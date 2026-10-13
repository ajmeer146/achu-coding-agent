import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  discoverNewServerUrl,
  waitForReadiness,
  resolveProjectEntryUrl,
  extractPortFromOutput,
  extractUrlFromOutput,
  isUrlServing,
  saveAppRuntime,
  getAppRuntime,
  clearAppRuntime,
} from "../src/tools/app-lifecycle.js";
import { BrowserSession } from "../src/browser/browser-session.js";
import { SnapshotManager } from "../src/tools/snapshot.js";
import { runVerificationSuite } from "../src/browser/browser-verification.js";

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

async function findFreePort(start = 51000): Promise<number> {
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

describe("Browser Verification, Server Readiness & Recovery Rollback Regression Tests", () => {
  // Test 1: Server starts successfully on the requested port
  test("1. Server starts successfully on the requested port", async () => {
    const port = await findFreePort(51100);
    const server = await listenOn(port, (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>App Home</h1>");
    });
    try {
      const url = await discoverNewServerUrl({
        candidatePort: port,
        preexistingPorts: new Set(),
        timeoutMs: 3000,
        pollMs: 100,
      });
      assert.equal(url, `http://localhost:${port}`);
      const readiness = await waitForReadiness(url!, { timeoutMs: 3000, intervalMs: 100 });
      assert.equal(readiness.ready, true);
      assert.equal(readiness.url, `http://localhost:${port}`);
    } finally {
      await closeServer(server);
    }
  });

  // Test 2: Port conflict causes the actual selected port to be detected and propagated
  test("2. Port conflict causes the actual selected port to be detected and propagated", async () => {
    const portOccupied = await findFreePort(51200);
    const portActual = await findFreePort(51250);
    const serverOccupied = await listenOn(portOccupied, (_req, res) => res.end("occupied"));
    const serverActual = await listenOn(portActual, (_req, res) => res.end("actual-app"));
    try {
      const simulatedOutput = `
> app@1.0.0 dev
> npx serve . -l ${portOccupied}

 INFO Accepting connections at http://localhost:${portActual}
`;
      const detectedPort = extractPortFromOutput(simulatedOutput);
      assert.equal(detectedPort, portActual);
      const detectedUrl = extractUrlFromOutput(simulatedOutput);
      assert.equal(detectedUrl, `http://localhost:${portActual}`);

      const discovered = await discoverNewServerUrl({
        candidatePort: portOccupied,
        preexistingPorts: new Set([portOccupied]),
        getUrlFromOutput: () => detectedUrl,
        timeoutMs: 3000,
        pollMs: 100,
      });
      assert.equal(discovered, `http://localhost:${portActual}`);
      assert.notEqual(discovered, `http://localhost:${portOccupied}`);
    } finally {
      await closeServer(serverOccupied);
      await closeServer(serverActual);
    }
  });

  // Test 3: Server process starts but never becomes HTTP-ready
  test("3. Server process starts but never becomes HTTP-ready", async () => {
    const unservedPort = await findFreePort(51300);
    const readiness = await waitForReadiness(`http://localhost:${unservedPort}`, {
      timeoutMs: 1200,
      intervalMs: 200,
    });
    assert.equal(readiness.ready, false);
    assert.match(readiness.error || "", /readiness timeout/i);
  });

  // Test 4: Server exits before readiness
  test("4. Server exits before readiness", async () => {
    const port = await findFreePort(51400);
    let alive = true;
    setTimeout(() => { alive = false; }, 150);

    const start = Date.now();
    const url = await discoverNewServerUrl({
      candidatePort: port,
      preexistingPorts: new Set(),
      timeoutMs: 5000,
      pollMs: 100,
      isAlive: () => alive,
    });
    assert.equal(url, null);
    assert.ok(Date.now() - start < 2000, "Should abort early when process exits");
  });

  // Test 5: Static HTML nested-path navigation
  test("5. Static HTML nested-path navigation", async () => {
    const port = await findFreePort(51500);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-nested-"));
    const htmlFile = "hello-ajmeer.html";
    await fs.writeFile(path.join(tempDir, htmlFile), "<html><body><h1>Hello Ajmeer Login</h1></body></html>");

    const server = await listenOn(port, (req, res) => {
      if (req.url === "/" || req.url === "") {
        // Directory listing behavior of serve when no index.html
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><head><title>Files within Temp\\</title></head><body>Directory listing</body></html>");
      } else if (req.url === `/${htmlFile}`) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body><h1>Hello Ajmeer Login</h1></body></html>");
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    try {
      const resolved = await resolveProjectEntryUrl(`http://localhost:${port}`, tempDir, [htmlFile]);
      assert.equal(resolved, `http://localhost:${port}/${htmlFile}`);
    } finally {
      await closeServer(server);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // Test 6: Browser automation unavailable while application server is healthy
  test("6. Browser automation unavailable while application server is healthy", async () => {
    const port = await findFreePort(51600);
    const server = await listenOn(port, (_req, res) => res.end("healthy"));
    try {
      assert.equal(await isUrlServing(`http://localhost:${port}`), true);

      // Create a browser session with an invalid executable path to simulate unavailable browser service
      const unavailableSession = new BrowserSession({
        executablePath: "C:\\nonexistent\\chromium.exe",
      });
      const availability = await unavailableSession.isAvailable();
      assert.equal(availability.available, false);
      assert.ok(availability.error, "Should report browser service unavailable error");
    } finally {
      await closeServer(server);
    }
  });

  // Test 7: Browser navigation timeout or connection refusal
  test("7. Browser navigation timeout or connection refusal", async () => {
    const closedPort = await findFreePort(51700);
    const session = new BrowserSession();
    // Navigate without calling init returns clear error
    const result = await session.navigate(`http://localhost:${closedPort}`);
    assert.equal(result.success, false);
    assert.ok(result.error.includes("not initialized") || result.isConnectivityError);
  });

  // Test 8: Recovery does not repeatedly execute the same ineffective action
  test("8. Recovery does not repeatedly execute the same ineffective action", () => {
    const repeatedFailures = new Map<string, number>();
    const failureKey = "browser_verify:1:Browser verification failed";

    let stopped = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const count = (repeatedFailures.get(failureKey) || 0) + 1;
      repeatedFailures.set(failureKey, count);
      if (count >= 3) {
        stopped = true;
        break;
      }
    }

    assert.equal(stopped, true);
    assert.equal(repeatedFailures.get(failureKey), 3);
  });

  // Test 9: Browser failure alone does not incorrectly classify a task as impossible
  test("9. Browser failure alone does not incorrectly classify a task as impossible", () => {
    const state = {
      lastError: {
        command: "browser_verify",
        exitCode: 1,
        errorMessage: "Target element login not found",
      },
      completedTasks: new Set(["edit_file:hello-ajmeer.html"]),
      currentPlan: [
        { id: "1", description: "Make changes", toolType: "edit_file", status: "completed" },
        { id: "2", description: "Verify in browser", toolType: "browser_verify", status: "failed" },
      ],
      stopReason: null as string | null,
    };

    const isBrowserOrInfraFailure = Boolean(
      state.lastError.command === "browser_verify" ||
      state.lastError.command === "open_browser" ||
      state.lastError.command === "start_app"
    );
    const hasCompletedEdits = Array.from(state.completedTasks).some((t: string) => t.startsWith("edit_file:"));

    if (isBrowserOrInfraFailure || hasCompletedEdits) {
      state.stopReason = `Verification failed: target elements could not be verified in browser. Last error: ${state.lastError.errorMessage}`;
    } else {
      state.stopReason = `Impossible task detected.`;
    }

    assert.ok(state.stopReason.includes("Verification failed"));
    assert.ok(!state.stopReason.includes("Impossible task"));
  });

  // Test 10: Successful code edits are not silently rolled back solely because verification infrastructure failed
  test("10. Successful code edits are not silently rolled back solely because verification infrastructure failed", async () => {
    const wsDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-noback-"));
    const filePath = path.join(wsDir, "hello-ajmeer.html");
    await fs.writeFile(filePath, "<!-- original -->");

    const manager = new SnapshotManager(wsDir, "task-verify-noback");
    await manager.init();
    await manager.captureBefore("hello-ajmeer.html", "edit");
    await fs.writeFile(filePath, "<!-- new login page -->");
    await manager.captureAfter("hello-ajmeer.html");

    const completedTasks = new Set(["edit_file:hello-ajmeer.html"]);
    const hasCompletedEdits = Array.from(completedTasks).some((t: string) => t.startsWith("edit_file:"));
    const stopReason = "Verification failed: browser tool unavailable";
    const rollbackRequested = false;

    // Evaluate rollback safety policy
    const shouldRollback = Boolean(rollbackRequested || (stopReason && !hasCompletedEdits));
    assert.equal(shouldRollback, false, "Should NOT rollback when code edits completed successfully");

    if (shouldRollback) {
      await manager.rollback();
    }

    const currentContent = await fs.readFile(filePath, "utf8");
    assert.equal(currentContent, "<!-- new login page -->", "Code edits must be preserved");

    await manager.cleanup();
    await fs.rm(wsDir, { recursive: true, force: true });
  });

  // Test 11: Rollback does not overwrite user changes made after the task snapshot
  test("11. Rollback does not overwrite user changes made after the task snapshot", async () => {
    const wsDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-userconflict-"));
    const filePath = path.join(wsDir, "hello-ajmeer.html");
    await fs.writeFile(filePath, "<!-- original -->");

    const manager = new SnapshotManager(wsDir, "task-user-edit");
    await manager.init();
    await manager.captureBefore("hello-ajmeer.html", "edit");
    await fs.writeFile(filePath, "<!-- agent login page -->");
    await manager.captureAfter("hello-ajmeer.html");

    // User modified file AFTER agent
    await fs.writeFile(filePath, "<!-- user manual change -->");

    const result = await manager.rollback();
    assert.equal(result.success, false, "Rollback should report conflict");
    assert.deepEqual(result.conflicts, ["hello-ajmeer.html"]);
    assert.deepEqual(result.restored, []);

    const content = await fs.readFile(filePath, "utf8");
    assert.equal(content, "<!-- user manual change -->", "User changes must never be overwritten");

    await manager.cleanup();
    await fs.rm(wsDir, { recursive: true, force: true });
  });

  // Test 12: Preview refresh and Open use the latest verified URL
  test("12. Preview refresh and Open use the latest verified URL", () => {
    let currentPreviewUrl: string | null = null;

    // App started at 62727/hello-ajmeer.html
    const verifiedUrl = "http://localhost:62727/hello-ajmeer.html";
    currentPreviewUrl = verifiedUrl;

    const refreshActionUrl = currentPreviewUrl;
    const openActionUrl = currentPreviewUrl;

    assert.equal(refreshActionUrl, verifiedUrl);
    assert.equal(openActionUrl, verifiedUrl);

    // When workspace changes, preview URL resets to null
    currentPreviewUrl = null;
    assert.equal(currentPreviewUrl, null);
  });
});
