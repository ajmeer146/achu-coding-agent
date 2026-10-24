import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { Workspace, isInsideRoot } from "./workspace.js";

/**
 * Allowed git repository hosts for cloud execution.
 * Only these hosts are allowed for git operations in cloud mode.
 */
const ALLOWED_GIT_HOSTS = new Set([
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "dev.azure.com",
  "sourceforge.net",
  "codeberg.org",
]);

/**
 * Validate a git repository URL.
 * Allows HTTPS URLs from allowed hosts, and file:// URLs for local testing.
 * Strips credentials from URL for logging.
 */
export function validateGitUrl(gitUrl: string): { valid: boolean; sanitizedUrl: string; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(gitUrl);
  } catch {
    return { valid: false, sanitizedUrl: "", error: "Invalid URL format" };
  }

  // Allow file:// URLs for local testing
  if (parsed.protocol === "file:") {
    const sanitizedUrl = redactCredentials(gitUrl);
    return { valid: true, sanitizedUrl };
  }

  // Only allow HTTPS for remote URLs
  if (parsed.protocol !== "https:") {
    return { valid: false, sanitizedUrl: redactCredentials(gitUrl), error: "Only HTTPS URLs are allowed" };
  }

  // Check host against allowlist
  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_GIT_HOSTS.has(hostname)) {
    return { valid: false, sanitizedUrl: redactCredentials(gitUrl), error: `Host ${hostname} is not allowed` };
  }

  // Sanitize URL for logging (remove credentials)
  const sanitizedUrl = redactCredentials(gitUrl);
  return { valid: true, sanitizedUrl };
}

/**
 * Redact credentials from a git URL for safe logging.
 * Converts https://user:pass@host/path to https://[REDACTED]:[REDACTED]@host/path
 * If the input is not a valid URL with credentials, returns the original string unchanged.
 */
export function redactCredentials(gitUrl: string): string {
  try {
    const parsed = new URL(gitUrl);
    if (parsed.username || parsed.password) {
      parsed.username = "[REDACTED]";
      parsed.password = "[REDACTED]";
      return parsed.toString();
    }
    return gitUrl;
  } catch {
    // Not a valid URL - return original string unchanged (don't redact arbitrary strings)
    return gitUrl;
  }
}

/**
 * Validate branch name to prevent command injection.
 * Only allows alphanumeric, dash, underscore, slash, and dot.
 */
export function validateBranchName(branch: string): { valid: boolean; error?: string } {
  if (!branch || branch.length === 0) {
    return { valid: false, error: "Branch name cannot be empty" };
  }
  if (branch.length > 255) {
    return { valid: false, error: "Branch name too long" };
  }
  // Git branch name rules: no spaces, no special chars except - _ . /
  // Also prevent command injection attempts
  if (!/^[a-zA-Z0-9._/-]+$/.test(branch)) {
    return { valid: false, error: "Branch name contains invalid characters" };
  }
  // Prevent path traversal attempts
  if (branch.includes("..") || branch.startsWith("-")) {
    return { valid: false, error: "Branch name contains invalid sequence" };
  }
  return { valid: true };
}

/**
 * GitWorkspace - A workspace that operates on a git repository.
 * Used for cloud execution where shared volumes are not available.
 * Clones the repository to a temporary directory and provides
 * workspace operations within that cloned repository.
 */
export class GitWorkspace {
  private readonly root: string;
  private readonly gitUrl: string;
  private readonly branch: string;
  private readonly sanitizedUrl: string;
  private initialized = false;
  private pushEnabled = false;
  // Track files written by the agent so they can be force-added even if .gitignore excludes them
  private readonly agentWrittenFiles = new Set<string>();

constructor(
    gitUrl: string,
    options?: { branch?: string; tempDir?: string; pushEnabled?: boolean }
  ) {
    this.gitUrl = gitUrl;
    const branch = options?.branch || "main";
    this.branch = branch;
    this.sanitizedUrl = redactCredentials(gitUrl);
    this.pushEnabled = options?.pushEnabled ?? false;
    // Use a highly unique temp directory name with PID, timestamp, random string, and UUID
    // to avoid collisions in parallel tests across worker threads
    const uniqueId = `${process.pid}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}-${crypto.randomUUID()}`;
    this.root = options?.tempDir || path.join("/tmp", "achu-workspace", uniqueId);
  }

  /**
   * Configure Git identity for commits.
   * Should be called before commitAndPush if not already set globally.
   */
  async configureIdentity(userName?: string, userEmail?: string): Promise<void> {
    const name = userName || process.env.GIT_USER_NAME || "Achu Coding Agent";
    const email = userEmail || process.env.GIT_USER_EMAIL || "achu-agent@trigger.dev";
    await this.runGit("config", "user.name", name);
    await this.runGit("config", "user.email", email);
  }

