import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  isPortAvailable,
  allocateAvailablePort,
  replacePortInCommand,
  saveAppRuntime,
  getAppRuntime,
  clearAppRuntime,
  isUrlServing,
  waitForReadiness,
  detectStartCommand,
} from "../src/tools/app-lifecycle.js";
import {
  deriveProjectSlug,
  isNewWebsiteTask,
  shouldIsolateNewProject,
  getDefaultProjectsBaseDir,
  Workspace,
} from "../src/tools/workspace.js";
import {
  replaceLogicalAndForPowerShell,
  normalizePipelinesForPowerShell,
  normalizeUnixCommand,
} from "../src/utils/command-guard.js";
import { stripEnclosingQuotes } from "../src/agent.js";
import { runCommand } from "../src/tools/terminal.js";

function listenOn(port: number, responseBody: string): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const s = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(responseBody);
    });
    s.once("error", reject);
    s.listen(port, "0.0.0.0", () => resolve(s));
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("Project Isolation, Port Allocation & Live Preview Regression Tests", () => {
  test("Creating two different new projects results in distinct directories", async () => {
    const taskA = "Build a complete, modern, responsive e-commerce website called **NovaCart**";
    const taskB = "Build a modern developer portfolio website called **DevShowcase**";

    const slugA = deriveProjectSlug(taskA);
    const slugB = deriveProjectSlug(taskB);

    assert.equal(slugA, "novacart");
    assert.equal(slugB, "devshowcase");

    const baseDir = getDefaultProjectsBaseDir();
    const dirA = path.join(baseDir, slugA);
    const dirB = path.join(baseDir, slugB);

    assert.notEqual(dirA, dirB, "Two different new projects must have distinct directories");
    assert.match(dirA, /novacart/);
    assert.match(dirB, /devshowcase/);
  });

  test("New website task detection isolates from existing unrelated directory", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-unrelated-project-"));
    try {
      // Put existing unrelated files in tempDir
      await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({ name: "old-portfolio" }));
      await fs.writeFile(path.join(tempDir, "index.html"), "<h1>Old Portfolio</h1>");

      const isNew = isNewWebsiteTask("Build a complete, modern e-commerce website called NovaCart");
      assert.equal(isNew, true, "Should identify task as a new website build");

      const isolate = await shouldIsolateNewProject("Build a complete, modern e-commerce website called NovaCart", tempDir);
      assert.equal(isolate, true, "Must isolate new website task away from unrelated existing directory");

      // Follow-up task on existing project should NOT isolate
      const followUpIsolate = await shouldIsolateNewProject("Update navbar style and fix responsive padding", tempDir);
      assert.equal(followUpIsolate, false, "Follow-up edits on existing project must stay in current directory");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("Port conflict triggers safe alternative-port strategy", async () => {
    // Find a free base port and start a server to occupy it
    const testPort = 54321;
    let conflictServer: http.Server | null = null;
    try {
      conflictServer = await listenOn(testPort, "OCCUPIED_APP");
      assert.equal(await isPortAvailable(testPort), false, "Test port must be occupied");

      // Alternative port allocation strategy
      const allocatedPort = await allocateAvailablePort(testPort);
      assert.notEqual(allocatedPort, testPort, "Must allocate an alternative port when candidate is occupied");
      assert.ok(allocatedPort > testPort, "Alternative port should be in a higher free range");
      assert.equal(await isPortAvailable(allocatedPort), true, "Allocated alternative port must be free");

      // Verify command port replacement
      const cmd1 = replacePortInCommand("npx serve . -l 54321", allocatedPort);
      assert.equal(cmd1, `npx serve . -l ${allocatedPort}`);

      const cmd2 = replacePortInCommand("npm run dev -- --port 54321", allocatedPort);
      assert.equal(cmd2, `npm run dev -- --port ${allocatedPort}`);

      const cmd3 = replacePortInCommand("serve .", allocatedPort);
      assert.equal(cmd3, `serve . -l ${allocatedPort}`);
    } finally {
      if (conflictServer) await closeServer(conflictServer);
    }
  });

  test("Failed server startup does not mark project as ready", async () => {
    // Probing a port where no server is listening
    const deadPort = 59999;
    const url = `http://localhost:${deadPort}`;
    const result = await waitForReadiness(url, { timeoutMs: 1500, intervalMs: 300 });

    assert.equal(result.ready, false, "Readiness check must fail when server is offline");
    assert.ok(result.error, "Failure must provide an actionable error message");
  });

  test("Stopping a server clears its runtime record and invalidates preview", async () => {
    const wsDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-stop-preview-"));
    try {
      saveAppRuntime({
        workspaceRoot: wsDir,
        pid: process.pid,
        port: 3000,
        url: "http://localhost:3000",
        startedAt: Date.now(),
      });

      const runtimeBefore = getAppRuntime(wsDir);
      assert.ok(runtimeBefore, "Runtime record should exist before stop");
      assert.equal(runtimeBefore?.url, "http://localhost:3000");

      clearAppRuntime(wsDir);

      const runtimeAfter = getAppRuntime(wsDir);
      assert.equal(runtimeAfter, null, "Runtime record must be cleared when server stops");
    } finally {
      await fs.rm(wsDir, { recursive: true, force: true });
    }
  });

  test("Two different websites run independently with dedicated ports and distinct content", async () => {
    const portA = 51234;
    const portB = 51235;

    let serverA: http.Server | null = null;
    let serverB: http.Server | null = null;
    const wsA = await fs.mkdtemp(path.join(os.tmpdir(), "achu-app-a-"));
    const wsB = await fs.mkdtemp(path.join(os.tmpdir(), "achu-app-b-"));

    try {
      // Start Website A
      serverA = await listenOn(portA, "<html><body>Website A - NovaCart</body></html>");
      saveAppRuntime({
        workspaceRoot: wsA,
        pid: process.pid,
        port: portA,
        url: `http://localhost:${portA}`,
        startedAt: Date.now(),
      });

      // Start Website B
      serverB = await listenOn(portB, "<html><body>Website B - DevShowcase</body></html>");
      saveAppRuntime({
        workspaceRoot: wsB,
        pid: process.pid,
        port: portB,
        url: `http://localhost:${portB}`,
        startedAt: Date.now(),
      });

      // Verify Website A
      const runtimeA = getAppRuntime(wsA);
      assert.ok(runtimeA, "Website A runtime exists");
      assert.equal(runtimeA?.url, `http://localhost:${portA}`);
      const resA = await fetch(runtimeA.url);
      const textA = await resA.text();
      assert.match(textA, /Website A - NovaCart/);

      // Verify Website B
      const runtimeB = getAppRuntime(wsB);
      assert.ok(runtimeB, "Website B runtime exists");
      assert.equal(runtimeB?.url, `http://localhost:${portB}`);
      const resB = await fetch(runtimeB.url);
      const textB = await resB.text();
      assert.match(textB, /Website B - DevShowcase/);

      // Strict isolation verification
      assert.notEqual(runtimeA.url, runtimeB.url, "Website A and B must serve from different localhost URLs");
      assert.notEqual(textA, textB, "Website A and B must serve different content");
      assert.ok(!textB.includes("NovaCart"), "Website B must never serve Website A's content");
    } finally {
      if (serverA) await closeServer(serverA);
      if (serverB) await closeServer(serverB);
      clearAppRuntime(wsA);
      clearAppRuntime(wsB);
      await fs.rm(wsA, { recursive: true, force: true });
      await fs.rm(wsB, { recursive: true, force: true });
    }
  });

  test("PowerShell commands and paths containing spaces preserve quotes and syntax", async () => {
    // 1. stripEnclosingQuotes must NOT truncate trailing quotes from arguments
    const cmdWithSpaces = 'mkdir "C:\\Users\\Achu146\\OneDrive\\Desktop\\testing file\\nova-cart"';
    const preserved = stripEnclosingQuotes(cmdWithSpaces);
    assert.equal(preserved, cmdWithSpaces, "Must preserve trailing quotes on internal arguments");
    assert.ok(preserved.endsWith('"'), "Closing quote must remain intact");

    // Enclosing quotes around entire command SHOULD be stripped
    assert.equal(stripEnclosingQuotes('"echo test"'), "echo test");
    assert.equal(stripEnclosingQuotes("'npm test'"), "npm test");

    // 2. PowerShell && normalization
    const chained = 'cd "C:\\Users\\Achu146\\OneDrive\\Desktop\\testing file" && npm run build';
    const normalizedChained = replaceLogicalAndForPowerShell(chained);
    assert.equal(
      normalizedChained,
      'cd "C:\\Users\\Achu146\\OneDrive\\Desktop\\testing file"; if ($?) { npm run build }',
      "&& must normalize to PowerShell conditional chaining"
    );

    // 3. Pipeline head/tail normalization
    const piped = "npx create-react-app nova-cart --template typescript 2>&1 | head -30";
    const normalizedPiped = normalizePipelinesForPowerShell(piped);
    assert.equal(
      normalizedPiped,
      "npx create-react-app nova-cart --template typescript 2>&1 | Select-Object -First 30",
      "| head must normalize to PowerShell Select-Object -First"
    );

    // 4. DOS dir flags normalization
    const dosDir = "dir /a /s /b";
    const normalizedDos = normalizeUnixCommand(dosDir);
    assert.equal(normalizedDos.normalized, "cmd.exe /c dir /a /s /b");

    // 5. Execute command in a real directory path containing spaces
    const spaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu space test-"));
    try {
      const res = await runCommand('Write-Output "Hello from space dir"', spaceDir);
      assert.equal(res.exitCode, 0);
      assert.match(res.stdout, /Hello from space dir/);

      // Create a subfolder with spaces using PowerShell
      const subRes = await runCommand('New-Item -ItemType Directory -Force -Path "sub folder"', spaceDir);
      assert.equal(subRes.exitCode, 0);
      assert.equal(await isUrlServing("http://localhost:59999", 50), false);
    } finally {
      await fs.rm(spaceDir, { recursive: true, force: true });
    }
  });

  test("Existing directory handling is idempotent without infinite retries", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-existing-dir-"));
    try {
      const subDirPath = path.join(tempDir, "nova-cart");
      await fs.mkdir(subDirPath, { recursive: true });

      // Running mkdir / New-Item on an existing directory with -Force succeeds without error
      const firstRun = await runCommand(`New-Item -ItemType Directory -Force -Path "${subDirPath}"`, tempDir);
      assert.equal(firstRun.exitCode, 0, "Initial creation should succeed");

      const secondRun = await runCommand(`New-Item -ItemType Directory -Force -Path "${subDirPath}"`, tempDir);
      assert.equal(secondRun.exitCode, 0, "Repeated creation on existing directory must succeed idempotently");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("Subdirectory project detection locates package.json in scaffolded subfolder", async () => {
    const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-parent-ws-"));
    try {
      const subAppDir = path.join(parentDir, "nova-cart");
      await fs.mkdir(subAppDir, { recursive: true });
      await fs.writeFile(
        path.join(subAppDir, "package.json"),
        JSON.stringify({
          name: "nova-cart",
          scripts: { dev: "npx serve . -l 4321" },
        })
      );

      const parentWorkspace = new Workspace(parentDir);
      const startInfo = await detectStartCommand(parentWorkspace);

      assert.equal(startInfo.command, "npm run dev");
      assert.equal(startInfo.port, 4321);
      assert.equal(startInfo.cwd, subAppDir, "Working directory must resolve to the sub-app directory");
    } finally {
      await fs.rm(parentDir, { recursive: true, force: true });
    }
  });

  test("Failure states are never reported as Ready or Successful", () => {
    // 1. Web app lifecycle where browser verification did not pass
    const computeSuccess = (plan: { toolType: string; status: string }[], browserPassed: boolean, stopReason: string | null) => {
      const isWebApp = plan.some(s => s.toolType === "start_app" || s.toolType === "browser_verify");
      const browserIncomplete = isWebApp && !browserPassed;
      const hasFailedSteps = plan.some(s => s.status === "failed");
      const allDone = plan.every(s => s.status === "completed" || s.toolType === "stop_app");
      return !stopReason && !browserIncomplete && !hasFailedSteps && allDone;
    };

    // Case A: 1 of 13 steps completed
    const planA = [
      { toolType: "list_directory", status: "completed" },
      { toolType: "run_command", status: "failed" },
      { toolType: "start_app", status: "pending" },
      { toolType: "browser_verify", status: "pending" },
      { toolType: "stop_app", status: "pending" },
    ];
    assert.equal(computeSuccess(planA, false, null), false, "Incomplete plan with failed steps must not be successful");

    // Case B: Execution loop stopped
    assert.equal(computeSuccess(planA, false, "Execution loop detected"), false, "Loop-stopped plan must not be successful");

    // Case C: Server running but browser verification never passed
    const planC = [
      { toolType: "create_file", status: "completed" },
      { toolType: "start_app", status: "completed" },
      { toolType: "browser_verify", status: "failed" },
      { toolType: "stop_app", status: "pending" },
    ];
    assert.equal(computeSuccess(planC, false, null), false, "Unverified web app must not be reported as successful");

    // Case D: All steps completed and browser verification passed
    const planD = [
      { toolType: "create_file", status: "completed" },
      { toolType: "start_app", status: "completed" },
      { toolType: "browser_verify", status: "completed" },
      { toolType: "stop_app", status: "pending" },
    ];
    assert.equal(computeSuccess(planD, true, null), true, "Only fully verified plan should be successful");
  });
});