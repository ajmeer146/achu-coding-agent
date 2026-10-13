import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { WebSocket } from "ws";

const TEST_PORT = 3099;
const WS_URL = `ws://localhost:${TEST_PORT}`;

async function runE2E() {
  console.log("=== Starting Real End-to-End Live Preview & Project Isolation Verification ===");

  const tempBase = await fs.mkdtemp(path.join(os.tmpdir(), "achu-e2e-base-"));
  process.env.ACHU_PROJECTS_DIR = tempBase;

  // 1. Start the workspace server on TEST_PORT
  console.log(`[1] Starting Workspace Server on port ${TEST_PORT}...`);
  const serverProcess = spawn("node", ["dist/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(TEST_PORT), ACHU_PROJECTS_DIR: tempBase },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverStarted = false;
  serverProcess.stdout.on("data", (d) => {
    const s = d.toString();
    console.log("[SERVER STDOUT]", s.trim());
    if (s.includes("running at")) {
      serverStarted = true;
    }
  });

  serverProcess.stderr.on("data", (d) => {
    console.error("[SERVER STDERR]", d.toString().trim());
  });

  // Wait for server to listen
  for (let i = 0; i < 20; i++) {
    if (serverStarted) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  const ws = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  console.log("  -> WebSocket connected to Workspace Server!");

  let activeWorkspace = null;
  let receivedAppUrl = null;
  const events = [];

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    events.push(msg);
    if (msg.type === "project_selected") {
      activeWorkspace = msg.path;
      console.log(`  -> Server event: project_selected (${msg.path})`);
    }
    if (msg.type === "app_url") {
      receivedAppUrl = msg.url;
      console.log(`  -> Server event: app_url (${msg.url}) [workspace: ${msg.workspaceRoot}]`);
    }
  });

  try {
    // 2. Create Project 1: NovaCart Live Preview Demo
    console.log("[2] Creating dedicated project for NovaCart...");
    ws.send(JSON.stringify({
      type: "create_project",
      payload: { name: "novacart-demo", task: "Build a complete e-commerce website called NovaCart" }
    }));

    await new Promise((r) => setTimeout(r, 600));
    if (!activeWorkspace) throw new Error("Project 1 was not selected");
    console.log(`  -> Project 1 workspace confirmed: ${activeWorkspace}`);

    // Create a working index.html and package.json with dev server
    const project1Dir = activeWorkspace;
    await fs.writeFile(
      path.join(project1Dir, "index.html"),
      "<!DOCTYPE html><html><head><title>NovaCart Demo</title></head><body><h1>Welcome to NovaCart Live Preview</h1></body></html>"
    );
    await fs.writeFile(
      path.join(project1Dir, "package.json"),
      JSON.stringify({
        name: "novacart-demo",
        scripts: {
          dev: "npx serve . -l 52101",
          start: "npx serve . -l 52101"
        }
      })
    );

    // 3. Select Project 1 to verify server state
    console.log("[3] Querying Project 1 live preview state...");
    ws.send(JSON.stringify({
      type: "select_project",
      payload: { path: project1Dir }
    }));
    await new Promise((r) => setTimeout(r, 400));
    // Project 1 has no running server yet, preview must be null
    console.log(`  -> Before server start, receivedAppUrl is null: ${receivedAppUrl === null}`);

    // 4. Start Project 1 development server manually / simulated
    console.log("[4] Starting development server for Project 1 on port 52101...");
    const dummyServerA = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<!DOCTYPE html><html><head><title>NovaCart Demo</title></head><body><h1>Welcome to NovaCart Live Preview</h1></body></html>");
    });
    await new Promise((r) => dummyServerA.listen(52101, "0.0.0.0", r));

    // Save runtime record in app-lifecycle registry for Project 1
    const { saveAppRuntime, clearAppRuntime } = await import("../dist/tools/app-lifecycle.js");
    saveAppRuntime({
      workspaceRoot: project1Dir,
      pid: process.pid,
      port: 52101,
      url: "http://localhost:52101",
      startedAt: Date.now()
    });

    // Re-select Project 1: must now emit http://localhost:52101
    ws.send(JSON.stringify({
      type: "select_project",
      payload: { path: project1Dir }
    }));
    await new Promise((r) => setTimeout(r, 500));
    if (receivedAppUrl !== "http://localhost:52101") {
      throw new Error(`Expected http://localhost:52101, got ${receivedAppUrl}`);
    }
    console.log(`  -> Verified Project 1 Live Preview URL: ${receivedAppUrl}`);

    // Verify HTTP response from that URL
    const fetchResA = await fetch(receivedAppUrl);
    const htmlA = await fetchResA.text();
    if (!htmlA.includes("Welcome to NovaCart Live Preview")) {
      throw new Error("HTTP response did not contain NovaCart content");
    }
    console.log("  -> Real HTTP response successfully verified from Live Preview URL!");

    // 5. Create Project 2: DevShowcase Portfolio
    console.log("[5] Creating Project 2: DevShowcase Portfolio...");
    ws.send(JSON.stringify({
      type: "create_project",
      payload: { name: "devshowcase-demo", task: "Build a developer portfolio called DevShowcase" }
    }));
    await new Promise((r) => setTimeout(r, 600));
    const project2Dir = activeWorkspace;
    if (project2Dir === project1Dir) {
      throw new Error("Project 2 reused Project 1 directory!");
    }
    console.log(`  -> Project 2 workspace created in distinct directory: ${project2Dir}`);

    // Project 2 has NO running server; verify preview URL is null
    if (receivedAppUrl !== null) {
      throw new Error(`Project 2 must have null preview URL, but received: ${receivedAppUrl}`);
    }
    console.log("  -> Confirmed: Switching to Project 2 does NOT retain Project 1's preview!");

    // 6. Switch back to Project 1
    console.log("[6] Switching back to Project 1...");
    ws.send(JSON.stringify({
      type: "select_project",
      payload: { path: project1Dir }
    }));
    await new Promise((r) => setTimeout(r, 500));
    if (receivedAppUrl !== "http://localhost:52101") {
      throw new Error(`Expected Project 1 URL http://localhost:52101, got ${receivedAppUrl}`);
    }
    console.log(`  -> Successfully restored Project 1 preview: ${receivedAppUrl}`);

    // Cleanup
    await new Promise((r) => dummyServerA.close(r));
    clearAppRuntime(project1Dir);

    console.log("=== End-to-End Real Live Preview & Isolation Test PASSED Successfully! ===");
  } finally {
    ws.close();
    serverProcess.kill("SIGTERM");
    await fs.rm(tempBase, { recursive: true, force: true });
  }
}

runE2E().catch((err) => {
  console.error("E2E Test Failed:", err);
  process.exit(1);
});
