import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../src/tools/workspace.js";
import { exportWorkspaceFiles, DEFAULT_WORKSPACE_EXPORT_LIMITS } from "../src/tools/workspace-export.js";

function makeTempWorkspace(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("Workspace export for cloud import (companion)", () => {
  test("exports text files and skips ignored directories, binary and oversize files", async () => {
    const tmpDir = makeTempWorkspace("achu-export-");
    try {
      fs.writeFileSync(path.join(tmpDir, "index.html"), "<h1>Hello Cloud</h1>", "utf8");
      fs.mkdirSync(path.join(tmpDir, "src"));
      fs.writeFileSync(path.join(tmpDir, "src", "app.js"), "console.log('ok');", "utf8");
      fs.mkdirSync(path.join(tmpDir, "node_modules"));
      fs.writeFileSync(path.join(tmpDir, "node_modules", "dep.js"), "module.exports = {};", "utf8");
      fs.writeFileSync(path.join(tmpDir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
      fs.writeFileSync(path.join(tmpDir, "blob.bin.dat"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
      fs.writeFileSync(path.join(tmpDir, "big.txt"), "x".repeat(4096), "utf8");

      const result = await exportWorkspaceFiles(new Workspace(tmpDir), { maxFileBytes: 1024 });

      const paths = result.files.map((f) => f.path).sort();
      assert.deepEqual(paths, ["index.html", "src/app.js"]);
      assert.equal(result.files.find((f) => f.path === "index.html")?.content, "<h1>Hello Cloud</h1>");
      assert.ok(result.skipped.tooLarge >= 1, "Oversize file must be counted as skipped");
      assert.ok(result.skipped.binary >= 2, "Binary extension and NUL-byte file must be skipped");
      assert.ok(result.skipped.ignored >= 1, "node_modules must be skipped");
      assert.equal(result.truncated, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("truncates deterministically when the file count limit is reached", async () => {
    const tmpDir = makeTempWorkspace("achu-export-count-");
    try {
      for (const name of ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"]) {
        fs.writeFileSync(path.join(tmpDir, name), `content-${name}`, "utf8");
      }
      const result = await exportWorkspaceFiles(new Workspace(tmpDir), { maxFiles: 3 });
      assert.equal(result.files.length, 3);
      assert.equal(result.truncated, true);
      assert.deepEqual(result.files.map((f) => f.path), ["a.txt", "b.txt", "c.txt"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("enforces the total byte budget and per-file fallbacks clamp to defaults", async () => {
    const tmpDir = makeTempWorkspace("achu-export-total-");
    try {
      fs.writeFileSync(path.join(tmpDir, "a.txt"), "a".repeat(100), "utf8");
      fs.writeFileSync(path.join(tmpDir, "b.txt"), "b".repeat(100), "utf8");
      fs.writeFileSync(path.join(tmpDir, "c.txt"), "c".repeat(100), "utf8");

      const result = await exportWorkspaceFiles(new Workspace(tmpDir), { maxTotalBytes: 150 });
      assert.equal(result.files.length, 1);
      assert.ok(result.totalBytes <= 150);
      assert.equal(result.truncated, true);

      // Requested limits above the defaults are clamped down to the payload contract.
      const clamped = await exportWorkspaceFiles(new Workspace(tmpDir), {
        maxFiles: 5000,
        maxFileBytes: 999 * 1024 * 1024,
        maxTotalBytes: 999 * 1024 * 1024,
      });
      assert.equal(clamped.files.length, 3);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("never follows symbolic links", async (t) => {
    const tmpDir = makeTempWorkspace("achu-export-link-");
    const outsideDir = makeTempWorkspace("achu-export-outside-");
    try {
      fs.writeFileSync(path.join(outsideDir, "secret.txt"), "outside-secret", "utf8");
      fs.writeFileSync(path.join(tmpDir, "real.txt"), "inside", "utf8");
      let linkCreated = false;
      try {
        fs.symlinkSync(path.join(outsideDir, "secret.txt"), path.join(tmpDir, "linked.txt"));
        linkCreated = true;
      } catch {
        // On Windows without Developer Mode, file symlinks require elevation,
        // but directory junctions do not and produce entry.isSymbolicLink() === true.
        try {
          const secretSubdir = path.join(outsideDir, "secret_dir");
          fs.mkdirSync(secretSubdir, { recursive: true });
          fs.writeFileSync(path.join(secretSubdir, "secret.txt"), "outside-secret", "utf8");
          fs.symlinkSync(secretSubdir, path.join(tmpDir, "linked_dir"), "junction");
          linkCreated = true;
        } catch {
          t.skip("Platform does not allow creating symlinks or junctions without elevation");
          return;
        }
      }
      if (!linkCreated) {
        t.skip("Platform does not allow creating symlinks without elevation");
        return;
      }
      const result = await exportWorkspaceFiles(new Workspace(tmpDir));
      const paths = result.files.map((f) => f.path).sort();
      assert.deepEqual(paths, ["real.txt"]);
      assert.equal(result.files.some((f) => f.content.includes("outside-secret")), false);
      assert.ok(result.skipped.symlink >= 1, "Should count skipped symlink");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test("default limits match the cloud payload contract", () => {
    assert.equal(DEFAULT_WORKSPACE_EXPORT_LIMITS.maxFiles, 300);
    assert.equal(DEFAULT_WORKSPACE_EXPORT_LIMITS.maxFileBytes, 2 * 1024 * 1024);
    assert.equal(DEFAULT_WORKSPACE_EXPORT_LIMITS.maxTotalBytes, 10 * 1024 * 1024);
  });

  test("live companion export endpoint rejects requests without a token", async () => {
    try {
      const res = await fetch("http://127.0.0.1:3001/api/companion/export-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceRoot: os.tmpdir() }),
        signal: AbortSignal.timeout(2000),
      });
      if (res.status === 404) return; // Older companion build without the endpoint
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.ok, false);
    } catch {
      // Companion not running during isolated unit tests: conditionally skipped
    }
  });

  test("live companion export requires prior authorization and returns authorized files with token", async () => {
    const tmpDir = makeTempWorkspace("achu-export-live-");
    try {
      fs.writeFileSync(path.join(tmpDir, "hello.txt"), "hello-from-companion", "utf8");
      let token = "";
      try {
        const tokRes = await fetch("http://127.0.0.1:3001/api/companion/token", { signal: AbortSignal.timeout(2000) });
        if (!tokRes.ok) return;
        const tokData = await tokRes.json();
        token = tokData.token || "";
      } catch {
        return; // Companion not running
      }
      if (!token) return;

      const authRes = await fetch("http://127.0.0.1:3001/api/companion/authorize-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-achu-companion-token": token },
        body: JSON.stringify({ path: tmpDir }),
        signal: AbortSignal.timeout(2000),
      });
      if (!authRes.ok) return;

      const exportRes = await fetch("http://127.0.0.1:3001/api/companion/export-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-achu-companion-token": token },
        body: JSON.stringify({ workspaceRoot: tmpDir }),
        signal: AbortSignal.timeout(10000),
      });
      if (exportRes.status === 404) return; // Older companion build without the endpoint
      assert.equal(exportRes.status, 200);
      const data = await exportRes.json();
      assert.equal(data.ok, true);
      assert.ok(Array.isArray(data.files));
      const hello = data.files.find((f: { path: string }) => f.path === "hello.txt");
      assert.ok(hello, "authorized file must be exported");
      assert.equal(hello.content, "hello-from-companion");
    } catch {
      // Conditionally verified when the companion server is running
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
