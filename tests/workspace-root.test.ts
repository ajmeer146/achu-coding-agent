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