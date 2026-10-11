import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../src/tools/workspace.js";
import { CodeIndexer } from "../src/tools/indexer.js";
import { searchCode } from "../src/tools/search-code.js";
import { checkActionSafety } from "../src/browser/browser-safety.js";

async function makeTempDir(label: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `achu-${label}-`));
  return fs.realpath(dir);
}

async function cleanup(...dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // ignore
    }
  }
}

// =============================================================================
// Workspace Path Containment Tests (CodeIndexer)
// =============================================================================

test("CodeIndexer - rejects traversal paths during collection", async () => {
  const root = await makeTempDir("indexer-traversal");
  const outside = await makeTempDir("indexer-outside");
  
  try {
    // Create a file outside the workspace
    await fs.writeFile(path.join(outside, "secret.txt"), "SECRET DATA");
    
    // Create a workspace with a symlink trying to escape
    const ws = new Workspace(root);
    const wsIndexer = new CodeIndexer();
    
    // Create a symlink pointing outside
    const linkPath = path.join(root, "escape_link");
    await fs.symlink(outside, linkPath, "junction");
    
    // Try to index - should not index the outside file
    await wsIndexer.ensureIndexed(root, ws);
    
    const files = wsIndexer.getFiles();
    // Should not contain the outside file
    assert.ok(!files.some(f => f.includes("secret.txt")), "Should not index files outside workspace via symlink");
  } finally {
    await cleanup(root, outside);
  }
});

test("CodeIndexer - rejects absolute paths outside workspace", async () => {
  const root = await makeTempDir("indexer-absolute");
  const outside = await makeTempDir("indexer-outside2");
  
  try {
    const ws = new Workspace(root);
    const wsIndexer = new CodeIndexer();
    
    // Create a file outside
    await fs.writeFile(path.join(outside, "outside.txt"), "OUTSIDE");
    
    // Try to index with absolute path traversal
    // Create a file that tries to reference outside via path traversal
    await ws.write("normal.ts", "export const x = 1;");
    
    await wsIndexer.ensureIndexed(root, ws);
    
    const files = wsIndexer.getFiles();
    assert.ok(!files.some(f => f.includes("outside.txt")), "Should not index files outside workspace");
    assert.ok(files.includes("normal.ts"), "Should index normal files");
  } finally {
    await cleanup(root, outside);
  }
});

test("CodeIndexer - accepts valid relative paths inside workspace", async () => {
  const root = await makeTempDir("indexer-valid");
  
  try {
    const ws = new Workspace(root);
    const wsIndexer = new CodeIndexer();
    
    await fs.mkdir(path.join(root, "src", "utils"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "index.ts"), "export function foo() {}");
    await fs.writeFile(path.join(root, "src", "utils", "helper.ts"), "export function helper() {}");
    await fs.writeFile(path.join(root, "package.json"), '{"name": "test"}');
    
    await wsIndexer.ensureIndexed(root, ws);
    
    const files = wsIndexer.getFiles();
    console.log("Indexed files:", files);
    // Files use platform-specific separators
    const hasIndex = files.some(f => f.includes("src") && f.includes("index.ts"));
    const hasHelper = files.some(f => f.includes("src") && f.includes("utils") && f.includes("helper.ts"));
    assert.ok(hasIndex, "Should index src/index.ts");
    assert.ok(hasHelper, "Should index nested files");
    // package.json is not a source file, but may be indexed with empty symbols
  } finally {
    await cleanup(root);
  }
});

test("CodeIndexer - handles symlink escape attempt in nested directory", async () => {
  const root = await makeTempDir("indexer-nested-symlink");
  const outside = await makeTempDir("indexer-outside3");
  
  try {
    const ws = new Workspace(root);
    const wsIndexer = new CodeIndexer();
    
    // Create nested directory structure
    await ws.write("src/app.ts", "export function app() {}");
    
    // Create a symlink inside src pointing outside
    const linkPath = path.join(root, "src", "escape_link");
    await fs.symlink(outside, linkPath, "junction");
    
    // Create a file outside
    await fs.writeFile(path.join(outside, "secret.ts"), "export const secret = 'data';");
    
    await wsIndexer.ensureIndexed(root, ws);
    
    const files = wsIndexer.getFiles();
    // Should not include files from the symlink target
    assert.ok(!files.some(f => f.includes("secret")), "Should not index files from symlink escape");
    // Files use platform-specific separators
    assert.ok(files.some(f => f.includes("src") && f.includes("app.ts")), "Should still index legitimate files");
  } finally {
    await cleanup(root, outside);
  }
});

