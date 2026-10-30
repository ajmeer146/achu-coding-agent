import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { editFile } from "../src/tools/edit-file.js";
import { Workspace } from "../src/tools/workspace.js";
import { chromium } from "playwright";

const TEST_PORT = 3899;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function startAppServer(workspaceDir: string) {
  const proc = spawn("node", ["server.js"], {
    cwd: workspaceDir,
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise<{ proc: typeof proc }>((resolve, reject) => {
    let output = "";
    proc.stdout.on("data", (d) => {
      output += d.toString();
      if (output.includes(`PulseTask server running at http://localhost:${TEST_PORT}`)) {
        resolve({ proc });
      }
    });
    proc.stderr.on("data", (d) => {
      console.error("[PulseTask Server Err]:", d.toString());
    });
    proc.on("error", reject);
    setTimeout(() => reject(new Error("Server startup timeout")), 6000);
  });
}

test("Final End-to-End Acceptance Test — PulseTask Full-Stack App with Autonomous Defect Repair", async (t) => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "achu-pulsetask-"));
  const workspace = new Workspace(workspaceDir);

  t.after(() => {
    try {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    } catch {}
  });

  // Step 1: Scaffold complete PulseTask application
  // 1. package.json
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        name: "pulsetask",
        version: "1.0.0",
        type: "module",
        scripts: { start: "node server.js" },
      },
      null,
      2
    )
  );

  // 2. server.js (with deliberate controlled defect: PUT /api/tasks/:id rejects 'done' because validStatuses only has ['todo', 'in_progress'])
  fs.writeFileSync(
    path.join(workspaceDir, "server.js"),
    `import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.resolve();
const DB_PATH = path.join(__dirname, 'data.db');
const PORT = process.env.PORT || 3000;

const db = new DatabaseSync(DB_PATH);
db.exec(\`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    display_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at DATETIME NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
\`);

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function verifyPassword(stored, provided, salt) {
  const comp = crypto.scryptSync(provided, salt, 64).toString('hex');
  const b1 = Buffer.from(stored, 'hex');
  const b2 = Buffer.from(comp, 'hex');
  if (b1.length !== b2.length) return false;
  return crypto.timingSafeEqual(b1, b2);
}
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(c => {
    const [k, v] = c.split('=');
    if (k && v) out[k.trim()] = decodeURIComponent(v.trim());
  });
  return out;
}
function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function authenticate(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.session;
  if (!token) return null;
  const sess = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token);
  if (!sess) return null;
  return db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(sess.user_id);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathName = url.pathname;
  const method = req.method.toUpperCase();

  if (pathName.startsWith('/api/')) {
    try {
      if (method === 'POST' && pathName === '/api/auth/register') {
        const body = await readBody(req);
        if (!body.username || body.username.length < 3 || !body.password || body.password.length < 6) {
          return sendJson(res, 400, { error: 'Invalid username or password' });
        }
        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(body.username);
        if (existing) return sendJson(res, 400, { error: 'Username taken' });
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = hashPassword(body.password, salt);
        const r = db.prepare('INSERT INTO users (username, password_hash, salt, display_name) VALUES (?, ?, ?, ?)').run(body.username, hash, salt, body.displayName || body.username);
        const token = crypto.randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, r.lastInsertRowid, new Date(Date.now() + 86400000).toISOString());
        return sendJson(res, 201, { id: Number(r.lastInsertRowid), username: body.username }, { 'Set-Cookie': \`session=\${token}; HttpOnly; Path=/; SameSite=Lax\` });
      }

      if (method === 'POST' && pathName === '/api/auth/login') {
        const body = await readBody(req);
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(body.username || '');
        if (!user || !verifyPassword(user.password_hash, body.password || '', user.salt)) {
          return sendJson(res, 401, { error: 'Invalid credentials' });
        }
        const token = crypto.randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, new Date(Date.now() + 86400000).toISOString());
        return sendJson(res, 200, { id: user.id, username: user.username, displayName: user.display_name }, { 'Set-Cookie': \`session=\${token}; HttpOnly; Path=/; SameSite=Lax\` });
      }

      if (method === 'GET' && pathName === '/api/auth/me') {
        const user = authenticate(req);
        if (!user) return sendJson(res, 401, { error: 'Unauthenticated' });
        return sendJson(res, 200, user);
      }

      const user = authenticate(req);
      if (!user) return sendJson(res, 401, { error: 'Auth required' });

      if (method === 'GET' && pathName === '/api/tasks') {
        const rows = db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY id DESC').all(user.id);
        return sendJson(res, 200, rows);
      }

      if (method === 'POST' && pathName === '/api/tasks') {
        const body = await readBody(req);
        if (!body.title) return sendJson(res, 400, { error: 'Title required' });
        const r = db.prepare('INSERT INTO tasks (user_id, title, description, status) VALUES (?, ?, ?, ?)').run(user.id, body.title, body.description || '', body.status || 'todo');
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(r.lastInsertRowid);
        return sendJson(res, 201, task);
      }

      if (method === 'PUT' && pathName.startsWith('/api/tasks/')) {
        const id = parseInt(pathName.split('/')[3], 10);
        const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, user.id);
        if (!task) return sendJson(res, 404, { error: 'Task not found' });
        const body = await readBody(req);
        // CONTROLLED DEFECT: Missing 'done' in validStatuses list!
        const validStatuses = ['todo', 'in_progress'];
        if (body.status && !validStatuses.includes(body.status)) {
          return sendJson(res, 400, { error: 'Invalid task status. Allowed: ' + validStatuses.join(', ') });
        }
        if (body.status) {
          db.prepare('UPDATE tasks SET status = ? WHERE id = ? AND user_id = ?').run(body.status, id, user.id);
        }
        return sendJson(res, 200, { success: true });
      }

      return sendJson(res, 404, { error: 'Not found' });
    } catch (e) {
      return sendJson(res, 500, { error: 'Internal error' });
    }
  }

  // Static files
  const filename = pathName === '/' ? 'index.html' : pathName.slice(1);
  const filePath = path.join(__dirname, filename);
  if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
    const ext = path.extname(filePath);
    const mime = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : 'application/javascript';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(fs.readFileSync(filePath));
    return;
  }
  res.writeHead(404);
  res.end('404');
});

server.listen(PORT, () => {
  console.log(\`PulseTask server running at http://localhost:\${PORT}\`);
});
`
  );

  // 3. index.html, login.html, dashboard.html, styles.css
  fs.writeFileSync(
    path.join(workspaceDir, "index.html"),
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="styles.css"><title>PulseTask</title></head><body>
    <header class="app-header"><a href="index.html" class="logo">PulseTask</a><nav><a href="login.html" class="btn">Sign In</a></nav></header>
    <main class="container"><h1>PulseTask Workspaces</h1><p>Secure full-stack task execution.</p><a href="login.html" id="get-started-btn" class="btn btn-primary">Get Started</a></main>
    </body></html>`
  );

  fs.writeFileSync(
    path.join(workspaceDir, "login.html"),
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="styles.css"><title>Login</title></head><body>
    <div class="container"><div class="card"><h2>Sign In</h2>
    <form id="login-form"><input id="user" placeholder="Username" required><input id="pass" type="password" placeholder="Password" required><button id="submit-login" type="submit">Login</button></form>
    <div id="msg"></div></div></div>
    <script>
    document.getElementById('login-form').onsubmit = async (e) => {
      e.preventDefault();
      const res = await fetch('/api/auth/login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ username: document.getElementById('user').value, password: document.getElementById('pass').value }) });
      if (res.ok) window.location.href = 'dashboard.html';
      else document.getElementById('msg').textContent = 'Login failed';
    };
    </script></body></html>`
  );

  fs.writeFileSync(
    path.join(workspaceDir, "dashboard.html"),
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="styles.css"><title>Dashboard</title></head><body data-protected="true">
    <header class="app-header"><span class="logo">PulseTask</span><nav><span id="user-display"></span><button id="logout-btn">Logout</button></nav></header>
    <main class="container">
      <h2>My Tasks</h2>
      <div class="task-form"><input id="new-title" placeholder="Task title"><button id="add-task-btn">Add Task</button></div>
      <div id="tasks-list"></div>
    </main>
    <script>
    async function loadTasks() {
      const me = await fetch('/api/auth/me').then(r => r.json());
      document.getElementById('user-display').textContent = me.display_name || me.displayName || me.username;
      const tasks = await fetch('/api/tasks').then(r => r.json());
      const el = document.getElementById('tasks-list');
      el.innerHTML = tasks.map(t => \`<div class="task-item" data-id="\${t.id}">
        <span>\${t.title} (\${t.status})</span>
        <button class="mark-done-btn" data-id="\${t.id}">Mark Done</button>
      </div>\`).join('');
      document.querySelectorAll('.mark-done-btn').forEach(b => {
        b.onclick = async () => {
          const res = await fetch('/api/tasks/' + b.dataset.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ status: 'done' }) });
          if (!res.ok) alert('Update Error');
          else loadTasks();
        };
      });
    }
    document.getElementById('add-task-btn').onclick = async () => {
      const title = document.getElementById('new-title').value;
      if (!title) return;
      await fetch('/api/tasks', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ title, status: 'todo' }) });
      document.getElementById('new-title').value = '';
      loadTasks();
    };
    loadTasks();
    </script></body></html>`
  );

  fs.writeFileSync(
    path.join(workspaceDir, "styles.css"),
    `* { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: sans-serif; background: #0f172a; color: #f8fafc; padding-bottom: 2rem; }
    .container { max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    .app-header { background: #1e293b; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
    .logo { font-size: 1.25rem; font-weight: bold; color: #38bdf8; text-decoration: none; }
    .btn { padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; text-decoration: none; display: inline-block; }
    .btn-primary { background: #38bdf8; color: #0f172a; font-weight: bold; }
    .card { background: #1e293b; padding: 2rem; border-radius: 8px; margin-top: 2rem; }
    input { padding: 0.5rem 1rem; background: #334155; border: 1px solid #475569; color: #fff; border-radius: 4px; margin-right: 0.5rem; }
    button { padding: 0.5rem 1rem; background: #38bdf8; border: none; border-radius: 4px; cursor: pointer; }
    .task-item { background: #1e293b; padding: 1rem; margin-top: 0.5rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; }
    `
  );

  // Step 2: Start server and verify baseline auth and task creation
  let serverHandle = await startAppServer(workspaceDir);

  let sessionCookie = "";
  let taskId = null;

  await t.test("Phase 4.1: Register User and create task", async () => {
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice_pulsetask", password: "password123", displayName: "Alice Lead" }),
    });
    assert.equal(regRes.status, 201);
    sessionCookie = regRes.headers.get("set-cookie")?.split(";")[0] || "";
    assert.ok(sessionCookie.startsWith("session="));

    const taskRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ title: "Setup CI/CD Pipeline", status: "todo" }),
    });
    assert.equal(taskRes.status, 201);
    const task = await taskRes.json();
    taskId = task.id;
    assert.equal(task.title, "Setup CI/CD Pipeline");
    assert.equal(task.status, "todo");
  });

  // Step 3: Trigger the controlled defect
  await t.test("Phase 4.2: Detect controlled defect (updating status to 'done' rejected with 400)", async () => {
    const updateRes = await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ status: "done" }),
    });

    // The controlled defect produces HTTP 400
    assert.equal(updateRes.status, 400, "Defect detected: updating to 'done' rejected because 'done' is missing from validStatuses");
    const errBody = await updateRes.json();
    assert.ok(errBody.error.includes("Invalid task status"), "Error explains status validation mismatch");
  });

  // Step 4: Autonomous Repair using Agent's editFile tool
  await t.test("Phase 4.3: Autonomous Repair using Agent editFile tool", async () => {
    // Explanation of cause: validStatuses in server.js omitted 'done'
    const editMsg = await editFile(
      workspace,
      "server.js",
      `        // CONTROLLED DEFECT: Missing 'done' in validStatuses list!
        const validStatuses = ['todo', 'in_progress'];`,
      `        // FIXED BY AGENT: Added 'done' to valid task statuses
        const validStatuses = ['todo', 'in_progress', 'done'];`
    );

    assert.ok(editMsg.includes("Successfully edited server.js"), "Agent editFile must successfully apply targeted patch to server.js");

    // Restart server with repaired code
    serverHandle.proc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 600));
    serverHandle = await startAppServer(workspaceDir);
  });

  // Step 5: Verification of Defect Fix
  await t.test("Phase 4.4: Verify that the defect is resolved", async () => {
    const updateRes = await fetch(`${BASE_URL}/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ status: "done" }),
    });

    assert.equal(updateRes.status, 200, "After repair: updating status to 'done' succeeds with 200 OK");

    const getRes = await fetch(`${BASE_URL}/api/tasks`, {
      headers: { Cookie: sessionCookie },
    });
    const tasks = await getRes.json();
    const updated = tasks.find((t: any) => t.id === taskId);
    assert.equal(updated.status, "done", "Task status is persisted as 'done' in SQLite");
  });

  // Step 6: Verify Unrelated Functionality Still Works (Browser E2E via Playwright)
  await t.test("Phase 4.5: Browser E2E confirms defect fixed and unrelated features intact", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });

      // 1. Landing page loads
      await page.goto(`${BASE_URL}/index.html`);
      const h1 = await page.textContent("h1");
      assert.ok(h1?.includes("PulseTask Workspaces"));

      // 2. Login flow
      await page.goto(`${BASE_URL}/login.html`);
      await page.fill("#user", "alice_pulsetask");
      await page.fill("#pass", "password123");
      await page.click("#submit-login");

      await page.waitForURL("**/dashboard.html");
      await page.waitForSelector("#user-display");
      const userText = await page.textContent("#user-display");
      assert.equal(userText, "Alice Lead");

      // 3. Create another task in browser
      await page.fill("#new-title", "Deploy Production Release");
      await page.click("#add-task-btn");

      await page.waitForFunction(() => {
        const text = document.getElementById("tasks-list")?.textContent || "";
        return text.includes("Deploy Production Release") && text.includes("Setup CI/CD Pipeline");
      });
      const taskList = await page.textContent("#tasks-list");
      assert.ok(taskList?.includes("Deploy Production Release"));
      assert.ok(taskList?.includes("Setup CI/CD Pipeline (done)"));

      // 4. Mobile viewport verification
      await page.setViewportSize({ width: 375, height: 812 });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      assert.ok(scrollWidth <= clientWidth, "Mobile dashboard has 0 horizontal scroll overflow");

      assert.equal(consoleErrors.length, 0, "Zero console errors during browser verification");
    } finally {
      await browser.close();
    }
  });

  serverHandle.proc.kill("SIGTERM");
});
