import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { Workspace } from "./workspace.js";

export type FileOperationType = "create" | "edit" | "delete";

export interface SnapshotRecord {
  operation: FileOperationType;
  relativePath: string;
  backupPath: string | null;
  beforeHash: string | null;
  afterHash: string | null; // Hash of the file right after the agent modified it
}

export class SnapshotManager {
  private readonly workspaceRoot: string;
  private readonly taskId: string;
  private readonly snapshotsDir: string;
  public records: Map<string, SnapshotRecord> = new Map();

  constructor(workspaceRoot: string, taskId: string) {
    this.workspaceRoot = workspaceRoot;
    this.taskId = taskId;
    
    // Hash the workspace root to avoid path traversal/special chars in folder name
    const hash = crypto.createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 12);
    this.snapshotsDir = path.join(os.tmpdir(), `achu-snapshots`, hash, taskId);
  }

  private async getFileHash(filePath: string): Promise<string | null> {
    try {
      const buffer = await fs.readFile(filePath);
      return crypto.createHash("sha256").update(buffer).digest("hex");
    } catch {
      return null;
    }
  }

  async init(): Promise<void> {
    await fs.mkdir(this.snapshotsDir, { recursive: true });
  }

  /**
   * Called BEFORE a file is modified/created by the agent.
   */
  async captureBefore(relativePath: string, operation: FileOperationType): Promise<void> {
    if (this.records.has(relativePath)) {
      // Already captured the original state before the first mutation in this task
      return;
    }

    const absolutePath = path.resolve(this.workspaceRoot, relativePath);
    
    // Prevent directory traversal
    if (!absolutePath.startsWith(path.resolve(this.workspaceRoot))) {
      throw new Error(`Path traversal attempt detected: ${relativePath}`);
    }

    const beforeHash = await this.getFileHash(absolutePath);
    let backupPath: string | null = null;

    if (beforeHash !== null) {
      // File exists, back it up
      backupPath = path.join(this.snapshotsDir, crypto.randomUUID() + "-" + path.basename(relativePath));
      await fs.copyFile(absolutePath, backupPath);
    }

    this.records.set(relativePath, {
      operation,
      relativePath,
      backupPath,
      beforeHash,
      afterHash: null,
    });
  }

  /**
   * Called AFTER a file is modified/created by the agent.
   */
  async captureAfter(relativePath: string): Promise<void> {
    const record = this.records.get(relativePath);
    if (!record) return;

    const absolutePath = path.resolve(this.workspaceRoot, relativePath);
    record.afterHash = await this.getFileHash(absolutePath);
  }

  /**
   * Rollback the workspace to the before-images, selectively.
   */
  async rollback(): Promise<{ success: boolean; conflicts: string[]; restored: string[] }> {
    const conflicts: string[] = [];
    const restored: string[] = [];

    for (const [relativePath, record] of this.records.entries()) {
      const absolutePath = path.resolve(this.workspaceRoot, relativePath);
      const currentHash = await this.getFileHash(absolutePath);

      // Check if user has modified the file since the agent touched it
      if (currentHash !== record.afterHash) {
        // User changed it, or another process changed it. Skip to avoid losing user work.
        conflicts.push(relativePath);
        continue;
      }

      if (record.backupPath && record.beforeHash) {
        // Restore from backup
        try {
          await fs.copyFile(record.backupPath, absolutePath);
          restored.push(relativePath);
        } catch (e) {
          conflicts.push(relativePath);
        }
      } else {
        // File did not exist before, so delete it
        try {
          await fs.unlink(absolutePath);
          restored.push(relativePath);
        } catch (e) {
          conflicts.push(relativePath);
        }
      }
    }

    return {
      success: conflicts.length === 0,
      conflicts,
      restored
    };
  }

  async cleanup(): Promise<void> {
    try {
      await fs.rm(this.snapshotsDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
}
