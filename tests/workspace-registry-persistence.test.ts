import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkspaceRegistry } from "../src/tools/workspace-registry.js";
import { Workspace } from "../src/tools/workspace.js";

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
// WorkspaceRegistry Persistence Tests
// =============================================================================

test("WorkspaceRegistry - persists workspaces across instances", async () => {
  const volumeRoot = await makeTempDir("wsreg-persist");
  const wsRoot = path.join(volumeRoot, "ws1");
  await fs.mkdir(wsRoot, { recursive: true });
  
  try {
    // Create first registry instance and register workspace
    const registry1 = WorkspaceRegistry.getInstance(volumeRoot);
    const id1 = await registry1.register(wsRoot, "Workspace 1");
    
    // Close first instance
    registry1.close();
    WorkspaceRegistry.resetInstanceForTesting();
    
    // Create second instance (simulating new process/worker)
    const registry2 = WorkspaceRegistry.getInstance(volumeRoot);
    const entry = registry2.get(id1);
    
    assert.ok(entry, "Workspace should be retrievable after registry restart");
    assert.equal(entry?.name, "Workspace 1");
    assert.equal(entry?.root, wsRoot);
    assert.equal(entry?.status, "active");
    
    registry2.close();
    WorkspaceRegistry.resetInstanceForTesting();
  } finally {
    await cleanup(volumeRoot);
  }
});

test("WorkspaceRegistry - resolves workspace across instances", async () => {
  const volumeRoot = await makeTempDir("wsreg-resolve");
  const wsRoot = path.join(volumeRoot, "ws2");
  await fs.mkdir(wsRoot, { recursive: true });
  await fs.writeFile(path.join(wsRoot, "test.txt"), "hello");
  
  try {
    const registry1 = WorkspaceRegistry.getInstance(volumeRoot);
    const id = await registry1.register(wsRoot, "Workspace 2");
    registry1.close();
    WorkspaceRegistry.resetInstanceForTesting();
    
    const registry2 = WorkspaceRegistry.getInstance(volumeRoot);
    const { workspace, root } = await registry2.resolveWorkspace(id);
    
    assert.equal(root, wsRoot);
    const content = await workspace.read("test.txt");
    assert.equal(content, "hello");
    
    registry2.close();
    WorkspaceRegistry.resetInstanceForTesting();
  } finally {
    await cleanup(volumeRoot);
  }
});

test("WorkspaceRegistry - registers with git URL and clones", { skip: "Requires network access" }, async () => {
  const volumeRoot = await makeTempDir("wsreg-git");
  const wsRoot = path.join(volumeRoot, "ws-git");
  
  try {
    const registry = WorkspaceRegistry.getInstance(volumeRoot);
    
    // Use a small public test repo
    const gitUrl = "https://github.com/git/test.git";
    const id = await registry.register(wsRoot, "Git Workspace", gitUrl);
    
    const entry = registry.get(id);
    assert.ok(entry);
    assert.equal(entry?.gitUrl, "https://github.com/git/test.git");
    
    // Check that git clone worked
    const files = await fs.readdir(wsRoot);
    assert.ok(files.length > 0, "Repository should be cloned");
    
    registry.close();
    WorkspaceRegistry.resetInstanceForTesting();
  } finally {
    await cleanup(volumeRoot);
  }
});

test("WorkspaceRegistry - rejects duplicate physical paths with different IDs", async () => {
  const volumeRoot = await makeTempDir("wsreg-dup");
  const wsRoot = path.join(volumeRoot, "ws-dup");
  await fs.mkdir(wsRoot, { recursive: true });
  
  try {
    const registry1 = WorkspaceRegistry.getInstance(volumeRoot);
    const id1 = await registry1.register(wsRoot);
    registry1.close();
    WorkspaceRegistry.resetInstanceForTesting();
    
    const registry2 = WorkspaceRegistry.getInstance(volumeRoot);
    const id2 = await registry2.register(wsRoot);
    
    assert.equal(id1, id2, "Same physical path should return same ID");
    
    registry2.close();
    WorkspaceRegistry.resetInstanceForTesting();
  } finally {
    await cleanup(volumeRoot);
  }
});

test("WorkspaceRegistry - lists workspaces across instances", async () => {
  const volumeRoot = await makeTempDir("wsreg-list");
  const wsRoot1 = path.join(volumeRoot, "ws-list1");
  const wsRoot2 = path.join(volumeRoot, "ws-list2");
  await fs.mkdir(wsRoot1, { recursive: true });
  await fs.mkdir(wsRoot2, { recursive: true });
  
  try {
    const registry1 = WorkspaceRegistry.getInstance(volumeRoot);
    await registry1.register(wsRoot1, "Workspace 1");
    await registry1.register(wsRoot2, "Workspace 2");
    registry1.close();
    WorkspaceRegistry.resetInstanceForTesting();
    
    const registry2 = WorkspaceRegistry.getInstance(volumeRoot);
    const list = registry2.list();
    
    assert.ok(list.length >= 2);
    assert.ok(list.some(w => w.name === "Workspace 1"));
    assert.ok(list.some(w => w.name === "Workspace 2"));
    
    registry2.close();
    WorkspaceRegistry.resetInstanceForTesting();
  } finally {
    await cleanup(volumeRoot);
  }
});

