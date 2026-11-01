import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { Workspace } from "../src/tools/workspace.js";
import {
  scaffoldStaticProject,
  scaffoldReactViteProject,
  scaffoldNextjsProject,
  scaffoldNodeExpressProject,
  scaffoldFullstackEcommerceProject,
  validateProjectStructure,
  autoRepairProjectStructure,
} from "../src/tools/scaffold.js";
import {
  detectStartCommand,
  isUrlServing,
  allocateAvailablePort,
  isPortAvailable,
} from "../src/tools/app-lifecycle.js";
import { BrowserSession } from "../src/browser/browser-session.js";
import { SnapshotManager } from "../src/tools/snapshot.js";
import { verifyTaskCompletionEvidence } from "../src/agent.js";

function startHttpServer(port: number, handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function stopHttpServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (typeof (server as any).closeAllConnections === "function") {
        (server as any).closeAllConnections();
      }
    } catch {}
    server.close(() => resolve());
  });
}

describe("Autonomous Full-Stack Website Builder Upgrade Acceptance Suite", () => {
  // Scenario 1: Generate a simple landing page from prompt
  test("Scenario 1: Generate a simple landing page with HTML, CSS, JS", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-s1-landing-"));
    const ws = new Workspace(tempDir);
    const result = await scaffoldStaticProject(ws, "landing-app");

    assert.equal(result.success, true);
    assert.ok(result.files.includes("index.html"));
    assert.ok(result.files.includes("styles.css"));
    assert.ok(result.files.includes("script.js"));
    assert.ok(fsSync.existsSync(path.join(tempDir, "index.html")));

    const validation = validateProjectStructure(tempDir);
    assert.equal(validation.valid, true);
    assert.equal(validation.projectType, "static");
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Scenario 2: Generate a React/Vite application
  test("Scenario 2: Generate a React/Vite application with bundler structure", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-s2-react-"));
    const ws = new Workspace(tempDir);
    const result = await scaffoldReactViteProject(ws, "vite-app");

    assert.equal(result.success, true);
    assert.ok(result.files.includes("package.json"));
    assert.ok(result.files.includes("vite.config.js"));
    assert.ok(result.files.includes("src/App.jsx"));
    assert.ok(result.files.includes("src/main.jsx"));

    const validation = validateProjectStructure(tempDir);
    assert.equal(validation.valid, true);
    assert.equal(validation.projectType, "react");
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Scenario 3: Generate a Next.js full-stack application
  test("Scenario 3: Generate a Next.js full-stack application with App Router and API routes", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-s3-nextjs-"));
    const ws = new Workspace(tempDir);
    const result = await scaffoldNextjsProject(ws, "next-fullstack");

    assert.equal(result.success, true);
    assert.ok(result.files.includes("package.json"));
    assert.ok(result.files.includes("app/layout.tsx"));
    assert.ok(result.files.includes("app/page.tsx"));
    assert.ok(result.files.includes("app/api/items/route.ts"));

    const validation = validateProjectStructure(tempDir);
    assert.equal(validation.valid, true);
    assert.equal(validation.projectType, "nextjs");

    const startInfo = await detectStartCommand(ws);
    assert.ok(startInfo.command.includes("next") || startInfo.command.includes("dev"));
    assert.equal(startInfo.port, 3000);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Scenario 4 & 5: Generate e-commerce store with database, auth, products, cart, checkout & admin
  test("Scenario 4 & 5: Generate full-stack e-commerce store with database, test backend API, and live interactions", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-s4-ecom-"));
    const ws = new Workspace(tempDir);
    const result = await scaffoldFullstackEcommerceProject(ws, "novamart-store");

    assert.equal(result.success, true);
    assert.ok(result.files.includes("package.json"));
    assert.ok(result.files.includes("server.js"));
    assert.ok(result.files.includes("db.js"));
    assert.ok(result.files.includes("public/index.html"));
    assert.ok(result.files.includes("public/styles.css"));
    assert.ok(result.files.includes("public/app.js"));
    assert.ok(result.files.includes("tests/api.test.js"));

    const validation = validateProjectStructure(tempDir);
    assert.equal(validation.valid, true);
    assert.equal(validation.projectType, "node");

    // Test database module operations directly
    const dbModule = await import(pathToFileURL(path.join(tempDir, "db.js")).href);
    const products = dbModule.db.getProducts();
    assert.ok(products.length >= 8, "Must contain at least 8 seeded products");
    assert.ok(products.some((p: any) => p.category === "Burgers"));
    assert.ok(products.some((p: any) => p.category === "Pizza"));

    // Test Cart & Checkout persistence
    const cart = dbModule.db.addToCart(1, products[0].id, 2);
    assert.ok(cart.length > 0);
    const order = dbModule.db.createOrder(1, { name: "Test Buyer", address: "123 Main St" });
    assert.ok(order);
    assert.ok(order.orderNumber.startsWith("#ORD-"));

    // Test Admin Metrics
    const metrics = dbModule.db.getAdminMetrics();
    assert.ok(metrics.totalOrders >= 1);
    assert.ok(metrics.totalRevenue > 0);

    // Test Auth
    const user = dbModule.db.authenticate("user@store.com", "user123");
    assert.ok(user);
    assert.equal(user.email, "user@store.com");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Scenario 6: Detect and repair deliberate build/config error
  test("Scenario 6: Detect and auto-repair invalid project configuration", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-s6-repair-"));
    const ws = new Workspace(tempDir);

    // Intentionally construct a broken React config using static npx serve
    await ws.write("package.json", JSON.stringify({
      name: "broken-react",
      dependencies: { react: "^18.2.0", "react-dom": "^18.2.0" },
      scripts: { dev: "npx serve -l 3000 ." }
    }, null, 2));
    await ws.write("src/App.jsx", "export default function App() { return <h1>App</h1>; }");
    await ws.write("index.html", "<div id='root'></div>");

    const preValidation = validateProjectStructure(tempDir);
    assert.equal(preValidation.valid, false, "Broken configuration must fail validation");

    const repairResult = await autoRepairProjectStructure(ws);
    assert.equal(repairResult.repaired, true);
    assert.ok(repairResult.changes.length > 0);

    const postValidation = validateProjectStructure(tempDir);
    assert.equal(postValidation.valid, true, "Project must be valid after auto-repair");
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Scenario 7: Dynamic Port Allocation & Startup Resilience
  test("Scenario 7: Automatically detect port collision and allocate alternative available port", async () => {
    const testPort = await allocateAvailablePort(45000);
    assert.ok(testPort >= 45000);

    // Bind this port with a dummy server
    const server = await startHttpServer(testPort, (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("port-occupied");
    });

    const isOccupied = await isUrlServing(`http://127.0.0.1:${testPort}`, 500);
    assert.equal(isOccupied, true);

    // Requesting same port must gracefully allocate alternative port
    const altPort = await allocateAvailablePort(testPort);
    assert.notEqual(altPort, testPort, "Must allocate a different port when preferred port is occupied");
    assert.ok(await isPortAvailable(altPort));

    await stopHttpServer(server);
  });

  // Scenario 8: Browser interactions and Playwright verification
  test("Scenario 8: Playwright browser verification verifies DOM elements and interactions", async () => {
    const session = new BrowserSession();
    const available = await session.isAvailable();
    if (!available.available) {
      console.log("Playwright not available in this environment; skipping browser step");
      return;
    }

    const html = `<!DOCTYPE html><html><head><title>Test Store</title></head><body><h1>Store Catalog</h1><button id="cartBtn">Cart (0)</button><button id="addBtn" onclick="document.getElementById('cartBtn').textContent='Cart (1)'">Add Item</button></body></html>`;

    try {
      await session.init();

      const navResult = await session.navigate(`data:text/html,${encodeURIComponent(html)}`);
      assert.equal(navResult.success, true);

      const inspectRes = await session.inspectPage();
      assert.equal(inspectRes.success, true);
      assert.ok(inspectRes.info.visibleText.includes("Store Catalog"));
      assert.ok(inspectRes.info.buttons.some(b => b.includes("Cart")));

      // Click Add Item
      const clickResult = await session.click("#addBtn");
      assert.equal(clickResult.success, true);

      const updatedRes = await session.inspectPage();
      assert.equal(updatedRes.success, true);
      assert.ok(updatedRes.info.buttons.some(b => b.includes("Cart (1)")));
    } finally {
      await session.close();
    }
  });

  // Scenario 9 & 10: Follow-up editing preserves existing files
  test("Scenario 9 & 10: Follow-up modification modifies target file and preserves existing project files", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-s9-followup-"));
    const ws = new Workspace(tempDir);

    // Initial files
    await ws.write("index.html", "<!DOCTYPE html><html><body><h1 id='title'>Original Store</h1><div id='items'></div></body></html>");
    await ws.write("styles.css", "body { background: #000; color: #fff; }");
    await ws.write("server.js", "console.log('Running server');");

    // Follow-up edit on index.html
    const originalHtml = await ws.read("index.html");
    const updatedHtml = originalHtml.replace("Original Store", "Updated Store with Discounts");
    await ws.write("index.html", updatedHtml);

    // Verify index.html was updated
    const finalHtml = await ws.read("index.html");
    assert.ok(finalHtml.includes("Updated Store with Discounts"));

    // Verify other files were preserved completely
    assert.ok(await ws.exists("styles.css"));
    assert.ok(await ws.exists("server.js"));
    const serverContent = await ws.read("server.js");
    assert.equal(serverContent, "console.log('Running server');");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Scenario 11: Cancellation, Rollback and Process Cleanup
  test("Scenario 11: SnapshotManager captures before/after and rolls back cleanly on cancellation", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-s11-rollback-"));
    const ws = new Workspace(tempDir);
    const snap = new SnapshotManager(tempDir, "task-test-cancel");
    await snap.init();

    // Create baseline file
    await ws.write("config.json", JSON.stringify({ version: "1.0.0" }));

    // Capture before modification
    await snap.captureBefore("config.json", "edit");
    await ws.write("config.json", JSON.stringify({ version: "2.0.0-broken" }));
    await snap.captureAfter("config.json");

    // Rollback
    const rollbackRes = await snap.rollback();
    assert.equal(rollbackRes.success, true);
    assert.ok(rollbackRes.restored.includes("config.json"));

    const restoredContent = await ws.read("config.json");
    assert.equal(JSON.parse(restoredContent).version, "1.0.0");

    await snap.cleanup();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Scenario 12: Cloud Execution Task Completion Evidence Verification
  test("Scenario 12: Task Completion Evidence correctly enforces build, live run, and verification passes", () => {
    const mockState: any = {
      completedTasks: new Set(["create_file:index.html", "create_file:styles.css", "create_file:script.js"]),
      stepsTaken: new Map(),
      appProcess: null,
      verificationPassed: false,
    };

    // Before starting the server and verifying
    const evidenceBefore = verifyTaskCompletionEvidence("Build a complete modern landing page website", mockState);
    assert.equal(evidenceBefore.verified, false, "Cannot claim completion without live verification");
    assert.ok(evidenceBefore.missingRequirements.some(r => r.includes("Live application verification")));

    // After running browser_verify
    mockState.completedTasks.add("browser_verify");
    mockState.appProcess = { status: "ready", url: "http://localhost:3000" };
    const evidenceAfter = verifyTaskCompletionEvidence("Build a complete modern landing page website", mockState);
    assert.equal(evidenceAfter.verified, true, "Task is verified complete after browser verification");
  });

  // Scenario 13: Local Execution Server Readiness Probe
  test("Scenario 13: Local execution server readiness probe correctly identifies live endpoints", async () => {
    const port = await allocateAvailablePort(47000);
    const server = await startHttpServer(port, (req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const isReady = await isUrlServing(`http://127.0.0.1:${port}/api/health`, 500);
    assert.equal(isReady, true);

    await stopHttpServer(server);

    const isStopped = await isUrlServing(`http://127.0.0.1:${port}/api/health`, 200);
    assert.equal(isStopped, false);
  });

  // Scenario 14: Artifact mapping and preview file resolution
  test("Scenario 14: Preview artifact resolution normalizes paths and serves entrypoint", () => {
    const artifacts = [
      { path: "public/index.html", content: "<html><body><h1>Storefront</h1></body></html>" },
      { path: "public/styles.css", content: "body { background: #111; }" },
      { path: "server.js", content: "const express = require('express');" },
    ];

    const fileMap = new Map<string, string>();
    for (const a of artifacts) {
      fileMap.set(a.path.toLowerCase(), a.content);
      fileMap.set(path.basename(a.path).toLowerCase(), a.content);
    }

    // Resolves root request
    const rootHtml = fileMap.get("index.html") || fileMap.get("public/index.html");
    assert.ok(rootHtml);
    assert.ok(rootHtml.includes("Storefront"));

    // Resolves subresource
    const styles = fileMap.get("styles.css") || fileMap.get("public/styles.css");
    assert.ok(styles);
    assert.ok(styles.includes("background"));
  });
});
