import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Workspace, validateWorkspaceDirectory } from "./tools/workspace.js";
import { listDirectory } from "./tools/list-directory.js";
import { readFile } from "./tools/read-file.js";
import { createFile } from "./tools/create-file.js";
import { editFile } from "./tools/edit-file.js";
import { buildFileTree } from "./tools/file-tree.js";
import { browseDirectory } from "./tools/directory-browser.js";
import { runAgent } from "./agent.js";
import { spawn } from "node:child_process";
import { captureWorkspaceBaseline, detectChanges, ChangedFile, generateDiffForDisplay, TaskBaseline } from "./tools/file-tracker.js";
import { getAppRuntime, isUrlServing, isProcessAlive } from "./tools/app-lifecycle.js";
import { createSessionManager } from "./session/session-manager.js";
import { SessionData, SessionMetadata } from "./session/session-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (_req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});
app.use(express.static(path.join(__dirname, "../public")));

interface ClientConnection {
  ws: WebSocket;
  workspaceRoot: string | null;
  currentTaskId: string | null;
  currentSessionId: string | null;
  agentProcess: any | null;
  baseline: TaskBaseline | null;
  changedFiles: ChangedFile[];
  reviewState: "NOT_REQUIRED" | "REVIEW_AVAILABLE" | "APPROVED" | "REJECTED";
  verificationStatus: "PENDING" | "PASSED" | "FAILED" | "NOT_REQUESTED";
  buildStatus: "PENDING" | "PASSED" | "FAILED" | "NOT_RUN";
  browserStatus: "PENDING" | "PASSED" | "FAILED" | "NOT_RUN";
  sessionManager: ReturnType<typeof createSessionManager>;
  workspaceLockHeld: boolean;
}

const clients = new Map<WebSocket, ClientConnection>();
const sessionManager = createSessionManager();

function broadcastToClient(ws: WebSocket, event: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function sendEvent(ws: WebSocket, type: string, data: any) {
  broadcastToClient(ws, { type, timestamp: Date.now(), ...data });
}

wss.on("connection", (ws) => {
  const client: ClientConnection = {
    ws,
    workspaceRoot: null,
    currentTaskId: null,
    currentSessionId: null,
    agentProcess: null,
    baseline: null,
    changedFiles: [],
    reviewState: "NOT_REQUIRED",
    verificationStatus: "NOT_REQUESTED",
    buildStatus: "NOT_RUN",
    browserStatus: "NOT_RUN",
    sessionManager,
    workspaceLockHeld: false,
  };
  clients.set(ws, client);

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleMessage(client, message);
    } catch (err) {
      console.error("Message handling error:", err);
      sendEvent(ws, "error", { message: "Invalid message format" });
    }
  });

  ws.on("close", async () => {
    if (client.agentProcess) {
      client.agentProcess.kill("SIGTERM");
    }
    if (client.workspaceLockHeld && client.workspaceRoot) {
      await client.sessionManager.releaseLock(client.workspaceRoot);
      client.workspaceLockHeld = false;
    }
    clients.delete(ws);
  });

  sendEvent(ws, "connected", { message: "Connected to Achu Workspace" });
});

