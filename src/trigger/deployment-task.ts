import { schemaTask, metadata } from "@trigger.dev/sdk/v3";
import { z } from "zod";

export const DeploymentTaskPayloadSchema = z.object({
  deploymentId: z.string().min(1),
  subdomain: z.string().min(1),
  siteName: z.string().min(1),
  userId: z.string().min(1),
  userEmail: z.string().email(),
  framework: z.string().default("static"),
  taskId: z.string().optional(),
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
    })
  ).optional(),
});

export type DeploymentTaskPayload = z.infer<typeof DeploymentTaskPayloadSchema>;

export const DeploymentTaskResultSchema = z.object({
  success: z.boolean(),
  deploymentId: z.string(),
  productionUrl: z.string().optional(),
  githubRepoUrl: z.string().optional(),
  vercelDeploymentUrl: z.string().optional(),
  error: z.string().optional(),
});

export type DeploymentTaskResult = z.infer<typeof DeploymentTaskResultSchema>;

/**
 * Trigger.dev durable background deployment task.
 * Runs independently of the browser session and survives client disconnects.
 */
export const websiteDeploymentTask = schemaTask({
  id: "website-deployment-run",
  schema: DeploymentTaskPayloadSchema,
  maxDuration: 600, // 10 minutes max
  machine: "small-1x",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 15000,
    maxTimeoutInMs: 120000,
    factor: 2,
  },
  run: async (payload: DeploymentTaskPayload): Promise<DeploymentTaskResult> => {
    console.log(`[Trigger.dev] Starting durable website deployment: ${payload.deploymentId} (${payload.subdomain})`);
    
    metadata.set("status", "running");
    metadata.set("step", 1);
    metadata.set("stepName", "Executing cloud deployment pipeline");
    metadata.set("deploymentId", payload.deploymentId);
    metadata.set("subdomain", payload.subdomain);

    const webPlatformUrl = (process.env.WEB_PLATFORM_URL || "https://www.workswithachu.me").replace(/\/+$/, "");
    const secret = (process.env.DEPLOYMENT_SECRET || "").trim().replace(/^["']|["']$/g, "");

    if (!secret) {
      const errMsg = "Missing canonical DEPLOYMENT_SECRET in worker environment. Cannot securely authorize internal deployment execution.";
      console.error(`[Trigger.dev] ${errMsg}`);
      throw new Error(errMsg);
    }

    metadata.set("authConfigured", true);

    try {
      // Never transfer complete project artifacts through a serverless orchestration callback.
      // The Next.js server retrieves verified artifacts directly from persistent database storage.
      const res = await fetch(`${webPlatformUrl}/api/deployments/internal-execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-deployment-secret": secret,
        },
        body: JSON.stringify({
          deploymentId: payload.deploymentId,
          subdomain: payload.subdomain,
          siteName: payload.siteName,
          userId: payload.userId,
          userEmail: payload.userEmail,
          framework: payload.framework,
          taskId: payload.taskId,
          // Only send files if explicitly small (< 20KB) for backwards compatibility or lightweight tests
          files: (payload.files && payload.files.length <= 5 && JSON.stringify(payload.files).length < 20_000)
            ? payload.files
            : undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errDetail = errData?.error?.message || res.statusText || `HTTP ${res.status}`;
        throw new Error(`Web platform deployment execution failed (${res.status}): ${errDetail}`);
      }

      const data = await res.json();
      const dep = data?.deployment;
      if (!dep) {
        throw new Error("Web platform did not return deployment details.");
      }
      if (dep.status === "FAILED" || !dep.productionUrl) {
        throw new Error(`Deployment failed: ${dep.errorMessage || "Deployment did not produce a production URL."}`);
      }

      metadata.set("step", 2);
      metadata.set("stepName", "Pipeline executed successfully");
      metadata.set("productionUrl", dep.productionUrl || `https://${payload.subdomain}.workswithachu.me`);
      if (dep.githubRepoUrl) metadata.set("githubRepoUrl", dep.githubRepoUrl);
      metadata.set("status", "completed");

      console.log(`[Trigger.dev] Website deployment ${payload.deploymentId} completed successfully.`);
      return {
        success: true,
        deploymentId: payload.deploymentId,
        productionUrl: dep.productionUrl,
        githubRepoUrl: dep.githubRepoUrl,
        vercelDeploymentUrl: dep.vercelDeploymentUrl,
      };
    } catch (err: unknown) {
      console.error(`[Trigger.dev] Durable deployment execution error:`, err);
      throw err;
    }
  },
});
