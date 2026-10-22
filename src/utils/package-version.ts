import path from "node:path";
import fs from "node:fs";

/**
 * Resolves the agent package version for both supported layouts:
 * - Bundled install: server.mjs and package.json sit side by side.
 * - Dev/build: server.js lives in dist/ or src/, package.json is one level up.
 *
 * Falls back to the provided fallback when no readable package.json with a
 * version field is found. Never throws.
 */
export function resolveAgentPackageVersion(baseDir: string, fallback = "1.0.0"): string {
  const candidates = [
    path.join(baseDir, "package.json"),
    path.join(baseDir, "..", "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: unknown };
      const version = typeof pkg?.version === "string" ? pkg.version.trim() : "";
      if (version) return version;
    } catch {
      // Try the next candidate; a malformed package.json must not crash startup.
    }
  }
  return fallback;
}
