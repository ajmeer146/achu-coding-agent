import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Workspace } from "../src/tools/workspace.js";
import {
  scaffoldReactViteProject,
  scaffoldStaticProject,
  validateProjectStructure,
  autoRepairProjectStructure,
} from "../src/tools/scaffold.js";
import {
  validateCommand,
  normalizeUnixCommand,
  replaceLogicalAndForPowerShell,
  replaceLogicalOrForPowerShell,
  balanceQuotes,
} from "../src/utils/command-guard.js";
import {
  detectStartCommand,
  replacePortInCommand,
  waitForReadiness,
  allocateAvailablePort,
  isPortAvailable,
} from "../src/tools/app-lifecycle.js";
import { runVerificationSuite } from "../src/browser/browser-verification.js";

describe("Coding Agent Engine E2E & Lifecycle Regression Tests", () => {
  test("1. Fresh workspace scaffolds a complete, valid React/Vite application", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-scaffold-test-"));
    const workspace = new Workspace(tempDir);

    const result = await scaffoldReactViteProject(workspace, "DevShowcase");
    assert.equal(result.success, true);
    assert.ok(result.files.includes("package.json"));
    assert.ok(result.files.includes("vite.config.js"));
    assert.ok(result.files.includes("index.html"));
    assert.ok(result.files.includes("src/main.jsx"));
    assert.ok(result.files.includes("src/App.jsx"));

    // Verify package.json contents
    const pkg = JSON.parse(await workspace.read("package.json"));
    assert.equal(pkg.scripts.dev, "vite");
    assert.equal(pkg.scripts.build, "vite build");
    assert.ok(pkg.dependencies.react);
    assert.ok(pkg.dependencies["react-dom"]);
    assert.ok(pkg.devDependencies.vite);

    // Verify index.html references entry point
    const indexHtml = await workspace.read("index.html");
    assert.ok(indexHtml.includes('<div id="root"></div>'));
    assert.ok(indexHtml.includes('src="/src/main.jsx"'));

    // Verify valid JSX (no unclosed comments or malformed css)
    const appJsx = await workspace.read("src/App.jsx");
    assert.ok(appJsx.includes("export default function App"));
    assert.ok(appJsx.includes("DevShowcase"));
    // Ensure all JSX comments are closed
    const unclosedComment = appJsx.match(/\{\/\*[^}]*<section/);
    assert.equal(unclosedComment, null, "JSX comments must be properly closed");

    // Validate project structure check passes
    const validation = validateProjectStructure(tempDir);
    assert.equal(validation.valid, true);
    assert.equal(validation.projectType, "react");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("2. Static server cannot be mistaken for a running React application", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-bogus-react-"));
    const workspace = new Workspace(tempDir);

    // Reproduce the exact bug seen in Desktop/testing:
    // package.json with react dependencies but dev: "npx serve . -l 5173" and no index.html
    const bogusPkg = {
      name: "devshowcase",
      scripts: {
        dev: "npx serve . -l 5173",
        build: "echo 'Static site - no build needed'",
        start: "npx serve . -l 5173",
      },
      dependencies: {
        react: "^18.2.0",
        "react-dom": "^18.2.0",
      },
    };
    await workspace.write("package.json", JSON.stringify(bogusPkg, null, 2));
    await workspace.write("src/App.js", "import React from 'react'; export default () => <div>Hi</div>;");

    // Pre-startup validation MUST flag this incompatible configuration
    const initialValidation = validateProjectStructure(tempDir);
    assert.equal(initialValidation.valid, false);
    assert.ok(initialValidation.error?.includes("npx serve"));

    // Auto-repair must fix the scripts to Vite and create the missing index.html & vite.config.js
    const repairResult = await autoRepairProjectStructure(workspace);
    assert.equal(repairResult.repaired, true);
    assert.ok(repairResult.changes.some((c) => c.includes("Vite")));

    const repairedPkg = JSON.parse(await workspace.read("package.json"));
    assert.equal(repairedPkg.scripts.dev, "vite");
    assert.equal(repairedPkg.scripts.build, "vite build");
    assert.ok(await workspace.exists("index.html"), "index.html must be created");
    assert.ok(await workspace.exists("vite.config.js"), "vite.config.js must be created");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("3. HTTP 200 response with directory listing is rejected by readiness check", async () => {
    // Start a test server that simulates `npx serve .` returning a directory listing
    const port = await allocateAvailablePort(54120);
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<!DOCTYPE html><html><head><title>Files within testing\\</title></head><body><h1>Directory listing</h1><ul><li>package.json</li><li>src/</li></ul></body></html>");
    });
    await new Promise<void>((r) => server.listen(port, "0.0.0.0", () => r()));

    try {
      const url = `http://localhost:${port}`;
      // waitForReadiness with short timeout must reject this directory listing
      const readiness = await waitForReadiness(url, { timeoutMs: 1500, intervalMs: 300 });
      assert.equal(readiness.ready, false, "Directory listing must NOT be marked ready");
      assert.ok(readiness.error?.includes("directory listing"));

      // Browser verification suite must also fail when page is a directory listing
      const fakeSession: any = {
        inspectPage: async () => ({
          success: true,
          info: {
            title: "Files within testing\\",
            url,
            visibleText: "Directory listing package.json src/",
            consoleErrors: [],
            pageErrors: [],
          },
        }),
      };

      const summary = await runVerificationSuite(fakeSession, url, []);
      assert.equal(summary.overallPassed, false, "Verification suite must fail for directory listing");
      assert.ok(summary.results.some((r) => r.error?.includes("directory listing")));
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  test("4. Broad Node.js process termination commands are strictly blocked", () => {
    // These commands were previously run by the agent during recovery failure
    const dangerousCommands = [
      'Get-Process | Where-Object {$_.ProcessName -eq "node"} | Stop-Process -Force',
      'Stop-Process -Name node -Force',
      'taskkill /f /im node.exe',
      'taskkill /pid 1234 /f',
      'npx kill-port 5173',
      'kill -9 1234',
      'killall node',
      'pkill -f node',
      'Get-Process node | Stop-Process',
    ];

    for (const cmd of dangerousCommands) {
      const res = validateCommand(cmd);
      assert.equal(res.allowed, false, `Command should be blocked: ${cmd}`);
      assert.ok(res.reason?.includes("blocked") || res.reason?.includes("termination"));
    }

    // Safe commands must remain allowed
    assert.equal(validateCommand("npm run dev").allowed, true);
    assert.equal(validateCommand("npm run build").allowed, true);
    assert.equal(validateCommand("npx tsc --noEmit").allowed, true);
    assert.equal(validateCommand("node dist/cli.js --help").allowed, true);
  });

  test("5. Windows PowerShell command normalization correctly converts syntax", () => {
    // 5a. Logical OR || converted to PowerShell conditional chaining
    const orCmd = "npx check || echo 'fallback'";
    const normalizedOr = normalizeUnixCommand(orCmd);
    assert.ok(normalizedOr.normalized.includes("if (-not $?)"));

    // 5b. Logical AND && converted to PowerShell conditional chaining
    const andCmd = "npm run build && npm test";
    const normalizedAnd = normalizeUnixCommand(andCmd);
    assert.ok(normalizedAnd.normalized.includes("if ($?)"));

    // 5c. 2>/dev/null converted to 2>$null
    const nullRedirect = "command 2>/dev/null";
    const normalizedNull = normalizeUnixCommand(nullRedirect);
    assert.ok(normalizedNull.normalized.includes("2>$null"));

    // 5d. Unclosed quotes are safely balanced
    const unclosed = 'echo "Build step: test';
    const balanced = balanceQuotes(unclosed);
    assert.equal(balanced, 'echo "Build step: test"');

    // 5e. curl is normalized to curl.exe to avoid PowerShell Invoke-WebRequest error
    const curlCmd = "curl -s http://localhost:5173";
    const normalizedCurl = normalizeUnixCommand(curlCmd);
    assert.ok(normalizedCurl.normalized.startsWith("curl.exe "));

    // 5f. ps aux is normalized to Get-Process
    const psCmd = "ps aux | findstr node";
    const normalizedPs = normalizeUnixCommand(psCmd);
    assert.ok(normalizedPs.normalized.includes("Get-Process"));
  });

  test("6. Port replacement correctly propagates to npm/pnpm/vite commands", () => {
    assert.equal(
      replacePortInCommand("npm run dev", 5174),
      "npm run dev -- --port 5174"
    );
    assert.equal(
      replacePortInCommand("vite", 5175),
      "vite --port 5175"
    );
    assert.equal(
      replacePortInCommand("npx serve . -l 3000", 3001),
      "npx serve . -l 3001"
    );
    assert.equal(
      replacePortInCommand("npm run dev -- --port 5173", 5178),
      "npm run dev -- --port 5178"
    );
  });

  test("7. Browser console errors cause verification suite to report failure", async () => {
    const fakeSession: any = {
      inspectPage: async () => ({
        success: true,
        info: {
          title: "My Portfolio",
          url: "http://localhost:5173",
          visibleText: "Welcome to my portfolio",
          consoleErrors: ["Uncaught TypeError: Cannot read property 'map' of undefined at App.jsx:24"],
          pageErrors: [],
        },
      }),
    };

    const summary = await runVerificationSuite(fakeSession, "http://localhost:5173", []);
    assert.equal(summary.overallPassed, false, "Verification must fail when console errors are present");
    assert.ok(summary.results.some((r) => r.error?.includes("Cannot read property 'map'")));
  });

  test("8. Real HTTP endpoint serving genuine React/Vite content passes verification", async () => {
    const port = await allocateAvailablePort(54220);
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html>
<html lang="en">
  <head><title>DevShowcase</title></head>
  <body>
    <div id="root">
      <h1>DevShowcase</h1>
      <p>Built with React &amp; Vite</p>
      <section><h2>Featured Projects</h2><div>Project 1</div></section>
    </div>
  </body>
</html>`);
    });
    await new Promise<void>((r) => server.listen(port, "0.0.0.0", () => r()));

    try {
      const url = `http://localhost:${port}`;
      const readiness = await waitForReadiness(url, { timeoutMs: 3000, intervalMs: 300 });
      assert.equal(readiness.ready, true);
      assert.equal(readiness.url, url);

      // Verify HTTP response directly
      const res = await fetch(url);
      const text = await res.text();
      assert.ok(text.includes("DevShowcase"));
      assert.ok(text.includes("Built with React &amp; Vite"));
      assert.ok(text.includes("Featured Projects"));
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
