import { spawn, ChildProcess } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as net from "node:net";
import { Workspace, isInsideRoot } from "./workspace.js";
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
  static?: boolean;
};

const STATIC_SERVER_SOURCE = `const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(process.argv[2] || process.cwd());
const port = Number(process.env.PORT || process.argv[3] || 3000);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const send = (res, code, body, type) => { res.writeHead(code, { "Content-Type": type || "text/plain; charset=utf-8", "Cache-Control": "no-store" }); res.end(body); };
const server = http.createServer((req, res) => {
  try {
    const rawPath = decodeURIComponent(String(req.url || "/").split("?")[0]);
    const filePath = path.resolve(root, "." + rawPath);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) return send(res, 403, "Forbidden");
    let target = filePath;
    try { if (fs.statSync(target).isDirectory()) target = path.join(target, "index.html"); } catch {}
    if (!fs.existsSync(target)) target = path.join(root, "index.html");
    if (!fs.existsSync(target)) return send(res, 404, "Not found");
    const body = fs.readFileSync(target);
    res.writeHead(200, { "Content-Type": types[path.extname(target).toLowerCase()] || "application/octet-stream", "Content-Length": body.length, "Cache-Control": "no-store" });
    if (req.method === "HEAD") return res.end();
    res.end(body);
  } catch {
    send(res, 500, "Server error");
  }
});
const bindHost = process.env.ACHU_BIND_ALL === "true" ? "0.0.0.0" : "127.0.0.1";
server.listen(port, bindHost, () => console.log("Serving " + root + " at http://" + (bindHost === "0.0.0.0" ? "localhost" : bindHost) + ":" + port));
`;

function getStaticServerScriptPath(): string {
  const scriptPath = path.join(os.tmpdir(), "achu-static-server.cjs");
  try {
    if (!fs.existsSync(scriptPath) || fs.readFileSync(scriptPath, "utf8") !== STATIC_SERVER_SOURCE) {
      fs.writeFileSync(scriptPath, STATIC_SERVER_SOURCE, "utf8");
    }
  } catch {}
  return scriptPath;
}

function isNodeServerFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return /\b(http\.createServer|express\(|fastify\(|new\s+Koa\(|\.listen\s*\()\b/.test(content);
  } catch {
    return false;
  }
}

export function isStaticSiteWorkspace(workingDir: string): boolean {
  const htmlPath = path.join(workingDir, "index.html");
  if (!fs.existsSync(htmlPath)) return false;

  // If a dedicated backend server script exists, this is a full-stack/backend app, not a static site
  const hasServerScript =
    fs.existsSync(path.join(workingDir, "server.js")) ||
    fs.existsSync(path.join(workingDir, "server.mjs")) ||
    fs.existsSync(path.join(workingDir, "server.cjs")) ||
    isNodeServerFile(path.join(workingDir, "app.js")) ||
    isNodeServerFile(path.join(workingDir, "app.mjs"));

  if (hasServerScript) return false;

  try {
    const pkgPath = path.join(workingDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const scripts = pkg.scripts || {};
      const hasNodeServer = Object.values(scripts).some((s: any) =>
        typeof s === "string" && /\bnode\s+[\w\.\/-]*(server|app|api|index)/i.test(s)
      );
      if (hasNodeServer) return false;
    }
  } catch {}

  let html = "";
  try {
    html = fs.readFileSync(htmlPath, "utf8");
  } catch {
    return false;
  }
  const hasReactRoot = /<div[^>]+id=["']root["']/i.test(html);
  const hasModuleEntry = /<script[^>]+type=["']module["'][^>]*src=["'][^"']*src\/(main|index)\.(jsx?|tsx?)/i.test(html);
  return !hasReactRoot && !hasModuleEntry;
}

export function createStaticSiteCommand(workingDir: string): StartCommandResult {
  const scriptPath = getStaticServerScriptPath();
  return {
    command: `"${process.execPath}" "${scriptPath}" "${workingDir}"`,
    port: null,
    url: null,
    cwd: workingDir,
    static: true,
  };
}

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

  // A plain HTML/CSS/JS site is served by the built-in static server. This
  // takes precedence over package.json scripts so a stray Vite/React config
  // can never break a static site that has no React root entry.
  if (isStaticSiteWorkspace(workspace.root)) {
    return createStaticSiteCommand(workspace.root);
  }

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

  // 3. Check for standalone server script in workspace root
  const serverCandidates = ["server.js", "server.mjs", "server.cjs"];
  for (const candidate of serverCandidates) {
    if (fs.existsSync(path.join(workspace.root, candidate))) {
      return { command: `node ${candidate}`, port: null, url: null, cwd: workspace.root };
    }
  }
  if (isNodeServerFile(path.join(workspace.root, "app.js"))) {
    return { command: "node app.js", port: null, url: null, cwd: workspace.root };
  }
  if (isNodeServerFile(path.join(workspace.root, "app.mjs"))) {
    return { command: "node app.mjs", port: null, url: null, cwd: workspace.root };
  }

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
  if (start !== 3001 && (await isPortAvailable(start)) && !(await isUrlServing(`http://localhost:${start}`, 200))) {
    return start;
  }
  for (let offset = 1; offset <= maxAttempts; offset++) {
    const candidate = start + offset;
    if (candidate > 65535) break;
    if (candidate === 3001) continue;
    if ((await isPortAvailable(candidate)) && !(await isUrlServing(`http://localhost:${candidate}`, 200))) {
      return candidate;
    }
  }
  return 3002;
}

/**
 * Update any port flags inside a script string (e.g. "npx serve . -l 3000", "vite --port 5173").
 */
export function updatePortInScriptString(script: string, newPort: number): string {
  let updated = script;
  if (/--\s+--port\s+\d+/i.test(updated)) {
    updated = updated.replace(/(--\s+--port\s+)\d+/i, `$1${newPort}`);
  } else if (/--\s+-p\s+\d+/i.test(updated)) {
    updated = updated.replace(/(--\s+-p\s+)\d+/i, `$1${newPort}`);
  } else if (/--\s+-l\s+\d+/i.test(updated)) {
    updated = updated.replace(/(--\s+-l\s+)\d+/i, `$1${newPort}`);
  } else if (/(?:-l|-p|--port)\s+\d+/i.test(updated)) {
    updated = updated.replace(/((?:-l|-p|--port)\s+)\d+/i, `$1${newPort}`);
  } else if (/--port=\d+/i.test(updated)) {
    updated = updated.replace(/(--port=)\d+/i, `$1${newPort}`);
  } else if (/PORT=\d+/i.test(updated)) {
    updated = updated.replace(/(PORT=)\d+/i, `$1${newPort}`);
  } else if (/\b(serve|http-server)\b/i.test(updated) && !/--port|-p|-l/.test(updated)) {
    updated = `${updated} -l ${newPort}`;
  } else if (/\bvite\b/i.test(updated) && !/--port/.test(updated)) {
    updated = `${updated} --port ${newPort}`;
  } else if (/\bnext\b/i.test(updated) && !/-p|--port/.test(updated)) {
    updated = `${updated} -p ${newPort}`;
  }
  return updated;
}

/**
 * Synchronize the allocated port to package.json scripts in the workspace.
 * Replaces port arguments in scripts like 'serve', 'vite', 'next', 'http-server'.
 * Does not overwrite unrelated scripts or configurations.
 */
export function syncPortToPackageJson(workspaceDir: string, newPort: number): boolean {
  try {
    const pkgPath = path.join(workspaceDir, "package.json");
    if (!fs.existsSync(pkgPath)) return false;
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    if (!pkg.scripts || typeof pkg.scripts !== "object") return false;

    let changed = false;
    for (const [scriptName, scriptVal] of Object.entries(pkg.scripts)) {
      if (typeof scriptVal === "string" && ["dev", "start", "serve", "preview"].includes(scriptName)) {
        const updated = updatePortInScriptString(scriptVal, newPort);
        if (updated !== scriptVal) {
          pkg.scripts[scriptName] = updated;
          changed = true;
        }
      }
    }

    if (changed) {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
      return true;
    }
  } catch {
    // Non-fatal if package.json cannot be parsed or updated
  }
  return false;
}

/**
 * Replace port flags in a server command with a new port number.
 */
export function replacePortInCommand(command: string, newPort: number, workspaceDir?: string): string {
  if (workspaceDir) {
    syncPortToPackageJson(workspaceDir, newPort);
  }

  let replaced = command;
  if (/--\s+--port\s+\d+/i.test(replaced)) {
    return replaced.replace(/(--\s+--port\s+)\d+/i, `$1${newPort}`);
  } else if (/--\s+-p\s+\d+/i.test(replaced)) {
    return replaced.replace(/(--\s+-p\s+)\d+/i, `$1${newPort}`);
  } else if (/--\s+-l\s+\d+/i.test(replaced)) {
    return replaced.replace(/(--\s+-l\s+)\d+/i, `$1${newPort}`);
  } else if (/(?:-l|-p|--port)\s+\d+/i.test(replaced)) {
    return replaced.replace(/((?:-l|-p|--port)\s+)\d+/i, `$1${newPort}`);
  } else if (/--port=\d+/i.test(replaced)) {
    return replaced.replace(/(--port=)\d+/i, `$1${newPort}`);
  } else if (/PORT=\d+/i.test(replaced)) {
    return replaced.replace(/(PORT=)\d+/i, `$1${newPort}`);
  } else if (/\b(serve|http-server)\b/i.test(replaced) && !/--port|-p|-l/.test(replaced)) {
    return `${replaced} -l ${newPort}`;
  } else if (/\bvite\b/i.test(replaced) && !/--port/.test(replaced)) {
    return `${replaced} --port ${newPort}`;
  }

  // Handle npm/pnpm/yarn commands:
  if (workspaceDir && fs.existsSync(path.join(workspaceDir, "package.json"))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workspaceDir, "package.json"), "utf8"));
      const scriptMatch = replaced.match(/^(?:npm|pnpm|yarn)\s+(?:run\s+)?([\w:.-]+)/i);
      const scriptName = scriptMatch ? scriptMatch[1] : "dev";
      const scriptVal = pkg.scripts?.[scriptName];
      if (typeof scriptVal === "string") {
        if (/\b(serve|http-server)\b/i.test(scriptVal)) {
          // Serve uses -l, which is already synchronized into package.json!
          // Never append --port to serve!
          return replaced;
        }
        if (/\bvite\b|\bastro\b|\bparcel\b|webpack|vue-cli-service|\bng\s+serve\b/i.test(scriptVal)) {
          if (!scriptVal.includes("--port")) return `${replaced} -- --port ${newPort}`;
          return replaced;
        }
        if (/\bnext\b|\bnuxt\b/i.test(scriptVal)) {
          if (!scriptVal.includes("-p") && !scriptVal.includes("--port")) return `${replaced} -- -p ${newPort}`;
          return replaced;
        }
        // react-scripts and unknown/custom scripts: never append a port flag.
        // The launcher sets the PORT environment variable for the spawned process.
        return replaced;
      }
      return replaced;
    } catch {}
  }

  if (/^(?:npm|pnpm)\s+run\s+\w+/i.test(replaced)) {
    return `${replaced} -- --port ${newPort}`;
  } else if (/^(?:npm|pnpm)\s+start\b/i.test(replaced)) {
    return `${replaced} -- --port ${newPort}`;
  } else if (/^yarn\s+(?:run\s+)?\w+/i.test(replaced)) {
    return `${replaced} --port ${newPort}`;
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
/**
 * Explicit allowlist of environment variables passed to generated app processes.
 * Platform secrets (NVIDIA_API_KEY, TRIGGER_SECRET_KEY, SESSION_SECRET, CSRF_SECRET,
 * POSTGRES_PASSWORD, etc.) are strictly excluded.
 */
export const GENERATED_APP_ENV_ALLOWLIST = new Set([
  'PATH', 'HOME', 'HOMEPATH', 'HOMEDRIVE', 'TMPDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA',
  'LOCALAPPDATA', 'SystemRoot', 'SystemDrive', 'COMSPEC', 'PATHEXT',
  'NODE_ENV', 'PORT', 'HOST', 'LANG', 'LC_ALL', 'SHELL', 'TERM',
  'CHOKIDAR_USEPOLLING', 'WATCHPACK_POLLING', 'FAST_REFRESH'
]);

export function filterToGeneratedAppEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {};
  for (const [key, val] of Object.entries(env)) {
    if (GENERATED_APP_ENV_ALLOWLIST.has(key) && val !== undefined) {
      safeEnv[key] = val;
    }
  }
  if (!safeEnv.HOST) {
    safeEnv.HOST = "127.0.0.1";
  }
  return safeEnv;
}

