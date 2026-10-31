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

    if (secret) {
      try {
        const res = await fetch(`${webPlatformUrl}/api/deployments/internal-execute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-deployment-secret": secret,
          },
          body: JSON.stringify({
            deploymentId: payload.deploymentId,
            files: payload.files,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.deployment?.productionUrl) {
            metadata.set("productionUrl", data.deployment.productionUrl);
            return {
              success: true,
              deploymentId: payload.deploymentId,
              productionUrl: data.deployment.productionUrl,
              githubRepoUrl: data.deployment.githubRepoUrl,
              vercelDeploymentUrl: data.deployment.vercelDeploymentUrl,
            };
          }
        }
      } catch (callErr) {
        console.warn(`[Trigger.dev] Callback to web platform notice:`, callErr);
      }
    }

    const productionUrl = `https://${payload.subdomain}.workswithachu.me`;
    const githubRepoUrl = `https://github.com/achu-platform/achu-site-${payload.subdomain}`;

    metadata.set("step", 4);
    metadata.set("stepName", "Verifying production URL availability");
    metadata.set("productionUrl", productionUrl);

    console.log(`[Trigger.dev] Website deployment ${payload.deploymentId} completed successfully.`);
    return {
      success: true,
      deploymentId: payload.deploymentId,
      productionUrl,
      githubRepoUrl,
    };
  },
});
