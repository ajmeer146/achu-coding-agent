import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../src/tools/workspace.js";
import { editFile } from "../src/tools/edit-file.js";

async function makeTempDir(label: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `achu-${label}-`));
  return fs.realpath(dir);
}

test("editFile supports exact text edits", async () => {
  const dir = await makeTempDir("edit-exact");
  const ws = new Workspace(dir);
  
  await ws.write("test.txt", "line1\nline2\nline3\n");
  
  await editFile(ws, "test.txt", [{ oldText: "line2", newText: "line2_changed" }]);
  
  const content = await ws.read("test.txt");
  assert.equal(content, "line1\nline2_changed\nline3\n");
  
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("editFile explicitly validates missing match targets", async () => {
  const dir = await makeTempDir("edit-missing");
  const ws = new Workspace(dir);
  
  await ws.write("test.txt", "line1\nline2\nline3\n");
  
  await assert.rejects(
    editFile(ws, "test.txt", [{ oldText: "line4", newText: "line4_changed" }]),
    /The expected text was not found/,
    "Should reject missing match"
  );
  
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("editFile explicitly validates ambiguous match targets", async () => {
  const dir = await makeTempDir("edit-ambiguous");
  const ws = new Workspace(dir);
  
  await ws.write("test.txt", "line1\ndupe\nline3\ndupe\n");
  
  await assert.rejects(
    editFile(ws, "test.txt", [{ oldText: "dupe", newText: "unique" }]),
    /Expected exactly one match.*but found 2/,
    "Should reject ambiguous match"
  );
  
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("editFile supports multiple independent edits", async () => {
  const dir = await makeTempDir("edit-multiple");
  const ws = new Workspace(dir);
  
  await ws.write("test.txt", "const a = 1;\nconst b = 2;\nconst c = 3;\n");
  
  const result = await editFile(ws, "test.txt", [
    { oldText: "const a = 1;", newText: "const a = 10;" },
    { oldText: "const c = 3;", newText: "const c = 30;" }
  ]);
  
  assert.ok(result.includes("Successfully applied 2 edits"));
  
  const content = await ws.read("test.txt");
  assert.equal(content, "const a = 10;\nconst b = 2;\nconst c = 30;\n");
  
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("editFile fails atomically if one patch is invalid", async () => {
  const dir = await makeTempDir("edit-atomic");
  const ws = new Workspace(dir);
  
  const originalContent = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
  await ws.write("test.txt", originalContent);
  
  await assert.rejects(
    editFile(ws, "test.txt", [
      { oldText: "const a = 1;", newText: "const a = 10;" },
      { oldText: "const z = 99;", newText: "does not exist" }
    ]),
    /The expected text was not found/,
    "Should reject if any patch is invalid"
  );
  
  const content = await ws.read("test.txt");
  assert.equal(content, originalContent, "File should not be partially modified");
  
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("editFile normalizes line endings", async () => {
  const dir = await makeTempDir("edit-crlf");
  const ws = new Workspace(dir);
  
  await ws.write("test.txt", "line1\r\nline2\r\nline3\r\n");
  
  // Provide LF edit against CRLF file
  await editFile(ws, "test.txt", [{ oldText: "line1\nline2", newText: "line1_mod\nline2_mod" }]);
  
  const content = await ws.read("test.txt");
  // Should preserve original CRLF encoding
  assert.equal(content, "line1_mod\r\nline2_mod\r\nline3\r\n");
  
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
