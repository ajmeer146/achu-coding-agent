import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { runCommand } from "../src/tools/terminal.js";
import { normalizeUnixCommand, balanceQuotes } from "../src/utils/command-guard.js";
import { Workspace } from "../src/tools/workspace.js";
import { createFile } from "../src/tools/create-file.js";
import { editFile } from "../src/tools/edit-file.js";
import { scaffoldStaticProject, scaffoldReactViteProject, validateProjectStructure } from "../src/tools/scaffold.js";
import {
  spawnAppProcess,
  waitForReadiness,
  stopAppProcess,
  allocateAvailablePort,
  isUrlServing,
  saveAppRuntime,
  getAppRuntime,
  clearAppRuntime,
  isProcessAlive
} from "../src/tools/app-lifecycle.js";
import { runVerificationSuite } from "../src/browser/browser-verification.js";
import { BrowserSession } from "../src/browser/browser-session.js";

async function removeDirWithRetry(dirPath: string, maxAttempts = 10, delayMs = 150): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
      return;
    } catch (err: any) {
      if ((err.code === "EBUSY" || err.code === "EPERM" || err.code === "ENOTEMPTY") && attempt < maxAttempts) {
        console.log(`[cleanup retry ${attempt}/${maxAttempts}] ${err.code} on ${dirPath}, waiting ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
}

describe("Master Mission End-to-End Deterministic Regression Suite", () => {
  test("1. Windows PowerShell command normalization handles spaces, compound chaining and DOS dir", async () => {
    const testPathWithSpaces = "C:\\Users\\Achu146\\OneDrive\\Desktop\\intrn py";

    // 1a. Chained commands pwd && ls -la
    const normAnd = normalizeUnixCommand("pwd && ls -la");
    assert.ok(normAnd.normalized.includes("Get-Location"), "pwd must normalize to Get-Location");
    assert.ok(normAnd.normalized.includes("if ($?)"), "&& must normalize to PowerShell conditional");
    assert.ok(normAnd.normalized.includes("Get-ChildItem -Force"), "ls -la must normalize to Get-ChildItem -Force");

    // 1b. ls -la with quoted path with spaces
    const normQuotedLs = normalizeUnixCommand(`ls -la "${testPathWithSpaces}"`);
    assert.ok(normQuotedLs.normalized.includes("Get-ChildItem -Force"), "Must convert to Get-ChildItem -Force");
    assert.ok(normQuotedLs.normalized.includes(`-LiteralPath "${testPathWithSpaces}"`), "Must preserve path in -LiteralPath");

    // 1c. ls -la with unquoted path with spaces
    const normUnquotedLs = normalizeUnixCommand(`ls -la ${testPathWithSpaces}`);
    assert.ok(normUnquotedLs.normalized.includes(`-LiteralPath "${testPathWithSpaces}"`), "Unquoted path with spaces must be safely quoted in -LiteralPath");

    // 1d. dir /a /b with quoted path with spaces
    const normQuotedDir = normalizeUnixCommand(`dir /a /b "${testPathWithSpaces}"`);
    assert.ok(normQuotedDir.normalized.includes("-LiteralPath"), "DOS dir with path must normalize to Get-ChildItem with -LiteralPath");
    assert.ok(normQuotedDir.normalized.includes("-Force") && normQuotedDir.normalized.includes("-Name"), "dir /a /b must normalize to -Force -Name");

    // 1e. dir /a /b with unquoted path with spaces
    const normUnquotedDir = normalizeUnixCommand(`dir /a /b ${testPathWithSpaces}`);
    assert.ok(normUnquotedDir.normalized.includes(`-LiteralPath "${testPathWithSpaces}"`), "DOS dir with unquoted path must safely quote -LiteralPath");

    // 1f. dir /a /s /b with no path remains backward-compatible cmd.exe /c
    const normBareDir = normalizeUnixCommand("dir /a /s /b");
    assert.equal(normBareDir.normalized, "cmd.exe /c dir /a /s /b");

    // 1g. curl -s normalizes to curl.exe to avoid PowerShell alias
    const normCurl = normalizeUnixCommand("curl -s http://localhost:3001/health");
    assert.ok(normCurl.normalized.startsWith("curl.exe "));

    // 1h. ps aux normalizes to Get-Process
    const normPs = normalizeUnixCommand("ps aux | grep node");
    assert.ok(normPs.normalized.startsWith("Get-Process"));
    assert.ok(normPs.normalized.includes("Select-String"));
  });

  test("2. Real command execution preserves exit codes, stdout, stderr, and paths with spaces", async () => {
    const spaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu master space-"));
    try {
      // 2a. Simple command succeeds
      const res1 = await runCommand('Write-Output "space check"', spaceDir);
      assert.equal(res1.exitCode, 0);
      assert.match(res1.stdout, /space check/);

      // 2b. Nonzero exit code is truthfully reported
      const res2 = await runCommand('cmd.exe /c "exit 7"', spaceDir);
      assert.equal(res2.exitCode, 7);

      // 2c. Subfolder with spaces created and listed
      const subFolder = path.join(spaceDir, "nested folder with spaces");
      await fs.mkdir(subFolder, { recursive: true });
      const testFile = path.join(subFolder, "hello.txt");
      await fs.writeFile(testFile, "Hello World from Space Path!", "utf8");

      const resList = await runCommand(`ls -la "${subFolder}"`, spaceDir);
      assert.equal(resList.exitCode, 0);
      assert.match(resList.stdout, /hello\.txt/);
    } finally {
      await fs.rm(spaceDir, { recursive: true, force: true });
    }
  });

  test("3. Multiline file editing with whitespace and quote tolerance", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu edit test-"));
    try {
      const ws = new Workspace(tempDir);
      const initialContent = `import React from 'react';

export default function App() {
  return (
    <div className="container">
      <h1>Original Header</h1>
      <p>Original body paragraph with text.</p>
    </div>
  );
}
`;
      await ws.write("src/App.jsx", initialContent);

      // Edit with leading/trailing blank lines in oldText and quote variations
      const editResult = await editFile(ws, "src/App.jsx", [
        {
          oldText: `
      <h1>Original Header</h1>
      <p>Original body paragraph with text.</p>
`,
          newText: `      <h1>Updated Header</h1>
      <p>Updated body paragraph with text.</p>`,
        },
      ]);
      assert.ok(editResult.includes("Successfully edited"));

      const updated = await ws.read("src/App.jsx");
      assert.ok(updated.includes("Updated Header"));
      assert.ok(updated.includes("Updated body paragraph with text."));

      // Full file replacement with oldText: "*"
      const fullReplacement = `// Full replacement\nexport default function App() { return <div>Replaced</div>; }\n`;
      await editFile(ws, "src/App.jsx", [{ oldText: "*", newText: fullReplacement }]);
      const fullyReplaced = await ws.read("src/App.jsx");
      assert.equal(fullyReplaced, fullReplacement);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("4. File creation overwrite handling and conflict recovery", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu create test-"));
    try {
      const ws = new Workspace(tempDir);
      await createFile(ws, "index.html", "<h1>Initial Scaffold</h1>");

      // Attempting create without overwrite should throw
      await assert.rejects(async () => {
        await createFile(ws, "index.html", "<h1>New Content</h1>", false);
      }, /File already exists/);

      // Calling with overwrite: true succeeds
      const updateRes = await createFile(ws, "index.html", "<h1>Overwritten Content</h1>", true);
      assert.ok(updateRes.includes("overwrote existing file"));
      const content = await ws.read("index.html");
      assert.equal(content, "<h1>Overwritten Content</h1>");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("5. Directory listing on Windows ('Index of C:\\...') is strictly rejected by browser verification", async () => {
    const mockSession = {
      inspectPage: async () => ({
        success: true,
        info: {
          url: "http://localhost:3000",
          title: "Index of C:\\Users\\Achu146\\OneDrive\\Desktop\\intrn py",
          visibleText: "Directory listing for /\\n.achu-sessions\\npackage.json",
          buttons: [],
          inputs: [],
          links: [".achu-sessions", "package.json"],
          consoleErrors: [],
          pageErrors: [],
        },
      }),
    } as unknown as BrowserSession;

    const summary = await runVerificationSuite(mockSession, "http://localhost:3000", []);
    assert.equal(summary.overallPassed, false, "Windows Index of directory listing must fail verification");
    assert.ok(summary.results.some((r) => r.error && r.error.includes("directory listing")));
  });

  test("6. Genuine local static site lifecycle in workspace with spaces", async () => {
    const spaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu static life test-"));
    try {
      const ws = new Workspace(spaceDir);
      const scaffoldRes = await scaffoldStaticProject(ws, "Space Landing");
      assert.equal(scaffoldRes.success, true);
      assert.ok(await ws.exists("index.html"));

      const validation = validateProjectStructure(ws.root);
      assert.equal(validation.valid, true);
      assert.equal(validation.projectType, "static");

      // Verify port allocation
      const port = await allocateAvailablePort(45000);
      assert.ok(port >= 45000);

      // Start real local server detached using node http server
      const serverScript = `node -e "const http = require('http'); const fs = require('fs'); http.createServer((req, res) => { res.writeHead(200, {'Content-Type': 'text/html'}); res.end(fs.readFileSync('index.html')); }).listen(${port}, () => console.log('Accepting connections at http://localhost:${port}'));"`;
      const app = spawnAppProcess(serverScript, ws.root);
      try {
        const readiness = await waitForReadiness(`http://localhost:${port}`, { timeoutMs: 10000, intervalMs: 300 });
        assert.equal(readiness.ready, true);

        // Verify Live Preview runtime registration
        saveAppRuntime({
          workspaceRoot: ws.root,
          pid: app.pid,
          port,
          url: `http://localhost:${port}`,
          startedAt: app.startTime,
        });

        const record = getAppRuntime(ws.root);
        assert.ok(record);
        assert.equal(record?.port, port);
        assert.equal(record?.url, `http://localhost:${port}`);
      } finally {
        await stopAppProcess(app);
        clearAppRuntime(ws.root);
      }
    } finally {
      await removeDirWithRetry(spaceDir);
    }
  });
});
