import { schemaTask, metadata } from "@trigger.dev/sdk";
import { z } from "zod";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { Workspace } from "../tools/workspace.js";
import { WorkspaceRegistry } from "../tools/workspace-registry.js";
import { GitWorkspace } from "../tools/git-workspace.js";
import { AgentResult } from "../agent.js";
import { validateGitUrl, redactCredentials } from "../tools/git-workspace.js";
import { sanitizeUserFacingError } from "../utils/error-sanitizer.js";

/**
 * Safely get the workspace root path from either Workspace or GitWorkspace.
 * Both classes have a getRoot() method, but this provides a fallback
 * for defense-in-depth against potential runtime issues.
 */
export function getWorkspaceRoot(workspace: Workspace | GitWorkspace): string {
  if (typeof workspace.getRoot === "function") {
    return workspace.getRoot();
  }
  // Fallback: both classes have a `root` property at runtime
  // (Workspace: public readonly; GitWorkspace: private but compiled to regular property)
  return (workspace as { root: string }).root;
}

/**
 * Payload schema for the agent task.
 * Supports multiple execution modes:
 * - Local development: workspaceRoot (uses shared volume)
 * - Cloud production: gitUrl (git checkout per task, no shared volume needed)
 * - Registered workspace: workspaceId (requires prior registration)
 */
export const AgentTaskPayloadSchema = z.object({
  task: z.string().min(1, "Task description is required"),
  workspaceId: z.string().min(1).optional(),
  workspaceRoot: z.string().min(1).optional(),
  gitUrl: z.string().url().optional(),
  branch: z.string().optional().default("main"),
  sessionId: z.string().optional(),
  requestedVerification: z.string().optional(),
  maxSteps: z.number().int().positive().max(50).optional().default(30),
  maxRecoveryAttempts: z.number().int().nonnegative().max(5).optional().default(3),
  // Model configuration (optional - can be set via env vars or passed directly)
  nvidiaApiKey: z.string().optional(),
  nvidiaBaseUrl: z.string().optional(),
  nvidiaModel: z.string().optional(),
  // Attached files to populate into the workspace
  files: z.array(z.object({
    path: z.string(),
    content: z.string(),
  })).optional(),
}).refine((data) => data.workspaceId || data.workspaceRoot || data.gitUrl || (data.files && data.files.length > 0), {
  message: "Either workspaceId, workspaceRoot, gitUrl, or files must be provided",
});

type AgentTaskPayload = z.infer<typeof AgentTaskPayloadSchema>;

export const AgentTaskResultSchema = z.object({
  success: z.boolean(),
  stopReason: z.string().nullable(),
  verificationPassed: z.boolean(),
  completedSteps: z.number(),
  totalSteps: z.number(),
  filesModified: z.array(z.string()),
  artifacts: z.array(z.object({
    path: z.string(),
    content: z.string(),
  })).optional(),
  gitCommitted: z.boolean().optional(),
  gitPushed: z.boolean().optional(),
  error: z.string().optional(),
  qualityScore: z.number().optional(),
  principlesSummary: z.string().optional(),
});

type AgentTaskResult = z.infer<typeof AgentTaskResultSchema>;

function getWorkspaceRegistry(): WorkspaceRegistry {
  return WorkspaceRegistry.getInstance();
}

