import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAgentPackageVersion } from "../src/utils/package-version.js";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("resolveAgentPackageVersion prefers side-by-side package.json (bundled install layout)", async () => {
  const root = await makeTempDir("achu-version-bundled-");
  const installDir = path.join(root, "AchuLocalAgent");
  await fs.mkdir(installDir, { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ version: "9.9.9" }));
  await fs.writeFile(path.join(installDir, "package.json"), JSON.stringify({ version: "2.3.4" }));

  assert.equal(resolveAgentPackageVersion(installDir), "2.3.4");

  await fs.rm(root, { recursive: true, force: true });
});

test("resolveAgentPackageVersion falls back to parent package.json (dist/dev layout)", async () => {
  const root = await makeTempDir("achu-version-dev-");
  const distDir = path.join(root, "dist");
  await fs.mkdir(distDir, { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));

  assert.equal(resolveAgentPackageVersion(distDir), "1.2.3");

  await fs.rm(root, { recursive: true, force: true });
});

test("resolveAgentPackageVersion returns fallback when no package.json exists", async () => {
  const root = await makeTempDir("achu-version-missing-");
  const emptyDir = path.join(root, "empty");
  await fs.mkdir(emptyDir, { recursive: true });

  assert.equal(resolveAgentPackageVersion(emptyDir), "1.0.0");
  assert.equal(resolveAgentPackageVersion(path.join(emptyDir, "deep", "missing"), "4.5.6"), "4.5.6");

  await fs.rm(root, { recursive: true, force: true });
});

test("resolveAgentPackageVersion ignores malformed or version-less package.json", async () => {
  const root = await makeTempDir("achu-version-malformed-");
  const distDir = path.join(root, "dist");
  await fs.mkdir(distDir, { recursive: true });

  // Malformed side-by-side file must not throw; parent is valid.
  await fs.writeFile(path.join(distDir, "package.json"), "{not-json");
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ version: "3.4.5" }));
  assert.equal(resolveAgentPackageVersion(distDir), "3.4.5");

  // Version-less parent also falls back.
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "no-version" }));
  assert.equal(resolveAgentPackageVersion(distDir), "1.0.0");

  await fs.rm(root, { recursive: true, force: true });
});