  /**
   * Get the authenticated clone URL with credentials if available.
   * Uses GITHUB_TOKEN from environment for GitHub HTTPS authentication.
   */
  private getAuthenticatedCloneUrl(): string {
    try {
      const parsed = new URL(this.gitUrl);
      // Only inject token for GitHub HTTPS URLs
      if (parsed.hostname === "github.com" && parsed.protocol === "https:") {
        const token = process.env.GITHUB_TOKEN || process.env.GIT_TOKEN;
        if (token && !parsed.username) {
          parsed.username = token;
          parsed.password = "";
          return parsed.toString();
        }
      }
      return this.gitUrl;
    } catch {
      return this.gitUrl;
    }
  }

  /**
   * Initialize the workspace by cloning the repository.
   * Must be called before using the workspace.
   * Validates configuration on first call.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Validate git URL
    const urlValidation = validateGitUrl(this.gitUrl);
    if (!urlValidation.valid) {
      throw new Error(`Invalid git URL: ${urlValidation.error}`);
    }
    
    // Validate branch name
    const branchValidation = validateBranchName(this.branch);
    if (!branchValidation.valid) {
      throw new Error(`Invalid branch name: ${branchValidation.error}`);
    }

    // Clean up any existing directory to avoid "not an empty directory" errors
    // Retry up to 5 times with increasing delays
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        console.log(`[GitWorkspace] Attempt ${attempt + 1}: Removing existing directory ${this.root}`);
        await fs.rm(this.root, { recursive: true, force: true });
        // Verify directory is actually gone by waiting until it's inaccessible
        let directoryGone = false;
        for (let check = 0; check < 10; check++) {
          try {
            await fs.access(this.root);
            // Directory still exists, wait a bit
            await new Promise(resolve => setTimeout(resolve, 50));
          } catch {
            directoryGone = true;
            break;
          }
        }
        if (directoryGone) {
          console.log(`[GitWorkspace] Successfully removed directory ${this.root}`);
          break;
        }
        console.log(`[GitWorkspace] Directory still exists after rm, retrying...`);
      } catch (e) {
        console.log(`[GitWorkspace] Attempt ${attempt + 1} failed to remove directory: ${e}`);
      }
      if (attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
    // Final verification
    try {
      await fs.access(this.root);
      throw new Error(`Failed to remove directory ${this.root} after multiple attempts`);
    } catch {
      console.log(`[GitWorkspace] Directory confirmed removed: ${this.root}`);
    }

    // DO NOT create the directory here - git clone will create it
    try {
      await this.cloneRepository();
      this.initialized = true;
    } catch (error) {
      // Clean up on clone failure
      try {
        await fs.rm(this.root, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Clone the repository to the workspace root.
   */
  private async cloneRepository(): Promise<void> {
    const { spawn } = await import("node:child_process");
    // Use authenticated URL if credentials are available
    const cloneUrl = this.getAuthenticatedCloneUrl();
    return new Promise((resolve, reject) => {
      const child = spawn("git", ["clone", "--depth", "1", "--branch", this.branch, cloneUrl, this.root], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderr = "";
      child.stderr?.on("data", (data) => { stderr += data.toString(); });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          // Sanitize error message to avoid leaking credentials
          const sanitizedError = redactCredentials(stderr);
          reject(new Error(`Git clone failed (code ${code}): ${sanitizedError}`));
        }
      });
      child.on("error", (err) => reject(new Error(`Git clone error: ${err.message}`)));
    });
  }

  /**
   * Enable pushing changes to the remote repository.
   * Must be called explicitly to enable pushing.
   * Requires git credentials to be configured (e.g., via SSH key or token).
   */
  enablePush(): void {
    this.pushEnabled = true;
  }

  /**
   * Commit and push changes to the remote repository.
   * Requires push to be explicitly enabled via enablePush().
   * Requires git credentials to be configured (e.g., via SSH key or token).
   */
  async commitAndPush(message: string): Promise<{ committed: boolean; pushed: boolean }> {
    if (!this.initialized) {
      throw new Error("Workspace not initialized");
    }
    if (!this.pushEnabled) {
      throw new Error("Push not enabled. Call enablePush() first to authorize pushing changes.");
    }

    // Configure Git identity before committing
    await this.configureIdentity();

    // Force-add files written by the agent so they are included even if .gitignore excludes them
    for (const file of this.agentWrittenFiles) {
      try {
        await this.runGit("add", "-f", file);
      } catch {
        // If force-add fails (e.g., file was deleted), continue with other files
        // The subsequent status check will handle the actual state
      }
    }

    // Also add any other non-ignored changes
    await this.runGit("add", "-A");

    // Check if there are any staged changes to commit
    const statusResult = await this.runGit("status", "--porcelain");
    const hasChanges = statusResult.stdout.trim().length > 0;

    if (!hasChanges) {
      // No changes to commit - this is not an error, just nothing to do
      return { committed: false, pushed: false };
    }

    await this.runGit("commit", "-m", message);
    await this.runGit("push", "origin", this.branch);
    return { committed: true, pushed: true };
  }

  /**
   * Run a git command in the workspace root and capture both stdout and stderr.
   */
  private async runGit(...args: string[]): Promise<{ stdout: string; stderr: string }> {
    const { spawn } = await import("node:child_process");
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: this.root,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (data) => { stdout += data.toString(); });
      child.stderr?.on("data", (data) => { stderr += data.toString(); });

      child.on("close", (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          // Sanitize only credential patterns in stderr, not the entire output
          const sanitizedStderr = stderr.replace(
            /https?:\/\/[^:@\s]+:[^:@\s]+@[^:\/\s]+/g,
            (match) => {
              try {
                return redactCredentials(match);
              } catch {
                return "[REDACTED]";
              }
            }
          );
          reject(new Error(`Git ${args[0]} failed (code ${code}): ${sanitizedStderr || "(no stderr output)"}`));
        }
      });
      child.on("error", reject);
    });
  }

  /**
   * Check if the workspace is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the workspace root path.
   */
  getRoot(): string {
    return this.root;
  }

  /**
   * Resolve a workspace-relative path, rejecting traversal attempts.
   * Mirrors the Workspace.resolve() interface for compatibility.
   */
  resolve(relativePath: string): string {
    const norm = relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
    const normalizedRootStr = this.root.replace(/\\/g, "/").replace(/^[a-zA-Z]:/, "").replace(/^[\\/]+/, "").toLowerCase();
    const normalizedNorm = norm.toLowerCase();
    if (normalizedNorm.startsWith(normalizedRootStr + "/")) {
      const stripped = norm.slice(normalizedRootStr.length + 1);
      return this.resolve(stripped);
    }
    if (normalizedNorm === normalizedRootStr) {
      return this.root;
    }

    const target = path.resolve(this.root, relativePath);

    if (!isInsideRoot(this.root, target)) {
      throw new Error(`Path outside workspace is not allowed: ${relativePath}`);
    }

    return target;
  }

  /**
   * Read a file from the workspace.
   */
  async read(relativePath: string): Promise<string> {
    return fs.readFile(this.resolve(relativePath), "utf8");
  }

  /**
   * Write a file to the workspace.
   */
  async write(relativePath: string, content: string): Promise<void> {
    const target = this.resolve(relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    // Track this file so it can be force-added during commit even if .gitignore excludes it
    this.agentWrittenFiles.add(relativePath);
  }

  /**
   * List files in a directory.
   */
  async list(relativePath = "."): Promise<string[]> {
    return fs.readdir(this.resolve(relativePath));
  }

  /**
   * Get file stats.
   */
  async stat(relativePath: string): Promise<import("node:fs").Stats | null> {
    try {
      return await fs.stat(this.resolve(relativePath));
    } catch {
      return null;
    }
  }

  /**
   * List directory with file types.
   */
  async listDetailed(relativePath = "."): Promise<
    Array<{
      name: string;
      type: "file" | "directory" | "other";
    }>
  > {
    const target = this.resolve(relativePath);
    const entries = await fs.readdir(target, { withFileTypes: true });

    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory()
        ? "directory"
        : entry.isFile()
          ? "file"
          : "other",
    }));
  }

  /**
   * Check if a path exists.
   */
  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up the temporary workspace directory.
   */
  async cleanup(): Promise<void> {
    if (this.initialized) {
      try {
        await fs.rm(this.root, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      this.initialized = false;
    }
  }
}

/**
 * Create a workspace instance based on the execution environment.
 * - If gitUrl is provided, returns a GitWorkspace (cloud mode)
 * - If workspaceRoot is provided, returns a regular Workspace (local mode)
 */
export async function createWorkspace(options: {
  workspaceRoot?: string;
  gitUrl?: string;
  branch?: string;
}): Promise<Workspace | GitWorkspace> {
  if (options.gitUrl) {
    const gitWorkspace = new GitWorkspace(options.gitUrl, { branch: options.branch });
    await gitWorkspace.init();
    return gitWorkspace;
  }

  if (options.workspaceRoot) {
    const { Workspace } = await import("./workspace.js");
    return new Workspace(options.workspaceRoot);
  }

  throw new Error("Either workspaceRoot or gitUrl must be provided");
}

// Re-export Workspace for convenience
export { Workspace } from "./workspace.js";
export { isInsideRoot } from "./workspace.js";