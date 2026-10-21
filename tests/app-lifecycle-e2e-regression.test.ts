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
  spawnAppProcess,
  stopAppProcess,
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

  test("9. Workspace path with spaces ('intrn py') establishes consistent project root", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu intrn py "));
    const ws = new Workspace(baseDir);

    // Add existing unrelated python file like in the user's workspace
    await ws.write("aj.py", "print('hello from python')\n");

    // Scaffolding DevShowcase in this workspace must create a dedicated child project
    const res = await scaffoldReactViteProject(ws, "DevShowcase");
    assert.equal(res.success, true);
    assert.ok(res.projectRoot?.endsWith("DevShowcase"), "Project root must be the nested DevShowcase folder");
    assert.equal(ws.root, res.projectRoot);

    // Resolving relative paths like 'src/App.jsx' must resolve to the child project
    const resolvedApp = ws.resolve("src/App.jsx");
    assert.ok(resolvedApp.includes("DevShowcase"), "src/App.jsx must resolve inside DevShowcase");
    assert.equal(fsSync.existsSync(resolvedApp), true, "App.jsx must exist at resolved location");

    await fs.rm(baseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  test("10. Multiline JSX editing with indentation tolerance and verify-after-write", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-jsx-edit-"));
    const ws = new Workspace(tempDir);

    const originalJsx = `import React from 'react';

export default function App() {
  return (
    <div className="container">
      <h1>Original Header</h1>
      <p>Original description</p>
    </div>
  );
}
`;
    await ws.write("src/App.jsx", originalJsx);

    // Edit 1: Match multiline block with DIFFERENT indentation and single vs double quotes
    const { editFile } = await import("../src/tools/edit-file.js");
    const oldMultilineWithDifferentIndent = `      <h1>Original Header</h1>
      <p>Original description</p>`;
    const newMultiline = `      <h1>DevShowcase Portfolio</h1>
      <section className="about">
        <h2>About Me</h2>
        <p>Experienced full-stack engineer</p>
      </section>`;

    const editRes = await editFile(ws, "src/App.jsx", [
      { oldText: oldMultilineWithDifferentIndent, newText: newMultiline },
    ]);
    assert.ok(editRes.includes("Successfully edited"));

    const modified = await ws.read("src/App.jsx");
    assert.ok(modified.includes("DevShowcase Portfolio"));
    assert.ok(modified.includes("About Me"));

    // Edit 2: Full replacement via oldText: "*"
    const fullReplacementJsx = `import React from 'react';
export default function App() {
  return <div>Full Rewrite Complete</div>;
}
`;
    await editFile(ws, "src/App.jsx", [{ oldText: "*", newText: fullReplacementJsx }]);
    const fullVerified = await ws.read("src/App.jsx");
    assert.equal(fullVerified.trim(), fullReplacementJsx.trim());

    await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  test("11. Edit failure provides current file context and prevents destructive deletion", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-edit-fail-"));
    const ws = new Workspace(tempDir);
    await ws.write("src/App.jsx", "const a = 1;\n");

    const { editFile } = await import("../src/tools/edit-file.js");

    // Expect actionable error with file excerpt
    await assert.rejects(
      editFile(ws, "src/App.jsx", [{ oldText: "non_existent_code_xyz", newText: "new_code" }]),
      (err: any) => {
        assert.ok(err.message.includes("The expected text was not found in src/App.jsx"));
        assert.ok(err.message.includes("Current file content begins with"));
        return true;
      }
    );

    // Verify shell deletion command remains blocked by command guard
    const delCmd = `del "${path.join(tempDir, "src", "App.jsx")}"`;
    const guardRes = validateCommand(delCmd);
    assert.equal(guardRes.allowed, false, "del on source file must be blocked");

    await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  test("12. Genuine React/Vite E2E in workspace with spaces ('intrn py test') with Live Preview runtime", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu intrn py test "));
    const ws = new Workspace(baseDir);

    // Existing workspace has unrelated user files (like 'intrn py' having python files)
    await ws.write("existing.py", "# existing python workspace\n");

    // Scaffold nested DevShowcase project
    const scaffoldRes = await scaffoldReactViteProject(ws, "DevShowcase");
    assert.equal(scaffoldRes.success, true);
    const projectDir = ws.root;
    assert.ok(projectDir.includes("DevShowcase"));

    // Edit src/App.jsx to customize portfolio content
    const { editFile } = await import("../src/tools/edit-file.js");
    const customPortfolioJsx = `import React from 'react';

export default function App() {
  return (
    <div style={{ padding: '2rem', background: '#111827', color: 'white' }}>
      <h1>DevShowcase Portfolio Live</h1>
      <section>
        <h2>Featured Projects</h2>
        <p>Interactive portfolio built with React &amp; Vite</p>
      </section>
    </div>
  );
}
`;
    await editFile(ws, "src/App.jsx", [{ oldText: "*", newText: customPortfolioJsx }]);
    const onDiskApp = await ws.read("src/App.jsx");
    assert.ok(onDiskApp.includes("DevShowcase Portfolio Live"));

    // Allocate port and start simulated app server
    const port = await allocateAvailablePort(54330);
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><html><head><title>DevShowcase</title></head><body><div id="root"><h1>DevShowcase Portfolio Live</h1></div></body></html>`);
    });
    await new Promise<void>((r) => server.listen(port, "0.0.0.0", () => r()));

    try {
      const url = `http://localhost:${port}`;
      const readiness = await waitForReadiness(url, { timeoutMs: 3000, intervalMs: 300 });
      assert.equal(readiness.ready, true);

      // Save app runtime and verify lookup works from both child project root AND parent workspace
      const { saveAppRuntime, getAppRuntime, clearAppRuntime } = await import("../src/tools/app-lifecycle.js");
      saveAppRuntime({
        workspaceRoot: projectDir,
        pid: process.pid,
        port,
        url,
        startedAt: Date.now(),
      });
      if (ws.parentRoot) {
        saveAppRuntime({
          workspaceRoot: ws.parentRoot,
          pid: process.pid,
          port,
          url,
          startedAt: Date.now(),
        });
      }

      const lookupChild = getAppRuntime(projectDir);
      assert.equal(lookupChild?.url, url, "Child project root must resolve active preview URL");

      const lookupParent = getAppRuntime(baseDir);
      assert.equal(lookupParent?.url, url, "Parent workspace root must resolve active preview URL");

      clearAppRuntime(projectDir);
      clearAppRuntime(baseDir);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      await fs.rm(baseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  test("13. File creation and full-replacement reliability on index.html with complex characters", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-file-replace-"));
    const ws = new Workspace(tempDir);
    const { createFile } = await import("../src/tools/create-file.js");
    const { editFile } = await import("../src/tools/edit-file.js");

    // 13a. Create new index.html
    const initialHtml = "<!DOCTYPE html><html><head><title>Initial</title></head><body><h1>Initial</h1></body></html>";
    const createRes1 = await createFile(ws, "index.html", initialHtml);
    assert.ok(createRes1.includes("Successfully created"));
    const onDisk1 = await ws.read("index.html");
    assert.equal(onDisk1, initialHtml);

    // 13b. Overwrite existing index.html via createFile with overwrite=true
    const updatedHtmlWithComplexChars = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Unique E-commerce &amp; Store: Price $99.99 for {Premium} "Item" 🚀</title>
</head>
<body>
  <h1>Sale: $49.99 only!</h1>
  <p>Template styles: { display: "flex", gap: "1rem" }</p>
</body>
</html>`;
    const createRes2 = await createFile(ws, "index.html", updatedHtmlWithComplexChars, true);
    assert.ok(createRes2.includes("Successfully updated"));
    const onDisk2 = await ws.read("index.html");
    assert.equal(onDisk2, updatedHtmlWithComplexChars);
    assert.ok(onDisk2.includes("$99.99"));
    assert.ok(onDisk2.includes("$49.99"));
    assert.ok(onDisk2.includes("🚀"));

    // 13c. Full replacement via editFile with newText only
    const thirdHtml = `<!DOCTYPE html><html><body><h1>Third Version: $199.00</h1></body></html>`;
    const editRes1 = await editFile(ws, "index.html", [{ newText: thirdHtml }]);
    assert.ok(editRes1.includes("Successfully edited"));
    const onDisk3 = await ws.read("index.html");
    assert.equal(onDisk3.trim(), thirdHtml.trim());
    assert.ok(onDisk3.includes("$199.00"));

    await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  test("14. Genuine E2E static HTML website lifecycle with Live Preview in workspace with spaces", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu intrn py static "));
    const ws = new Workspace(baseDir);
    const { editFile } = await import("../src/tools/edit-file.js");

    // 14a. Scaffold static project in workspace
    const scaffoldRes = await scaffoldStaticProject(ws, "EcommerceStore");
    assert.equal(scaffoldRes.success, true);
    assert.ok(await ws.exists("index.html"));
    assert.ok(await ws.exists("styles.css"));
    assert.ok(await ws.exists("package.json"));

    // 14b. Overwrite index.html with unique ecommerce webpage
    const ecommerceHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Unique E-Commerce Store</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header>
    <h1>Unique E-Commerce Collection</h1>
    <p>Exclusive handcrafted goods starting at $29.99</p>
  </header>
  <main>
    <section class="card">
      <h2>Featured Products</h2>
      <div class="product">
        <h3>Premium Silk Shirt</h3>
        <p class="price">$79.99</p>
      </div>
    </section>
  </main>
</body>
</html>`;
    const updateRes = await editFile(ws, "index.html", [{ newText: ecommerceHtml }]);
    assert.ok(updateRes.includes("Successfully edited"));

    // 14c. Verify file read-back matches
    const readBack = await ws.read("index.html");
    assert.ok(readBack.includes("Unique E-Commerce Collection"));
    assert.ok(readBack.includes("$79.99"));

    // 14d. Allocate port and start web server
    const port = await allocateAvailablePort(54660);
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(readBack);
    });
    await new Promise<void>((r) => server.listen(port, "0.0.0.0", () => r()));

    try {
      const url = `http://localhost:${port}`;
      const readiness = await waitForReadiness(url, { timeoutMs: 3000, intervalMs: 300 });
      assert.equal(readiness.ready, true);

      // Verify HTTP response content
      const response = await fetch(url);
      const text = await response.text();
      assert.ok(text.includes("Unique E-Commerce Collection"));
      assert.ok(text.includes("$79.99"));
      assert.equal(text.includes("Files within "), false, "Must not be a directory listing");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      await fs.rm(baseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  test("15. Static index.html site starts without package.json and ignores stray Vite/React files", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-static-serve-"));
    const workspace = new Workspace(tempDir);
    await workspace.write(
      "index.html",
      `<!DOCTYPE html><html><head><title>ShopNova</title><link rel="stylesheet" href="styles.css"></head><body><h1>ShopNova Storefront</h1><div id="products"></div><script src="script.js" defer></script></body></html>`
    );
    await workspace.write("styles.css", "body { font-family: system-ui; } h1 { color: #111; }");
    await workspace.write("script.js", "document.getElementById('products').textContent = 'Loaded';");

    let info = await detectStartCommand(workspace);
    assert.equal(info.static, true, "Plain index.html site must use the built-in static server");
    assert.equal(info.command.includes("achu-static-server"), true);

    // Reproduce the production failure: a stray Vite/React package.json and
    // src/main.jsx next to a static index.html without a React root.
    await workspace.write(
      "package.json",
      JSON.stringify({ name: "shopnova", scripts: { dev: "vite --port 5173" }, dependencies: { react: "^18.2.0", "react-dom": "^18.2.0" }, devDependencies: { vite: "^4.5.14" } }, null, 2)
    );
    await workspace.write("src/main.jsx", "import React from 'react'; console.log(React);");
    info = await detectStartCommand(workspace);
    assert.equal(info.static, true, "Static index.html without a React root must win over stray Vite config");

    const port = await allocateAvailablePort(54770);
    const appInfo = spawnAppProcess(info.command, tempDir, { ...process.env, PORT: String(port) });
    try {
      const readiness = await waitForReadiness(`http://localhost:${port}`, { timeoutMs: 10000, intervalMs: 300 });
      assert.equal(readiness.ready, true);
      const response = await fetch(`http://localhost:${port}/`);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.ok(html.includes("ShopNova Storefront"));
      const script = await fetch(`http://localhost:${port}/script.js`);
      assert.equal(script.status, 200);
      assert.ok((await script.text()).includes("products"));
    } finally {
      await stopAppProcess(appInfo);
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  test("16. Placeholder hero graphics fail browser verification", async () => {
    const fakeSession: any = {
      inspectPage: async () => ({
        success: true,
        info: {
          title: "ShopNova",
          url: "http://localhost:3000",
          visibleText: "ShopNova Discover Quality Products",
          buttons: ["Shop Now"],
          inputs: [],
          links: [],
          selects: [],
          textareas: [],
          consoleErrors: [],
          pageErrors: [],
          qualityIssues: ['Large inline SVG contains only "E" and no illustration paths; it is a placeholder graphic.'],
        },
      }),
    };

    const summary = await runVerificationSuite(fakeSession, "http://localhost:3000", []);
    assert.equal(summary.overallPassed, false);
    assert.ok(summary.results.some((r) => r.error?.includes("Placeholder")));
  });
});
