import { Workspace } from "./workspace.js";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

/**
 * Persistent workspace registry for authorization and workspace management.
 * Maps workspace IDs to their root paths and metadata.
 * Backed by SQLite for persistence across worker restarts.
 */
export class WorkspaceRegistry {
  private static instance: WorkspaceRegistry | null = null;
  private db: Database.Database;
  private workspaceVolumeRoot: string;

  private constructor(volumeRoot?: string) {
    this.workspaceVolumeRoot = volumeRoot || process.env.WORKSPACE_VOLUME_ROOT || "/workspaces";
    const dbPath = path.join(this.workspaceVolumeRoot, ".registry", "workspaces.db");
    
    // Ensure registry directory exists
    fsSync.mkdirSync(path.dirname(dbPath), { recursive: true });
    
    this.db = new Database(dbPath);
    this.initSchema();
  }

  static getInstance(volumeRoot?: string): WorkspaceRegistry {
    if (!WorkspaceRegistry.instance) {
      WorkspaceRegistry.instance = new WorkspaceRegistry(volumeRoot);
    }
    return WorkspaceRegistry.instance;
  }

  static resetInstanceForTesting(): void {
    if (WorkspaceRegistry.instance) {
      WorkspaceRegistry.instance.close();
      WorkspaceRegistry.instance = null;
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        real_root_path TEXT NOT NULL,
        git_url TEXT,
        owner_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workspaces_real_root ON workspaces(real_root_path);
      CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id);
    `);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Register a workspace and return its ID.
   * The workspace root is validated and normalized.
   * If gitUrl is provided, the workspace will be initialized with a git clone.
   */
  async register(root: string, name?: string, gitUrl?: string, ownerId?: string): Promise<string> {
    const { root: normalizedRoot, realRoot } = await validateWorkspaceDirectory(root);
    const id = generateWorkspaceId(normalizedRoot);
    const now = Date.now();

    // Check if workspace already exists
    const existing = this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as WorkspaceRow | undefined;
    if (existing) {
      // Verify it's the same physical location
      if (existing.real_root_path !== realRoot) {
        throw new Error(`Workspace ID collision: ${id} maps to different paths`);
      }
      // Update access time
      this.db.prepare("UPDATE workspaces SET updated_at = ? WHERE id = ?").run(Date.now(), id);
      return id;
    }

    // Ensure the workspace directory exists
    await fs.mkdir(normalizedRoot, { recursive: true });

    // If gitUrl provided, clone the repository
    if (gitUrl) {
      await this.cloneRepository(gitUrl, normalizedRoot);
    }

    const stmt = this.db.prepare(`
      INSERT INTO workspaces (id, name, root_path, real_root_path, git_url, owner_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `);
    stmt.run(id, name || path.basename(normalizedRoot), normalizedRoot, realRoot, gitUrl || null, ownerId || null, now, now);

    return id;
  }

  /**
   * Clone a git repository into the workspace directory.
   */
  private async cloneRepository(gitUrl: string, targetPath: string): Promise<void> {
    const { spawn } = await import("node:child_process");
    return new Promise((resolve, reject) => {
      const child = spawn("git", ["clone", gitUrl, targetPath], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderr = "";
      child.stderr?.on("data", (data) => { stderr += data.toString(); });
      
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Git clone failed (code ${code}): ${stderr}`));
        }
      });
      child.on("error", reject);
    });
  }

  /**
   * Get workspace by ID.
   * Returns undefined if not registered.
   */
  get(id: string): WorkspaceEntry | undefined {
    const row = this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as WorkspaceRow | undefined;
    return row ? this.mapRowToEntry(row) : undefined;
  }

  /**
   * Get workspace by root path (resolves symlinks).
   */
  getByRoot(root: string): WorkspaceEntry | undefined {
    const normalized = path.resolve(root);
    let realRoot = normalized;
    try {
      realRoot = fsSync.realpathSync.native(normalized);
    } catch {}

    const row = this.db.prepare("SELECT * FROM workspaces WHERE real_root_path = ? OR root_path = ?").get(realRoot, normalized) as WorkspaceRow | undefined;
    return row ? this.mapRowToEntry(row) : undefined;
  }

  /**
   * Resolve a workspace ID to a Workspace instance.
   * Throws if not found or not accessible.
   */
  async resolveWorkspace(id: string): Promise<{ workspace: Workspace; root: string }> {
    const entry = this.get(id);
    if (!entry) {
      throw new Error(`Workspace not found: ${id}`);
    }
    const workspace = new Workspace(entry.root);
    return { workspace, root: entry.root };
  }

  /**
   * List all registered workspaces.
   */
  list(): WorkspaceEntry[] {
    const rows = this.db.prepare("SELECT * FROM workspaces WHERE status = 'active' ORDER BY updated_at DESC").all() as WorkspaceRow[];
    return rows.map(row => this.mapRowToEntry(row));
  }

  /**
   * Update workspace metadata.
   */
  update(id: string, updates: Partial<Pick<WorkspaceEntry, "name" | "status" | "gitUrl">>): boolean {
    const fields: string[] = [];
    const values: any[] = [];
    
    if (updates.name !== undefined) { fields.push("name = ?"); values.push(updates.name); }
    if (updates.status !== undefined) { fields.push("status = ?"); values.push(updates.status); }
    if (updates.gitUrl !== undefined) { fields.push("git_url = ?"); values.push(updates.gitUrl); }
    
    if (fields.length === 0) return false;
    
    fields.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);
    
    const result = this.db.prepare(`UPDATE workspaces SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return result.changes > 0;
  }

  /**
   * Remove a workspace from the registry (soft delete).
   */
  remove(id: string): boolean {
    const result = this.db.prepare("UPDATE workspaces SET status = 'deleted', updated_at = ? WHERE id = ?").run(Date.now(), id);
    return result.changes > 0;
  }

  /**
   * Get the workspace volume root path.
   */
  getVolumeRoot(): string {
    return this.workspaceVolumeRoot;
  }

  private mapRowToEntry(row: WorkspaceRow): WorkspaceEntry {
    return {
      id: row.id,
      name: row.name,
      root: row.root_path,
      realRoot: row.real_root_path,
      gitUrl: row.git_url ?? undefined,
      ownerId: row.owner_id ?? undefined,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

interface WorkspaceRow {
  id: string;
  name: string;
  root_path: string;
  real_root_path: string;
  git_url: string | null;
  owner_id: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface WorkspaceEntry {
  id: string;
  name: string;
  root: string;
  realRoot: string;
  gitUrl?: string;
  ownerId?: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Validate and normalize a workspace directory path.
 */
export async function validateWorkspaceDirectory(
  input: string,
): Promise<{ root: string; realRoot: string; entries: number }> {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error("A workspace path is required.");
  }

  const root = path.resolve(input.trim());

  let stats;
  try {
    stats = await fs.stat(root);
  } catch {
    throw new Error(`Workspace directory does not exist or is not accessible: ${root}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${root}`);
  }

  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Workspace directory is not readable: ${root} (${msg})`);
  }

  let realRoot = root;
  try {
    realRoot = fsSync.realpathSync.native(root);
  } catch {
    realRoot = root;
  }

  return { root, realRoot, entries: entries.length };
}

/**
 * Generate a stable workspace ID from a normalized root path.
 */
function generateWorkspaceId(root: string): string {
  return crypto.createHash("sha256").update(root).digest("hex").slice(0, 16);
}

// Re-export Workspace for convenience
export { Workspace } from "./workspace.js";
export { isInsideRoot } from "./workspace.js";