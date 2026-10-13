import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as net from "node:net";
import { Workspace } from "./workspace.js";
import { validateProjectStructure, autoRepairProjectStructure } from "./scaffold.js";

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
  cwd?: string;
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
 * Checks workspace root first, then immediate subdirectories if not at root.
 */
export async function detectStartCommand(workspace: Workspace): Promise<StartCommandResult> {
  const scriptPriority = ["dev", "start", "serve", "preview"];

  // Auto-repair known project inconsistencies (e.g. React configured with static npx serve)
  try {
    await autoRepairProjectStructure(workspace);
  } catch {}

  // 1. Check workspace root package.json
  try {
    if (await workspace.exists("package.json")) {
      const packageJsonContent = await workspace.read("package.json");
      const packageJson = JSON.parse(packageJsonContent);
      const scripts = packageJson.scripts || {};

      for (const script of scriptPriority) {
        if (scripts[script]) {
          const pm = await detectPackageManager(workspace);
          const prefix = pm === "npm" ? "npm run" : `${pm} run`;
          const command = `${prefix} ${script}`;
          const scriptText = String(scripts[script] ?? "");
          const port = parsePortFromScript(scriptText);
          return { command, port, url: null, cwd: workspace.root };
        }
      }
    }
  } catch {}

  // 2. Check immediate subdirectories for package.json (e.g. scaffolded project folder)
  try {
    const entries = await fs.promises.readdir(workspace.root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
        const subDirPath = path.join(workspace.root, entry.name);
        const subWorkspace = new Workspace(subDirPath);
        try {
          await autoRepairProjectStructure(subWorkspace);
        } catch {}
        const subPkgPath = path.join(subDirPath, "package.json");
        if (fs.existsSync(subPkgPath)) {
          try {
            const raw = fs.readFileSync(subPkgPath, "utf8");
            const parsed = JSON.parse(raw);
            const scripts = parsed.scripts || {};
            for (const script of scriptPriority) {
              if (scripts[script]) {
                const pm = await detectPackageManager(subWorkspace);
                const prefix = pm === "npm" ? "npm run" : `${pm} run`;
                const command = `${prefix} ${script}`;
                const scriptText = String(scripts[script] ?? "");
                const port = parsePortFromScript(scriptText);
                return { command, port, url: null, cwd: subDirPath };
              }
            }
          } catch {}
        }
      }
    }
  } catch {}

  return { command: "", port: null, url: null, cwd: workspace.root };
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
 * Check if a TCP port is currently free and available for binding.
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

/**
 * Allocate an available port when the preferred port is occupied.
 * Tries preferred port first, then sequential available alternatives.
 */
export async function allocateAvailablePort(preferredPort = 3000, maxAttempts = 100): Promise<number> {
  const start = preferredPort > 0 && preferredPort <= 65535 ? preferredPort : 3000;
  if ((await isPortAvailable(start)) && !(await isUrlServing(`http://localhost:${start}`, 200))) {
    return start;
  }
  for (let offset = 1; offset <= maxAttempts; offset++) {
    const candidate = start + offset;
    if (candidate > 65535) break;
    if ((await isPortAvailable(candidate)) && !(await isUrlServing(`http://localhost:${candidate}`, 200))) {
      return candidate;
    }
  }
  return start + 1;
}

/**
 * Replace port flags in a server command with a new port number.
 */
export function replacePortInCommand(command: string, newPort: number): string {
  let replaced = command;
  if (/--\s+--port\s+\d+/i.test(replaced)) {
    replaced = replaced.replace(/(--\s+--port\s+)\d+/i, `$1${newPort}`);
  } else if (/--\s+-p\s+\d+/i.test(replaced)) {
    replaced = replaced.replace(/(--\s+-p\s+)\d+/i, `$1${newPort}`);
  } else if (/(?:-l|-p|--port)\s+\d+/i.test(replaced)) {
    replaced = replaced.replace(/((?:-l|-p|--port)\s+)\d+/i, `$1${newPort}`);
  } else if (/--port=\d+/i.test(replaced)) {
    replaced = replaced.replace(/(--port=)\d+/i, `$1${newPort}`);
  } else if (/PORT=\d+/i.test(replaced)) {
    replaced = replaced.replace(/(PORT=)\d+/i, `$1${newPort}`);
  } else if (/\b(serve|http-server)\b/i.test(replaced) && !/--port|-p|-l/.test(replaced)) {
    replaced = `${replaced} -l ${newPort}`;
  } else if (/\bvite\b/i.test(replaced) && !/--port/.test(replaced)) {
    replaced = `${replaced} --port ${newPort}`;
  } else if (/^(?:npm|pnpm)\s+run\s+\w+/i.test(replaced)) {
    replaced = `${replaced} -- --port ${newPort}`;
  } else if (/^yarn\s+(?:run\s+)?\w+/i.test(replaced)) {
    replaced = `${replaced} --port ${newPort}`;
  }
  return replaced;
}

/**
 * Detect package manager from lockfiles or package.json field.
 */
