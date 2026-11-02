import { defineConfig } from "@trigger.dev/sdk";
import { playwright } from "@trigger.dev/build/extensions/playwright";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";
import fs from "node:fs";
import path from "node:path";

const SYNCED_KEYS = ["NVIDIA_API_KEY", "NVIDIA_BASE_URL", "NVIDIA_MODEL", "DATABASE_URL", "DEPLOYMENT_SECRET", "WEB_PLATFORM_URL"] as const;

function readSyncedEnv(): Record<string, string> {
  const values: Record<string, string> = {};
  const candidatePaths = [
    path.join(process.cwd(), ".env"),
    "C:/Users/Achu146/achu-coding-agent/.env",
    "C:/Users/Achu146/OneDrive/Desktop/works-with-achu-v2/.env",
  ];

  for (const envPath of candidatePaths) {
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match) continue;
        const name = match[1];
        if (!(SYNCED_KEYS as readonly string[]).includes(name as any)) continue;
        let value = match[2].trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (value && !values[name]) values[name] = value.trim();
      }
    }
  }

  for (const key of SYNCED_KEYS) {
    if (!values[key] && process.env[key]) {
      values[key] = (process.env[key] as string).trim().replace(/^["']|["']$/g, "");
    }
  }
  return values;
}

export default defineConfig({
  project: "proj_saqtxqdgvbvazuqkwkdj",
  dirs: ["./src/trigger"],
  maxDuration: 1800,
  build: {
    extensions: [
      playwright({
        browsers: ["chromium"],
      }),
    ],
    external: ["playwright", "playwright-core", "better-sqlite3"],
  },
  extensions: [syncEnvVars(async () => readSyncedEnv())],
});