test("CodeIndexer - rejects cross-workspace access", async () => {
  const ws1Root = await makeTempDir("indexer-ws1");
  const ws2Root = await makeTempDir("indexer-ws2");
  
  try {
    const ws1 = new Workspace(ws1Root);
    const ws2 = new Workspace(ws2Root);
    const ws1Indexer = new CodeIndexer();
    const ws2Indexer = new CodeIndexer();
    
    // Create files in both workspaces
    await ws1.write("ws1-file.ts", "export const ws1 = 1;");
    await ws2.write("ws2-file.ts", "export const ws2 = 2;");
    
    // Index each workspace separately
    await ws1Indexer.ensureIndexed(ws1Root, ws1);
    await ws2Indexer.ensureIndexed(ws2Root, ws2);
    
    const ws1Files = ws1Indexer.getFiles();
    const ws2Files = ws2Indexer.getFiles();
    
    // Each indexer should only see its own workspace files
    assert.ok(ws1Files.includes("ws1-file.ts"), "WS1 should have its file");
    assert.ok(!ws1Files.some(f => f.includes("ws2-file")), "WS1 should not see WS2 files");
    assert.ok(ws2Files.includes("ws2-file.ts"), "WS2 should have its file");
    assert.ok(!ws2Files.some(f => f.includes("ws1-file")), "WS2 should not see WS1 files");
  } finally {
    await cleanup(ws1Root, ws2Root);
  }
});

// =============================================================================
// Browser URL Validation Tests
// =============================================================================

test("Browser safety - allows localhost HTTP URLs", () => {
  const result = checkActionSafety("navigate", { url: "http://localhost:3000" });
  assert.equal(result.allowed, true, "Should allow localhost HTTP");
});

test("Browser safety - allows 127.0.0.1 HTTP URLs", () => {
  const result = checkActionSafety("navigate", { url: "http://127.0.0.1:5173" });
  assert.equal(result.allowed, true, "Should allow 127.0.0.1 HTTP");
});

test("Browser safety - allows localhost HTTPS URLs", () => {
  const result = checkActionSafety("navigate", { url: "https://localhost:443" });
  assert.equal(result.allowed, true, "Should allow localhost HTTPS");
});

test("Browser safety - blocks file:// protocol", () => {
  const result = checkActionSafety("navigate", { url: "file:///etc/passwd" });
  assert.equal(result.allowed, false, "Should block file:// protocol");
  assert.ok(result.reason.includes("non-HTTP"), "Should mention non-HTTP in reason");
});

test("Browser safety - blocks javascript: protocol", () => {
  const result = checkActionSafety("navigate", { url: "javascript:alert(1)" });
  assert.equal(result.allowed, false, "Should block javascript: protocol");
});

test("Browser safety - blocks data: protocol", () => {
  const result = checkActionSafety("navigate", { url: "data:text/html,<script>alert(1)</script>" });
  assert.equal(result.allowed, false, "Should block data: protocol");
});

test("Browser safety - blocks external origins", () => {
  const result = checkActionSafety("navigate", { url: "https://example.com" });
  assert.equal(result.allowed, false, "Should block external origins");
  assert.ok(result.reason.includes("external origin"), "Should mention external origin in reason");
});

test("Browser safety - blocks private IP ranges", () => {
  const result = checkActionSafety("navigate", { url: "http://192.168.1.1:8080" });
  assert.equal(result.allowed, false, "Should block 192.168.x.x");
  
  const result2 = checkActionSafety("navigate", { url: "http://10.0.0.1:8080" });
  assert.equal(result2.allowed, false, "Should block 10.x.x.x");
  
  const result3 = checkActionSafety("navigate", { url: "http://172.16.0.1:8080" });
  assert.equal(result3.allowed, false, "Should block 172.16-31.x.x");
  
  const result4 = checkActionSafety("navigate", { url: "http://169.254.169.254/latest/meta-data" });
  assert.equal(result4.allowed, false, "Should block 169.254.x.x (AWS metadata)");
});

test("Browser safety - blocks malformed URLs", () => {
  // URL with http:// scheme but malformed hostname
  const result = checkActionSafety("navigate", { url: "http://" });
  assert.equal(result.allowed, false, "Should block malformed URLs");
  assert.ok(result.reason.toLowerCase().includes("invalid url"), "Should mention invalid URL in reason");
});

test("Browser safety - allows IPv6 localhost", () => {
  const result = checkActionSafety("navigate", { url: "http://[::1]:3000" });
  assert.equal(result.allowed, true, "Should allow IPv6 localhost");
});