export async function detectPackageManager(workspace: Workspace): Promise<string> {
  try {
    if (await workspace.exists("package.json")) {
      const pkg = JSON.parse(await workspace.read("package.json"));
      if (typeof pkg.packageManager === "string") {
        if (pkg.packageManager.startsWith("pnpm")) return "pnpm";
        if (pkg.packageManager.startsWith("yarn")) return "yarn";
        if (pkg.packageManager.startsWith("bun")) return "bun";
        if (pkg.packageManager.startsWith("npm")) return "npm";
      }
    }
  } catch {}

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
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
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
    /Accepting connections at\s+https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i,
    /serving on\s+https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i,
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
    /Accepting connections at\s+(https?:\/\/[^\s]+)/i,
    /serving on\s+(https?:\/\/[^\s]+)/i,
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
 * Resolves the actual reachable URL for a web project.
 * If the root URL (/) returns a directory listing (e.g. static server without index.html)
 * or 404, it checks candidate entry files (e.g. modified .html files or root html files)
 * and returns the full path (e.g. http://localhost:62727/hello-ajmeer.html).
 */
export async function resolveProjectEntryUrl(
  baseUrl: string,
  workspaceRoot?: string,
  candidateFiles?: string[]
): Promise<string> {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  if (!workspaceRoot) return normalizedBase;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    let rootResponse: Response | null = null;
    let rootText = "";
    try {
      rootResponse = await fetch(normalizedBase, { method: "GET", redirect: "manual", signal: controller.signal });
      rootText = await rootResponse.text();
    } catch {
      // Ignore network errors on initial probe
    } finally {
      clearTimeout(timeoutId);
    }

    const isDirectoryListing = rootText.includes("Files within ") || rootText.includes("Directory listing");
    const isNotFound = rootResponse ? (rootResponse.status === 404) : false;

    // If root works and is not a directory listing or 404, root is fine
    if (rootResponse && rootResponse.ok && !isDirectoryListing && !isNotFound) {
      return normalizedBase;
    }

    // Collect candidate HTML files
    const candidates: string[] = [];
    if (candidateFiles && Array.isArray(candidateFiles)) {
      for (const f of candidateFiles) {
        if (typeof f === "string" && f.toLowerCase().endsWith(".html")) {
          candidates.push(f);
        }
      }
    }

    try {
      const entries = await fs.promises.readdir(workspaceRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".html") && entry.name.toLowerCase() !== "index.html") {
          if (!candidates.includes(entry.name)) {
            candidates.push(entry.name);
          }
        }
      }
    } catch {
      // Ignore readdir errors
    }

    for (const candidate of candidates) {
      const cleanPath = candidate.replace(/^[/\\]+/, "").replace(/\\/g, "/");
      const candidateUrl = `${normalizedBase}/${cleanPath}`;
      try {
        const ctl = new AbortController();
        const tid = setTimeout(() => ctl.abort(), 1500);
        const res = await fetch(candidateUrl, { method: "GET", redirect: "follow", signal: ctl.signal });
        clearTimeout(tid);
        if (res.ok) {
          return candidateUrl;
        }
      } catch {
        // Continue to next candidate
      }
    }
  } catch {
    // Fall back to normalized base
  }

  return normalizedBase;
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
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (onProgress) onProgress(attempt, maxAttempts);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      lastStatus = response.status;

      // 2xx, 3xx redirects (e.g. 301/302 from serve)
      if (response.ok) {
        let isDirectoryListing = false;
        try {
          const bodyText = await response.text();
          isDirectoryListing = bodyText.includes("Files within ") ||
            bodyText.includes("Directory listing") ||
            bodyText.includes("<title>Index of");
        } catch {
          // Ignore body read errors
        }

        if (isDirectoryListing) {
          lastStatus = response.status;
          if (attempt >= maxAttempts) {
            return {
              ready: false,
              url,
              error: `Application server at ${url} returned a directory listing instead of a rendered web application (missing index.html or invalid server config)`,
            };
          }
          // Do not treat directory listing as a ready web app; keep waiting
        } else {
          return { ready: true, url };
        }
      } else if (response.status >= 300 && response.status < 400) {
        return { ready: true, url };
      }
    } catch {
      // Not ready yet, continue polling
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  const detail = lastStatus ? ` (last HTTP status: ${lastStatus})` : "";
  return {
    ready: false,
    url,
    error: `Application readiness timeout after ${timeoutMs}ms${detail}`
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
  let iteration = 0;

  for (;;) {
    if (isAlive && !isAlive()) return null;

    // Prefer the spawned process's own reported URL when available.
    if (getUrlFromOutput) {
      const reported = getUrlFromOutput();
      if (reported) return reported;
    }

    // If candidatePort was occupied prior to spawn, the process had a port conflict
    // and was forced to choose another port. Avoid immediately probing candidatePort range
    // on the first loop iterations to give stdout time to announce the real selected port.
    const candidateConflict = candidatePort !== null && preexistingPorts.has(candidatePort);
    const allowPortProbing = !candidateConflict || iteration >= 2;

    if (candidatePort && allowPortProbing) {
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

    iteration++;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}