import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Workspace, validateWorkspaceDirectory, isInsideRoot, getDefaultProjectsBaseDir, deriveProjectSlug, shouldIsolateNewProject } from "./tools/workspace.js";
import { exportWorkspaceFiles, DEFAULT_WORKSPACE_EXPORT_LIMITS } from "./tools/workspace-export.js";
import { listDirectory } from "./tools/list-directory.js";
import { readFile } from "./tools/read-file.js";
import { createFile } from "./tools/create-file.js";
import { editFile } from "./tools/edit-file.js";
import { buildFileTree } from "./tools/file-tree.js";
import { browseDirectory } from "./tools/directory-browser.js";
import { runAgent } from "./agent.js";
import { spawn } from "node:child_process";
import { captureWorkspaceBaseline, detectChanges, ChangedFile, generateDiffForDisplay, TaskBaseline } from "./tools/file-tracker.js";
import { getAppRuntime, isUrlServing, isProcessAlive, ensureAppServer, clearAppRuntime } from "./tools/app-lifecycle.js";
import { createSessionManager } from "./session/session-manager.js";
import { SessionData, SessionMetadata } from "./session/session-types.js";
import { sanitizeUserFacingError } from "./utils/error-sanitizer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AGENT_PACKAGE_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    return String(pkg.version ?? "1.0.0");
  } catch {
    return "1.0.0";
  }
})();

function loadLocalEnv(): void {
  const candidateEnvPaths = [
    path.join(os.homedir(), ".achu", ".env"),
    path.join(os.homedir(), ".achu", "agent.env"),
    path.join(__dirname, ".env"),
    path.join(__dirname, "..", ".env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
    "C:\\Users\\Achu146\\achu-coding-agent\\.env",
    "C:\\Users\\Achu146\\OneDrive\\Desktop\\works-with-achu-v2\\.env",
  ];
  for (const envPath of candidateEnvPaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, "utf8");
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
            if (!process.env[key] && val) {
              process.env[key] = val;
            }
          }
        }
        console.log(`[env] Loaded environment configurations from: ${envPath}`);
      } catch {}
    }
  }
}
function initFileLogging(): void {
  try {
    const logDir = path.join(os.homedir(), ".achu");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFilePath = path.join(logDir, "agent.log");
    const logStream = fs.createWriteStream(logFilePath, { flags: "a" });
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = (...args: any[]) => {
      originalLog(...args);
      try {
        logStream.write(`[${new Date().toISOString()}] [INFO] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}\n`);
      } catch {}
    };

    console.error = (...args: any[]) => {
      originalError(...args);
      try {
        logStream.write(`[${new Date().toISOString()}] [ERROR] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}\n`);
      } catch {}
    };

    console.warn = (...args: any[]) => {
      originalWarn(...args);
      try {
        logStream.write(`[${new Date().toISOString()}] [WARN] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}\n`);
      } catch {}
    };
  } catch {}
}
initFileLogging();
loadLocalEnv();

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

export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    const allowed = (process.env.ACHU_ALLOWED_ORIGINS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.includes(origin.toLowerCase()) || allowed.includes(u.origin.toLowerCase()) || allowed.includes(host)) return true;
    if (host === "workswithachu.me" || host.endsWith(".workswithachu.me")) return true;
    if (host === "works-with-achu.me" || host.endsWith(".works-with-achu.me")) return true;
    if (host.includes("workswithachu") || host.includes("works-with-achu")) return true;
    if (host.endsWith(".vercel.app")) return true;
  } catch {
    return false;
  }
  return false;
}

/**
 * Workspace roots the user has explicitly authorized in this companion session.
 * `export-workspace` only exports from these roots, so a webpage can never read
 * arbitrary directories even if it has the pairing token.
 */
const authorizedWorkspaceRoots = new Set<string>();

function registerAuthorizedRoots(root: string, realRoot?: string): void {
  for (const candidate of [root, realRoot]) {
    if (!candidate || typeof candidate !== "string") continue;
    try {
      authorizedWorkspaceRoots.add(path.resolve(candidate));
    } catch {}
  }
}

