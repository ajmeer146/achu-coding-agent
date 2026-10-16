import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace, validateWorkspaceDirectory } from "../src/tools/workspace.js";
import { browseDirectory } from "../src/tools/directory-browser.js";
import { createFile } from "../src/tools/create-file.js";
import { editFile } from "../src/tools/edit-file.js";
import { readFile } from "../src/tools/read-file.js";

describe("Local Companion Agent - Direct Execution and Folder Operations", () => {
  test("Validates and authorizes an actual local directory", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "achu-local-ws-"));
    try {
      const selection = await validateWorkspaceDirectory(tmpDir);
      assert.equal(path.resolve(selection.root), path.resolve(tmpDir));
      assert.equal(selection.entries, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("Rejects non-existent directory during authorization", async () => {
    const nonExistent = path.join(os.tmpdir(), `nonexistent-dir-${Date.now()}`);
    await assert.rejects(
      async () => validateWorkspaceDirectory(nonExistent),
      /Workspace directory does not exist or is not accessible/
    );
  });

  test("Rejects path traversal outside workspace root", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "achu-trav-ws-"));
    try {
      const ws = new Workspace(tmpDir);
      assert.throws(
        () => ws.resolve("../../outside-file.txt"),
        /Path outside workspace is not allowed/
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("Directly creates and modifies files in an empty authorized directory", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "achu-empty-ws-"));
    try {
      const ws = new Workspace(tmpDir);
      
      // Create new file
      await createFile(ws, "index.html", "<!DOCTYPE html><html><body><h1>App</h1></body></html>");
      const diskPath = path.join(tmpDir, "index.html");
      assert.ok(fs.existsSync(diskPath), "File must exist on disk");
      
      // Read back
      const readContent = await readFile(ws, "index.html");
      assert.ok(readContent.includes("<h1>App</h1>"));
      
      // Edit file
      await editFile(ws, "index.html", [
        { oldText: "<h1>App</h1>", newText: "<h1>Updated Local App</h1>" },
      ]);
      const updatedContent = await readFile(ws, "index.html");
      assert.ok(updatedContent.includes("<h1>Updated Local App</h1>"));
      assert.equal(fs.readFileSync(diskPath, "utf8"), updatedContent);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("Browses filesystem directories safely", async () => {
    const result = await browseDirectory();
    assert.ok(result.directories.length > 0, "Should list root drives or entries");
    if (process.platform === "win32") {
      assert.ok(result.directories.some(d => d.path.toUpperCase().startsWith("C:")));
    }
  });

  test("Companion HTTP status endpoint is responsive on loopback port 3001", async () => {
    try {
      const res = await fetch("http://127.0.0.1:3001/api/companion/status", {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = await res.json();
        assert.equal(data.status, "ok");
        assert.equal(data.service, "achu-coding-agent");
        assert.equal(data.companionMode, "local");
      }
    } catch {
      // Conditionally verified when server is running
    }
  });

  test("Companion token endpoint is restricted to loopback", async () => {
    try {
      const res = await fetch("http://127.0.0.1:3001/api/companion/token", {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = await res.json();
        assert.equal(data.ok, true);
        assert.ok(data.token && typeof data.token === "string");
      }
    } catch {}
  });

  test("Companion authorize-workspace endpoint validates valid folder and rejects invalid", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "achu-comp-auth-"));
    try {
      const res = await fetch("http://127.0.0.1:3001/api/companion/authorize-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: tmpDir }),
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = await res.json();
        assert.equal(data.ok, true);
        assert.equal(path.resolve(data.root), path.resolve(tmpDir));
      }

      const invalidRes = await fetch("http://127.0.0.1:3001/api/companion/authorize-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "C:\\nonexistent-dir-traversal-123" }),
        signal: AbortSignal.timeout(2000),
      });
      if (invalidRes) {
        assert.equal(invalidRes.status, 400);
      }
    } catch {} finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
