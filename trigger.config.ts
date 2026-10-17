import { defineConfig } from "@trigger.dev/sdk";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_saqtxqdgvbvazuqkwkdj",
  dirs: ["./src/trigger"],
  maxDuration: 300,
  build: {
    external: ["playwright", "playwright-core", "better-sqlite3"],
  },
  extensions: [syncEnvVars()],
});