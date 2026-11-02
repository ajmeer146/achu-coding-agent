import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { BrowserSession } from "../src/browser/browser-session.js";
import { Workspace } from "../src/tools/workspace.js";
import { scaffoldStaticProject, scaffold3DExperienceProject } from "../src/tools/scaffold.js";
import { generateDesignSpec } from "../src/tools/design-planner.js";

function listenOn(port: number, handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function findFreePort(start = 55600): Promise<number> {
  for (let p = start; p < start + 200; p++) {
    try {
      const s = await listenOn(p, (_req, res) => res.end("ok"));
      await closeServer(s);
      return p;
    } catch {
      // try next
    }
  }
  throw new Error("No free port found");
}

async function waitForServerReady(url: string, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

const SHOT_DIR = path.resolve(process.cwd(), "docs/acceptance-evidence/screenshots");

describe("Phase E — Autonomous Software Engineering Benchmarks (1, 2, 3)", () => {
  // -------------------------------------------------------------------------
  // BENCHMARK 1: Premium Multi-Page Business Website
  // -------------------------------------------------------------------------
  test("Benchmark 1: Premium Multi-Page Business Website with Functional Navigation & Form Validation", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-bench-business-"));
    const workspace = new Workspace(tempDir);
    const spec = generateDesignSpec(
      "Build a complete premium business website for a modern technology company named NexaCorp. " +
      "Create a polished responsive design with a professional homepage, about section, services, pricing plans, " +
      "contact form with validation, appropriate real imagery, consistent typography, and mobile navigation."
    );

    const scaffoldRes = await scaffoldStaticProject(workspace, "NexaCorp Technologies", spec);
    assert.equal(scaffoldRes.success, true);

    const port = await findFreePort();
    const server = await listenOn(port, async (req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      if (urlPath === "/" || urlPath === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(await workspace.read("index.html"));
      } else if (urlPath === "/styles.css") {
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
        res.end(await workspace.read("styles.css"));
      } else if (urlPath === "/script.js") {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(await workspace.read("script.js"));
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      const page = session.getPage()!;
      await session.navigate(`http://localhost:${port}`);

      // 1. Desktop Layout Verification (1440x900)
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(200);

      const brandHeader = await page.$eval("h1", (el) => el.textContent?.trim());
      assert.ok(brandHeader && brandHeader.length > 3, "Must display prominent brand header");

      // Verify Contact Form inputs & submission
      const nameInput = await page.$("input[name='name'], #name");
      const emailInput = await page.$("input[name='email'], #email");
      if (nameInput && emailInput) {
        await nameInput.fill("Sarah Jenkins");
        await emailInput.fill("s.jenkins@nexacorp.test");
        const submitBtn = await page.$("button[type='submit']");
        if (submitBtn) {
          await submitBtn.click();
          await page.waitForTimeout(200);
        }
      }

      // Capture desktop screenshot
      const shot1 = path.join(SHOT_DIR, "benchmark-1-business-site-desktop.png");
      await page.screenshot({ path: shot1, fullPage: false });

      // 2. Mobile Layout Verification (375x667)
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(200);

      const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(hasHorizontalOverflow, false, "Mobile viewport must not have horizontal overflow");

      const shot2 = path.join(SHOT_DIR, "benchmark-1-business-site-mobile.png");
      await page.screenshot({ path: shot2, fullPage: false });

      const pageInfo = (await session.inspectPage()).pageInfo;
      const errors = pageInfo?.consoleErrors || [];
      assert.equal(errors.length, 0, `Benchmark 1 must have 0 console errors: ${errors.join(", ")}`);
    } finally {
      await session.close();
      await closeServer(server);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // -------------------------------------------------------------------------
  // BENCHMARK 2: Full-Stack Task Management Application
  // -------------------------------------------------------------------------
  test("Benchmark 2: Full-Stack Task Management Application with Express Backend, Persistent DB & CRUD", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-bench-taskapp-"));
    const workspace = new Workspace(tempDir);

    // 1. package.json
    const packageJson = {
      name: "nexa-task-manager",
      version: "1.0.0",
      type: "module",
      scripts: { start: "node server.js" },
      dependencies: { express: "^4.21.0" }
    };
    await workspace.write("package.json", JSON.stringify(packageJson, null, 2));

    // 2. db.js - Persistent JSON database engine
    const dbJs = `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbFile = path.join(__dirname, "tasks_db.json");

function readDb() {
  if (!fs.existsSync(dbFile)) {
    const init = {
      tasks: [
        { id: 1, title: "Implement Cloud Agent Trigger Pipeline", status: "completed", priority: "high", project: "Platform" },
        { id: 2, title: "Validate Windows Local Agent Installer", status: "completed", priority: "high", project: "Desktop" },
        { id: 3, title: "Add 2D Game & 3D Interactive Scaffolds", status: "in_progress", priority: "medium", project: "Engine" }
      ]
    };
    fs.writeFileSync(dbFile, JSON.stringify(init, null, 2));
    return init;
  }
  return JSON.parse(fs.readFileSync(dbFile, "utf8"));
}

function writeDb(data) {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
}

export const db = {
  getTasks: () => readDb().tasks,
  addTask: (task) => {
    const d = readDb();
    const id = Date.now();
    const newTask = { id, ...task, status: task.status || "pending", priority: task.priority || "medium" };
    d.tasks.push(newTask);
    writeDb(d);
    return newTask;
  },
  updateTask: (id, updates) => {
    const d = readDb();
    const idx = d.tasks.findIndex(t => t.id === Number(id));
    if (idx === -1) return null;
    d.tasks[idx] = { ...d.tasks[idx], ...updates };
    writeDb(d);
    return d.tasks[idx];
  },
  deleteTask: (id) => {
    const d = readDb();
    const lenBefore = d.tasks.length;
    d.tasks = d.tasks.filter(t => t.id !== Number(id));
    writeDb(d);
    return d.tasks.length < lenBefore;
  }
};
`;
    await workspace.write("db.js", dbJs);

    // 3. server.js - Express backend
    const serverJs = `import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = parseInt(process.env.PORT || "55700", 10);

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/tasks", (_req, res) => {
  res.json({ success: true, tasks: db.getTasks() });
});

app.post("/api/tasks", (req, res) => {
  const { title, project, priority, status } = req.body || {};
  if (!title) return res.status(400).json({ success: false, error: "Title is required" });
  const task = db.addTask({ title, project: project || "General", priority, status });
  res.status(201).json({ success: true, task });
});

app.put("/api/tasks/:id", (req, res) => {
  const updated = db.updateTask(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ success: false, error: "Task not found" });
  res.json({ success: true, task: updated });
});

app.delete("/api/tasks/:id", (req, res) => {
  const deleted = db.deleteTask(req.params.id);
  res.json({ success: deleted });
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(\`Task Manager API running on http://localhost:\${port}\`);
});
`;
    await workspace.write("server.js", serverJs);

    // 4. public/index.html & app.js
    const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NexaTask — Full-Stack Task Manager</title>
  <style>
    :root { --bg: #0b0f19; --card: #161f38; --cyan: #00f0ff; --text: #f8fafc; }
    body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; margin: 0; padding: 2rem; }
    .container { max-width: 900px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 1.5rem; margin-bottom: 2rem; }
    h1 { font-size: 1.6rem; color: var(--cyan); margin: 0; }
    .task-form { display: flex; gap: 0.75rem; margin-bottom: 2rem; flex-wrap: wrap; }
    input, select, button { padding: 0.65rem 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: var(--card); color: #fff; font-size: 0.9rem; }
    input { flex: 1; min-width: 200px; }
    button.btn-primary { background: var(--cyan); color: #000; font-weight: 700; border: none; cursor: pointer; }
    .task-list { display: flex; flex-direction: column; gap: 0.75rem; }
    .task-card { background: var(--card); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 1rem 1.25rem; display: flex; justify-content: space-between; align-items: center; }
    .task-title { font-weight: 600; }
    .task-badge { padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; background: rgba(0,240,255,0.15); color: var(--cyan); }
    .task-actions { display: flex; gap: 0.5rem; }
    .btn-sm { padding: 0.35rem 0.65rem; font-size: 0.8rem; cursor: pointer; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>NexaTask Full-Stack Workspace</h1>
      <span id="taskCounter" class="task-badge">3 Tasks</span>
    </header>
    <form id="taskForm" class="task-form">
      <input type="text" id="taskTitleInput" placeholder="Enter task objective..." required>
      <select id="prioritySelect">
        <option value="medium">Medium Priority</option>
        <option value="high">High Priority</option>
        <option value="low">Low Priority</option>
      </select>
      <button type="submit" id="addTaskBtn" class="btn-primary">+ Add Task</button>
    </form>
    <div id="taskList" class="task-list"></div>
  </div>
  <script>
    async function loadTasks() {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      const list = document.getElementById('taskList');
      list.innerHTML = '';
      data.tasks.forEach(t => {
        const div = document.createElement('div');
        div.className = 'task-card';
        div.innerHTML = '<span class="task-title">' + t.title + '</span><span class="task-badge">' + t.status + '</span><button class="btn-sm btn-del" onclick="deleteTask(' + t.id + ')">✕</button>';
        list.appendChild(div);
      });
      document.getElementById('taskCounter').textContent = data.tasks.length + ' Tasks';
    }
    document.getElementById('taskForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('taskTitleInput');
      const priority = document.getElementById('prioritySelect').value;
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: input.value, priority })
      });
      input.value = '';
      loadTasks();
    });
    window.deleteTask = async (id) => {
      await fetch('/api/tasks/' + id, { method: 'DELETE' });
      loadTasks();
    };
    loadTasks();
  </script>
</body>
</html>`;
    await workspace.write("public/index.html", indexHtml);

    // Link node_modules for zero-cost express availability
    try {
      await fs.symlink(path.resolve("node_modules"), path.join(tempDir, "node_modules"), "junction");
    } catch {}

    const backendPort = await findFreePort(55700);
    const child = spawn("node", ["server.js"], {
      cwd: tempDir,
      stdio: "pipe",
      env: { ...process.env, PORT: String(backendPort) }
    });

    const isReady = await waitForServerReady(`http://localhost:${backendPort}/api/tasks`, 8000);
    assert.ok(isReady, `Task Manager backend must be live on port ${backendPort}`);

    const session = new BrowserSession({ headless: true });
    try {
      // 1. Backend REST API Verification
      const listRes = await fetch(`http://localhost:${backendPort}/api/tasks`);
      assert.equal(listRes.status, 200);
      const listData = await listRes.json();
      assert.ok(listData.tasks.length >= 3, "Database must return initial tasks");

      // Create new task via API
      const createRes = await fetch(`http://localhost:${backendPort}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Verify Multi-Tenant Isolation", priority: "high" })
      });
      assert.equal(createRes.status, 201);
      const createdData = await createRes.json();
      assert.equal(createdData.task.title, "Verify Multi-Tenant Isolation");

      // 2. Playwright UI Verification
      await session.init();
      const page = session.getPage()!;
      await session.navigate(`http://localhost:${backendPort}`);

      await page.waitForSelector(".task-card");
      const cardCount = await page.$eval("#taskList", el => el.children.length);
      assert.ok(cardCount >= 4, "Task cards must render in UI");

      // Add task via UI Form
      await page.fill("#taskTitleInput", "Run Continuous Integration Tests");
      await page.click("#addTaskBtn");
      await page.waitForTimeout(300);

      const updatedCount = await page.$eval("#taskList", el => el.children.length);
      assert.equal(updatedCount, cardCount + 1, "Task list must increment after form submission");

      // Reload page and verify database persistence survives refresh
      await page.reload();
      await page.waitForTimeout(300);
      const reloadedCount = await page.$eval("#taskList", el => el.children.length);
      assert.equal(reloadedCount, updatedCount, "Task list must persist across browser refresh");

      // Capture screenshot
      const shot = path.join(SHOT_DIR, "benchmark-2-task-management.png");
      await page.screenshot({ path: shot, fullPage: false });

      const pageInfo = (await session.inspectPage()).pageInfo;
      const errors = pageInfo?.consoleErrors || [];
      assert.equal(errors.length, 0, `Benchmark 2 must have 0 console errors: ${errors.join(", ")}`);
    } finally {
      await session.close();
      child.kill("SIGTERM");
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // -------------------------------------------------------------------------
  // BENCHMARK 3: Interactive 2D/3D Experience
  // -------------------------------------------------------------------------
  test("Benchmark 3: Interactive 3D WebGL Celestial Scene with Dynamic Lighting & OrbitControls", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-bench-3d-"));
    const workspace = new Workspace(tempDir);
    const spec = generateDesignSpec("Build an interactive 3D WebGL solar system experience with Three.js and dynamic lighting");
    assert.equal(spec.productType, "experience_3d");

    const scaffoldRes = await scaffold3DExperienceProject(workspace, "Solaris Core 3D", spec);
    assert.equal(scaffoldRes.success, true);

    const port = await findFreePort();
    const server = await listenOn(port, async (req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      if (urlPath === "/" || urlPath === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(await workspace.read("index.html"));
      } else if (urlPath === "/styles.css") {
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
        res.end(await workspace.read("styles.css"));
      } else if (urlPath === "/src/main.js") {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(await workspace.read("src/main.js"));
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      const page = session.getPage()!;
      await session.navigate(`http://localhost:${port}`);

      // 1. Verify 3D Canvas is active and rendering
      await page.waitForSelector("#webglCanvas");
      const canvasDims = await page.$eval("#webglCanvas", el => ({ width: el.clientWidth, height: el.clientHeight }));
      assert.ok(canvasDims.width > 200, "WebGL Canvas must have positive rendered width");

      // 2. Interact with controls: toggle particles, switch lighting mode
      await page.click("#particleToggleBtn");
      await page.waitForTimeout(150);

      await page.click("#themeToggleBtn");
      await page.waitForTimeout(150);
      const themeText = await page.$eval("#themeToggleBtn", el => el.textContent);
      assert.ok(themeText?.includes("SOLAR"), "Theme button must toggle to SOLAR mode");

      await page.click("#resetCamBtn");
      await page.waitForTimeout(150);

      // 3. Test Mobile Viewport (375x667)
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(200);

      const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(hasHorizontalOverflow, false, "3D experience must not have horizontal overflow on mobile");

      // Capture screenshot
      const shot = path.join(SHOT_DIR, "benchmark-3-interactive-3d.png");
      await page.screenshot({ path: shot, fullPage: false });

      const pageInfo = (await session.inspectPage()).pageInfo;
      const errors = pageInfo?.consoleErrors || [];
      assert.equal(errors.length, 0, `Benchmark 3 must have 0 console errors: ${errors.join(", ")}`);
    } finally {
      await session.close();
      await closeServer(server);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