async function handleMessage(client: ClientConnection, message: any) {
  const { type, payload } = message;

  switch (type) {
    case "select_project": {
      const projectPath = payload.path;
      if (!projectPath || String(projectPath).trim().length === 0) {
        sendEvent(client.ws, "error", { message: "Project path is required" });
        return;
      }

      // Refuse to switch workspaces while a task is running in the current one.
      if (client.agentProcess) {
        sendEvent(client.ws, "error", {
          message: "Cannot change workspace while a task is running. Stop the task first.",
        });
        return;
      }

      try {
        // Never fall back to another directory: invalid selections fail loudly.
        const selection = await validateWorkspaceDirectory(String(projectPath));
        client.workspaceRoot = selection.root;
        client.currentSessionId = null;
        client.currentTaskId = null;
        client.changedFiles = [];
        client.baseline = null;

        sendEvent(client.ws, "project_selected", {
          path: selection.root,
          entryCount: selection.entries,
        });

        // If an active app server exists for this workspace, send the live URL immediately
        const runtime = getAppRuntime(selection.root);
        if (runtime && runtime.url && isProcessAlive(runtime.pid) && await isUrlServing(runtime.url)) {
          sendEvent(client.ws, "app_url", { url: runtime.url });
        }

        // Immediately populate the file tree for the newly selected workspace.
        const workspace = new Workspace(selection.root);
        const tree = await buildFileTree(workspace);
        sendEvent(client.ws, "file_tree", { path: selection.root, tree });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent(client.ws, "project_error", { path: String(projectPath), message: msg });
      }
      break;
    }

    case "browse_directory": {
      try {
        const result = await browseDirectory(payload.path ? String(payload.path) : undefined);
        sendEvent(client.ws, "directory_browsed", {
          path: result.path,
          parent: result.parent,
          directories: result.directories,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent(client.ws, "browse_error", {
          path: payload.path ? String(payload.path) : null,
          message: msg,
        });
      }
      break;
    }

    case "get_file_tree": {
      if (!client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No project selected" });
        return;
      }
      try {
        const workspace = new Workspace(client.workspaceRoot);
        const tree = await buildFileTree(workspace);
        sendEvent(client.ws, "file_tree", { path: client.workspaceRoot, tree });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent(client.ws, "error", { message: `Failed to build file tree: ${msg}` });
      }
      break;
    }

    case "create_file": {
      if (!client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No project selected" });
        return;
      }
      const filePath = payload.path;
      if (!filePath) {
        sendEvent(client.ws, "error", { message: "File path is required" });
        return;
      }
      if (typeof payload.content !== "string") {
        sendEvent(client.ws, "error", { message: "File content is required" });
        return;
      }
      try {
        const workspace = new Workspace(client.workspaceRoot);
        const result = await createFile(workspace, filePath, payload.content);
        sendEvent(client.ws, "file_created", { path: filePath, message: result });
        const tree = await buildFileTree(workspace);
        sendEvent(client.ws, "file_tree", { path: client.workspaceRoot, tree });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent(client.ws, "file_operation_error", { operation: "create", path: filePath, message: msg });
      }
      break;
    }

    case "edit_file": {
      if (!client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No project selected" });
        return;
      }
      const { path: filePath } = payload;
      if (typeof filePath !== "string" || !filePath.trim()) {
        sendEvent(client.ws, "error", { message: "File path is required" });
        return;
      }
      if (!payload.edits && (typeof payload.oldText !== "string" || typeof payload.newText !== "string")) {
        sendEvent(client.ws, "error", { message: "Either 'edits' array or 'oldText'/'newText' are required" });
        return;
      }
      try {
        const workspace = new Workspace(client.workspaceRoot);
        const edits = payload.edits || [{ oldText: payload.oldText, newText: payload.newText }];
        const result = await editFile(workspace, filePath, edits);
        sendEvent(client.ws, "file_edited", { path: filePath, message: result });
        const tree = await buildFileTree(workspace);
        sendEvent(client.ws, "file_tree", { path: client.workspaceRoot, tree });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent(client.ws, "file_operation_error", { operation: "edit", path: filePath, message: msg });
      }
      break;
    }

    case "create_session": {
      if (!client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No project selected" });
        return;
      }
      const task = payload.task;
      if (!task) {
        sendEvent(client.ws, "error", { message: "Task is required" });
        return;
      }
      
      const lockAcquired = await client.sessionManager.tryAcquireLock(client.workspaceRoot);
      if (!lockAcquired) {
        sendEvent(client.ws, "error", { message: "Workspace is currently being modified by another active session" });
        return;
      }
      client.workspaceLockHeld = true;
      
      const session = await client.sessionManager.createSession(client.workspaceRoot, task);
      client.currentSessionId = session.metadata.sessionId;
      client.currentTaskId = session.metadata.taskId;
      
      sendEvent(client.ws, "session_created", { 
        sessionId: session.metadata.sessionId,
        taskId: session.metadata.taskId,
        task: session.metadata.task,
        status: session.metadata.status,
      });
      break;
    }

    case "get_session": {
      const sessionId = payload.sessionId;
      if (!sessionId) {
        sendEvent(client.ws, "error", { message: "Session ID required" });
        return;
      }
      if (!client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No project selected" });
        return;
      }
      
      const session = await client.sessionManager.getSession(client.workspaceRoot, sessionId);
      if (!session) {
        sendEvent(client.ws, "error", { message: "Session not found" });
        return;
      }
      sendEvent(client.ws, "session_state", { session });
      break;
    }

    case "list_sessions": {
      if (!client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No project selected" });
        return;
      }
      const sessions = await client.sessionManager.listSessions(client.workspaceRoot);
      sendEvent(client.ws, "session_list", { sessions });
      break;
    }

    case "pause_session": {
      if (!client.currentSessionId || !client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No active session" });
        return;
      }
      try {
        const session = await client.sessionManager.pauseSession(client.workspaceRoot, client.currentSessionId);
        if (session) {
          sendEvent(client.ws, "session_paused", { sessionId: client.currentSessionId });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent(client.ws, "error", { message: msg });
      }
      break;
    }

    case "resume_session": {
      if (!client.currentSessionId || !client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No active session" });
        return;
      }
      try {
        const session = await client.sessionManager.resumeSession(client.workspaceRoot, client.currentSessionId);
        if (session) {
          client.currentTaskId = session.metadata.taskId;
          sendEvent(client.ws, "session_resumed", { sessionId: client.currentSessionId });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent(client.ws, "error", { message: msg });
      }
      break;
    }

    case "cancel_session": {
      if (!client.currentSessionId || !client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No active session" });
        return;
      }
      const session = await client.sessionManager.cancelSession(client.workspaceRoot, client.currentSessionId);
      if (session) {
        sendEvent(client.ws, "session_cancelled", { sessionId: client.currentSessionId });
      }
      if (client.workspaceLockHeld) {
        await client.sessionManager.releaseLock(client.workspaceRoot);
        client.workspaceLockHeld = false;
      }
      client.currentSessionId = null;
      client.currentTaskId = null;
      break;
    }

    case "delete_session": {
      const sessionId = payload.sessionId;
      if (!sessionId || !client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "Session ID required" });
        return;
      }
      await client.sessionManager.deleteSession(client.workspaceRoot, sessionId);
      sendEvent(client.ws, "session_deleted", { sessionId });
      break;
    }

    case "acquire_lock": {
      if (!client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No project selected" });
        return;
      }
      const acquired = await client.sessionManager.tryAcquireLock(client.workspaceRoot);
      if (acquired) {
        client.workspaceLockHeld = true;
        sendEvent(client.ws, "lock_acquired", {});
      } else {
        sendEvent(client.ws, "error", { message: "Workspace is currently being modified by another active session" });
      }
      break;
    }

    case "release_lock": {
      if (!client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No project selected" });
        return;
      }
      if (client.workspaceLockHeld) {
        await client.sessionManager.releaseLock(client.workspaceRoot);
        client.workspaceLockHeld = false;
        sendEvent(client.ws, "lock_released", {});
      }
      break;
    }

    case "list_directory": {
      if (!client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No project selected" });
        return;
      }
      try {
        const workspace = new Workspace(client.workspaceRoot);
        const relativePath = payload.path || ".";
        const result = await listDirectory(workspace, relativePath);
        sendEvent(client.ws, "directory_listed", { path: relativePath, content: result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent(client.ws, "error", { message: `Failed to list directory: ${msg}` });
      }
      break;
    }

    case "read_file": {
      if (!client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No project selected" });
        return;
      }
      const filePath = payload.path;
      if (!filePath) {
        sendEvent(client.ws, "error", { message: "File path is required" });
        return;
      }
      try {
        const workspace = new Workspace(client.workspaceRoot);
        const content = await readFile(workspace, filePath);
        sendEvent(client.ws, "file_read", { path: filePath, content });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent(client.ws, "error", { message: `Failed to read file: ${msg}` });
      }
      break;
    }

    case "run_task": {
      if (!client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No project selected" });
        return;
      }
      const task = payload.task;
      if (!task) {
        sendEvent(client.ws, "error", { message: "Task is required" });
        return;
      }

      // Check if resuming an existing session
      const resumeSessionId = payload.resumeSessionId;
      let sessionId: string;
      let taskId: string;
      let baseline: any = null;

      if (resumeSessionId) {
        // Resume existing session
        const session = await client.sessionManager.getSession(client.workspaceRoot, resumeSessionId);
        if (!session) {
          sendEvent(client.ws, "error", { message: "Session not found" });
          return;
        }
        if (session.metadata.status !== "PAUSED" && session.metadata.status !== "INTERRUPTED") {
          sendEvent(client.ws, "error", { message: `Cannot resume session in status: ${session.metadata.status}` });
          return;
        }
        
        const lockAcquired = await client.sessionManager.tryAcquireLock(client.workspaceRoot);
        if (!lockAcquired) {
          sendEvent(client.ws, "error", { message: "Workspace is currently being modified by another active session" });
          return;
        }
        client.workspaceLockHeld = true;
        
        sessionId = session.metadata.sessionId;
        taskId = session.metadata.taskId;
        client.currentSessionId = sessionId;
        client.currentTaskId = taskId;
        
        // Restore baseline from session if available
        if (session.metadata.currentPlan.length > 0) {
          baseline = session.metadata.currentPlan;
        }
        
        const resumedSession = await client.sessionManager.resumeSession(client.workspaceRoot, sessionId);
        if (resumedSession) {
          sendEvent(client.ws, "session_resumed", { sessionId });
        }
      } else {
        // Create new session
        const lockAcquired = await client.sessionManager.tryAcquireLock(client.workspaceRoot);
        if (!lockAcquired) {
          sendEvent(client.ws, "error", { message: "Workspace is currently being modified by another active session" });
          return;
        }
        client.workspaceLockHeld = true;
        
        const session = await client.sessionManager.createSession(client.workspaceRoot, task);
        sessionId = session.metadata.sessionId;
        taskId = session.metadata.taskId;
        client.currentSessionId = sessionId;
        client.currentTaskId = taskId;
        
        const workspace = new Workspace(client.workspaceRoot);
        baseline = await captureWorkspaceBaseline(workspace, taskId);
        client.baseline = baseline;
        
        sendEvent(client.ws, "session_created", { 
          sessionId: session.metadata.sessionId,
          taskId: session.metadata.taskId,
          task: session.metadata.task,
          status: session.metadata.status,
        });
      }

      client.changedFiles = [];
      client.reviewState = "NOT_REQUIRED";
      client.verificationStatus = "NOT_REQUESTED";
      client.buildStatus = "NOT_RUN";
      client.browserStatus = "NOT_RUN";

      sendEvent(client.ws, "task_started", { taskId, task, status: "running", sessionId, workspaceRoot: client.workspaceRoot });
      sendEvent(client.ws, "task_status", { taskId, status: "RUNNING", sessionId, workspaceRoot: client.workspaceRoot });

      try {
        await runAgentWithWorkspace(client, client.workspaceRoot, task, taskId, sessionId, baseline);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent(client.ws, "task_failed", { taskId, error: msg, sessionId });
      }
      break;
    }

    case "stop_task": {
      if (client.agentProcess) {
        client.agentProcess.kill("SIGINT");
        sendEvent(client.ws, "task_stopped", { taskId: client.currentTaskId });
        client.agentProcess = null;
      }
      break;
    }

    case "get_diff": {
      if (!client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No project selected" });
        return;
      }
      const filePath = payload.path;
      if (!filePath) {
        sendEvent(client.ws, "error", { message: "File path is required" });
        return;
      }
      try {
        const workspace = new Workspace(client.workspaceRoot);
        const changedFile = client.changedFiles.find(f => f.path === filePath);
        if (!changedFile) {
          sendEvent(client.ws, "diff_result", { path: filePath, error: "File not in changed files" });
          return;
        }
        if (changedFile.isBinary) {
          sendEvent(client.ws, "diff_result", { 
            path: filePath, 
            isBinary: true, 
            message: "Binary file changed" 
          });
          return;
        }
        const diff = generateDiffForDisplay(changedFile.oldContent, changedFile.newContent, filePath);
        sendEvent(client.ws, "diff_result", { 
          path: filePath, 
          changeType: changedFile.changeType,
          diff: diff.lines,
          truncated: diff.truncated,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent(client.ws, "diff_result", { path: filePath, error: msg });
      }
      break;
    }

    case "approve_changes": {
      if (client.reviewState !== "REVIEW_AVAILABLE") {
        sendEvent(client.ws, "error", { message: "No changes available for review" });
        return;
      }
      client.reviewState = "APPROVED";
      if (client.currentSessionId && client.workspaceRoot) {
        await client.sessionManager.updateSession(client.workspaceRoot, client.currentSessionId, { 
          reviewState: "APPROVED" 
        });
      }
      sendEvent(client.ws, "approval_changed", { state: "APPROVED" });
      break;
    }

    case "reject_changes": {
      if (client.reviewState !== "REVIEW_AVAILABLE") {
        sendEvent(client.ws, "error", { message: "No changes available for review" });
        return;
      }
      client.reviewState = "REJECTED";
      if (client.currentSessionId && client.workspaceRoot) {
        await client.sessionManager.updateSession(client.workspaceRoot, client.currentSessionId, { 
          reviewState: "REJECTED" 
        });
      }
      sendEvent(client.ws, "approval_changed", { state: "REJECTED" });
      break;
    }

    default:
      sendEvent(client.ws, "error", { message: `Unknown message type: ${type}` });
  }
}

async function runAgentWithWorkspace(
  client: ClientConnection,
  workspaceRoot: string,
  task: string,
  taskId: string,
  sessionId: string,
  baseline: any
): Promise<void> {
  console.log(`[run_task] Received run_task for sessionId=${sessionId} taskId=${taskId}`);
  console.log(`[run_task] workspaceRoot=${workspaceRoot}`);

  // Run the CLI from the main project directory (where dist/cli.js exists)
  // while passing the target workspace via WORKSPACE_ROOT env
  const mainProjectDir = path.resolve(__dirname, "..");
  const cliPath = path.resolve(mainProjectDir, "dist", "cli.js");

  console.log(`[run_task] mainProjectDir=${mainProjectDir}`);
  console.log(`[run_task] CLI absolute path=${cliPath}`);

  // Verify the executable exists before spawning
  const cliExists = fs.existsSync(cliPath);
  console.log(`[run_task] CLI exists check: ${cliExists}`);
  if (!cliExists) {
    const errorMsg = `CLI executable not found at: ${cliPath}. Please run 'npm run build' first.`;
    console.error(`[run_task] ${errorMsg}`);
    
    await cleanupAndEmitFailure(client, workspaceRoot, sessionId, taskId, errorMsg);
    return;
  }

  const nodeExec = process.execPath;
  const spawnArgs = [cliPath, task];
  console.log(`[run_task] Spawning: ${nodeExec} ${spawnArgs.join(" ")}`);
  console.log(`[run_task] cwd: ${mainProjectDir}`);
  console.log(`[run_task] env.WORKSPACE_ROOT: ${workspaceRoot}`);
  console.log(`[run_task] env.ACHU_SESSION_ID: ${sessionId}`);
  console.log(`[run_task] env.ACHU_TASK_ID: ${taskId}`);

  // Pass session info to CLI via env
  const child = spawn(nodeExec, spawnArgs, {
    cwd: mainProjectDir,
    env: { 
      ...process.env, 
      WORKSPACE_ROOT: workspaceRoot,
      ACHU_SESSION_ID: sessionId,
      ACHU_TASK_ID: taskId,
    },
    windowsHide: true,
  });

  client.agentProcess = child;

  console.log(`[run_task] Child process spawned, PID: ${child.pid ?? "unknown"}`);

  let stdoutBuffer = "";
  let stderrBuffer = "";

  child.on("spawn", () => {
    console.log(`[run_task] Child process 'spawn' event fired, PID: ${child.pid ?? "unknown"}`);
  });

  // Update session status to RUNNING
  if (client.workspaceRoot) {
    await client.sessionManager.updateSession(client.workspaceRoot, sessionId, { 
      status: "RUNNING",
      startedAt: Date.now(),
    });
    await client.sessionManager.updateSession(client.workspaceRoot, sessionId, {
      phase: "execute",
    });
    sendEvent(client.ws, "session_status", { sessionId, status: "RUNNING" });
  }

  child.stdout.on("data", (data: Buffer) => {
    const text = data.toString();
    stdoutBuffer += text;
    console.log(`[run_task] stdout chunk (${text.length} chars): ${text.slice(0, 200).replace(/\n/g, "\\n")}`);
    sendEvent(client.ws, "agent_output", { taskId, stream: "stdout", content: text, sessionId });
    const m = text.match(/App started and ready at\s+(https?:\/\/[^\s"']+)/i);
    if (m?.[1]) {
      sendEvent(client.ws, "app_url", { url: m[1], taskId, sessionId });
    }
    if (text.includes("App process stopped.")) {
      sendEvent(client.ws, "app_url", { url: null, taskId, sessionId });
    }
  });

  child.stderr.on("data", (data: Buffer) => {
    const text = data.toString();
    stderrBuffer += text;
    console.log(`[run_task] stderr chunk (${text.length} chars): ${text.slice(0, 200).replace(/\n/g, "\\n")}`);
    sendEvent(client.ws, "agent_output", { taskId, stream: "stderr", content: text, sessionId });
    const m = text.match(/App started and ready at\s+(https?:\/\/[^\s"']+)/i);
    if (m?.[1]) {
      sendEvent(client.ws, "app_url", { url: m[1], taskId, sessionId });
    }
    if (text.includes("App process stopped.")) {
      sendEvent(client.ws, "app_url", { url: null, taskId, sessionId });
    }
  });

  child.on("error", async (err) => {
    console.error(`[run_task] Child process 'error' event: ${err.message}`, err);
    client.agentProcess = null;
    await cleanupAndEmitFailure(client, workspaceRoot, sessionId, taskId, `Spawn failed: ${err.message}`);
  });

  child.on("close", async (code, signal) => {
    console.log(`[run_task] Child process 'close' event: exitCode=${code}, signal=${signal}`);
    client.agentProcess = null;
    const finalOutput = stdoutBuffer + stderrBuffer;
    
    const workspace = new Workspace(workspaceRoot);
    const detectedChanges = baseline ? await detectChanges(workspace, baseline) : [];
    client.changedFiles = detectedChanges;
    
    const hasChanges = detectedChanges.length > 0;
    if (hasChanges) {
      client.reviewState = "REVIEW_AVAILABLE";
      sendEvent(client.ws, "review_available", { 
        taskId, 
        sessionId,
        changedFiles: detectedChanges.map(f => ({ path: f.path, changeType: f.changeType, additions: f.additions, deletions: f.deletions, isBinary: f.isBinary })),
      });
    }

    const verificationMatch = finalOutput.match(/VERIFICATION (PASSED|FAILED)/);
    const buildMatch = finalOutput.match(/(?:Build|build|BUILD).*?(PASSED|FAILED|passed|failed)/);
    const browserMatch = finalOutput.match(/Browser verification (PASSED|FAILED)/i);

    if (verificationMatch) {
      client.verificationStatus = verificationMatch[1] === "PASSED" ? "PASSED" : "FAILED";
    }
    if (buildMatch) {
      client.buildStatus = /PASSED|passed/i.test(buildMatch[1]) ? "PASSED" : "FAILED";
    }
    if (browserMatch) {
      client.browserStatus = browserMatch[1].toUpperCase() === "PASSED" ? "PASSED" : "FAILED";
    }

    sendEvent(client.ws, "verification_status", { 
      taskId, 
      sessionId,
      verification: client.verificationStatus,
      build: client.buildStatus,
      browser: client.browserStatus,
    });

    const success = code === 0 && signal === null;
    
    if (client.workspaceRoot) {
      const finalStatus = success ? "COMPLETED" : "FAILED";
      await client.sessionManager.completeSession(client.workspaceRoot, sessionId, success);
      
      sendEvent(client.ws, "session_completed", { 
        sessionId, 
        success,
        status: finalStatus,
      });
      
      // Release workspace lock
      if (client.workspaceLockHeld) {
        await client.sessionManager.releaseLock(client.workspaceRoot);
        client.workspaceLockHeld = false;
        console.log(`[run_task] Workspace lock released for ${workspaceRoot}`);
      }
    }

    if (success) {
      console.log(`[run_task] Task completed successfully`);
      sendEvent(client.ws, "task_completed", { 
        taskId, 
        sessionId,
        output: finalOutput,
        changedFiles: detectedChanges.map(f => ({ path: f.path, changeType: f.changeType, additions: f.additions, deletions: f.deletions, isBinary: f.isBinary })),
      });
      sendEvent(client.ws, "task_status", { taskId, status: "COMPLETED", sessionId });
    } else {
      const errorMsg = signal ? `Process terminated by signal ${signal}` : `Process exited with code ${code}`;
      console.log(`[run_task] Task failed: ${errorMsg}`);
      sendEvent(client.ws, "task_failed", { 
        taskId, 
        sessionId,
        error: errorMsg,
        output: finalOutput,
        changedFiles: detectedChanges.map(f => ({ path: f.path, changeType: f.changeType, additions: f.additions, deletions: f.deletions, isBinary: f.isBinary })),
      });
      sendEvent(client.ws, "task_status", { taskId, status: "FAILED", sessionId });
    }
    client.currentTaskId = null;
  });
}

async function cleanupAndEmitFailure(
  client: ClientConnection,
  workspaceRoot: string,
  sessionId: string,
  taskId: string,
  errorMsg: string
): Promise<void> {
  // Release workspace lock if held
  if (client.workspaceLockHeld && workspaceRoot) {
    await client.sessionManager.releaseLock(workspaceRoot);
    client.workspaceLockHeld = false;
    console.log(`[run_task] Workspace lock released during cleanup for ${workspaceRoot}`);
  }
  
  // Complete session as failed
  if (workspaceRoot) {
    await client.sessionManager.completeSession(workspaceRoot, sessionId, false);
  }
  
  // Send failure events
  sendEvent(client.ws, "task_failed", { taskId, sessionId, error: errorMsg });
  sendEvent(client.ws, "task_status", { taskId, status: "FAILED", sessionId });
  sendEvent(client.ws, "session_completed", { sessionId, success: false, status: "FAILED" });
  
  client.currentTaskId = null;
  client.agentProcess = null;
}

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Achu Workspace server running at http://localhost:${PORT}`);
});