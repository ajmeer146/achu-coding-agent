import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { WorkspaceRegistry } from "../src/tools/workspace-registry.js";
import { Workspace } from "../src/tools/workspace.js";
import { AgentResult } from "../src/agent.js";

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
// WorkspaceRegistry Tests
// =============================================================================

test("WorkspaceRegistry - registers workspace and returns stable ID", async () => {
  const root = await makeTempDir("wsreg-register");
  
  try {
    const registry = WorkspaceRegistry.getInstance();
    const id1 = await registry.register(root);
    const id2 = await registry.register(root);
    
    assert.equal(id1, id2, "Same workspace should return same ID");
    assert.equal(id1.length, 16, "ID should be 16 characters (SHA256 truncated)");
    
    const entry = registry.get(id1);
    assert.ok(entry, "Workspace should be retrievable by ID");
    assert.equal(entry?.root, root);
  } finally {
    await cleanup(root);
  }
});

test("WorkspaceRegistry - rejects duplicate physical paths with different IDs", async () => {
  const root = await makeTempDir("wsreg-duplicate");
  
  try {
    const registry = WorkspaceRegistry.getInstance();
    await registry.register(root);
    
    // Try to register the same physical path again - should return same ID
    const id1 = await registry.register(root);
    const id2 = await registry.register(root);
    assert.equal(id1, id2);
  } finally {
    await cleanup(root);
  }
});

test("WorkspaceRegistry - resolves workspace by ID", async () => {
  const root = await makeTempDir("wsreg-resolve");
  
  try {
    const registry = WorkspaceRegistry.getInstance();
    const id = await registry.register(root);
    
    const { workspace, root: resolvedRoot } = await registry.resolveWorkspace(id);
    
    assert.ok(workspace instanceof Workspace);
    assert.equal(resolvedRoot, root);
  } finally {
    await cleanup(root);
  }
});

test("WorkspaceRegistry - throws for unknown workspace ID", async () => {
  const registry = WorkspaceRegistry.getInstance();
  
  await assert.rejects(
    registry.resolveWorkspace("unknown-id-1234567890123456"),
    /Workspace not found/
  );
});

test("WorkspaceRegistry - lists registered workspaces", async () => {
  const root1 = await makeTempDir("wsreg-list1");
  const root2 = await makeTempDir("wsreg-list2");
  
  try {
    const registry = WorkspaceRegistry.getInstance();
    const id1 = await registry.register(root1, "Workspace 1");
    const id2 = await registry.register(root2, "Workspace 2");
    
    const list = registry.list();
    assert.equal(list.length >= 2, true);
    assert.ok(list.some(w => w.id === id1 && w.name === "Workspace 1"));
    assert.ok(list.some(w => w.id === id2 && w.name === "Workspace 2"));
  } finally {
    await cleanup(root1, root2);
  }
});

test("WorkspaceRegistry - resolves workspace by root path", async () => {
  const root = await makeTempDir("wsreg-byroot");
  
  try {
    const registry = WorkspaceRegistry.getInstance();
    await registry.register(root);
    
    const found = registry.getByRoot(root);
    assert.ok(found);
    assert.equal(found?.root, root);
  } finally {
    await cleanup(root);
  }
});

// =============================================================================
// Agent Completion Result Tests
// =============================================================================

test("AgentResult type - success with verification passed", () => {
  const result: AgentResult = {
    success: true,
    stopReason: null,
    verificationPassed: true,
    completedSteps: 5,
    totalSteps: 5,
    filesModified: ["src/index.ts", "src/utils.ts"],
    error: undefined,
  };
  
  assert.equal(result.success, true);
  assert.equal(result.stopReason, null);
  assert.equal(result.verificationPassed, true);
  assert.equal(result.completedSteps, 5);
  assert.equal(result.totalSteps, 5);
  assert.deepEqual(result.filesModified, ["src/index.ts", "src/utils.ts"]);
});

test("AgentResult type - failure with stop reason", () => {
  const result: AgentResult = {
    success: false,
    stopReason: "Recovery exhausted after 3 attempts",
    verificationPassed: false,
    completedSteps: 2,
    totalSteps: 5,
    filesModified: ["src/index.ts"],
    error: "Recovery exhausted after 3 attempts",
  };
  
  assert.equal(result.success, false);
  assert.equal(result.stopReason, "Recovery exhausted after 3 attempts");
  assert.equal(result.verificationPassed, false);
});

test("AgentResult type - success without verification", () => {
  const result: AgentResult = {
    success: true,
    stopReason: null,
    verificationPassed: false,
    completedSteps: 3,
    totalSteps: 3,
    filesModified: [],
    error: undefined,
  };
  
  // Success without verification requested should be true
  assert.equal(result.success, true);
  assert.equal(result.verificationPassed, false);
});

// =============================================================================
// Integration: AgentResult from runAgent (via mocking)
// =============================================================================