export function buildGeneratedAppEnv(port?: number): NodeJS.ProcessEnv {
  const safe = filterToGeneratedAppEnv(process.env);
  if (port !== undefined) {
    safe.PORT = String(port);
  }
  return safe;
}

/**
 * Spawn an app process in a cross-platform detached manner so the parent
 * process can exit without killing the server.
 *
 *  - Windows: windowsHide=true prevents console windows; parent can discover
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
  env?: NodeJS.ProcessEnv
): AppProcessInfo {
  const safeEnv = env ? filterToGeneratedAppEnv(env) : buildGeneratedAppEnv();
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
      env: safeEnv,
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
      // Normalize loopback hosts so the whole pipeline uses the canonical
      // http://localhost:<port> form (matches getAppUrl/discoverNewServerUrl).
      return match[1].trim().replace(/\/\/(?:127\.0\.0\.1|0\.0\.0\.0)(?=[:/])/i, "//localhost");
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
      // Fast adaptive interval: check every 250ms for first 8 attempts (2s), then 500ms, then intervalMs
      const pollDelay = options.intervalMs !== undefined
        ? intervalMs
        : (attempt <= 8 ? 250 : (attempt <= 14 ? 500 : 1000));
      await new Promise((resolve) => setTimeout(resolve, pollDelay));
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
  appInfo.status = "stopped";

  // On Windows, terminate the process tree owned by this exact PID and wait for handles to release
  if (process.platform === "win32" && appInfo.pid > 0) {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", appInfo.pid.toString(), "/t", "/f"], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"],
      });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
      setTimeout(resolve, 3000);
    });
  }

  const child = appInfo.process;
  if (child) {
    try { child.kill("SIGTERM"); } catch {}
    try { child.kill("SIGKILL"); } catch {}
  }
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

function appRegistryDir(): string {
  const dir = path.join(os.tmpdir(), "achu-app-runtimes");
  try {
    fs.mkdirSync(dir, { recursive: true });
    migrateLegacyRegistry(dir);
  } catch {
    // Best effort: the registry is an optimization, not a source of truth.
  }
  return dir;
}

function normalizeWorkspaceKey(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function runtimeRecordPath(key: string): string {
  const hash = crypto.createHash("sha1").update(key).digest("hex");
  return path.join(appRegistryDir(), `${hash}.json`);
}

function writeRuntimeRecord(key: string, record: AppRuntimeRecord): void {
  const target = runtimeRecordPath(key);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(record), "utf8");
    fs.renameSync(tmp, target);
  } catch {
    try {
      fs.writeFileSync(target, JSON.stringify(record), "utf8");
      fs.rmSync(tmp, { force: true });
    } catch {
      // Best effort: the registry is an optimization, not a source of truth.
    }
  }
}

function readRuntimeRecord(file: string): AppRuntimeRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && typeof parsed.workspaceRoot === "string" && Number.isInteger(parsed.pid)) {
      return parsed as AppRuntimeRecord;
    }
  } catch {
    // Missing or corrupt record: ignore it.
  }
  return null;
}

/**
 * One file per workspace avoids the read-modify-write race that lost records
 * when several agent/test processes updated the old single JSON registry
 * concurrently (leaving servers running but untracked).
 */
