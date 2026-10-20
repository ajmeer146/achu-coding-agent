import { defineConfig } from "@trigger.dev/sdk";
import { playwright } from "@trigger.dev/build/extensions/playwright";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

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
  extensions: [syncEnvVars()],
});