import { test } from "node:test";
import assert from "node:assert/strict";

test("getWorkspaceRoot works with Workspace instance", async () => {
  const { Workspace } = await import("../src/tools/workspace.js");
  const { getWorkspaceRoot } = await import("../src/trigger/agent-task.js");
  
  const ws = new Workspace("/tmp/test-workspace");
  const root = getWorkspaceRoot(ws);
  assert.equal(typeof root, "string");
  assert.ok(root.length > 0);
});

test("getWorkspaceRoot works with GitWorkspace instance", async () => {
  const { GitWorkspace } = await import("../src/tools/git-workspace.js");
  const { getWorkspaceRoot } = await import("../src/trigger/agent-task.js");
  
  // GitWorkspace requires init() which does git clone, so we test the method exists
  // and the fallback path works by creating an instance without init
  const gw = new GitWorkspace("https://github.com/test/test.git", { tempDir: "/tmp/test-git-workspace" });
  // getRoot should be a function
  assert.equal(typeof gw.getRoot, "function");
  const root = getWorkspaceRoot(gw);
  assert.equal(typeof root, "string");
  assert.equal(root, "/tmp/test-git-workspace");
});

test("getWorkspaceRoot fallback works when getRoot is missing", async () => {
  const { getWorkspaceRoot } = await import("../src/trigger/agent-task.js");
  
  // Create a mock object that has root property but no getRoot method
  const mockWorkspace = { root: "/mock/path" };
  const root = getWorkspaceRoot(mockWorkspace as any);
  assert.equal(root, "/mock/path");
});

test("Workspace.resolve and GitWorkspace.resolve de-duplicate paths prefixed with full workspace root missing a leading slash", async () => {
  const { Workspace } = await import("../src/tools/workspace.js");
  const path = await import("node:path");
  const os = await import("node:os");
  const fs = await import("node:fs/promises");
  
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-ws-dedup-"));
  const ws = new Workspace(rootDir);
  
  const rootNoDrive = rootDir.replace(/^[a-zA-Z]:/, "").replace(/\\/g, "/").replace(/^[\\/]+/, "");
  const testRelPath = `${rootNoDrive}/index.html`;
  
  const resolved = ws.resolve(testRelPath);
  assert.equal(resolved, path.resolve(ws.root, "index.html"));
  assert.ok(!resolved.includes(path.join(path.basename(rootDir), rootNoDrive)), "Must not duplicate workspace path segments");

  const { GitWorkspace } = await import("../src/tools/git-workspace.js");
  const gw = new GitWorkspace("https://github.com/test/test.git", { tempDir: rootDir });
  const resolvedGw = gw.resolve(testRelPath);
  assert.equal(resolvedGw, path.resolve(rootDir, "index.html"));

  await fs.rm(rootDir, { recursive: true, force: true });
});