export const codingAgentTask = schemaTask({
  id: "coding-agent-run",
  schema: AgentTaskPayloadSchema,
  maxDuration: 1800, // 30 minutes max
  machine: "small-2x",
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 30000, // 30 seconds
    maxTimeoutInMs: 300000, // 5 minutes
    factor: 2,
  },
  run: async (payload: AgentTaskPayload): Promise<AgentTaskResult> => {
    console.log(`[Trigger.dev] Starting coding agent task`);
    console.log(`[Trigger.dev] Task: ${payload.task}`);

    metadata.set("step", 1);
    metadata.set("stepName", "Preparing isolated workspace");
    metadata.set("progress", 10);

    let workspace: Workspace | GitWorkspace;

    if (payload.gitUrl) {
      // Cloud mode: git checkout per task, no shared volume needed
      // Use sanitized URL for logging to avoid credential leaks
      const { sanitizedUrl } = validateGitUrl(payload.gitUrl);
      console.log(`[Trigger.dev] Cloud mode: cloning ${sanitizedUrl} (branch: ${payload.branch})`);
      try {
        // Enable push only if explicitly requested
        const gitWorkspace = new GitWorkspace(payload.gitUrl, { 
          branch: payload.branch,
          pushEnabled: true // Enable push for cloud mode
        });
        await gitWorkspace.init();
        workspace = gitWorkspace;
        console.log(`[Trigger.dev] Git workspace initialized at: ${getWorkspaceRoot(workspace)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          stopReason: `Git clone failed: ${message}`,
          verificationPassed: false,
          completedSteps: 0,
          totalSteps: 0,
          filesModified: [],
          error: `Git clone failed: ${message}`,
        };
      }
    } else if (payload.workspaceRoot) {
      // Local testing mode: register workspace directly in this process
      console.log(`[Trigger.dev] Using workspaceRoot: ${payload.workspaceRoot}`);
      try {
        const registry = getWorkspaceRegistry();
        const workspaceId = await registry.register(payload.workspaceRoot);
        const resolved = await registry.resolveWorkspace(workspaceId);
        workspace = resolved.workspace;
        console.log(`[Trigger.dev] Workspace registered and resolved: ${resolved.root}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          stopReason: `Workspace registration failed: ${message}`,
          verificationPassed: false,
          completedSteps: 0,
          totalSteps: 0,
          filesModified: [],
          error: `Workspace registration failed: ${message}`,
        };
      }
    } else if (payload.workspaceId) {
      // Production mode with workspace ID: resolve workspace ID through registry or create isolated cloud workspace
      console.log(`[Trigger.dev] Workspace ID: ${payload.workspaceId}`);
      try {
        const registry = getWorkspaceRegistry();
        const resolved = await registry.resolveWorkspace(payload.workspaceId);
        workspace = resolved.workspace;
        console.log(`[Trigger.dev] Workspace resolved from registry: ${resolved.root}`);
      } catch (registryError) {
        // Initialize an isolated cloud workspace on the worker
        const sanitizedId = payload.workspaceId.replace(/[^a-zA-Z0-9_-]/g, "_");
        const cloudWorkspaceDir = path.join(os.tmpdir(), "achu-workspace", `ws-${sanitizedId}`);
        await fs.promises.mkdir(cloudWorkspaceDir, { recursive: true });
        workspace = new Workspace(cloudWorkspaceDir);
        console.log(`[Trigger.dev] Isolated cloud workspace initialized at: ${cloudWorkspaceDir}`);
      }
    } else if (payload.files && payload.files.length > 0) {
      // Cloud task created from browser-uploaded project files
      const tmpDir = path.join(os.tmpdir(), "achu-workspace", `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      await fs.promises.mkdir(tmpDir, { recursive: true });
      workspace = new Workspace(tmpDir);
      console.log(`[Trigger.dev] File-based workspace initialized at: ${tmpDir}`);
    } else {
      // Should not happen due to schema refinement
      return {
        success: false,
        stopReason: "Either workspaceId, workspaceRoot, gitUrl, or files must be provided",
        verificationPassed: false,
        completedSteps: 0,
        totalSteps: 0,
        filesModified: [],
        error: "Either workspaceId, workspaceRoot, gitUrl, or files must be provided",
      };
    }

    // Save original environment variables
    const originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
    const originalSessionId = process.env.SESSION_ID;
    const originalAchuSessionId = process.env.ACHU_SESSION_ID;
    const originalNvidiaApiKey = process.env.NVIDIA_API_KEY;
    const originalNvidiaBaseUrl = process.env.NVIDIA_BASE_URL;
    const originalNvidiaModel = process.env.NVIDIA_MODEL;

    // Set up environment for the agent
    process.env.WORKSPACE_ROOT = getWorkspaceRoot(workspace);
    process.env.SESSION_ID = payload.sessionId || `trigger-${Date.now()}`;
    process.env.ACHU_SESSION_ID = payload.sessionId || `trigger-${Date.now()}`;

    // Write any user-attached files into the workspace
    if (payload.files && payload.files.length > 0) {
      console.log(`[Trigger.dev] Writing ${payload.files.length} attached file(s) into workspace...`);
      for (const file of payload.files) {
        try {
          await workspace.write(file.path, file.content);
          console.log(`[Trigger.dev] Attached file written: ${file.path}`);
        } catch (fileErr) {
          console.warn(`[Trigger.dev] Could not write attached file ${file.path}:`, fileErr);
        }
      }
    }
    // Ensure model configuration is available to the agent (priority: payload > env vars)
    if (payload.nvidiaApiKey) process.env.NVIDIA_API_KEY = payload.nvidiaApiKey;
    else if (originalNvidiaApiKey) process.env.NVIDIA_API_KEY = originalNvidiaApiKey;
    if (payload.nvidiaBaseUrl) process.env.NVIDIA_BASE_URL = payload.nvidiaBaseUrl;
    else if (originalNvidiaBaseUrl) process.env.NVIDIA_BASE_URL = originalNvidiaBaseUrl;
    if (payload.nvidiaModel) process.env.NVIDIA_MODEL = payload.nvidiaModel;
    else if (originalNvidiaModel) process.env.NVIDIA_MODEL = originalNvidiaModel;

    try {
      // Import and run the agent
      const { runAgent } = await import("../agent.js");

      console.log(`[Trigger.dev] Running agent with task: ${payload.task}`);
      console.log(`[Trigger.dev] Session ID: ${process.env.SESSION_ID}`);

      metadata.set("step", 2);
      metadata.set("stepName", "Planning and executing coding task");
      metadata.set("progress", 30);

      // Run the agent - this will execute the full agent loop
      const result = await runAgent(payload.task, {
        maxSteps: payload.maxSteps,
        maxRecoveryAttempts: payload.maxRecoveryAttempts,
        onProgress: (stepNum, stepName, log) => {
          metadata.set("step", stepNum);
          metadata.set("stepName", stepName);
          if (log) {
            metadata.set("latestLog", log);
          }
        },
      }) as AgentResult;

      console.log(`[Trigger.dev] Agent task completed`);

      metadata.set("step", 5);
      metadata.set("stepName", "Collecting generated artifacts");
      metadata.set("progress", 90);

      let gitCommitted = false;
      let gitPushed = false;

      const finalResult = result ?? {
        success: false,
        stopReason: "Agent did not return a result",
        verificationPassed: false,
        completedSteps: 0,
        totalSteps: 0,
        filesModified: [],
        error: "Agent execution did not produce a result",
      };

      // Collect all modified/created project files from workspace root
      const rootPath = getWorkspaceRoot(workspace);

      // If project has a build script and dist/ does not exist, run build to generate production artifacts
      try {
        const pkgPath = path.join(rootPath, "package.json");
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(await fs.promises.readFile(pkgPath, "utf8"));
          if (pkg.scripts?.build && !pkg.scripts.build.includes("echo") && !fs.existsSync(path.join(rootPath, "dist"))) {
            console.log(`[Trigger.dev] Running project build script for production artifacts...`);
            const { runCommand } = await import("../tools/terminal.js");
            await runCommand("npm run build", rootPath, 120000);
          }
        }
      } catch (buildErr) {
        console.warn(`[Trigger.dev] Optional build step skipped or failed:`, buildErr);
      }

      const IGNORE_SCAN = new Set(["node_modules", ".git", ".achu-sessions", ".turbo", ".cache", ".registry"]);
      const artifactsMap = new Map<string, string>();

      async function scanDirectory(dir: string, relPrefix = "") {
        try {
          const entries = await fs.promises.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (IGNORE_SCAN.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
              if (artifactsMap.size < 250) {
                await scanDirectory(full, rel);
              }
            } else if (entry.isFile()) {
              if (artifactsMap.size < 250) {
                try {
                  const stat = await fs.promises.stat(full);
                  if (stat.size < 2 * 1024 * 1024) {
                    const content = await fs.promises.readFile(full, "utf8");
                    artifactsMap.set(rel.replace(/\\/g, "/"), content);
                  }
                } catch {}
              }
            }
          }
        } catch {}
      }

      await scanDirectory(rootPath);

      // Also ensure any explicitly modified file is captured
      for (const filePath of finalResult.filesModified) {
        try {
          const normalized = filePath.replace(/\\/g, "/");
          if (!artifactsMap.has(normalized)) {
            const content = await workspace.read(filePath);
            artifactsMap.set(normalized, content);
          }
        } catch {}
      }

      const artifacts: Array<{ path: string; content: string }> = Array.from(artifactsMap.entries()).map(([p, c]) => ({
        path: p,
        content: c,
      }));

      metadata.set("step", 6);
      metadata.set("stepName", "Completed");
      metadata.set("progress", 100);

      // If using GitWorkspace, commit and push changes
      if (workspace instanceof GitWorkspace) {
        console.log(`[Trigger.dev] Committing and pushing changes...`);
        try {
          // Use sanitized URL for logging (gitUrl is guaranteed to be defined for GitWorkspace)
          const { sanitizedUrl } = validateGitUrl(payload.gitUrl!);
          const pushResult = await workspace.commitAndPush(`chore: ${payload.task}`);
          gitCommitted = Boolean(pushResult.committed);
          gitPushed = Boolean(pushResult.pushed);
          if (pushResult.committed) {
            console.log(`[Trigger.dev] Changes pushed to ${sanitizedUrl}`);
          } else {
            console.log(`[Trigger.dev] No changes to commit, skipping push`);
          }
        } catch (pushError) {
          // Sanitize push error message - only redact credentials from URLs, not the entire error
          const errorMessage = String(pushError instanceof Error ? pushError.message : pushError);
          // Only redact if the error contains a URL with credentials
          const sanitizedError = errorMessage.replace(
            /https?:\/\/[^:@\s]+:[^:@\s]+@[^:\/\s]+/g,
            (match) => {
              try {
                return redactCredentials(match);
              } catch {
                return "[REDACTED]";
              }
            }
          );
          console.warn(`[Trigger.dev] Failed to push changes: ${sanitizedError}`);
          // Don't fail the task if push fails - the work was done locally
        }
        await workspace.cleanup();
      } else {
        // Temporary file-based workspace cleanup
        try {
          const rootPath = getWorkspaceRoot(workspace);
          if (rootPath.includes("achu-workspace")) {
            await fs.promises.rm(rootPath, { recursive: true, force: true });
          }
        } catch {}
      }

      return {
        success: finalResult.success,
        stopReason: finalResult.stopReason ? sanitizeUserFacingError(finalResult.stopReason) : null,
        verificationPassed: finalResult.verificationPassed,
        completedSteps: finalResult.completedSteps,
        totalSteps: finalResult.totalSteps,
        filesModified: finalResult.filesModified,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
        gitCommitted,
        gitPushed,
        error: finalResult.error ? sanitizeUserFacingError(finalResult.error) : undefined,
        qualityScore: finalResult.qualityAudit?.overallScore,
        principlesSummary: finalResult.principlesSummary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const sanitized = sanitizeUserFacingError(message);
      console.error(`[Trigger.dev] Agent execution failed:`, error);

      return {
        success: false,
        stopReason: sanitized,
        verificationPassed: false,
        completedSteps: 0,
        totalSteps: 0,
        filesModified: [],
        error: sanitized,
      };
    } finally {
      // Restore environment
      if (originalWorkspaceRoot !== undefined) {
        process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
      } else {
        delete process.env.WORKSPACE_ROOT;
      }
      if (originalSessionId !== undefined) {
        process.env.SESSION_ID = originalSessionId;
      } else {
        delete process.env.SESSION_ID;
      }
      if (originalAchuSessionId !== undefined) {
        process.env.ACHU_SESSION_ID = originalAchuSessionId;
      } else {
        delete process.env.ACHU_SESSION_ID;
      }
      if (originalNvidiaApiKey !== undefined) {
        process.env.NVIDIA_API_KEY = originalNvidiaApiKey;
      } else {
        delete process.env.NVIDIA_API_KEY;
      }
      if (originalNvidiaBaseUrl !== undefined) {
        process.env.NVIDIA_BASE_URL = originalNvidiaBaseUrl;
      } else {
        delete process.env.NVIDIA_BASE_URL;
      }
      if (originalNvidiaModel !== undefined) {
        process.env.NVIDIA_MODEL = originalNvidiaModel;
      } else {
        delete process.env.NVIDIA_MODEL;
      }
    }
  },
});