function isAuthorizedForExport(candidateRoot: string, realRoot?: string): boolean {
  for (const candidate of [candidateRoot, realRoot]) {
    if (!candidate || typeof candidate !== "string") continue;
    let resolved: string;
    try {
      resolved = path.resolve(candidate);
    } catch {
      continue;
    }
    for (const authorized of authorizedWorkspaceRoots) {
      if (isInsideRoot(authorized, resolved)) return true;
    }
  }
  return false;
}

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    res.status(403).json({ ok: false, error: "Forbidden: Origin not authorized to access local companion" });
    return;
  }
  if (origin) {
    res.header("Access-Control-Allow-Origin", origin);
  } else {
    res.header("Access-Control-Allow-Origin", "*");
  }
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
    version: AGENT_PACKAGE_VERSION,
    companionMode: "local",
    timestamp: Date.now(),
    uptime: process.uptime(),
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "achu-coding-agent",
    version: AGENT_PACKAGE_VERSION,
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
  status: "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
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
    version: AGENT_PACKAGE_VERSION,
    companionMode: "local",
    activeTaskId: runningTask?.id || null,
    runningCount: Array.from(activeTasks.values()).filter(t => t.status === "RUNNING").length,
    timestamp: Date.now(),
    uptime: process.uptime(),
  });
});

app.get("/api/companion/token", (req, res) => {
  const ip = req.socket.remoteAddress;
  const isLoopback = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  if (!isLoopback) {
    res.status(403).json({ ok: false, error: "Token retrieval is restricted to loopback" });
    return;
  }
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    res.status(403).json({ ok: false, error: "Origin not allowed to retrieve companion token" });
    return;
  }
  res.json({ ok: true, token: COMPANION_TOKEN });
});

