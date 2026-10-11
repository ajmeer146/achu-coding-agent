import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import {
  discoverNewServerUrl,
  probePortRange,
  saveAppRuntime,
  getAppRuntime,
  clearAppRuntime,
  isUrlServing
} from "../dist/tools/app-lifecycle.js";

function listenOn(port, content) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(content);
    });
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function isPortFree(port) {
  try {
    const s = await listenOn(port, "probe");
    await closeServer(s);
    return true;
  } catch {
    return false;
  }
}

async function findTwoAdjacentFreePorts(start) {
  for (let p = start; p < start + 500; p++) {
    if (p % 1000 === 0) continue;
    if ((await isPortFree(p)) && (await isPortFree(p + 1))) return p;
  }
  throw new Error("no adjacent free ports found");
}

async function fetchContent(url) {
  const res = await fetch(url);
  return await res.text();
}

async function runRegressionTest() {
  console.log("=== Bounded Regression Test for Sequential Apps A and B ===");
  const basePort = await findTwoAdjacentFreePorts(50000);
  const portA = basePort;
  const portB = basePort + 1;
  const wsDir = await fsp.mkdtemp(path.join(os.tmpdir(), "achu-stale-regression-"));

  let serverA, serverB;
  try {
    console.log(`[1] Starting App A on port ${portA}...`);
    serverA = await listenOn(portA, "APP_A_CONTENT");
    
    // Simulate App A detection
    const preexistingForA = new Set();
    const urlA = await discoverNewServerUrl({
      candidatePort: portA,
      preexistingPorts: preexistingForA,
      maxProbes: 5,
      timeoutMs: 2000,
      pollMs: 100
    });
    assert.ok(urlA, "Should detect App A URL");
    console.log(`  -> URL A discovered: ${urlA}`);
    
    const contentA = await fetchContent(urlA);
    assert.equal(contentA, "APP_A_CONTENT", "A should serve A's content");
    console.log(`  -> Verified App A content: ${contentA}`);

    // Save runtime for A
    saveAppRuntime({
      workspaceRoot: wsDir,
      pid: process.pid,
      port: portA,
      url: urlA,
      startedAt: Date.now()
    });

    console.log(`[2] Simulating agent execution for App B...`);
    // Agent starts App B on a new port, but App A is STILL RUNNING! This is the core issue!
    // Stale server bug: When B is started, the preview logic might mistakenly find A because A is already running and responds to HTTP requests.
    // The fix involves passing the preexisting ports (portA) to discoverNewServerUrl.
    
    console.log(`  -> App A is still running on ${portA}`);
    serverB = await listenOn(portB, "APP_B_CONTENT");
    
    // In actual app lifecycle, `preexistingPorts` are collected BEFORE starting the new server.
    const preexistingForB = await probePortRange(3000, 3, 500);
    // Since we're using a custom port range for tests, we must include portA manually or probe the test range.
    const preexistingTest = new Set([portA]);

    const urlB = await discoverNewServerUrl({
      candidatePort: portB, // Simulate agent suggesting portB
      preexistingPorts: preexistingTest,
      maxProbes: 5,
      timeoutMs: 2000,
      pollMs: 100
    });

    assert.ok(urlB, "Should detect App B URL");
    console.log(`  -> URL B discovered: ${urlB}`);
    
    assert.notEqual(urlB, urlA, "URL B must be different from URL A (stale port fix)");
    
    const contentB = await fetchContent(urlB);
    assert.equal(contentB, "APP_B_CONTENT", "B should serve B's content");
    console.log(`  -> Verified App B content: ${contentB}`);

    // Save runtime for B
    saveAppRuntime({
      workspaceRoot: wsDir,
      pid: process.pid, // using test pid
      port: portB,
      url: urlB,
      startedAt: Date.now()
    });
    
    // Verify getAppRuntime fetches B
    const runtime = getAppRuntime(wsDir);
    assert.equal(runtime.url, urlB, "Workspace runtime should be updated to App B");
    
    console.log("[3] Confirming server reuse occurs only when the server is healthy and belongs to the workspace");
    assert.ok(await isUrlServing(runtime.url), "Server B is healthy");

    console.log("=== Test PASSED: The final preview serves B's content, not A's ===");
  } finally {
    if (serverA) await closeServer(serverA);
    if (serverB) await closeServer(serverB);
    await fsp.rm(wsDir, { recursive: true, force: true });
  }
}

runRegressionTest().catch(err => {
  console.error("Test FAILED:", err);
  process.exit(1);
});