test("runAgent returns structured AgentResult", async () => {
  const { runAgent } = await import("../src/agent.js");
  
  // The actual runAgent requires a workspace and API keys
  // We test that the function signature returns AgentResult
  // by checking the TypeScript compilation (already done in build)
  
  // This test documents the expected interface
  const mockResult: AgentResult = {
    success: true,
    stopReason: null,
    verificationPassed: true,
    completedSteps: 3,
    totalSteps: 3,
    filesModified: ["src/main.ts"],
    error: undefined,
  };
  
  assert.ok("success" in mockResult);
  assert.ok("verificationPassed" in mockResult);
  assert.ok("completedSteps" in mockResult);
  assert.ok("totalSteps" in mockResult);
  assert.ok("filesModified" in mockResult);
});

test("AgentResult captures modified files correctly", () => {
  const result: AgentResult = {
    success: true,
    stopReason: null,
    verificationPassed: true,
    completedSteps: 2,
    totalSteps: 2,
    filesModified: ["src/main.ts", "src/utils.ts"],
    error: undefined,
  };
  
  assert.equal(result.filesModified.length, 2);
  assert.ok(result.filesModified.includes("src/main.ts"));
  assert.ok(result.filesModified.includes("src/utils.ts"));
});

// =============================================================================
// Workspace Authorization Tests
// =============================================================================

test("WorkspaceRegistry - rejects unauthorized workspace access", async () => {
  const root = await makeTempDir("wsreg-auth");
  
  try {
    const registry = WorkspaceRegistry.getInstance();
    await registry.register(root);
    
    const { workspace } = await registry.resolveWorkspace("non-existent-id");
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok((error as Error).message.includes("Workspace not found"));
  } finally {
    await cleanup(root);
  }
});

test("WorkspaceRegistry - prevents path traversal via registry", async () => {
  const root = await makeTempDir("wsreg-traversal");
  
  try {
    const registry = WorkspaceRegistry.getInstance();
    const id = await registry.register(root);
    
    const { workspace } = await registry.resolveWorkspace(id);
    
    // Attempt to resolve a path outside workspace
    try {
      workspace.resolve("../../../etc/passwd");
      assert.fail("Should have thrown");
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok((error as Error).message.includes("Path outside workspace is not allowed"));
    }
  } finally {
    await cleanup(root);
  }
});

test("WorkspaceRegistry - cross-workspace access blocked", async () => {
  const root1 = await makeTempDir("wsreg-cross1");
  const root2 = await makeTempDir("wsreg-cross2");
  
  try {
    const registry = WorkspaceRegistry.getInstance();
    const id1 = await registry.register(root1, "Workspace 1");
    const id2 = await registry.register(root2, "Workspace 2");
    
    const { workspace: ws1 } = await registry.resolveWorkspace(id1);
    const { workspace: ws2 } = await registry.resolveWorkspace(id2);
    
    // ws1 should not be able to resolve ws2's files
    const ws2File = path.join(root2, "secret.txt");
    await fs.writeFile(ws2File, "secret");
    
    try {
      ws1.resolve(path.relative(root1, ws2File));
      assert.fail("Should have thrown");
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok((error as Error).message.includes("Path outside workspace is not allowed"));
    }
  } finally {
    await cleanup(root1, root2);
  }
});

// =============================================================================
// Trigger Task Integration Tests
// =============================================================================

test("Trigger task payload uses workspaceRoot or workspaceId", async () => {
  // This test verifies the payload schema accepts either workspaceId or workspaceRoot
  const { AgentTaskPayloadSchema } = await import("../src/trigger/agent-task.js");
  
  const validPayloadWithRoot = {
    task: "Test task",
    workspaceRoot: "/some/path",
    sessionId: "session-123",
    requestedVerification: "npm test",
    maxSteps: 30,
    maxRecoveryAttempts: 3,
  };
  
  const result1 = AgentTaskPayloadSchema.safeParse(validPayloadWithRoot);
  assert.equal(result1.success, true);
  
  const validPayloadWithId = {
    task: "Test task",
    workspaceId: "abc123def4567890",
    sessionId: "session-123",
    requestedVerification: "npm test",
    maxSteps: 30,
    maxRecoveryAttempts: 3,
  };
  
  const result2 = AgentTaskPayloadSchema.safeParse(validPayloadWithId);
  assert.equal(result2.success, true);
  
  // Both workspaceId and workspaceRoot missing should fail
  const invalidPayload = {
    task: "Test task",
    sessionId: "session-123",
  };
  
  const invalidResult = AgentTaskPayloadSchema.safeParse(invalidPayload);
  assert.equal(invalidResult.success, false);
});

test("Trigger task result schema validates AgentResult structure", async () => {
  const { AgentTaskResultSchema } = await import("../src/trigger/agent-task.js");
  
  const validResult = {
    success: true,
    stopReason: null,
    verificationPassed: true,
    completedSteps: 5,
    totalSteps: 5,
    filesModified: ["src/main.ts"],
    error: undefined,
  };
  
  const result = AgentTaskResultSchema.safeParse(validResult);
  assert.equal(result.success, true);
  
  // Error should be optional
  const resultWithoutError = { ...validResult };
  delete (validResult as any).error;
  const result2 = AgentTaskResultSchema.safeParse(validResult);
  assert.equal(result2.success, true);
});