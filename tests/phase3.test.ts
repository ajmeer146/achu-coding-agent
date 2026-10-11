import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";

import {
  Workspace,
  isInsideRoot,
  validateWorkspaceDirectory,
} from "../src/tools/workspace.js";
import { buildFileTree } from "../src/tools/file-tree.js";
import { browseDirectory } from "../src/tools/directory-browser.js";
import { createFile } from "../src/tools/create-file.js";
import { editFile } from "../src/tools/edit-file.js";

async function makeTempDir(label: string): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `achu-${label}-`));
  return fsp.realpath(dir);
}

async function cleanup(...dirs: string[]) {
  for (const dir of dirs) {
    try {
      await fsp.rm(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

// 1. A valid, existing, accessible directory can be selected as a workspace.
test("selects a valid workspace directory", async () => {
  const dir = await makeTempDir("valid");
  try {
    const result = await validateWorkspaceDirectory(dir);
    assert.equal(path.resolve(result.root), path.resolve(dir));
    assert.equal(result.entries, 0);
  } finally {
    await cleanup(dir);
  }
});

// 2. An invalid / non-existent directory is rejected with an actionable error.
test("rejects a non-existent workspace directory", async () => {
  const missing = path.join(os.tmpdir(), `achu-missing-${Date.now()}-nope`);
  await assert.rejects(
    () => validateWorkspaceDirectory(missing),
    /does not exist or is not accessible/,
  );
});

// 3. A file (not a directory) is rejected.
test("rejects a file used as a workspace", async () => {
  const dir = await makeTempDir("file");
  const file = path.join(dir, "not-a-dir.txt");
  await fsp.writeFile(file, "hi");
  try {
    await assert.rejects(
      () => validateWorkspaceDirectory(file),
      /is not a directory/,
    );
  } finally {
    await cleanup(dir);
  }
});

// 4. Listing a real workspace returns its real files.
test("lists real files in the workspace", async () => {
  const dir = await makeTempDir("list");
  await fsp.writeFile(path.join(dir, "a.txt"), "a");
  await fsp.writeFile(path.join(dir, "b.txt"), "b");
  try {
    const ws = new Workspace(dir);
    const entries = await ws.list(".");
    assert.deepEqual(entries.sort(), ["a.txt", "b.txt"]);
  } finally {
    await cleanup(dir);
  }
});

// 5. Reading a real file returns its real contents.
test("reads a real file's contents", async () => {
  const dir = await makeTempDir("read");
  await fsp.writeFile(path.join(dir, "readme.md"), "# Hello\n");
  try {
    const ws = new Workspace(dir);
    assert.equal(await ws.read("readme.md"), "# Hello\n");
  } finally {
    await cleanup(dir);
  }
});

// 6. Creating a file persists it on disk.
test("creates a file that persists on disk", async () => {
  const dir = await makeTempDir("create");
  try {
    const ws = new Workspace(dir);
    await createFile(ws, "src/new.txt", "created");
    const onDisk = await fsp.readFile(path.join(dir, "src", "new.txt"), "utf8");
    assert.equal(onDisk, "created");
  } finally {
    await cleanup(dir);
  }
});

// 7. Editing a file persists the change on disk.
test("edits a file and persists the change", async () => {
  const dir = await makeTempDir("edit");
  await fsp.writeFile(path.join(dir, "app.ts"), "const x = 1;\n");
  try {
    const ws = new Workspace(dir);
    await editFile(ws, "app.ts", "const x = 1;", "const x = 2;");
    const onDisk = await fsp.readFile(path.join(dir, "app.ts"), "utf8");
    assert.equal(onDisk, "const x = 2;\n");
  } finally {
    await cleanup(dir);
  }
});

// 8. Switching workspaces uses the new directory independently of the old one.
test("switches workspaces without leaking state", async () => {
  const first = await makeTempDir("first");
  const second = await makeTempDir("second");
  await fsp.writeFile(path.join(first, "only-first.txt"), "1");
  await fsp.writeFile(path.join(second, "only-second.txt"), "2");
  try {
    const a = new Workspace(first);
    assert.deepEqual(await a.list("."), ["only-first.txt"]);

    const b = new Workspace(second);
    assert.deepEqual(await b.list("."), ["only-second.txt"]);
  } finally {
    await cleanup(first, second);
  }
});

// 9. Paths that escape the workspace via `..` are rejected.
test("rejects traversal via parent directory", async () => {
  const dir = await makeTempDir("escape");
  const outside = path.join(dir, "..", `achu-outside-${Date.now()}.txt`);
  try {
    const ws = new Workspace(dir);
    assert.throws(
      () => ws.resolve("..\\outside.txt"),
      /outside workspace is not allowed/,
    );
    await assert.rejects(() => ws.write("..\\outside.txt", "nope"));
    const exists = await fsp
      .access(outside)
      .then(() => true)
      .catch(() => false);
    assert.equal(exists, false);
  } finally {
    await cleanup(dir);
  }
});

// 10. Absolute paths outside the workspace are rejected.
test("rejects absolute paths outside the workspace", async () => {
  const dir = await makeTempDir("abs");
  const outside = path.join(os.tmpdir(), "achu-absolute-outside.txt");
  try {
    const ws = new Workspace(dir);
    assert.throws(
      () => ws.resolve(outside),
      /Path outside workspace is not allowed/,
    );
  } finally {
    await cleanup(dir);
  }
});

// 11. isInsideRoot handles boundaries correctly.
test("isInsideRoot only accepts children of the root", async () => {
  const root = path.resolve("C:\\ws\\project");
  assert.equal(isInsideRoot(root, path.join(root, "src", "a.ts")), true);
  assert.equal(isInsideRoot(root, process.platform === "win32" ? "c:\\workspace\\x" : "/workspace/x"), false);
  assert.equal(isInsideRoot(root, path.join(root, "..", "sibling")), false);
});

// 12. The file tree reflects real, bounded workspace structure.
test("builds a file tree matching real files", async () => {
  const dir = await makeTempDir("tree");
  await fsp.mkdir(path.join(dir, "src"), { recursive: true });
  await fsp.writeFile(path.join(dir, "src", "index.ts"), "export {};\n");
  await fsp.writeFile(path.join(dir, "README.md"), "# x\n");
  await fsp.mkdir(path.join(dir, "node_modules", "ignored"), { recursive: true });
  try {
    const ws = new Workspace(dir);
    const tree = await buildFileTree(ws);
    const names = tree.map((n) => n.name).sort();
    assert.deepEqual(names, ["README.md", "src"]);
    const src = tree.find((n) => n.name === "src");
    assert.equal(src?.type, "directory");
    assert.equal(src?.children?.[0].name, "index.ts");
    assert.ok(!tree.some((n) => n.name === "node_modules"));
  } finally {
    await cleanup(dir);
  }
});

// 13. A file tree refresh after an edit reflects the new file.
test("file tree refresh reflects newly created files", async () => {
  const dir = await makeTempDir("refresh");
  try {
    const ws = new Workspace(dir);
    const before = await buildFileTree(ws);
    assert.deepEqual(before, []);

    await createFile(ws, "added.txt", "x");
    const after = await buildFileTree(ws);
    assert.deepEqual(after.map((n) => n.name), ["added.txt"]);
  } finally {
    await cleanup(dir);
  }
});

// 14. The folder browser lists real subdirectories but not files.
test("browses real directories without exposing files", async () => {
  const dir = await makeTempDir("browse");
  await fsp.mkdir(path.join(dir, "sub"), { recursive: true });
  await fsp.writeFile(path.join(dir, "file.txt"), "x");
  try {
    const result = await browseDirectory(dir);
    assert.equal(result.path, dir);
    assert.deepEqual(result.directories.map((d) => d.name), ["sub"]);
  } finally {
    await cleanup(dir);
  }
});

// 15. Browsing a non-existent directory surfaces an error (no silent fallback).
test("folder browser reports errors instead of falling back", async () => {
  const missing = path.join(os.tmpdir(), `achu-browse-missing-${Date.now()}`);
  await assert.rejects(
    () => browseDirectory(missing),
    /does not exist or is not accessible/,
  );
});

// 16. create_file refuses to overwrite; edit_file requires exactly one match.
test("file operations fail loudly instead of corrupting files", async () => {
  const dir = await makeTempDir("guard");
  await fsp.writeFile(path.join(dir, "dup.txt"), "same same");
  try {
    const ws = new Workspace(dir);
    await assert.rejects(() => createFile(ws, "dup.txt", "new"), /already exists/);
    await assert.rejects(
      () => editFile(ws, "dup.txt", "same", "other"),
      /exactly one match/,
    );
    await assert.rejects(
      () => editFile(ws, "dup.txt", "not-present", "x"),
      /was not found/,
    );
    // Original file must be untouched after failed operations.
    assert.equal(await fsp.readFile(path.join(dir, "dup.txt"), "utf8"), "same same");
  } finally {
    await cleanup(dir);
  }
});

// 17. isInsideRoot allows the root itself but not siblings.
test("isInsideRoot allows the root itself but not siblings", () => {
  const root = path.resolve(os.tmpdir(), "achu-root-check");
  assert.equal(isInsideRoot(root, root), true);
  assert.equal(isInsideRoot(root, path.join(root, "child", "deep")), true);
  assert.equal(isInsideRoot(root, path.resolve(root, "..")), false);
});
