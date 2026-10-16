import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Workspace, validateWorkspaceDirectory, getDefaultProjectsBaseDir, deriveProjectSlug, shouldIsolateNewProject } from "./tools/workspace.js";
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

function getOrCreatePairingToken(): string {
  try {
    const tokenDir = path.join(os.homedir(), ".achu");
    const tokenFile = path.join(tokenDir, "companion-token.txt");
    if (fs.existsSync(tokenFile)) {
      const existing = fs.readFileSync(tokenFile, "utf8").trim();
      if (existing.length >= 16) return existing;
    }
    fs.mkdirSync(tokenDir, { recursive: true });
    const newToken = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(tokenFile, newToken, { mode: 0o600 });
    return newToken;
  } catch {
    return "achu_local_token_default";
  }
}

export const COMPANION_TOKEN = process.env.ACHU_COMPANION_TOKEN || getOrCreatePairingToken();

function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    const allowed = (process.env.ACHU_ALLOWED_ORIGINS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.includes(origin.toLowerCase()) || allowed.includes(u.origin.toLowerCase()) || allowed.includes(host)) return true;
    if (host.endsWith(".vercel.app") || host.includes("works-with-achu")) return true;
  } catch {
    return false;
  }
  return false;
}

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.header("Access-Control-Allow-Origin", origin || "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-achu-companion-token");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Private-Network", "true");
  res.header("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

// Explicit health check endpoints for connection handshakes
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "achu-coding-agent",
    version: "1.0.0",
    companionMode: "local",
    timestamp: Date.now(),
    uptime: process.uptime(),
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "achu-coding-agent",
    version: "1.0.0",
    companionMode: "local",
    timestamp: Date.now(),
    uptime: process.uptime(),
  });
});

export interface LocalTaskRecord {
  id: string;
  sessionId: string;
  task: string;
  workspaceRoot: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  startTime: number;
  endTime?: number;
  childProcess: any | null;
  outputBuffer: string;
  outputEvents: Array<{ stream: "stdout" | "stderr"; content: string; timestamp: number }>;
  changedFiles: ChangedFile[];
  reviewState: "NOT_REQUIRED" | "REVIEW_AVAILABLE" | "APPROVED" | "REJECTED";
  verificationStatus: "PENDING" | "PASSED" | "FAILED" | "NOT_REQUESTED";
  buildStatus: "PENDING" | "PASSED" | "FAILED" | "NOT_RUN";
  browserStatus: "PENDING" | "PASSED" | "FAILED" | "NOT_RUN";
  appUrl: string | null;
  error?: string;
  baseline?: any;
}

export const activeTasks = new Map<string, LocalTaskRecord>();

// Companion REST API endpoints
app.get("/api/companion/status", (_req, res) => {
  const runningTask = Array.from(activeTasks.values()).find(t => t.status === "RUNNING");
  res.json({
    status: "ok",
    service: "achu-coding-agent",
    version: "1.0.0",
    companionMode: "local",
    activeTaskId: runningTask?.id || null,
    runningCount: Array.from(activeTasks.values()).filter(t => t.status === "RUNNING").length,
    timestamp: Date.now(),
    uptime: process.uptime(),
  });
});

app.get("/api/companion/token", (req, res) => {
  const ip = req.socket.remoteAddress;
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
    res.json({ ok: true, token: COMPANION_TOKEN });
  } else {
    res.status(403).json({ ok: false, error: "Token retrieval is restricted to loopback" });
  }
});

