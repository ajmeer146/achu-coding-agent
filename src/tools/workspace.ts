import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";

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

/**
 * Returns the base root folder where new projects should be isolated.
 */
export function getDefaultProjectsBaseDir(): string {
  if (process.env.ACHU_PROJECTS_DIR) {
    return path.resolve(process.env.ACHU_PROJECTS_DIR);
  }
  if (process.env.WORKSPACE_VOLUME_ROOT && process.env.WORKSPACE_VOLUME_ROOT !== "/workspaces") {
    return path.resolve(process.env.WORKSPACE_VOLUME_ROOT);
  }
  const desktop = path.join(os.homedir(), "OneDrive", "Desktop");
  if (fsSync.existsSync(desktop)) {
    return path.join(desktop, "achu-projects");
  }
  const regularDesktop = path.join(os.homedir(), "Desktop");
  if (fsSync.existsSync(regularDesktop)) {
    return path.join(regularDesktop, "achu-projects");
  }
  return path.join(os.homedir(), "achu-projects");
}

/**
 * Derive a clean directory slug from a task description or project name.
 */
export function deriveProjectSlug(taskOrName: string): string {
  const input = String(taskOrName || "").trim();
  // Check for explicit "called **<name>**" or "called <name>" or "named <name>"
  const calledMatch = input.match(/(?:called|named)\s+[*_`]*([a-zA-Z0-9_\-\s]+?)[*_`]*(?:\.|\n|$|,|\s+(?:with|that|which|using))/i);
  let name = "";
  if (calledMatch && calledMatch[1]) {
    name = calledMatch[1].trim();
  } else {
    // Check for "Build a ... website/app/landing page"
    const buildMatch = input.match(/(?:build|create)\s+(?:a|an)\s+(?:[a-zA-Z0-9_\-]+\s+)*(?:website|app|page|store|platform|dashboard|portfolio)\s*(?:called|named)?\s*([a-zA-Z0-9_\-]+)?/i);
    if (buildMatch && buildMatch[1]) {
      name = buildMatch[1].trim();
    }
  }

  if (!name) {
    const words = input.slice(0, 30).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    name = words || `project-${Date.now()}`;
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `project-${Date.now()}`;
}

/**
 * Detect whether a task represents a brand new website or application building request.
 */
export function isNewWebsiteTask(task: string): boolean {
  const lower = String(task || "").toLowerCase();
  const hasBuild = /\b(build|create|scaffold|generate|setup)\b/i.test(lower);
  const hasTarget = /\b(website|web app|webapp|landing page|portfolio|e-commerce|store|dashboard|site|application)\b/i.test(lower);
  const isFollowUp = /\b(modify|update|improve|extend|change|fix|add to|refactor|test|check)\b/i.test(lower);
  return hasBuild && hasTarget && !isFollowUp;
}

/**
 * Determine whether a task requires a dedicated isolated workspace directory
 * rather than reusing the current directory.
 */
export async function shouldIsolateNewProject(task: string, currentWorkspaceRoot: string | null): Promise<boolean> {
  if (!currentWorkspaceRoot) return true;
  if (!isNewWebsiteTask(task)) return false;

  try {
    const slug = deriveProjectSlug(task);
    const currentDirName = path.basename(currentWorkspaceRoot).toLowerCase();
    const isMatchingDirectory = currentDirName === slug.toLowerCase();

    // Explicit user requirement for isolated workspace
    if (/isolated workspace|new workspace|new directory|fresh workspace/i.test(task)) {
      if (!isMatchingDirectory) return true;
    }

    const ws = new Workspace(currentWorkspaceRoot);
    const hasPkg = await ws.exists("package.json");
    const hasIndex = await ws.exists("index.html");

    // Check if directory has existing user files
    let entries: string[] = [];
    try {
      entries = await fs.readdir(currentWorkspaceRoot);
    } catch {
      return true;
    }

    const nonMetaEntries = entries.filter((e) => !e.startsWith(".") && e !== "node_modules");

    // Truly empty workspace is safe to reuse
    if (nonMetaEntries.length === 0) {
      return false;
    }

    // Matching directory name means user selected this specific project directory
    if (isMatchingDirectory) {
      return false;
    }

    // Directory contains files and does NOT match the requested project: isolate
    return true;
  } catch {
    return true;
  }
}

export class Workspace {
  public root: string;
  public parentRoot?: string;

  constructor(root = process.cwd()) {
    this.root = path.resolve(root);
  }

  getRoot(): string {
    return this.root;
  }

  setRoot(newRoot: string): void {
    const resolved = path.resolve(newRoot);
    if (!this.parentRoot && resolved !== this.root && isInsideRoot(this.root, resolved)) {
      this.parentRoot = this.root;
    }
    this.root = resolved;
  }

  /**
   * Discovers if there is an authoritative app project root in a child directory
   * (e.g. if a subfolder contains package.json while root does not, or after scaffolding).
   */
  async getAuthoritativeProjectRoot(): Promise<string> {
    if (await this.exists("package.json")) {
      return this.root;
    }
    // Check immediate subdirectories for package.json
    try {
      const entries = await fs.readdir(this.root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
          const subPath = path.join(this.root, entry.name);
          if (fsSync.existsSync(path.join(subPath, "package.json"))) {
            return subPath;
          }
        }
      }
    } catch {}
    return this.root;
  }

  async syncAuthoritativeRoot(): Promise<string> {
    const authRoot = await this.getAuthoritativeProjectRoot();
    if (authRoot !== this.root) {
      this.setRoot(authRoot);
    }
    return this.root;
  }

  /**
   * Resolve a workspace-relative path, rejecting both lexical traversal
   * (`..\\outside`) and symlink escapes (a link inside the workspace pointing
   * outside it). The final, existing ancestor is checked against the real
   * workspace root so a symlinked directory cannot be used to break out.
   *
   * Enforces single authoritative resolution: prevents path duplication when a
   * relative path includes the project root folder name while this.root is
   * already at that folder.
   */
  resolve(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      const resolved = path.resolve(relativePath);
      const isAllowed = isInsideRoot(this.root, resolved) || (this.parentRoot ? isInsideRoot(this.parentRoot, resolved) : false);
      if (!isAllowed) {
        throw new Error(`Path outside workspace is not allowed: ${relativePath}`);
      }
      this.assertNoSymlinkEscape(resolved, relativePath);
      return resolved;
    }

    const norm = relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
    const currentFolder = path.basename(this.root).toLowerCase();
    const folderPrefix = currentFolder + "/";

    let target = path.resolve(this.root, relativePath);

    // If relativePath is prefixed with current directory name (e.g. "achu-test-lab/package.json" when this.root is already ".../achu-test-lab"),
    // de-duplicate to avoid duplicated nested path ".../achu-test-lab/achu-test-lab/package.json".
    if (this.parentRoot) {
      const parentCandidate = path.resolve(this.parentRoot, relativePath);
      if (isInsideRoot(this.root, parentCandidate)) {
        target = parentCandidate;
      }
    } else if (norm.toLowerCase().startsWith(folderPrefix)) {
      const stripped = norm.slice(folderPrefix.length);
      const strippedTarget = path.resolve(this.root, stripped);
      if (fsSync.existsSync(strippedTarget) || !fsSync.existsSync(target)) {
        target = strippedTarget;
      }
    } else if (norm.toLowerCase() === currentFolder) {
      target = this.root;
    }

    // If target does not exist at current root, check if it exists in an immediate child project directory
    // (e.g., if project was scaffolded into a subdirectory like 'DevShowcase/src/App.jsx')
    if (!fsSync.existsSync(target)) {
      try {
        const entries = fsSync.readdirSync(this.root, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
            const candidate = path.resolve(this.root, entry.name, relativePath);
            if (fsSync.existsSync(candidate)) {
              // Found target inside child project: update authoritative root
              this.setRoot(path.join(this.root, entry.name));
              target = candidate;
              break;
            }
          }
        }
      } catch {}
    }

    const isAllowed = isInsideRoot(this.root, target) || (this.parentRoot ? isInsideRoot(this.parentRoot, target) : false);
    if (!isAllowed) {
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

    let realParentRoot = realRoot;
    if (this.parentRoot) {
      try {
        realParentRoot = fsSync.realpathSync.native(this.parentRoot);
      } catch {
        realParentRoot = this.parentRoot;
      }
    }

    if (!isInsideRoot(realRoot, realExisting) && !isInsideRoot(realParentRoot, realExisting)) {
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
