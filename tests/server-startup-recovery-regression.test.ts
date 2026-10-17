import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import { Workspace } from "../src/tools/workspace.js";
import { createFile } from "../src/tools/create-file.js";
import { editFile } from "../src/tools/edit-file.js";
import {
  replacePortInCommand,
  syncPortToPackageJson,
  allocateAvailablePort,
  isPortAvailable,
  ensureAppServer,
  getAppRuntime,
  stopAppRuntime,
  isProcessAlive,
} from "../src/tools/app-lifecycle.js";
import { validateCommand, isProtectedFile } from "../src/utils/command-guard.js";

function startTestOccupier(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Occupied port server");
    });
    s.listen(port, "0.0.0.0", () => resolve(s));
    s.on("error", reject);
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Remove a test temp dir. After owned child process trees are stopped, only
 * transient Windows handle-release races (AV, delayed close) can fail; retry
 * those a bounded number of times and surface persistent failures.
 */
async function rmDirWithRetry(dir: string, attempts = 8, delayMs = 250): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err: any) {
      const transient = err && (err.code === "EPERM" || err.code === "EBUSY" || err.code === "ENOTEMPTY");
      if (!transient || i === attempts) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

describe("Development Server Startup, Recovery Loop, and Protected Files Regression Suite", () => {
  test("1. Protected files: package.json is allowed with valid JSON while .env is strictly blocked", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "achu-test-pkg-"));
    const ws = new Workspace(tmp);
    try {
      // package.json creation is permitted with valid JSON
      const validPkg = JSON.stringify({ name: "my-test-app", version: "1.0.0", scripts: { start: "serve" } }, null, 2);
      const resCreate = await createFile(ws, "package.json", validPkg);
      assert.ok(resCreate.includes("Successfully created package.json"));

      // package.json editing is permitted with valid JSON
      const editResult = await editFile(ws, "package.json", [{ oldText: "my-test-app", newText: "updated-test-app" }]);
      assert.ok(editResult.includes("Successfully edited package.json"));
      const editedContent = await ws.read("package.json");
      assert.ok(editedContent.includes("updated-test-app"));

      // package.json edit with invalid JSON is rejected
      await assert.rejects(
        async () => {
          await editFile(ws, "package.json", [{ oldText: "*", newText: "{ invalid json: true" }]);
        },
        /Invalid JSON in package.json/
      );

      // .env creation is strictly blocked
      await assert.rejects(
        async () => {
          await createFile(ws, ".env", "SECRET=123");
        },
        /Forbidden: .env files cannot be created/
      );

      // .env edit is strictly blocked
      await assert.rejects(
        async () => {
          await editFile(ws, ".env", [{ oldText: "*", newText: "SECRET=456" }]);
        },
        /Forbidden: .env files cannot be modified/
      );

      // isProtectedFile reflects rules
      assert.equal(isProtectedFile(".env"), true);
      assert.equal(isProtectedFile(".env.local"), true);
      assert.equal(isProtectedFile(".env.production"), true);
      assert.equal(isProtectedFile(".npmrc"), true);
      assert.equal(isProtectedFile("tsconfig.json"), true);
      assert.equal(isProtectedFile("package.json"), false);
      assert.equal(isProtectedFile("package-lock.json"), false);

      // validateCommand blocks .env modifications and npm install serve
      const envBlock = validateCommand("echo SECRET=123 > .env");
      assert.equal(envBlock.allowed, false);

      const serveInstallBlock = validateCommand("npm install serve");
      assert.equal(serveInstallBlock.allowed, false);
      assert.ok(serveInstallBlock.reason?.includes("Installing 'serve' packages is not permitted"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("2. Port replacement: updates package.json scripts and avoids npx serve conflicting port flags", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "achu-test-port-"));
    try {
      const initialPkg = {
        name: "test-site",
        scripts: {
          dev: "npx serve . -l 3000",
          start: "npx serve . -l 3000",
        },
      };
      fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify(initialPkg, null, 2));

      // Synchronize port to package.json
      const synced = syncPortToPackageJson(tmp, 3002);
      assert.equal(synced, true);

      const updatedPkg = JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8"));
      assert.equal(updatedPkg.scripts.dev, "npx serve . -l 3002");
      assert.equal(updatedPkg.scripts.start, "npx serve . -l 3002");

      // replacePortInCommand on npm run dev with workspaceDir must NOT append conflicting --port 3002
      const cmd = replacePortInCommand("npm run dev", 3002, tmp);
      assert.equal(cmd.includes("--port 3002"), false);
      assert.equal(cmd, "npm run dev");

      // Direct npx serve command port replacement
      const directServeCmd = replacePortInCommand("npx serve . -l 3000", 3005);
      assert.equal(directServeCmd, "npx serve . -l 3005");

      // Vite command port replacement
      const viteCmd = replacePortInCommand("vite", 5174);
      assert.equal(viteCmd, "vite --port 5174");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("3. Port allocation when port is occupied allocates a clean alternative port", async () => {
    // Pick an ephemeral port for testing conflict
    const testPort = 39871;
    let occupier: http.Server | null = null;
    try {
      occupier = await startTestOccupier(testPort);
      assert.equal(await isPortAvailable(testPort), false);

      const allocated = await allocateAvailablePort(testPort);
      assert.notEqual(allocated, testPort);
      assert.ok(allocated > testPort);
      assert.equal(await isPortAvailable(allocated), true);
    } finally {
      if (occupier) await closeServer(occupier);
    }
  });

  test("4. ensureAppServer starts static HTML site on free allocated port and survives completion", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "achu-test-static-app-"));
    const htmlContent = "<!DOCTYPE html><html><head><title>My Test Site</title></head><body><h1>Hello World</h1></body></html>";
    fs.writeFileSync(path.join(tmp, "index.html"), htmlContent);

    try {
      const serverUrl = await ensureAppServer(tmp);
      assert.ok(serverUrl, "Server URL must be returned");
      assert.ok(serverUrl.startsWith("http://localhost:"));

      // Verify HTTP 200 response
      const res = await fetch(serverUrl);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes("Hello World"));

      // Verify runtime record was persisted and process is alive
      const runtime = getAppRuntime(tmp);
      assert.ok(runtime, "Runtime record must be saved");
      assert.equal(runtime.url, serverUrl);
      assert.ok(isProcessAlive(runtime.pid), "Process must be alive");

      // Stop the exact process tree this test started (releases dir handles)
      await stopAppRuntime(tmp);
      assert.equal(getAppRuntime(tmp), null, "Runtime record must be cleared after stop");
    } finally {
      await rmDirWithRetry(tmp);
    }
  });

  test("5. ensureAppServer does not kill unrelated process occupying candidate port", async () => {
    const conflictPort = 39872;
    let unrelatedServer: http.Server | null = null;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "achu-test-conflict-"));
    fs.writeFileSync(path.join(tmp, "index.html"), "<h1>Occupied port test</h1>");
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "conflict-app", scripts: { start: `npx --yes serve -l ${conflictPort} .` } })
    );

    try {
      // Start unrelated server on conflictPort
      unrelatedServer = await startTestOccupier(conflictPort);
      assert.equal(await isPortAvailable(conflictPort), false);

      // ensureAppServer must allocate an alternative port and not kill unrelatedServer
      const serverUrl = await ensureAppServer(tmp);
      assert.ok(serverUrl);
      const portMatch = serverUrl.match(/:(\d+)/);
      const actualPort = portMatch ? parseInt(portMatch[1], 10) : 0;
      assert.notEqual(actualPort, conflictPort, "Must not bind to occupied port");

      // Verify unrelatedServer is STILL serving on conflictPort
      const unrelatedRes = await fetch(`http://localhost:${conflictPort}`);
      assert.equal(unrelatedRes.status, 200);
      assert.equal(await unrelatedRes.text(), "Occupied port server");

      // Clean up the process tree this test started; the unrelated server must remain
      await stopAppRuntime(tmp);
      assert.equal(getAppRuntime(tmp), null, "Runtime record must be cleared after stop");
    } finally {
      if (unrelatedServer) await closeServer(unrelatedServer);
      await rmDirWithRetry(tmp);
    }
  });

  test("6. Unknown npm script bodies never receive an appended --port flag (E2E-5 regression)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "achu-test-unknown-script-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({
          name: "broken-server",
          scripts: {
            dev: 'node -e "process.exit(1)"',
            start: 'node -e "process.exit(1)"',
            custom: "node server.js",
          },
        })
      );

      // Unknown script: no flag may be appended (previously produced "node: bad option: --port")
      assert.equal(replacePortInCommand("npm run dev", 3004, tmp), "npm run dev");
      assert.equal(replacePortInCommand("npm start", 3004, tmp), "npm start");
      assert.equal(replacePortInCommand("npm run custom", 3004, tmp), "npm run custom");
      assert.equal(replacePortInCommand("yarn dev", 3004, tmp), "yarn dev");

      // Missing script name in package.json: also no blind append
      assert.equal(replacePortInCommand("npm run nonexistent", 3004, tmp), "npm run nonexistent");

      // Known port-taking bodies in synced scripts (dev/start) are updated in package.json itself
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({
          name: "vite-app",
          scripts: { dev: "vite", start: "vite dev", custom: "vite" },
        })
      );
      assert.equal(replacePortInCommand("npm run dev", 3004, tmp), "npm run dev");
      assert.equal(replacePortInCommand("npm start", 3004, tmp), "npm start");
      const syncedPkg = JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8"));
      assert.equal(syncedPkg.scripts.dev, "vite --port 3004");
      assert.equal(syncedPkg.scripts.start, "vite dev --port 3004");

      // Custom scripts are not touched by sync, so a known server body gets the flag appended
      assert.equal(replacePortInCommand("npm run custom", 3004, tmp), "npm run custom -- --port 3004");

      // Known body that already carries a port is left alone
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({
          name: "vite-app-fixed",
          scripts: { dev: "vite --port 5173" },
        })
      );
      assert.equal(replacePortInCommand("npm run dev", 3004, tmp), "npm run dev");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