function loadRegistry(): Record<string, AppRuntimeRecord> {
  const dir = appRegistryDir();
  const records: Record<string, AppRuntimeRecord> = {};
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const record = readRuntimeRecord(path.join(dir, name));
      if (record) records[normalizeWorkspaceKey(record.workspaceRoot)] = record;
    }
  } catch {
    // Missing or unreadable registry: start clean.
  }
  return records;
}

function migrateLegacyRegistry(dir: string): void {
  const legacyPath = path.join(os.tmpdir(), "achu-app-runtime.json");
  if (!fs.existsSync(legacyPath)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
    if (parsed && typeof parsed === "object") {
      for (const record of Object.values(parsed as Record<string, AppRuntimeRecord>)) {
        if (!record || typeof record.workspaceRoot !== "string" || !Number.isInteger(record.pid)) continue;
        if (!isProcessAlive(record.pid)) continue;
        const hash = crypto.createHash("sha1").update(normalizeWorkspaceKey(record.workspaceRoot)).digest("hex");
        const target = path.join(dir, `${hash}.json`);
        try { fs.writeFileSync(target, JSON.stringify(record), "utf8"); } catch {}
      }
    }
    fs.rmSync(legacyPath, { force: true });
  } catch {
    // Leave the legacy file in place if it cannot be parsed.
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
  const key = normalizeWorkspaceKey(workspaceRoot);
  const recordPath = runtimeRecordPath(key);
  const record = readRuntimeRecord(recordPath);
  if (record) {
    if (isProcessAlive(record.pid)) return record;
    try { fs.rmSync(recordPath, { force: true }); } catch {}
  }

  // Also check if any active record is inside an immediate child project of workspaceRoot
  const resolvedRoot = path.resolve(workspaceRoot);
  for (const [k, rec] of Object.entries(loadRegistry())) {
    if (!isProcessAlive(rec.pid)) {
      try { fs.rmSync(runtimeRecordPath(k), { force: true }); } catch {}
      continue;
    }
    if (isInsideRoot(resolvedRoot, rec.workspaceRoot)) {
      return rec;
    }
  }

  return null;
}

/** Persist (or update) the app runtime record for a workspace. */
export function saveAppRuntime(record: AppRuntimeRecord): void {
  writeRuntimeRecord(normalizeWorkspaceKey(record.workspaceRoot), record);
}

/** Remove the app runtime record for a workspace (e.g. after a failed start). */
export function clearAppRuntime(workspaceRoot: string): void {
  try { fs.rmSync(runtimeRecordPath(normalizeWorkspaceKey(workspaceRoot)), { force: true }); } catch {}
}

/**
 * Tree-kill the app server previously recorded for `workspaceRoot` and remove
 * its runtime record(s). Only the exact PID this agent spawned (and its
 * descendants) is terminated — never a process discovered by port number or
 * name — so unrelated listeners are untouched. Waits (bounded) until the
 * process has exited so workspace file handles are released on Windows.
 *
 * Returns true when a record existed, false otherwise.
 */
export async function stopAppRuntime(workspaceRoot: string): Promise<boolean> {
  const registry = loadRegistry();
  const key = normalizeWorkspaceKey(workspaceRoot);
  const record = registry[key];
  if (!record) return false;

  const targetPids = new Set<number>();
  if (Number.isInteger(record.pid) && record.pid > 0) targetPids.add(record.pid);
  // ensureAppServer persists the same pid under both the authoritative project
  // root and the requested workspace root; collect all entries with that pid.
  for (const rec of Object.values(registry)) {
    if (Number.isInteger(rec.pid) && rec.pid > 0 && rec.pid === record.pid) {
      targetPids.add(rec.pid);
    }
  }

  for (const pid of targetPids) {
    if (!isProcessAlive(pid)) continue;

    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", pid.toString(), "/t", "/f"], {
          windowsHide: true,
          stdio: ["ignore", "ignore", "ignore"],
        });
        killer.on("close", () => resolve());
        killer.on("error", () => resolve());
        setTimeout(resolve, 3000);
      });
    } else {
      // Detached wrappers are their own process-group leaders.
      try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
    }

    // Bounded wait until the process tree has fully exited (file handles released).
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && isProcessAlive(pid)) {
      await new Promise((r) => setTimeout(r, 150));
    }
    if (process.platform !== "win32" && isProcessAlive(pid)) {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
  }

  for (const [k, rec] of Object.entries(registry)) {
    if (k === key || (Number.isInteger(rec.pid) && targetPids.has(rec.pid))) {
      try { fs.rmSync(runtimeRecordPath(k), { force: true }); } catch {}
    }
  }
  return true;
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

