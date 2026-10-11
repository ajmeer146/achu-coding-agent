import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";

/**
 * Returns true when `child` is the same as, or located inside, `root`.
 * Comparisons are case-insensitive on Windows, where the filesystem is.
 */
export function isInsideRoot(root: string, child: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedChild = path.resolve(child);
  const normalize = (value: string) => {
    const trimmed = value.replace(/[\\/]+$/, "");
    return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
  };
  const normalizedRoot = normalize(resolvedRoot);
  const normalizedChild = normalize(resolvedChild);
  if (normalizedChild === normalizedRoot) return true;
  return normalizedChild.startsWith(normalizedRoot + path.sep);
}

/**
 * Resolve `input` to an absolute path to an existing, accessible directory.
 *
 * Unlike {@link Workspace}, this validates that the *selected workspace root*
 * itself is usable. It never silently falls back to another directory: any
 * failure throws an actionable error so the caller can surface it verbatim.
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

export class Workspace {
  constructor(public readonly root = process.cwd()) {
    this.root = path.resolve(root);
  }

  getRoot(): string {
    return this.root;
  }

  /**
   * Resolve a workspace-relative path, rejecting both lexical traversal
   * (`..\\outside`) and symlink escapes (a link inside the workspace pointing
   * outside it). The final, existing ancestor is checked against the real
   * workspace root so a symlinked directory cannot be used to break out.
   */
  resolve(relativePath: string): string {
    const target = path.resolve(this.root, relativePath);

    if (!isInsideRoot(this.root, target)) {
      throw new Error(`Path outside workspace is not allowed: ${relativePath}`);
    }

    this.assertNoSymlinkEscape(target, relativePath);

    return target;
  }

  /**
   * Assert that a target path does not escape the workspace via symlinks.
   * Walks up to the deepest existing ancestor, resolves its real path,
   * and verifies it's contained within the real workspace root.
   * This method is public so it can be used by other components (e.g., CodeIndexer)
   * for consistent symlink escape protection.
   */
  assertNoSymlinkEscape(target: string, original: string): void {
    // Walk up to the deepest ancestor that actually exists on disk.
    let existing = target;
    let guard = 0;
    while (!fsSync.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing || guard++ > 500) break;
      existing = parent;
    }

    let realExisting: string;
    let realRoot: string;
    try {
      realExisting = fsSync.realpathSync.native(existing);
    } catch {
      realExisting = existing;
    }
    try {
      realRoot = fsSync.realpathSync.native(this.root);
    } catch {
      realRoot = this.root;
    }

    if (!isInsideRoot(realRoot, realExisting)) {
      throw new Error(`Path outside workspace is not allowed: ${original}`);
    }
  }

  async read(relativePath: string): Promise<string> {
    return fs.readFile(this.resolve(relativePath), "utf8");
  }

  async write(relativePath: string, content: string): Promise<void> {
    const target = this.resolve(relativePath);

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }

  async list(relativePath = "."): Promise<string[]> {
    return fs.readdir(this.resolve(relativePath));
  }

  async stat(
    relativePath: string,
  ): Promise<fsSync.Stats | null> {
    try {
      return await fs.stat(this.resolve(relativePath));
    } catch {
      return null;
    }
  }

  async listDetailed(relativePath = "."): Promise<
    Array<{
      name: string;
      type: "file" | "directory" | "other";
    }>
  > {
    const target = this.resolve(relativePath);
    const entries = await fs.readdir(target, {
      withFileTypes: true,
    });

    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory()
        ? "directory"
        : entry.isFile()
          ? "file"
          : "other",
    }));
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(relativePath));
      return true;
    } catch {
      return false;
    }
  }
}