test("WorkspaceRegistry - getByRoot works across instances", async () => {
  const volumeRoot = await makeTempDir("wsreg-byroot");
  const wsRoot = path.join(volumeRoot, "ws-byroot");
  await fs.mkdir(wsRoot, { recursive: true });
  
  try {
    const registry1 = WorkspaceRegistry.getInstance(volumeRoot);
    await registry1.register(wsRoot);
    registry1.close();
    WorkspaceRegistry.resetInstanceForTesting();
    
    const registry2 = WorkspaceRegistry.getInstance(volumeRoot);
    const entry = registry2.getByRoot(wsRoot);
    
    assert.ok(entry);
    assert.equal(entry?.root, wsRoot);
    
    registry2.close();
    WorkspaceRegistry.resetInstanceForTesting();
  } finally {
    await cleanup(volumeRoot);
  }
});

test("WorkspaceRegistry - update and remove workspaces", async () => {
  const volumeRoot = await makeTempDir("wsreg-update");
  const wsRoot = path.join(volumeRoot, "ws-update");
  await fs.mkdir(wsRoot, { recursive: true });
  
  try {
    const registry = WorkspaceRegistry.getInstance(volumeRoot);
    const id = await registry.register(wsRoot, "Original Name");
    
    // Update name
    const updated = registry.update(id, { name: "Updated Name" });
    assert.ok(updated);
    
    const entry = registry.get(id);
    assert.equal(entry?.name, "Updated Name");
    
    // Soft delete
    const removed = registry.remove(id);
    assert.ok(removed);
    
    const deletedEntry = registry.get(id);
    assert.equal(deletedEntry?.status, "deleted");
    
    registry.close();
    WorkspaceRegistry.resetInstanceForTesting();
  } finally {
    await cleanup(volumeRoot);
  }
});

// =============================================================================
// Cross-Process Workspace Resolution Tests
// =============================================================================

test("Workspace - cross-process resolution via registry", async () => {
  const volumeRoot = await makeTempDir("ws-cross");
  const wsRoot = path.join(volumeRoot, "ws-cross");
  await fs.mkdir(wsRoot, { recursive: true });
  await fs.writeFile(path.join(wsRoot, "data.txt"), "cross-process data");
  
  try {
    // Process 1: Register and resolve
    const registry1 = WorkspaceRegistry.getInstance(volumeRoot);
    const id = await registry1.register(wsRoot);
    const { workspace: ws1 } = await registry1.resolveWorkspace(id);
    const content1 = await ws1.read("data.txt");
    assert.equal(content1, "cross-process data");
    registry1.close();
    WorkspaceRegistry.resetInstanceForTesting();
    
    // Process 2: Resolve same workspace
    const registry2 = WorkspaceRegistry.getInstance(volumeRoot);
    const { workspace: ws2 } = await registry2.resolveWorkspace(id);
    const content2 = await ws2.read("data.txt");
    assert.equal(content2, "cross-process data");
    
    registry2.close();
    WorkspaceRegistry.resetInstanceForTesting();
  } finally {
    await cleanup(volumeRoot);
  }
});

test("WorkspaceRegistry - rejects unauthorized workspace ID", async () => {
  const volumeRoot = await makeTempDir("ws-unauth");
  const wsRoot = path.join(volumeRoot, "ws-unauth");
  await fs.mkdir(wsRoot, { recursive: true });
  
  try {
    const registry1 = WorkspaceRegistry.getInstance(volumeRoot);
    await registry1.register(wsRoot);
    registry1.close();
    WorkspaceRegistry.resetInstanceForTesting();
    
    const registry2 = WorkspaceRegistry.getInstance(volumeRoot);
    
    await assert.rejects(
      registry2.resolveWorkspace("non-existent-id"),
      /Workspace not found/
    );
    
    registry2.close();
    WorkspaceRegistry.resetInstanceForTesting();
  } finally {
    await cleanup(volumeRoot);
  }
});

test("WorkspaceRegistry - isolates different volumes", async () => {
  const volumeRoot1 = await makeTempDir("ws-isolate1");
  const volumeRoot2 = await makeTempDir("ws-isolate2");
  const wsRoot1 = path.join(volumeRoot1, "ws1");
  const wsRoot2 = path.join(volumeRoot2, "ws2");
  await fs.mkdir(wsRoot1, { recursive: true });
  await fs.mkdir(wsRoot2, { recursive: true });
  
  try {
    const registry1 = WorkspaceRegistry.getInstance(volumeRoot1);
    const id1 = await registry1.register(wsRoot1);
    registry1.close();
    WorkspaceRegistry.resetInstanceForTesting();
    
    const registry2 = WorkspaceRegistry.getInstance(volumeRoot2);
    // Should not find workspace from volume1
    const entry = registry2.get(id1);
    assert.equal(entry, undefined);
    
    const id2 = await registry2.register(wsRoot2);
    assert.ok(id2 !== id1);
    
    registry2.close();
    WorkspaceRegistry.resetInstanceForTesting();
  } finally {
    await cleanup(volumeRoot1, volumeRoot2);
  }
});