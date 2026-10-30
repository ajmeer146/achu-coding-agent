import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../src/tools/workspace.js";
import { createFile } from "../src/tools/create-file.js";
import { editFile } from "../src/tools/edit-file.js";
import { detectStartCommand, isStaticSiteWorkspace, ensureAppServer, stopAppRuntime } from "../src/tools/app-lifecycle.js";
import { initializePlan, updatePlanProgress } from "../src/agent.js";

import { spawn } from "node:child_process";

test("TaskFlow Pro Full-Stack Application Multi-File Generation & Runtime Verification", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "achu-taskflow-pro-"));
  const ws = new Workspace(tmpDir);
  let serverProc: any = null;

  t.after(async () => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill("SIGTERM");
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  const taskPrompt = "Build a full-stack TaskFlow Pro application with Node.js backend, SQLite database persistence, REST API for task management, and responsive frontend views";

  await t.test("1. Plan initialization generates all full-stack steps with proper dependencies", () => {
    const plan = initializePlan(taskPrompt, {
      hasProject: false,
      projectType: "none",
      existingFiles: [],
      framework: null,
    });

    assert.ok(plan.length >= 8, `Plan should have at least 8 steps, got ${plan.length}`);
    const targets = plan.map(s => s.target).filter(Boolean);
    assert.ok(targets.includes("package.json"), "Plan must include package.json");
    assert.ok(targets.includes("server.js"), "Plan must include server.js");
    assert.ok(targets.includes("index.html"), "Plan must include index.html");
    assert.ok(targets.includes("styles.css"), "Plan must include styles.css");
  });

  await t.test("2. package.json creation succeeds and establishes server configuration", async () => {
    const pkgContent = JSON.stringify({
      name: "taskflow-pro",
      version: "1.0.0",
      type: "module",
      scripts: {
        start: "node server.js"
      }
    }, null, 2);

    const res = await createFile(ws, "package.json", pkgContent);
    assert.match(res, /Successfully created package.json/);
    assert.ok(fs.existsSync(path.join(tmpDir, "package.json")));
  });

  await t.test("3. server.js creation succeeds with ESM import.meta.url and multiline imports without syntax error", async () => {
    const serverCode = `import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DatabaseSync
} from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'data.db');
const PORT = process.env.PORT || 3000;

const db = new DatabaseSync(DB_PATH);
db.exec(\`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'todo'
  );
\`);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/tasks') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ id: 1, title: 'TaskFlow Setup', status: 'completed' }]));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }
  if (url.pathname === '/styles.css') {
    const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/css' });
    res.end(css);
    return;
  }
  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(\`TaskFlow Pro server running at http://localhost:\${PORT}\`);
});

export default server;
`;

    const res = await createFile(ws, "server.js", serverCode);
    assert.match(res, /Successfully created server.js/);
    assert.ok(fs.existsSync(path.join(tmpDir, "server.js")));
  });

  await t.test("4. index.html and styles.css creation succeed", async () => {
    const htmlCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="styles.css">
  <title>TaskFlow Pro</title>
</head>
<body>
  <header>
    <h1>TaskFlow Pro</h1>
  </header>
  <main>
    <div id="task-list">Loading tasks...</div>
  </main>
  <script src="app.js"></script>
</body>
</html>
`;
    const cssCode = `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; }
h1 { font-size: 2rem; color: #38bdf8; }
`;

    const htmlRes = await createFile(ws, "index.html", htmlCode);
    assert.match(htmlRes, /Successfully created index.html/);

    const cssRes = await createFile(ws, "styles.css", cssCode);
    assert.match(cssRes, /Successfully created styles.css/);

    assert.ok(fs.existsSync(path.join(tmpDir, "index.html")));
    assert.ok(fs.existsSync(path.join(tmpDir, "styles.css")));
  });

  await t.test("5. Server lifecycle detection recognizes full-stack backend and starts server on allocated port", async () => {
    assert.equal(isStaticSiteWorkspace(tmpDir), false, "Workspace with server.js must NOT be treated as static site");

    const startCmd = await detectStartCommand(ws);
    assert.match(startCmd.command, /npm run start|node server\.js/);

    const testPort = 3888;
    serverProc = spawn("node", ["server.js"], {
      cwd: tmpDir,
      env: { ...process.env, PORT: String(testPort) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise<void>((resolve, reject) => {
      let output = "";
      serverProc.stdout.on("data", (d: Buffer) => {
        output += d.toString();
        if (output.includes(`TaskFlow Pro server running at http://localhost:${testPort}`)) {
          resolve();
        }
      });
      serverProc.on("error", reject);
      setTimeout(() => reject(new Error("Server failed to boot within 5s")), 5000);
    });

    const appUrl = `http://127.0.0.1:${testPort}`;

    // Verify root HTML
    const pageRes = await fetch(appUrl);
    assert.equal(pageRes.status, 200);
    const html = await pageRes.text();
    assert.ok(html.includes("TaskFlow Pro"), "Preview page must contain TaskFlow Pro HTML, not raw prompt");

    // Verify backend API
    const apiRes = await fetch(`${appUrl}/api/tasks`);
    assert.equal(apiRes.status, 200);
    const apiData = await apiRes.json();
    assert.equal(apiData[0]?.title, "TaskFlow Setup");
  });
});
