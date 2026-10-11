import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Workspace } from "./workspace.js";

export type AppProcessInfo = {
  process: ChildProcess;
  command: string;
  cwd: string;
  pid: number;
  url: string | null;
  port: number | null;
  startTime: number;
  status: "starting" | "ready" | "failed" | "stopped";
  output: string;
  // Temp file capturing combined stdout+stderr. Using a file descriptor for
  // stdio (instead of pipes) means the parent holds NO stream handles, so the
  // CLI can exit naturally while the detached dev server keeps running.
  outputPath?: string;
};

export type StartCommandResult = {
  command: string;
  port: number | null;
  url: string | null;
};

/**
 * Match commands that (attempt to) start a development server via a shell.
 * Start-anchored so legitimate commands that merely mention a server command
 * (e.g. `npm pkg set scripts.dev="npx serve . -l 3000"`) are NOT blocked.
 */
export function isServerStartupCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return /^(npx\s+(serve|http-server)|npm\s+run\s+(dev|start|serve|preview)|pnpm\s+(dev|start|serve|preview)|yarn\s+(dev|start|serve|preview))\b/.test(normalized);
}

/**
 * Detect the appropriate start command from package.json scripts.
 * Prefers dev/start scripts based on package manager and framework.
 * Also parses a candidate port from the script text for reliable URL probing.
 */
export async function detectStartCommand(workspace: Workspace): Promise<StartCommandResult> {
  try {
    const packageJsonContent = await workspace.read("package.json");
    const packageJson = JSON.parse(packageJsonContent);
    const scripts = packageJson.scripts || {};

    // Priority order for start scripts
    const scriptPriority = [
      "dev",
      "start",
      "serve",
      "preview",
    ];

    for (const script of scriptPriority) {
      if (scripts[script]) {
        // Get package manager
        const pm = await detectPackageManager(workspace);
        const prefix = pm === "npm" ? "npm run" : `${pm} run`;
        const command = `${prefix} ${script}`;
        const scriptText = String(scripts[script] ?? "");
        const port = parsePortFromScript(scriptText);
        return { command, port, url: null };
      }
    }

    return { command: "", port: null, url: null };
  } catch {
    return { command: "", port: null, url: null };
  }
}

/**
 * Parse a candidate port from a package.json script text.
 * Recognizes: -l N, -p N, --port N, --port=N, PORT=N.
 * Falls back to well-known framework defaults; returns null when unknown.
 */
export function parsePortFromScript(scriptText: string): number | null {
  const text = String(scriptText ?? "");
  const explicit =
    text.match(/(?:^|\s)(?:-l|-p|--port)[=\s]+(\d{1,5})\b/i) ||
    text.match(/\bPORT[=\s]+(\d{1,5})\b/i);
  if (explicit) {
    const port = parseInt(explicit[1], 10);
    if (port >= 1 && port <= 65535) return port;
  }
  const lower = text.toLowerCase();
  if (/\bvite\b/.test(lower) && !/\b--port\b/.test(lower)) return 5173;
  if (/\bnext\b/.test(lower)) return 3000;
  if (/\bhttp-server\b/.test(lower)) return 8080;
  if (/\bserve\b/.test(lower)) return 3000;
  return null;
}

export type ReadinessCheckResult = {
  ready: boolean;
  url: string | null;
  error?: string;
};

/**
 * Detect package manager from lockfiles.
 */
export async function detectPackageManager(workspace: Workspace): Promise<string> {
  const lockfiles = [
    { name: "pnpm", file: "pnpm-lock.yaml" },
    { name: "yarn", file: "yarn.lock" },
    { name: "bun", file: "bun.lockb" },
    { name: "bun", file: "bun.lock" },
    { name: "npm", file: "package-lock.json" },
  ];

  for (const { name, file } of lockfiles) {
    if (await workspace.exists(file)) {
      return name;
    }
  }
  return "npm";
}

