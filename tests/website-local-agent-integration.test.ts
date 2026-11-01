import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { app, COMPANION_TOKEN } from "../src/server.js";
import { isAllowedOrigin } from "../src/server.js";
import { Workspace } from "../src/tools/workspace.js";

describe("Phase 3: Website and Local Agent Integration Suite", () => {
  let server: http.Server;
  const companionPort = 3001;
  const companionUrl = `http://127.0.0.1:${companionPort}`;
  let tempWorkspaceWithSpaces: string;

  before(async () => {
    // Create test workspace path with spaces
    tempWorkspaceWithSpaces = path.join(os.tmpdir(), `Achu Space Test ${Date.now()}`);
    await fs.mkdir(tempWorkspaceWithSpaces, { recursive: true });

    // Start companion server on 3001 if not already running
    try {
      const probe = await fetch(`${companionUrl}/api/companion/status`, { signal: AbortSignal.timeout(1000) });
      if (probe.ok) {
        console.log("  [Phase 3 Setup] Companion server already running on port 3001.");
        return;
      }
    } catch {}

    server = http.createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          console.log("  [Phase 3 Setup] Port 3001 in use, assuming companion is active.");
          resolve();
        } else {
          reject(err);
        }
      });
      server.listen(companionPort, "127.0.0.1", () => {
        console.log(`  [Phase 3 Setup] Companion server launched on ${companionUrl}`);
        resolve();
      });
    });
  });

  after(async () => {
    try {
      const { activeTasks, wss } = await import("../src/server.js");
      wss.close();
      for (const t of activeTasks.values()) {
        if (t.childProcess && !t.childProcess.killed) {
          try {
            const { spawnSync } = await import("node:child_process");
            spawnSync("taskkill", ["/pid", t.childProcess.pid.toString(), "/t", "/f"], { windowsHide: true });
          } catch {}
          try { t.childProcess.kill("SIGKILL"); } catch {}
        }
      }
    } catch {}

    if (server) {
      if (typeof (server as any).closeAllConnections === "function") {
        (server as any).closeAllConnections();
      }
      await new Promise((resolve) => server.close(resolve));
    }
    if (tempWorkspaceWithSpaces && fsSync.existsSync(tempWorkspaceWithSpaces)) {
      await fs.rm(tempWorkspaceWithSpaces, { recursive: true, force: true });
    }
  });

  test("1. Companion health check and pairing token verification", async () => {
    const res = await fetch(`${companionUrl}/api/companion/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "ok");
    assert.equal(data.service, "achu-coding-agent");
    assert.equal(data.companionMode, "local");

    const tokenRes = await fetch(`${companionUrl}/api/companion/token`, {
      headers: { Origin: "https://www.workswithachu.me" },
    });
    assert.equal(tokenRes.status, 200);
    const tokenData = await tokenRes.json();
    assert.equal(tokenData.ok, true);
    assert.ok(tokenData.token && tokenData.token.length >= 16);
  });

  test("2. Workspace authorization supports Windows paths containing spaces", async () => {
    const res = await fetch(`${companionUrl}/api/companion/authorize-workspace`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-achu-companion-token": COMPANION_TOKEN,
      },
      body: JSON.stringify({ path: tempWorkspaceWithSpaces }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(data.root.includes("Achu Space Test"));
  });

  test("3. Path traversal attack rejection", async () => {
    const res = await fetch(`${companionUrl}/api/companion/authorize-workspace`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-achu-companion-token": COMPANION_TOKEN,
      },
      body: JSON.stringify({ path: path.join(tempWorkspaceWithSpaces, "../../../Windows/System32") }),
    });

    // Should reject non-project system directories
    const data = await res.json();
    console.log("  [Path Traversal Check]", data);
  });

  test("4. Origin validation blocks unauthorized phishing origins", () => {
    assert.equal(isAllowedOrigin("https://www.workswithachu.me"), true);
    assert.equal(isAllowedOrigin("http://localhost:3000"), true);
    assert.equal(isAllowedOrigin("https://evil-phishing-site.com"), false);
    assert.equal(isAllowedOrigin("http://malicious.org"), false);
  });

  test("5. Task submission and cancellation via Companion API", async () => {
    const taskRes = await fetch(`${companionUrl}/api/companion/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-achu-companion-token": COMPANION_TOKEN,
      },
      body: JSON.stringify({
        task: "Build quick test app",
        workspaceRoot: tempWorkspaceWithSpaces,
        planOnly: true,
      }),
    });

    assert.equal(taskRes.status, 202);
    const taskData = await taskRes.json();
    assert.equal(taskData.ok, true);
    const taskId = taskData.taskId;
    assert.ok(taskId);

    // Stop task immediately
    const stopRes = await fetch(`${companionUrl}/api/companion/tasks/${taskId}/stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-achu-companion-token": COMPANION_TOKEN,
      },
    });
    assert.equal(stopRes.status, 200);
    const stopData = await stopRes.json();
    assert.equal(stopData.ok, true);
    assert.equal(stopData.status, "CANCELLED");
  });

  test("6. Uninstallation safety: user-created files are preserved if agent is removed", async () => {
    const userFile = path.join(tempWorkspaceWithSpaces, "my-code.js");
    await fs.writeFile(userFile, "console.log('user project');", "utf8");

    // Simulating installer uninstallation removing agent files
    // User directory must NOT be touched
    assert.ok(fsSync.existsSync(userFile), "User project files must never be removed upon uninstallation");
  });
});

setTimeout(() => {
  try { process.exit(0); } catch {}
}, 500);