/**
 * Automatically ensures a development server is running for an application workspace.
 * Reuses existing running server if alive, or detects start command and launches detached.
 */
export async function ensureAppServer(workspaceRoot: string): Promise<string | null> {
  const ws = new Workspace(workspaceRoot);
  const authRoot = await ws.getAuthoritativeProjectRoot();

  // 1. Check if already serving
  const existing = getAppRuntime(authRoot) || getAppRuntime(workspaceRoot);
  if (existing && existing.url && isProcessAlive(existing.pid) && (await isUrlServing(existing.url, 600))) {
    return existing.url;
  }

  // 2. Detect start command or static fallback
  const effectiveWs = new Workspace(authRoot);
  const startInfo = await detectStartCommand(effectiveWs);
  let command = startInfo.command;
  let port = startInfo.port || 3000;
  let workingDir = startInfo.cwd || authRoot;

  if (!command && (fs.existsSync(path.join(authRoot, "index.html")) || fs.existsSync(path.join(workspaceRoot, "index.html")))) {
    command = "npx --yes serve -l 3000 .";
    port = 3000;
    workingDir = fs.existsSync(path.join(authRoot, "index.html")) ? authRoot : workspaceRoot;
  }

  if (!command) {
    return null;
  }

  // 3. Port conflict prevention
  const isPortBusy = (await isUrlServing(`http://localhost:${port}`, 300)) || !(await isPortAvailable(port));
  if (isPortBusy) {
    port = await allocateAvailablePort(port);
    command = replacePortInCommand(command, port, workingDir);
  } else {
    syncPortToPackageJson(workingDir, port);
  }

  const spawnEnv = buildGeneratedAppEnv(port);

  const preexistingPorts = await probePortRange(port, 20, 300);
  const appInfo = spawnAppProcess(command, workingDir, spawnEnv);
  const url = await discoverNewServerUrl({
    candidatePort: port,
    preexistingPorts,
    maxProbes: 20,
    timeoutMs: 12000,
    pollMs: 500,
    isAlive: () => !hasAppProcessExited(appInfo),
    getUrlFromOutput: () => {
      const out = readAppOutput(appInfo);
      return extractUrlFromOutput(out);
    },
  });

  const finalUrl = url || `http://localhost:${port}`;
  const isServing = await isUrlServing(finalUrl, 2000);
  if (isServing) {
    saveAppRuntime({
      workspaceRoot: authRoot,
      pid: appInfo.pid,
      port,
      url: finalUrl,
      startedAt: Date.now(),
      outputPath: appInfo.outputPath,
    });
    if (authRoot !== workspaceRoot) {
      saveAppRuntime({
        workspaceRoot,
        pid: appInfo.pid,
        port,
        url: finalUrl,
        startedAt: Date.now(),
        outputPath: appInfo.outputPath,
      });
    }
    return finalUrl;
  }

  return null;
}