/**
 * Spawn a detached application process.
 *
 * Detachment is required on Windows: a non-detached child dies when the parent
 * CLI exits (its console is destroyed), which would break Live Preview.
 *
 * Output capture is best-effort and platform-dependent:
 *  - Windows: `detached: true` sets DETACHED_PROCESS, under which NEITHER pipe
 *    handles NOR shell redirection can capture the child's output (the file is
 *    created but stays empty). We therefore use `stdio: "ignore"` and detect
 *    the URL by probing the candidate port parsed from package.json.
 *  - POSIX: detachment is a new session; shell redirection still captures
 *    output, so we redirect stdout+stderr to a temp file for URL extraction.
 *
 * Either way the parent keeps NO pipe/stream handle, so it can exit promptly
 * while the server keeps running.
 */
export function spawnAppProcess(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): AppProcessInfo {
  let outputPath: string | undefined;
  try {
    outputPath = path.join(os.tmpdir(), `achu-app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`);
    
    const wrapperSrc = `
      const fs = require('fs');
      const { spawn } = require('child_process');
      const child = spawn(process.argv[1], {
        cwd: process.argv[2],
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const outStream = fs.createWriteStream(process.argv[3], { flags: 'a' });
      child.stdout.pipe(outStream);
      child.stderr.pipe(outStream);
      child.on('exit', () => process.exit(0));
    `.replace(/\n/g, ' ');

    const wrapper = spawn("node", ["-e", wrapperSrc, command, cwd, outputPath], {
      env,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    wrapper.unref();

    return {
      process: wrapper,
      command,
      cwd,
      pid: wrapper.pid ?? -1,
      url: null,
      port: null,
      startTime: Date.now(),
      status: "starting",
      output: "",
      outputPath,
    };
  } catch (error) {
    if (outputPath) { try { fs.rmSync(outputPath, { force: true }); } catch { /* best effort */ } }
    throw error;
  }
}

/**
 * Read the captured output of a spawned app process (combined stdout+stderr).
 */
export function readAppOutput(appInfo: AppProcessInfo): string {
  if (!appInfo.outputPath) return appInfo.output;
  try {
    return fs.readFileSync(appInfo.outputPath, "utf8");
  } catch {
    return appInfo.output;
  }
}

/**
 * Delete the temp output file of a spawned app process (failure cleanup).
 */
export function cleanupAppOutputFile(appInfo: AppProcessInfo): void {
  if (!appInfo.outputPath) return;
  try { fs.rmSync(appInfo.outputPath, { force: true }); } catch { /* best effort */ }
}

/**
 * Check whether the spawned process has exited (works for unref'd detached
 * children without registering event listeners that could hold the loop).
 */
export function hasAppProcessExited(appInfo: AppProcessInfo): boolean {
  const child = appInfo.process;
  if (!child) {
    return !isProcessAlive(appInfo.pid);
  }
  return child.exitCode !== null || child.signalCode !== null;
}

/**
 * Detach the app process from the parent, allowing the parent to exit
 * while the child continues running. With file-based stdio there are no
 * parent-side pipe handles; unref releases the child handle reference.
 */
export function detachAppProcess(appInfo: AppProcessInfo): void {
  if (!appInfo.process) return;
  // Destroy any stream handles defensively (file-based stdio has none).
  if (appInfo.process.stdout && !appInfo.process.stdout.destroyed) {
    appInfo.process.stdout.destroy();
  }
  if (appInfo.process.stderr && !appInfo.process.stderr.destroyed) {
    appInfo.process.stderr.destroy();
  }
  // Unref the child to allow parent to exit
  if (appInfo.process.unref) {
    appInfo.process.unref();
  }
}

/**
 * Extract port from dev server output.
 * Looks for common patterns like "Local: http://localhost:3000" or "http://localhost:5173"
 */
export function extractPortFromOutput(output: string): number | null {
  const patterns = [
    /Local:\s*https?:\/\/localhost:(\d+)/i,
    /http:\/\/localhost:(\d+)/i,
    /http:\/\/127\.0\.0\.1:(\d+)/i,
    /listening on port (\d+)/i,
    /on port (\d+)/i,
    /:(\d{4,5})\s*$/m,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match && match[1]) {
      const port = parseInt(match[1], 10);
      if (port >= 1000 && port <= 65535) {
        return port;
      }
    }
  }
  return null;
}

/**
 * Extract URL from dev server output.
 */
export function extractUrlFromOutput(output: string): string | null {
  const patterns = [
    /Local:\s*(https?:\/\/[^\s]+)/i,
    /(https?:\/\/localhost:\d+)/i,
    /(https?:\/\/127\.0\.0\.1:\d+)/i,
    /(https?:\/\/0\.0\.0\.0:\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Wait for application readiness by polling the URL.
 */
export async function waitForReadiness(
  url: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    onProgress?: (attempt: number, maxAttempts: number) => void;
  } = {}
): Promise<ReadinessCheckResult> {
  const { timeoutMs = 60000, intervalMs = 1000, onProgress } = options;
  const maxAttempts = Math.ceil(timeoutMs / intervalMs);
  const startTime = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (onProgress) onProgress(attempt, maxAttempts);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (response.ok) {
        return { ready: true, url };
      }
    } catch {
      // Not ready yet, continue polling
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return { 
    ready: false, 
    url, 
    error: `Application readiness timeout after ${timeoutMs}ms` 
  };
}

/**
 * Stop the application process gracefully.
 */
export async function stopAppProcess(appInfo: AppProcessInfo): Promise<void> {
  if (appInfo.status === "stopped") return;

  return new Promise((resolve) => {
    const child = appInfo.process;
    if (!child) {
      appInfo.status = "stopped";
      resolve();
      return;
    }

    let resolved = false;
    const forceKillTimeout = setTimeout(() => {
      if (!resolved) {
        child.kill("SIGKILL");
        resolved = true;
        appInfo.status = "stopped";
        resolve();
      }
    }, 5000);

    child.on("close", () => {
      if (!resolved) {
        clearTimeout(forceKillTimeout);
        resolved = true;
        appInfo.status = "stopped";
        resolve();
      }
    });

    // Try graceful shutdown first
    child.kill("SIGTERM");
  });
}

/**
 * Check if a process is owned by the current task.
 */
export function isOwnedProcess(appInfo: AppProcessInfo | null, pid: number): boolean {
  return appInfo !== null && appInfo.pid === pid && appInfo.status !== "stopped";
}

/**
 * Append output to app process info.
 */
export function appendAppOutput(appInfo: AppProcessInfo, chunk: string): void {
  appInfo.output += chunk;
  
  // Update URL/port if detected
  if (!appInfo.port) {
    const port = extractPortFromOutput(chunk);
    if (port) appInfo.port = port;
  }
  if (!appInfo.url) {
    const url = extractUrlFromOutput(chunk);
    if (url) appInfo.url = url;
  }
}

/**
 * Get the application URL, preferring detected URL over constructed one.
 */
export function getAppUrl(appInfo: AppProcessInfo): string | null {
  if (appInfo.url) return appInfo.url;
  if (appInfo.port) return `http://localhost:${appInfo.port}`;
  return null;
}

/**
 * A record of an app server this agent spawned, persisted so a later task can
 * (a) reuse it ONLY when it is confirmed to serve the same workspace, and
 * (b) never mistake it for a newly spawned server on the same port.
 *
 * The record lives in the OS temp dir (never in the user's project) and is
 * keyed by the normalized workspace root.
 */
export type AppRuntimeRecord = {
  /** Absolute workspace root the app was started for. */
  workspaceRoot: string;
  /** PID of the shell that owns the dev server process. */
  pid: number;
  port: number | null;
  url: string | null;
  startedAt: number;
  /** Temporary file capturing stdout/stderr */
  outputPath?: string;
};

function appRegistryPath(): string {
  return path.join(os.tmpdir(), "achu-app-runtime.json");
}

function normalizeWorkspaceKey(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function loadRegistry(): Record<string, AppRuntimeRecord> {
  try {
    const raw = fs.readFileSync(appRegistryPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, AppRuntimeRecord>;
  } catch {
    // Missing or corrupt registry: start clean.
  }
  return {};
}

function saveRegistry(registry: Record<string, AppRuntimeRecord>): void {
  try {
    fs.writeFileSync(appRegistryPath(), JSON.stringify(registry), "utf8");
  } catch {
    // Best effort: the registry is an optimization, not a source of truth.
  }
}

/** Whether a PID refers to a live process (no signals delivered). */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Look up a previously spawned app for `workspaceRoot`.
 * Returns null (and prunes the entry) when the recorded process is gone.
 */
export function getAppRuntime(workspaceRoot: string): AppRuntimeRecord | null {
  const registry = loadRegistry();
  const key = normalizeWorkspaceKey(workspaceRoot);
  const record = registry[key];
  if (!record) return null;
  if (!isProcessAlive(record.pid)) {
    delete registry[key];
    saveRegistry(registry);
    return null;
  }
  return record;
}

/** Persist (or update) the app runtime record for a workspace. */
export function saveAppRuntime(record: AppRuntimeRecord): void {
  const registry = loadRegistry();
  registry[normalizeWorkspaceKey(record.workspaceRoot)] = record;
  saveRegistry(registry);
}

/** Remove the app runtime record for a workspace (e.g. after a failed start). */
export function clearAppRuntime(workspaceRoot: string): void {
  const registry = loadRegistry();
  const key = normalizeWorkspaceKey(workspaceRoot);
  if (key in registry) {
    delete registry[key];
    saveRegistry(registry);
  }
}

/**
 * Probe a single URL. Returns true when ANY HTTP response is received (the
 * server is listening), regardless of status code.
 */
export async function isUrlServing(url: string, timeoutMs = 800): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal });
      return true;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return false;
  }
}

/**
 * Probe a contiguous range of localhost ports in parallel and return the set
 * of ports that are serving.
 */
export async function probePortRange(
  startPort: number,
  count: number,
  timeoutMs = 500,
): Promise<Set<number>> {
  const serving = new Set<number>();
  if (!Number.isInteger(startPort) || startPort < 1 || count < 1) return serving;

  const ports: number[] = [];
  for (let offset = 0; offset < count; offset++) {
    const port = startPort + offset;
    if (port > 0 && port <= 65535) ports.push(port);
  }

  await Promise.all(
    ports.map(async (port) => {
      if (await isUrlServing(`http://localhost:${port}`, timeoutMs)) {
        serving.add(port);
      }
    }),
  );
  return serving;
}

/**
 * Discover the URL of a server that was started AFTER a snapshot was taken.
 *
 * This is the fix for the stale-preview regression: a dev server often falls
 * back to a fixed default port, where a leftover server from a previous task
 * may still be listening. The old code probed that candidate port and accepted
 * the first 200 response, which was the OLD server. Here we subtract the ports
 * that were already serving before we spawned (`preexistingPorts`) so the
 * returned URL can only belong to the newly started server.
 */
export async function discoverNewServerUrl(options: {
  candidatePort: number | null;
  preexistingPorts?: Set<number>;
  maxProbes?: number;
  timeoutMs?: number;
  pollMs?: number;
  /** Return false to stop early when the spawned process has exited. */
  isAlive?: () => boolean;
  /** Optional authoritative URL parsed from the spawned process output. */
  getUrlFromOutput?: () => string | null;
}): Promise<string | null> {
  const {
    candidatePort,
    preexistingPorts = new Set<number>(),
    maxProbes = 20,
    timeoutMs = 15000,
    pollMs = 600,
    isAlive,
    getUrlFromOutput,
  } = options;

  const deadline = Date.now() + timeoutMs;

  for (;;) {
    // Prefer the spawned process's own reported URL when available.
    if (getUrlFromOutput) {
      const reported = getUrlFromOutput();
      if (reported) return reported;
    }

    if (candidatePort) {
      const serving = await probePortRange(candidatePort, maxProbes, 500);
      for (let port = candidatePort; port < candidatePort + maxProbes; port++) {
        if (port > 65535) break;
        if (serving.has(port) && !preexistingPorts.has(port)) {
          return `http://localhost:${port}`;
        }
      }
    }

    if (isAlive && !isAlive()) return null;
    if (Date.now() >= deadline) return null;

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}