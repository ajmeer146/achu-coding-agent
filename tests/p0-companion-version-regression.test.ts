/**
 * P0 Regression Test: Companion Version Consistency
 *
 * Verifies that the companion /api/companion/update/check endpoint
 * reports the same version as AGENT_PACKAGE_VERSION (resolved from package.json),
 * not the old hardcoded "1.0.0".
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveAgentPackageVersion } from "../src/utils/package-version.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// In tests/ the package.json is one level up
const agentRoot = path.resolve(__dirname, "..");

function readPackageJson(): { version: string } {
  return JSON.parse(readFileSync(path.join(agentRoot, "package.json"), "utf8"));
}

describe("P0 — Companion Version Consistency", () => {
  test("1. resolveAgentPackageVersion returns a non-empty semver string", () => {
    const version = resolveAgentPackageVersion(agentRoot);
    assert.ok(version.length > 0, "version must not be empty");
    assert.match(version, /^\d+\.\d+\.\d+/, "version must be semver-shaped");
  });

  test("2. Resolved version matches package.json version", () => {
    const pkg = readPackageJson();
    const version = resolveAgentPackageVersion(agentRoot);
    assert.equal(version, pkg.version,
      `resolveAgentPackageVersion must match package.json version (${pkg.version})`);
  });

  test("3. Resolved version is NOT the old hardcoded placeholder", () => {
    const version = resolveAgentPackageVersion(agentRoot);
    const pkg = readPackageJson();
    // The old bug set this to "1.0.0" even after package.json was bumped to 1.0.3+.
    if (pkg.version !== "1.0.0") {
      assert.notEqual(version, "1.0.0",
        "If package.json is not 1.0.0, the resolved version must not be 1.0.0 either");
    }
    assert.ok(version, "version must be truthy");
  });

  test("4. server.ts update/check endpoint uses AGENT_PACKAGE_VERSION (source inspection)", async () => {
    const serverSrc = await readFile(
      path.join(agentRoot, "src", "server.ts"), "utf8");

    // The old bug: hardcoded "1.0.0" string inside the update/check handler
    const updateCheckIdx = serverSrc.indexOf('"/api/companion/update/check"');
    assert.ok(updateCheckIdx >= 0, "update/check route must exist in server.ts");

    // Extract the handler body (from the route definition to the next route)
    const handlerBody = serverSrc.slice(updateCheckIdx, updateCheckIdx + 800);

    // Must NOT hardcode the version string
    assert.ok(
      !handlerBody.includes('"1.0.0"'),
      "update/check handler must not hardcode version \"1.0.0\""
    );

    // Must reference AGENT_PACKAGE_VERSION
    assert.ok(
      handlerBody.includes("AGENT_PACKAGE_VERSION"),
      "update/check handler must use AGENT_PACKAGE_VERSION"
    );
  });

  test("5. Live companion /api/companion/update/check returns correct version (when server is running)", async () => {
    let health: any;
    try {
      const res = await fetch("http://127.0.0.1:3001/api/companion/update/check", {
        signal: AbortSignal.timeout(2000),
      });
      health = await res.json();
    } catch {
      console.log("[skip] Companion offline — live version test skipped");
      return;
    }

    assert.ok(health.ok, "update/check must return ok: true");
    assert.ok(health.currentVersion, "currentVersion must be present");
    assert.match(String(health.currentVersion), /^\d+\.\d+\.\d+/,
      "currentVersion must be semver");

    const pkg = readPackageJson();
    if (pkg.version !== "1.0.0") {
      assert.notEqual(health.currentVersion, "1.0.0",
        `Live companion reports 1.0.0 but package.json is ${pkg.version} — version drift confirmed`);
    }
    assert.equal(health.currentVersion, pkg.version,
      `Live companion version (${health.currentVersion}) must match package.json (${pkg.version})`);
  });
});
