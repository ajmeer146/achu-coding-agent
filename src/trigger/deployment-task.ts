import { schemaTask, metadata } from "@trigger.dev/sdk/v3";
import { z } from "zod";

export const DeploymentTaskPayloadSchema = z.object({
  deploymentId: z.string().min(1),
  subdomain: z.string().min(1),
  siteName: z.string().min(1),
  userId: z.string().min(1),
  userEmail: z.string().email(),
  framework: z.string().default("static"),
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
    
    metadata.set("step", 1);
    metadata.set("stepName", "Creating isolated GitHub repository");
    metadata.set("deploymentId", payload.deploymentId);
    metadata.set("subdomain", payload.subdomain);

    metadata.set("step", 2);
    metadata.set("stepName", "Uploading source files to GitHub");

    metadata.set("step", 3);
    metadata.set("stepName", "Deploying Vercel project and custom subdomain");

    const webPlatformUrl = (process.env.WEB_PLATFORM_URL || "https://www.workswithachu.me").replace(/\/+$/, "");
    const secret = process.env.DEPLOYMENT_SECRET || process.env.SESSION_SECRET || process.env.WORKSPACE_SECRET || "";

    if (!secret) {
      const errMsg = "Missing DEPLOYMENT_SECRET/SESSION_SECRET in worker environment. Cannot securely authorize internal deployment execution.";
      console.error(`[Trigger.dev] ${errMsg}`);
      throw new Error(errMsg);
    }

    try {
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
          files: payload.files,
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

      metadata.set("step", 4);
      metadata.set("stepName", "Deployment complete");
      metadata.set("productionUrl", dep.productionUrl || `https://${payload.subdomain}.workswithachu.me`);

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