app.post("/api/companion/authorize-workspace", async (req, res) => {
  const { path: requestedPath } = req.body || {};
  if (!requestedPath || typeof requestedPath !== "string") {
    res.status(400).json({ ok: false, error: "Path is required" });
    return;
  }
  try {
    const selection = await validateWorkspaceDirectory(requestedPath);
    res.json({ ok: true, root: selection.root, realRoot: selection.realRoot, entries: selection.entries });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.get("/api/companion/browse", async (req, res) => {
  const targetPath = req.query.path ? String(req.query.path) : undefined;
  try {
    const result = await browseDirectory(targetPath);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.get("/api/companion/file-tree", async (req, res) => {
  const targetPath = req.query.path ? String(req.query.path) : undefined;
  if (!targetPath) {
    res.status(400).json({ ok: false, error: "Path query param is required" });
    return;
  }
  try {
    const selection = await validateWorkspaceDirectory(targetPath);
    const ws = new Workspace(selection.root);
    const tree = await buildFileTree(ws);
    res.json({ ok: true, root: selection.root, tree });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post("/api/companion/tasks", async (req, res) => {
  const { task, workspaceRoot, taskId: clientTaskId } = req.body || {};
  if (!task || typeof task !== "string" || !task.trim()) {
    res.status(400).json({ ok: false, error: "Task description is required" });
    return;
  }
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    res.status(400).json({ ok: false, error: "Authorized workspaceRoot is required" });
    return;
  }
  try {
    const selection = await validateWorkspaceDirectory(workspaceRoot);
    const effectiveRoot = selection.root;

    // Check if task is already running in this workspace
    const existing = Array.from(activeTasks.values()).find(
      t => t.workspaceRoot === effectiveRoot && t.status === "RUNNING"
    );
    if (existing) {
      res.status(409).json({ ok: false, error: "A task is already running in this workspace. Stop it first.", taskId: existing.id });
      return;
    }

    const taskId = clientTaskId || `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const session = await sessionManager.createSession(effectiveRoot, task);
    const sessionId = session.metadata.sessionId;

    const ws = new Workspace(effectiveRoot);
    const baseline = await captureWorkspaceBaseline(ws, taskId);

    const dummyClient: ClientConnection = {
      ws: null as any,
      workspaceRoot: effectiveRoot,
      currentTaskId: taskId,
      currentSessionId: sessionId,
      agentProcess: null,
      baseline,
      changedFiles: [],
      reviewState: "NOT_REQUIRED",
      verificationStatus: "NOT_REQUESTED",
      buildStatus: "NOT_RUN",
      browserStatus: "NOT_RUN",
      sessionManager,
      workspaceLockHeld: false,
    };

    runAgentWithWorkspace(dummyClient, effectiveRoot, task, taskId, sessionId, baseline).catch((err) => {
      console.error("[companion_task] Background task error:", err);
    });

    res.status(202).json({ ok: true, taskId, sessionId, status: "RUNNING", workspaceRoot: effectiveRoot });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.get("/api/companion/tasks/:taskId", (req, res) => {
  const task = activeTasks.get(req.params.taskId);
  if (!task) {
    res.status(404).json({ ok: false, error: "Task not found" });
    return;
  }
  res.json({
    ok: true,
    task: {
      id: task.id,
      sessionId: task.sessionId,
      task: task.task,
      workspaceRoot: task.workspaceRoot,
      status: task.status,
      startTime: task.startTime,
      endTime: task.endTime,
      output: task.outputBuffer,
      changedFiles: task.changedFiles,
      verificationStatus: task.verificationStatus,
      buildStatus: task.buildStatus,
      browserStatus: task.browserStatus,
      appUrl: task.appUrl,
      error: task.error,
    },
  });
});

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

function broadcastToAll(event: any) {
  const payload = JSON.stringify({ timestamp: Date.now(), ...event });
  for (const [ws] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

async function terminateTaskProcess(task: LocalTaskRecord): Promise<void> {
  if (task.childProcess) {
    const pid = task.childProcess.pid;
    if (pid) {
      if (process.platform === "win32") {
        try {
          spawn("taskkill", ["/pid", pid.toString(), "/t", "/f"], { windowsHide: true });
        } catch {}
      }
      try {
        task.childProcess.kill("SIGTERM");
      } catch {}
    }
    task.childProcess = null;
  }
  task.status = "CANCELLED";
  task.endTime = Date.now();
  task.error = "Cancelled by user";
  broadcastToAll({
    type: "task_stopped",
    taskId: task.id,
    sessionId: task.sessionId,
    status: "CANCELLED",
    workspaceRoot: task.workspaceRoot,
  });
  broadcastToAll({
    type: "task_status",
    taskId: task.id,
    status: "CANCELLED",
    sessionId: task.sessionId,
    workspaceRoot: task.workspaceRoot,
  });
}

app.post("/api/companion/tasks/:taskId/stop", async (req, res) => {
  const task = activeTasks.get(req.params.taskId);
  if (!task) {
    res.status(404).json({ ok: false, error: "Task not found" });
    return;
  }
  await terminateTaskProcess(task);
  res.json({ ok: true, status: "CANCELLED" });
});

app.use(express.static(path.join(__dirname, "../public")));

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
    // Note: Active background tasks persist across client disconnects, page navigation, and reloads.
    // They are ONLY stopped by an explicit stop_task command from the user.
    clients.delete(ws);
  });

  sendEvent(ws, "connected", {
    message: "Connected to Achu Workspace",
    companionVersion: "1.0.0",
    mode: "local",
  });

  // If a task is currently running, notify the newly connected client
  const runningTask = Array.from(activeTasks.values()).find(t => t.status === "RUNNING");
  if (runningTask) {
    sendEvent(ws, "task_status", {
      taskId: runningTask.id,
      status: "RUNNING",
      sessionId: runningTask.sessionId,
      workspaceRoot: runningTask.workspaceRoot,
      task: runningTask.task,
    });
  }
});

async function handleMessage(client: ClientConnection, message: any) {
  const { type, payload } = message;

  switch (type) {
    case "create_project": {
      try {
        const { path: requestedPath, name, task } = payload || {};
        let targetDir = requestedPath ? String(requestedPath).trim() : "";
        if (!targetDir) {
          const slug = deriveProjectSlug(name || task || `project-${Date.now()}`);
          targetDir = path.join(getDefaultProjectsBaseDir(), slug);
        }
        await fs.promises.mkdir(targetDir, { recursive: true });
        const selection = await validateWorkspaceDirectory(targetDir);
        client.workspaceRoot = selection.root;
        client.currentSessionId = null;
        client.currentTaskId = null;
        client.changedFiles = [];
        client.baseline = null;

        sendEvent(client.ws, "project_selected", {
          path: selection.root,
          entryCount: selection.entries,
          isNew: true,
        });
        sendEvent(client.ws, "app_url", {
          url: null,
          workspaceRoot: selection.root,
        });

        const workspace = new Workspace(selection.root);
        const tree = await buildFileTree(workspace);
        sendEvent(client.ws, "file_tree", { path: selection.root, tree });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendEvent(client.ws, "project_error", { message: msg });
      }
      break;
    }

    case "authorize_workspace":
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
        // Automatically create if explicitly requested or if under default projects dir
        if (payload.createIfMissing && !fs.existsSync(String(projectPath))) {
          await fs.promises.mkdir(String(projectPath), { recursive: true });
        }

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
          authorized: true,
        });

        // If an active app server exists for this workspace, send the live URL immediately
        const runtime = getAppRuntime(selection.root);
        if (runtime && runtime.url && isProcessAlive(runtime.pid) && await isUrlServing(runtime.url)) {
          sendEvent(client.ws, "app_url", {
            url: runtime.url,
            workspaceRoot: selection.root,
            port: runtime.port,
            pid: runtime.pid,
          });
        } else {
          // Explicitly clear preview for workspace without running app
          sendEvent(client.ws, "app_url", {
            url: null,
            workspaceRoot: selection.root,
          });
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
        const result = await createFile(workspace, filePath, payload.content, payload.overwrite ?? true);
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

    case "get_active_task":
    case "reconnect_task": {
      const targetTaskId = payload?.taskId;
      let targetTask: LocalTaskRecord | undefined;
      if (targetTaskId) {
        targetTask = activeTasks.get(targetTaskId);
      }
      if (!targetTask && client.workspaceRoot) {
        targetTask = Array.from(activeTasks.values()).reverse().find(t => t.workspaceRoot === client.workspaceRoot);
      }
      if (!targetTask) {
        targetTask = Array.from(activeTasks.values()).reverse().find(t => t.status === "RUNNING");
      }
      if (targetTask) {
        client.currentTaskId = targetTask.id;
        client.currentSessionId = targetTask.sessionId;
        if (!client.workspaceRoot && targetTask.workspaceRoot) {
          client.workspaceRoot = targetTask.workspaceRoot;
        }
        sendEvent(client.ws, "task_restored", {
          taskId: targetTask.id,
          sessionId: targetTask.sessionId,
          task: targetTask.task,
          status: targetTask.status,
          workspaceRoot: targetTask.workspaceRoot,
          output: targetTask.outputBuffer,
          changedFiles: targetTask.changedFiles,
          verificationStatus: targetTask.verificationStatus,
          buildStatus: targetTask.buildStatus,
          browserStatus: targetTask.browserStatus,
          appUrl: targetTask.appUrl,
          error: targetTask.error,
        });
      } else {
        sendEvent(client.ws, "task_restored", { taskId: null, status: "idle" });
      }
      break;
    }

    case "run_task": {
      const task = payload.task;
      if (!task) {
        sendEvent(client.ws, "error", { message: "Task is required" });
        return;
      }

      // Check if explicit workspace directory is provided in payload
      const explicitWorkspace = (payload.workspaceRoot ? String(payload.workspaceRoot).trim() : null) || client.workspaceRoot;
      if (explicitWorkspace) {
        try {
          const selection = await validateWorkspaceDirectory(explicitWorkspace);
          client.workspaceRoot = selection.root;
        } catch (err: any) {
          sendEvent(client.ws, "error", { message: `Invalid workspace directory: ${err.message}` });
          return;
        }
      }

      // Only isolate if client explicitly requested a new project or no workspace is active at all
      if (!client.workspaceRoot) {
        const slug = deriveProjectSlug(payload.projectName || task);
        const baseDir = getDefaultProjectsBaseDir();
        let targetDir = path.join(baseDir, slug);
        if (fs.existsSync(targetDir)) {
          try {
            const files = fs.readdirSync(targetDir);
            if (files.length > 0) {
              targetDir = path.join(baseDir, `${slug}-${Date.now()}`);
            }
          } catch {}
        }
        await fs.promises.mkdir(targetDir, { recursive: true });
        const selection = await validateWorkspaceDirectory(targetDir);
        client.workspaceRoot = selection.root;
        client.currentSessionId = null;
        client.currentTaskId = null;
        client.changedFiles = [];
        client.baseline = null;

        sendEvent(client.ws, "project_selected", {
          path: selection.root,
          entryCount: selection.entries,
          isNew: true,
          authorized: true,
        });
        sendEvent(client.ws, "app_url", {
          url: null,
          workspaceRoot: selection.root,
        });

        const wsObj = new Workspace(selection.root);
        const tree = await buildFileTree(wsObj);
        sendEvent(client.ws, "file_tree", { path: selection.root, tree });
      }

      if (!client.workspaceRoot) {
        sendEvent(client.ws, "error", { message: "No project selected" });
        return;
      }

      // Prevent duplicate tasks running in the same workspace
      const alreadyRunning = Array.from(activeTasks.values()).find(
        t => t.workspaceRoot === client.workspaceRoot && t.status === "RUNNING"
      );
      if (alreadyRunning) {
        sendEvent(client.ws, "error", {
          message: "A task is already running in this workspace. Stop it first.",
          taskId: alreadyRunning.id,
        });
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
        taskId = payload.taskId || session.metadata.taskId;
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
        taskId = payload.taskId || session.metadata.taskId;
        client.currentSessionId = sessionId;
        client.currentTaskId = taskId;
        
        const workspace = new Workspace(client.workspaceRoot);
        baseline = await captureWorkspaceBaseline(workspace, taskId);
        client.baseline = baseline;
        
        sendEvent(client.ws, "session_created", { 
          sessionId: session.metadata.sessionId,
          taskId,
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
      const taskIdToStop = payload?.taskId || client.currentTaskId;
      let taskToStop: LocalTaskRecord | undefined;
      if (taskIdToStop) {
        taskToStop = activeTasks.get(taskIdToStop);
      }
      if (!taskToStop && client.workspaceRoot) {
        taskToStop = Array.from(activeTasks.values()).find(t => t.workspaceRoot === client.workspaceRoot && t.status === "RUNNING");
      }
      if (taskToStop) {
        await terminateTaskProcess(taskToStop);
        sendEvent(client.ws, "task_stopped", { taskId: taskToStop.id });
      } else if (client.agentProcess) {
        try {
          if (process.platform === "win32" && client.agentProcess.pid) {
            spawn("taskkill", ["/pid", client.agentProcess.pid.toString(), "/t", "/f"], { windowsHide: true });
          }
          client.agentProcess.kill("SIGTERM");
        } catch {}
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

  const taskRecord: LocalTaskRecord = {
    id: taskId,
    sessionId,
    task,
    workspaceRoot,
    status: "RUNNING",
    startTime: Date.now(),
    childProcess: null,
    outputBuffer: "",
    outputEvents: [],
    changedFiles: [],
    reviewState: "NOT_REQUIRED",
    verificationStatus: "NOT_REQUESTED",
    buildStatus: "NOT_RUN",
    browserStatus: "NOT_RUN",
    appUrl: null,
    baseline,
  };
  activeTasks.set(taskId, taskRecord);

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
  taskRecord.childProcess = child;

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
    broadcastToAll({ type: "session_status", sessionId, status: "RUNNING" });
  }

  child.stdout.on("data", (data: Buffer) => {
    const text = data.toString();
    stdoutBuffer += text;
    taskRecord.outputBuffer += text;
    taskRecord.outputEvents.push({ stream: "stdout", content: text, timestamp: Date.now() });
    console.log(`[run_task] stdout chunk (${text.length} chars): ${text.slice(0, 200).replace(/\n/g, "\\n")}`);
    broadcastToAll({ type: "agent_output", taskId, stream: "stdout", content: text, sessionId, workspaceRoot: client.workspaceRoot || workspaceRoot });
    const m = text.match(/App started and ready at\s+(https?:\/\/[^\s"']+)/i);
    if (m?.[1]) {
      taskRecord.appUrl = m[1];
      broadcastToAll({ type: "app_url", url: m[1], taskId, sessionId, workspaceRoot: client.workspaceRoot || workspaceRoot });
    }
    if (text.includes("App process stopped.")) {
      taskRecord.appUrl = null;
      broadcastToAll({ type: "app_url", url: null, taskId, sessionId, workspaceRoot: client.workspaceRoot || workspaceRoot });
    }

    // Synchronize workspace root if the CLI updated it to a child/application directory
    const rootMatch = text.match(/(?:Authoritative project root updated to|Updated workspace root to match application directory|Established authoritative project root at subdirectory):\s+(.+)/i);
    if (rootMatch && rootMatch[1]) {
      const candidateRoot = rootMatch[1].trim().replace(/[\r\n]+$/, "");
      if (fs.existsSync(candidateRoot)) {
        console.log(`[run_task] Authoritative project root updated to: ${candidateRoot}`);
        client.workspaceRoot = candidateRoot;
        taskRecord.workspaceRoot = candidateRoot;
        broadcastToAll({ type: "project_selected", path: candidateRoot, entryCount: 0, authorized: true });
        try {
          const wsObj = new Workspace(candidateRoot);
          buildFileTree(wsObj).then((tree) => {
            broadcastToAll({ type: "file_tree", path: candidateRoot, tree });
          }).catch(() => {});
        } catch {}
      }
    }
  });

  child.stderr.on("data", (data: Buffer) => {
    const text = data.toString();
    stderrBuffer += text;
    taskRecord.outputBuffer += text;
    taskRecord.outputEvents.push({ stream: "stderr", content: text, timestamp: Date.now() });
    console.log(`[run_task] stderr chunk (${text.length} chars): ${text.slice(0, 200).replace(/\n/g, "\\n")}`);
    broadcastToAll({ type: "agent_output", taskId, stream: "stderr", content: text, sessionId, workspaceRoot: client.workspaceRoot || workspaceRoot });
    const m = text.match(/App started and ready at\s+(https?:\/\/[^\s"']+)/i);
    if (m?.[1]) {
      taskRecord.appUrl = m[1];
      broadcastToAll({ type: "app_url", url: m[1], taskId, sessionId, workspaceRoot: client.workspaceRoot || workspaceRoot });
    }
    if (text.includes("App process stopped.")) {
      taskRecord.appUrl = null;
      broadcastToAll({ type: "app_url", url: null, taskId, sessionId, workspaceRoot: client.workspaceRoot || workspaceRoot });
    }
  });

  child.on("error", async (err) => {
    console.error(`[run_task] Child process 'error' event: ${err.message}`, err);
    client.agentProcess = null;
    taskRecord.childProcess = null;
    taskRecord.status = "FAILED";
    taskRecord.error = `Spawn failed: ${err.message}`;
    taskRecord.endTime = Date.now();
    await cleanupAndEmitFailure(client, client.workspaceRoot || workspaceRoot, sessionId, taskId, `Spawn failed: ${err.message}`);
  });

  child.on("close", async (code, signal) => {
    console.log(`[run_task] Child process 'close' event: exitCode=${code}, signal=${signal}`);
    client.agentProcess = null;
    taskRecord.childProcess = null;
    taskRecord.endTime = Date.now();
    const finalOutput = stdoutBuffer + stderrBuffer;
    taskRecord.outputBuffer = finalOutput;
    
    const effectiveRoot = client.workspaceRoot || workspaceRoot;
    const workspace = new Workspace(effectiveRoot);
    const detectedChanges = baseline ? await detectChanges(workspace, baseline) : [];
    client.changedFiles = detectedChanges;
    taskRecord.changedFiles = detectedChanges;
    
    const hasChanges = detectedChanges.length > 0;
    if (hasChanges) {
      client.reviewState = "REVIEW_AVAILABLE";
      taskRecord.reviewState = "REVIEW_AVAILABLE";
      broadcastToAll({ 
        type: "review_available",
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
      taskRecord.verificationStatus = client.verificationStatus;
    }
    if (buildMatch) {
      client.buildStatus = /PASSED|passed/i.test(buildMatch[1]) ? "PASSED" : "FAILED";
      taskRecord.buildStatus = client.buildStatus;
    }
    if (browserMatch) {
      client.browserStatus = browserMatch[1].toUpperCase() === "PASSED" ? "PASSED" : "FAILED";
      taskRecord.browserStatus = client.browserStatus;
    }

    broadcastToAll({ 
      type: "verification_status",
      taskId, 
      sessionId,
      verification: client.verificationStatus,
      build: client.buildStatus,
      browser: client.browserStatus,
    });

    const success = code === 0 && signal === null;
    if (taskRecord.status !== "CANCELLED") {
      taskRecord.status = success ? "COMPLETED" : "FAILED";
    }
    
    if (client.workspaceRoot) {
      const finalStatus = success ? "COMPLETED" : "FAILED";
      await client.sessionManager.completeSession(client.workspaceRoot, sessionId, success);
      
      broadcastToAll({ 
        type: "session_completed",
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
      broadcastToAll({ 
        type: "task_completed",
        taskId, 
        sessionId,
        output: finalOutput,
        changedFiles: detectedChanges.map(f => ({ path: f.path, changeType: f.changeType, additions: f.additions, deletions: f.deletions, isBinary: f.isBinary })),
        workspaceRoot: effectiveRoot,
      });
      broadcastToAll({ type: "task_status", taskId, status: "COMPLETED", sessionId, workspaceRoot: effectiveRoot });
    } else {
      const errorMsg = signal ? `Process terminated by signal ${signal}` : `Process exited with code ${code}`;
      console.log(`[run_task] Task failed: ${errorMsg}`);
      taskRecord.error = errorMsg;
      broadcastToAll({ 
        type: "task_failed",
        taskId, 
        sessionId,
        error: errorMsg,
        output: finalOutput,
        changedFiles: detectedChanges.map(f => ({ path: f.path, changeType: f.changeType, additions: f.additions, deletions: f.deletions, isBinary: f.isBinary })),
        workspaceRoot: effectiveRoot,
      });
      broadcastToAll({ type: "task_status", taskId, status: "FAILED", sessionId, workspaceRoot: effectiveRoot });
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
  broadcastToAll({ type: "task_failed", taskId, sessionId, error: errorMsg, workspaceRoot });
  broadcastToAll({ type: "task_status", taskId, status: "FAILED", sessionId, workspaceRoot });
  broadcastToAll({ type: "session_completed", sessionId, success: false, status: "FAILED" });
  
  client.currentTaskId = null;
  client.agentProcess = null;
}

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "127.0.0.1";

server.listen(Number(PORT), HOST, () => {
  console.log(`Achu Workspace server running at http://${HOST}:${PORT}`);
  console.log(`[Companion] Pairing Token: ${COMPANION_TOKEN}`);
});