app.post("/api/companion/authorize-workspace", async (req, res) => {
  const tokenHeader = req.headers["x-achu-companion-token"];
  if (COMPANION_TOKEN && tokenHeader && tokenHeader !== COMPANION_TOKEN) {
    res.status(401).json({ ok: false, error: "Unauthorized: Invalid companion token" });
    return;
  }
  const { path: requestedPath } = req.body || {};
  if (!requestedPath || typeof requestedPath !== "string") {
    res.status(400).json({ ok: false, error: "Path is required" });
    return;
  }
  try {
    const selection = await validateWorkspaceDirectory(requestedPath);
    registerAuthorizedRoots(selection.root, selection.realRoot);
    res.json({ ok: true, root: selection.root, realRoot: selection.realRoot, entries: selection.entries });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post("/api/companion/export-workspace", async (req, res) => {
  const tokenHeader = req.headers["x-achu-companion-token"];
  if (!COMPANION_TOKEN || !tokenHeader || tokenHeader !== COMPANION_TOKEN) {
    res.status(401).json({ ok: false, error: "Unauthorized: a valid companion token is required to export workspace files" });
    return;
  }

  const { workspaceRoot, maxFiles, maxFileBytes, maxTotalBytes } = req.body || {};
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    res.status(400).json({ ok: false, error: "Authorized workspaceRoot is required" });
    return;
  }

  try {
    const selection = await validateWorkspaceDirectory(workspaceRoot);
    if (!isAuthorizedForExport(selection.root, selection.realRoot)) {
      res.status(403).json({
        ok: false,
        error: "Workspace has not been authorized in this companion session. Select the folder again in the web app, then retry the import.",
      });
      return;
    }

    const ws = new Workspace(selection.root);
    const result = await exportWorkspaceFiles(ws, {
      maxFiles: typeof maxFiles === "number" ? maxFiles : undefined,
      maxFileBytes: typeof maxFileBytes === "number" ? maxFileBytes : undefined,
      maxTotalBytes: typeof maxTotalBytes === "number" ? maxTotalBytes : undefined,
    });

    console.log(
      `[companion_export] Exported ${result.files.length} file(s) (${result.totalBytes} bytes) from authorized workspace: ${selection.root}` +
      `${result.truncated ? " [truncated at limits]" : ""}`,
    );

    res.json({
      ok: true,
      root: selection.root,
      realRoot: selection.realRoot,
      files: result.files,
      totalBytes: result.totalBytes,
      truncated: result.truncated,
      skipped: result.skipped,
      limits: { ...DEFAULT_WORKSPACE_EXPORT_LIMITS },
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post("/api/companion/sync-artifacts", async (req, res) => {
  const tokenHeader = req.headers["x-achu-companion-token"];
  if (COMPANION_TOKEN && tokenHeader && tokenHeader !== COMPANION_TOKEN) {
    res.status(401).json({ ok: false, error: "Unauthorized: Invalid companion token" });
    return;
  }

  const { workspaceRoot, artifacts } = req.body || {};
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    res.status(400).json({ ok: false, error: "Authorized workspaceRoot is required" });
    return;
  }
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    res.status(400).json({ ok: false, error: "Artifacts array is required and must not be empty" });
    return;
  }

  try {
    const selection = await validateWorkspaceDirectory(workspaceRoot);
    const ws = new Workspace(selection.root);
    const writtenFiles: string[] = [];

    for (const artifact of artifacts) {
      if (!artifact || typeof artifact.path !== "string" || typeof artifact.content !== "string") {
        continue;
      }

      // Safe relative path normalization
      const cleanRel = artifact.path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
      if (cleanRel.includes("..") || /^[a-zA-Z]:[/\\]/.test(cleanRel)) {
        res.status(400).json({ ok: false, error: `Invalid path traversal or absolute path escape: ${artifact.path}` });
        return;
      }

      await ws.write(cleanRel, artifact.content);
      writtenFiles.push(cleanRel);
    }

    console.log(`[companion_sync] Synchronized ${writtenFiles.length} files into authorized workspace: ${selection.root}`);
    res.json({
      ok: true,
      root: selection.root,
      syncedCount: writtenFiles.length,
      files: writtenFiles,
    });
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
  const tokenHeader = req.headers["x-achu-companion-token"];
  if (COMPANION_TOKEN && tokenHeader && tokenHeader !== COMPANION_TOKEN) {
    res.status(401).json({ ok: false, error: "Unauthorized: Invalid companion token" });
    return;
  }
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
    registerAuthorizedRoots(selection.root, selection.realRoot);

    // Check if task is already running in this workspace
    const existing = Array.from(activeTasks.values()).find(
      t => t.workspaceRoot === effectiveRoot && t.status === "RUNNING"
    );
    if (existing) {
      if (existing.childProcess && existing.childProcess.pid) {
        if (!isProcessAlive(existing.childProcess.pid)) {
          console.log(`[companion_task] Process ${existing.childProcess.pid} exited. Cleaning stale task ${existing.id}`);
          existing.status = "FAILED";
          existing.childProcess = null;
          existing.error = "Process exited unexpectedly";
        }
      } else if (!existing.childProcess) {
        existing.status = "COMPLETED";
      }
      if (existing.status === "RUNNING") {
        res.status(409).json({ ok: false, error: "A task is already running in this workspace. Stop it first.", taskId: existing.id });
        return;
      }
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
  if (task.status === "RUNNING" && task.childProcess && task.childProcess.pid && !isProcessAlive(task.childProcess.pid)) {
    task.status = (task.changedFiles && task.changedFiles.length > 0) ? "PARTIAL" : "FAILED";
    task.error = task.error || "Process exited unexpectedly";
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
      error: sanitizeUserFacingError(task.error),
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
  // Stop dev server owned by this workspace
  try {
    const runtime = getAppRuntime(task.workspaceRoot);
    if (runtime && runtime.pid && isProcessAlive(runtime.pid)) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", runtime.pid.toString(), "/t", "/f"], { windowsHide: true });
      } else {
        process.kill(runtime.pid, "SIGTERM");
      }
      clearAppRuntime(task.workspaceRoot);
    }
  } catch {}
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
    type: "app_url",
    url: null,
    taskId: task.id,
    sessionId: task.sessionId,
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
  const tokenHeader = req.headers["x-achu-companion-token"];
  if (COMPANION_TOKEN && tokenHeader && tokenHeader !== COMPANION_TOKEN) {
    res.status(401).json({ ok: false, error: "Unauthorized: Invalid companion token" });
    return;
  }
  let task = activeTasks.get(req.params.taskId);
  if (!task && (req.params.taskId === "active" || req.params.taskId === "current")) {
    task = Array.from(activeTasks.values()).find(t => t.status === "RUNNING");
  }
  if (!task) {
    const running = Array.from(activeTasks.values()).find(t => t.status === "RUNNING");
    if (running) {
      await terminateTaskProcess(running);
      res.json({ ok: true, status: "CANCELLED", taskId: running.id });
      return;
    }
    res.status(404).json({ ok: false, error: "Task not found" });
    return;
  }
  await terminateTaskProcess(task);
  res.json({ ok: true, status: "CANCELLED", taskId: task.id });
});

export function compareSemver(v1: string, v2: string): number {
  const parse = (v: string) => (v.replace(/[^0-9.]/g, "").split(".").map(n => parseInt(n, 10) || 0));
  const p1 = parse(v1);
  const p2 = parse(v2);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

app.get("/api/companion/update/check", async (_req, res) => {
  const currentVersion = "1.0.0";
  const updateUrl = process.env.ACHU_UPDATE_URL || "https://www.workswithachu.me/api/download/local-agent?info=true";
  try {
    const fetchRes = await fetch(updateUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    });
    if (!fetchRes.ok) {
      res.json({
        ok: true,
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
        note: `Update server responded with status ${fetchRes.status}`,
      });
      return;
    }
    const data = await fetchRes.json();
    const latestVersion = data.version || currentVersion;
    const isNewer = compareSemver(latestVersion, currentVersion) > 0;
    res.json({
      ok: true,
      currentVersion,
      latestVersion,
      updateAvailable: isNewer,
      downloadUrl: data.downloadUrl || "/api/download/local-agent",
      sha256: data.sha256 || null,
      sizeMB: data.sizeMB || null,
      releaseDate: data.releaseDate || null,
    });
  } catch (err: any) {
    res.json({
      ok: true,
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      note: `Could not reach update server: ${err.message || String(err)}`,
    });
  }
});

app.post("/api/companion/update/apply", async (req, res) => {
  const tokenHeader = req.headers["x-achu-companion-token"];
  if (COMPANION_TOKEN && tokenHeader && tokenHeader !== COMPANION_TOKEN) {
    res.status(401).json({ ok: false, error: "Unauthorized: Invalid companion token" });
    return;
  }

  const scriptsDir = path.join(__dirname, "../scripts");
  const updateScript = path.join(scriptsDir, "update-agent.ps1");
  const templatesScript = path.join(__dirname, "../installer-templates", "update-agent.ps1");
  const targetScript = fs.existsSync(updateScript) ? updateScript : templatesScript;

  if (process.platform === "win32" && fs.existsSync(targetScript)) {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", targetScript], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    res.json({
      ok: true,
      message: "Update process started in background. Achu Local Agent will update and restart automatically.",
    });
    return;
  }

  res.status(501).json({
    ok: false,
    error: "Automatic update script is only supported on Windows installations.",
  });
});

app.use(express.static(path.join(__dirname, "../public")));

wss.on("connection", (ws, req) => {
  const origin = req?.headers?.origin;
  if (origin && !isAllowedOrigin(origin)) {
    console.warn(`[companion_security] Rejected WebSocket connection from unauthorized origin: ${origin}`);
    ws.close(1008, "Origin not allowed");
    return;
  }
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
        registerAuthorizedRoots(selection.root, selection.realRoot);
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
        registerAuthorizedRoots(selection.root, selection.realRoot);
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
        if (runtime && runtime.url && isProcessAlive(runtime.pid) && (await isUrlServing(runtime.url))) {
          sendEvent(client.ws, "app_url", {
            url: runtime.url,
            workspaceRoot: selection.root,
            port: runtime.port,
            pid: runtime.pid,
          });
        } else {
          // If workspace is runnable, automatically ensure server is started
          ensureAppServer(selection.root)
            .then((liveUrl) => {
              if (liveUrl) {
                sendEvent(client.ws, "app_url", {
                  url: liveUrl,
                  workspaceRoot: selection.root,
                });
              } else {
                sendEvent(client.ws, "app_url", {
                  url: null,
                  workspaceRoot: selection.root,
                });
              }
            })
            .catch(() => {
              sendEvent(client.ws, "app_url", {
                url: null,
                workspaceRoot: selection.root,
              });
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
          registerAuthorizedRoots(selection.root, selection.realRoot);
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
        registerAuthorizedRoots(selection.root, selection.realRoot);
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

  const taskRecord: LocalTaskRecord = {
    id: taskId,
    sessionId,
    task,
    workspaceRoot,
    status: "RUNNING",
    startTime: Date.now(),
    childProcess: null,
    outputBuffer: `[Local Agent] Initializing local execution engine...\n[Local Agent] Task: ${task}\n[Local Agent] Workspace: ${workspaceRoot}\n`,
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

  // Locate the CLI runner (cli.mjs in installed distribution or dist/cli.js in dev)
  const candidateCliPaths = [
    path.join(__dirname, "cli.mjs"),
    path.join(__dirname, "dist", "cli.js"),
    path.join(__dirname, "cli.js"),
    path.resolve(__dirname, "..", "dist", "cli.js"),
    path.resolve(__dirname, "..", "cli.mjs"),
    path.resolve(process.cwd(), "dist", "cli.js"),
    path.resolve(process.cwd(), "cli.mjs"),
    "C:\\Users\\Achu146\\achu-coding-agent\\dist\\cli.js",
  ];
  const cliPath = candidateCliPaths.find((p) => fs.existsSync(p));

  console.log(`[run_task] CLI candidate paths: ${candidateCliPaths.join(", ")}`);
  console.log(`[run_task] Resolved CLI path: ${cliPath || "NOT FOUND"}`);

  if (!cliPath) {
    const errorMsg = `Achu agent runner (cli.mjs or dist/cli.js) not found. Checked: ${candidateCliPaths.join(", ")}`;
    console.error(`[run_task] ${errorMsg}`);
    taskRecord.status = "FAILED";
    taskRecord.error = errorMsg;
    taskRecord.outputBuffer += `\n[Fatal Error] ${errorMsg}\n`;
    await cleanupAndEmitFailure(client, workspaceRoot, sessionId, taskId, errorMsg);
    return;
  }

  // Locate bundled node runtime if available
  const candidateNodePaths = [
    path.join(__dirname, "bin", "node.exe"),
    path.resolve(__dirname, "..", "bin", "node.exe"),
    process.execPath,
  ];
  const nodeExec = candidateNodePaths.find((p) => fs.existsSync(p)) || process.execPath;
  const mainProjectDir = fs.existsSync(path.join(__dirname, "package.json")) ? __dirname : path.resolve(__dirname, "..");
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
    const entriesNow = await workspace.listDetailed(".").catch(() => []);
    const hadNoFiles = (!baseline?.files || Object.keys(baseline.files).length === 0);
    let effectiveSuccess = success;
    if (success && hadNoFiles && entriesNow.length === 0) {
      effectiveSuccess = false;
      const deliverableError = "Execution ended without writing any files to the project folder.";
      console.warn(`[run_task] ${deliverableError}`);
      taskRecord.error = deliverableError;
      taskRecord.outputBuffer += `\n[Verification Error] ${deliverableError}\n`;
    }

    if (taskRecord.status !== "CANCELLED") {
      taskRecord.status = effectiveSuccess ? "COMPLETED" : "FAILED";
    }
    
    if (client.workspaceRoot) {
      const finalStatus = effectiveSuccess ? "COMPLETED" : "FAILED";
      await client.sessionManager.completeSession(client.workspaceRoot, sessionId, effectiveSuccess);
      
      broadcastToAll({ 
        type: "session_completed",
        sessionId, 
        success: effectiveSuccess,
        status: finalStatus,
      });
      
      // Release workspace lock
      if (client.workspaceLockHeld) {
        await client.sessionManager.releaseLock(client.workspaceRoot);
        client.workspaceLockHeld = false;
        console.log(`[run_task] Workspace lock released for ${workspaceRoot}`);
      }
    }

    if (effectiveSuccess) {
      console.log(`[run_task] Task completed successfully`);
      
      // Ensure app server is active for live preview if project became runnable
      if (!taskRecord.appUrl) {
        try {
          const liveUrl = await ensureAppServer(effectiveRoot);
          if (liveUrl) {
            taskRecord.appUrl = liveUrl;
            broadcastToAll({ type: "app_url", url: liveUrl, taskId, sessionId, workspaceRoot: effectiveRoot });
          }
        } catch (err) {
          console.warn("[run_task] Error ensuring live app server:", err);
        }
      }

      broadcastToAll({ 
        type: "task_completed",
        taskId, 
        sessionId,
        output: finalOutput,
        changedFiles: detectedChanges.map(f => ({ path: f.path, changeType: f.changeType, additions: f.additions, deletions: f.deletions, isBinary: f.isBinary })),
        workspaceRoot: effectiveRoot,
        appUrl: taskRecord.appUrl,
      });
      broadcastToAll({ type: "task_status", taskId, status: "COMPLETED", sessionId, workspaceRoot: effectiveRoot });
    } else {
      const errorMsg = signal ? `Process terminated by signal ${signal}` : `Process exited with code ${code}`;
      const sanitizedError = sanitizeUserFacingError(taskRecord.error || errorMsg);
      console.log(`[run_task] Task failed: ${sanitizedError}`);
      taskRecord.error = sanitizedError;
      broadcastToAll({
        type: "task_failed",
        taskId,
        sessionId,
        error: sanitizedError,
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