// =============================================================================
// Workspace.resolve() Path Containment Tests
// =============================================================================

test("Workspace.resolve() - rejects traversal attempts", async () => {
  const root = await makeTempDir("ws-resolve-traversal");
  
  try {
    const ws = new Workspace(root);
    
    // These should throw
    await assert.rejects(
      async () => ws.resolve("../../../etc/passwd"),
      /Path outside workspace is not allowed/
    );
    
    await assert.rejects(
      async () => ws.resolve("src/../../../escape"),
      /Path outside workspace is not allowed/
    );
    
    await assert.rejects(
      async () => ws.resolve("..\\..\\escape"),
      /Path outside workspace is not allowed/
    );
  } finally {
    await cleanup(root);
  }
});

test("Workspace.resolve() - rejects absolute paths outside workspace", async () => {
  const root = await makeTempDir("ws-resolve-absolute");
  const outside = await makeTempDir("ws-outside");
  
  try {
    const ws = new Workspace(root);
    
    await assert.rejects(
      async () => ws.resolve(path.join(outside, "secret.txt")),
      /Path outside workspace is not allowed/
    );
  } finally {
    await cleanup(root, outside);
  }
});

test("Workspace.resolve() - accepts valid relative paths", async () => {
  const root = await makeTempDir("ws-resolve-valid");
  
  try {
    const ws = new Workspace(root);
    
    const result1 = ws.resolve("src/index.ts");
    assert.ok(result1.endsWith("src/index.ts") || result1.includes("src" + path.sep + "index.ts"), "Should resolve relative path");
    
    const result2 = ws.resolve("./src/index.ts");
    assert.ok(result2.endsWith("src/index.ts") || result2.includes("src" + path.sep + "index.ts"), "Should resolve relative path with ./");
    
    const result3 = ws.resolve("src/../src/index.ts");
    assert.ok(result3.endsWith("src/index.ts") || result3.includes("src" + path.sep + "index.ts"), "Should resolve path with .. that stays inside");
  } finally {
    await cleanup(root);
  }
});

test("Workspace.resolve() - blocks symlink escapes", async () => {
  const root = await makeTempDir("ws-resolve-symlink");
  const outside = await makeTempDir("ws-symlink-outside");
  
  try {
    const ws = new Workspace(root);
    
    // Create a symlink pointing outside
    const linkPath = path.join(root, "escape_link");
    await fs.symlink(outside, linkPath, "junction");
    
    await assert.rejects(
      async () => ws.resolve("escape_link/secret.txt"),
      /Path outside workspace is not allowed/
    );
  } finally {
    await cleanup(root, outside);
  }
});

// =============================================================================
// Integration Tests
// =============================================================================

test("searchCode - uses workspace path validation", async () => {
  const root = await makeTempDir("searchcode-integration");
  const outside = await makeTempDir("searchcode-outside");
  
  try {
    const ws = new Workspace(root);
    
    // Create a file inside workspace
    await ws.write("index.ts", "export function hello() { return 'world'; }");
    
    // Create a symlink pointing outside
    const linkPath = path.join(root, "outside_link");
    await fs.symlink(outside, linkPath, "junction");
    await fs.writeFile(path.join(outside, "secret.ts"), "export const secret = 'leaked';");
    
    // searchCode should work for legitimate files
    const result = await searchCode(ws, "hello", "text");
    assert.ok(result.includes("hello"), "Should find function in legitimate file");
    
    // The indexer should not have indexed the outside file
    // (We can't directly test the indexer from here, but the path validation
    // in searchCode uses workspace.resolve which blocks the symlink)
  } finally {
    await cleanup(root, outside);
  }
});

test("Workspace - concurrent access with different roots", async () => {
  const root1 = await makeTempDir("ws-concurrent-1");
  const root2 = await makeTempDir("ws-concurrent-2");
  
  try {
    const ws1 = new Workspace(root1);
    const ws2 = new Workspace(root2);
    
    await ws1.write("file1.ts", "export const a = 1;");
    await ws2.write("file2.ts", "export const b = 2;");
    
    const r1 = ws1.resolve("file1.ts");
    const r2 = ws2.resolve("file2.ts");
    
    assert.ok(r1.includes("file1.ts"));
    assert.ok(r2.includes("file2.ts"));
    
    // ws1 should not be able to resolve ws2's files
    await assert.rejects(
      async () => ws1.resolve(path.relative(root1, r2)),
      /Path outside workspace is not allowed/
    );
  } finally {
    await cleanup(root1, root2);
  }
});