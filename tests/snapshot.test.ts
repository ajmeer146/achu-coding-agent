import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SnapshotManager } from "../src/tools/snapshot.js";

async function makeTempDir(label: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `achu-${label}-`));
  return fs.realpath(dir);
}

test("SnapshotManager handles file creation, modification, and rollback", async () => {
  const wsDir = await makeTempDir("snapshot-test");
  const taskId = "task-123";
  const manager = new SnapshotManager(wsDir, taskId);
  await manager.init();

  // 1. Existing file modification
  const existingFile = path.join(wsDir, "existing.txt");
  await fs.writeFile(existingFile, "original content");
  
  await manager.captureBefore("existing.txt", "edit");
  await fs.writeFile(existingFile, "modified content");
  await manager.captureAfter("existing.txt");

  // 2. New file creation
  const newFile = path.join(wsDir, "new.txt");
  await manager.captureBefore("new.txt", "create");
  await fs.writeFile(newFile, "new content");
  await manager.captureAfter("new.txt");

  // Verify current state
  assert.equal(await fs.readFile(existingFile, "utf8"), "modified content");
  assert.equal(await fs.readFile(newFile, "utf8"), "new content");

  // Rollback
  const result = await manager.rollback();
  assert.ok(result.success, "Rollback should succeed");
  assert.deepEqual(result.restored.sort(), ["existing.txt", "new.txt"].sort());

  // Verify restored state
  assert.equal(await fs.readFile(existingFile, "utf8"), "original content");
  await assert.rejects(fs.access(newFile), /ENOENT/, "new.txt should be deleted");

  await manager.cleanup();
  await fs.rm(wsDir, { recursive: true, force: true });
});

test("SnapshotManager preserves user changes made after checkpoint", async () => {
  const wsDir = await makeTempDir("snapshot-user");
  const taskId = "task-123";
  const manager = new SnapshotManager(wsDir, taskId);
  await manager.init();

  const file = path.join(wsDir, "file.txt");
  await fs.writeFile(file, "original content");

  await manager.captureBefore("file.txt", "edit");
  await fs.writeFile(file, "agent content");
  await manager.captureAfter("file.txt");

  // User manually edits the file AFTER the agent
  await fs.writeFile(file, "user content");

  const result = await manager.rollback();
  assert.ok(!result.success, "Rollback should report conflicts");
  assert.deepEqual(result.conflicts, ["file.txt"]);
  assert.deepEqual(result.restored, []);

  // Verify user content is preserved
  assert.equal(await fs.readFile(file, "utf8"), "user content");

  await manager.cleanup();
  await fs.rm(wsDir, { recursive: true, force: true });
});

test("SnapshotManager prevents path traversal", async () => {
  const wsDir = await makeTempDir("snapshot-path");
  const taskId = "task-123";
  const manager = new SnapshotManager(wsDir, taskId);
  await manager.init();

  await assert.rejects(
    manager.captureBefore("../outside.txt", "edit"),
    /Path traversal attempt detected/,
    "Should block path traversal"
  );

  await manager.cleanup();
  await fs.rm(wsDir, { recursive: true, force: true });
});

test("SnapshotManager handles missing files and deletion", async () => {
  const wsDir = await makeTempDir("snapshot-delete");
  const taskId = "task-123";
  const manager = new SnapshotManager(wsDir, taskId);
  await manager.init();

  const file = path.join(wsDir, "delete_me.txt");
  await fs.writeFile(file, "content to delete");

  await manager.captureBefore("delete_me.txt", "delete");
  await fs.unlink(file);
  await manager.captureAfter("delete_me.txt");

  const result = await manager.rollback();
  assert.ok(result.success, "Rollback should succeed");
  assert.equal(await fs.readFile(file, "utf8"), "content to delete");

  await manager.cleanup();
  await fs.rm(wsDir, { recursive: true, force: true });
});
