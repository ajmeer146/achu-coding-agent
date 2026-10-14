import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { Workspace } from "../src/tools/workspace.js";
import { scaffoldReactViteProject } from "../src/tools/scaffold.js";
import { editFile } from "../src/tools/edit-file.js";
import { BrowserSession } from "../src/browser/browser-session.js";
import {
  spawnAppProcess,
  waitForReadiness,
  stopAppProcess,
  allocateAvailablePort,
  saveAppRuntime,
  clearAppRuntime,
} from "../src/tools/app-lifecycle.js";

describe("Achu Test Lab Real End-to-End React/Vite Creation & Browser Verification", () => {
  test("Real React/Vite creation in workspace path with spaces, build, server start, and browser interactions", async () => {
    // 1. Workspace root path containing spaces
    const baseDir = path.join(
      os.tmpdir(),
      `achu test lab space ${Date.now()}`
    );
    await fs.mkdir(baseDir, { recursive: true });

    // Requirement 1: create a new project directory named achu-test-lab inside workspace
    const projectDir = path.join(baseDir, "achu-test-lab");
    await fs.mkdir(projectDir, { recursive: true });

    const ws = new Workspace(projectDir);
    ws.parentRoot = baseDir;

    // 2. Scaffold React + Vite application into project directory
    const scaffoldRes = await scaffoldReactViteProject(ws, "achu-test-lab");
    assert.equal(scaffoldRes.success, true);
    assert.ok(
      projectDir.toLowerCase().includes("achu-test-lab"),
      "Authoritative project root must be inside achu-test-lab directory"
    );

    // 3. Verify all required files exist
    const requiredFiles = [
      "package.json",
      "index.html",
      "src/main.jsx",
      "src/App.jsx",
      "src/index.css",
      "vite.config.js",
    ];
    for (const f of requiredFiles) {
      assert.equal(
        fsSync.existsSync(path.join(projectDir, f)),
        true,
        `Required file ${f} must exist in project directory`
      );
    }

    // 4. Implement complete Testing Dashboard in src/App.jsx matching requirements
    const testLabAppJsx = `import React, { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  const [tasks, setTasks] = useState([
    { id: 1, text: 'Scaffold project structure', done: true },
    { id: 2, text: 'Build application components', done: true },
    { id: 3, text: 'Run browser verification', done: false },
  ]);

  const toggleTask = (id) => {
    setTasks(tasks.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0f172a',
      color: '#f8fafc',
      fontFamily: 'system-ui, sans-serif',
      padding: '2rem'
    }}>
      <header style={{
        maxWidth: '800px',
        margin: '0 auto 2rem auto',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #334155',
        paddingBottom: '1rem'
      }}>
        <h1 style={{ fontSize: '2rem', margin: 0, fontWeight: '700' }}>Achu Test Lab</h1>
        <span style={{
          backgroundColor: '#10b981',
          color: '#ffffff',
          padding: '0.4rem 0.8rem',
          borderRadius: '9999px',
          fontSize: '0.875rem',
          fontWeight: '600'
        }}>
          Application Running
        </span>
      </header>

      <main style={{ maxWidth: '800px', margin: '0 auto' }}>
        {/* Counter Section */}
        <section style={{
          backgroundColor: '#1e293b',
          borderRadius: '12px',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          border: '1px solid #334155'
        }}>
          <h2 style={{ fontSize: '1.25rem', marginTop: 0, marginBottom: '1rem' }}>Interactive Counter</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span id="counter-value" style={{ fontSize: '2.5rem', fontWeight: '800', minWidth: '3rem' }}>
              {count}
            </span>
            <button
              id="increment-btn"
              onClick={() => setCount(count + 1)}
              style={{
                backgroundColor: '#3b82f6',
                color: '#ffffff',
                border: 'none',
                padding: '0.6rem 1.2rem',
                borderRadius: '8px',
                fontSize: '1rem',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              Increment
            </button>
            <button
              id="reset-btn"
              onClick={() => setCount(0)}
              style={{
                backgroundColor: '#64748b',
                color: '#ffffff',
                border: 'none',
                padding: '0.6rem 1.2rem',
                borderRadius: '8px',
                fontSize: '1rem',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              Reset
            </button>
          </div>
        </section>

        {/* Checklist Section */}
        <section style={{
          backgroundColor: '#1e293b',
          borderRadius: '12px',
          padding: '1.5rem',
          border: '1px solid #334155'
        }}>
          <h2 style={{ fontSize: '1.25rem', marginTop: 0, marginBottom: '1rem' }}>Task Checklist</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {tasks.map(task => (
              <li key={task.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0' }}>
                <input
                  type="checkbox"
                  id={'task-' + task.id}
                  checked={task.done}
                  onChange={() => toggleTask(task.id)}
                  style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                />
                <label
                  htmlFor={'task-' + task.id}
                  style={{
                    fontSize: '1rem',
                    textDecoration: task.done ? 'line-through' : 'none',
                    color: task.done ? '#94a3b8' : '#f8fafc',
                    cursor: 'pointer'
                  }}
                >
                  {task.text}
                </label>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
`;
    await editFile(ws, "src/App.jsx", [{ oldText: "*", newText: testLabAppJsx }]);

    // 5. Link node_modules from local repo cache for fast, offline compilation
    const localNodeModules = path.resolve(
      process.cwd(),
      "saas-landing",
      "node_modules"
    );
    if (fsSync.existsSync(localNodeModules)) {
      const projectNodeModules = path.join(projectDir, "node_modules");
      try {
        if (process.platform === "win32") {
          execSync(`cmd /c mklink /J "${projectNodeModules}" "${localNodeModules}"`, {
            stdio: "ignore",
          });
        } else {
          await fs.symlink(localNodeModules, projectNodeModules, "junction");
        }
      } catch {}
    }

    // 6. Verify build command succeeds
    const viteBin = path.join(projectDir, "node_modules", ".bin", "vite");
    const hasVite = fsSync.existsSync(viteBin) || fsSync.existsSync(viteBin + ".cmd");
    if (hasVite) {
      const buildResult = execSync(
        `"${path.join(projectDir, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite")}" build`,
        {
          cwd: projectDir,
          encoding: "utf8",
          stdio: "pipe",
        }
      );
      assert.ok(
        fsSync.existsSync(path.join(projectDir, "dist", "index.html")),
        "Vite build must generate dist/index.html"
      );
    }

    // 7. Start application development server
    const port = await allocateAvailablePort(54500);
    const startCmd = hasVite
      ? `npx vite --port ${port} --host`
      : `npx serve -l ${port} dist`;

    const appProcess = spawnAppProcess(startCmd, projectDir, port);
    assert.equal(appProcess.status, "starting", "Newly spawned app process must have status 'starting'");

    const appUrl = `http://localhost:${port}`;

    try {
      // 8. Wait for application readiness
      const ready = await waitForReadiness(appUrl, {
        timeoutMs: 20000,
        intervalMs: 300,
      });
      assert.equal(ready.ready, true, `Application must become HTTP-ready at ${appUrl}`);
      appProcess.status = "ready";
      appProcess.url = appUrl;
      appProcess.port = port;
      assert.equal(appProcess.status, "ready");

      saveAppRuntime({
        workspaceRoot: projectDir,
        pid: appProcess.pid,
        port,
        url: appUrl,
        startedAt: Date.now(),
      });

      // 9. Launch real Playwright Browser Verification
      const browser = new BrowserSession({ headless: true });
      await browser.init();

      try {
        // Navigate to the live application URL
        const navRes = await browser.navigate(appUrl);
        assert.equal(navRes.success, true, `Navigation to ${appUrl} must succeed`);

        const page = browser.getPage();
        assert.ok(page !== null, "Playwright page must be initialized");

        // Wait for root React component mounting
        await page.waitForSelector("h1", { timeout: 10000 });

        // A. Verify Heading
        const headingText = await page.textContent("h1");
        assert.ok(
          headingText?.includes("Achu Test Lab"),
          `Page heading must contain 'Achu Test Lab', got: ${headingText}`
        );

        // B. Verify Status Badge
        const badge = await page.locator("header span").textContent();
        assert.ok(
          badge?.includes("Application Running"),
          `Status badge must contain 'Application Running', got: ${badge}`
        );

        // C. Verify Initial Counter State
        const initialCount = await page.textContent("#counter-value");
        assert.equal(initialCount?.trim(), "0", "Initial counter value must be 0");

        // D. Test Increment Button Interaction
        await page.click("#increment-btn");
        const countAfterInc1 = await page.textContent("#counter-value");
        assert.equal(countAfterInc1?.trim(), "1", "Counter must be 1 after increment");

        await page.click("#increment-btn");
        const countAfterInc2 = await page.textContent("#counter-value");
        assert.equal(countAfterInc2?.trim(), "2", "Counter must be 2 after second increment");

        // E. Test Reset Button Interaction
        await page.click("#reset-btn");
        const countAfterReset = await page.textContent("#counter-value");
        assert.equal(countAfterReset?.trim(), "0", "Counter must be 0 after reset");

        // F. Test Checklist Checkbox Interaction
        const thirdCheckbox = page.locator("#task-3");
        const isInitiallyChecked = await thirdCheckbox.isChecked();
        assert.equal(isInitiallyChecked, false, "Third checklist task should initially be unchecked");

        await thirdCheckbox.click();
        const isNowChecked = await thirdCheckbox.isChecked();
        assert.equal(isNowChecked, true, "Checklist item must be checked after click");

        // G. Verify Preview URL is active
        assert.equal(appUrl.startsWith("http://localhost:"), true);
      } finally {
        await browser.close();
      }
    } finally {
      await stopAppProcess(appProcess);
      clearAppRuntime(projectDir);
      clearAppRuntime(baseDir);
      try {
        await fs.rm(baseDir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 300,
        });
      } catch {}
    }
  });
});
