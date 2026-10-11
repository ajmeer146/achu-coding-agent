import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { Workspace } from "../src/tools/workspace.js";
import { validateCommand } from "../src/utils/command-guard.js";
import { runCommand } from "../src/tools/terminal.js";

async function makeTempDir(label: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `achu-${label}-`));
  return fs.realpath(dir);
}

test("Workspace boundary validation (Symlink escape)", async () => {
  const wsDir = await makeTempDir("sandbox-ws");
  const outsideDir = await makeTempDir("sandbox-outside");
  
  const ws = new Workspace(wsDir);
  
  // Create a symlink inside the workspace pointing outside
  const symlinkPath = path.join(wsDir, "escape_link");
  await fs.symlink(outsideDir, symlinkPath, "junction");
  
  // Attempt to resolve a path inside the symlink
  assert.throws(
    () => ws.resolve("escape_link/secret.txt"),
    /Path outside workspace is not allowed|Symlink escape attempt detected|ENOENT/,
    "Should block resolving through symlink escaping the workspace"
  );
  
  await fs.rm(wsDir, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("Command execution structured policy: Destructive commands", () => {
  // Destructive command blocked
  assert.equal(validateCommand("rm -rf /").allowed, false);
  assert.equal(validateCommand("Remove-Item -Recurse C:\\").allowed, false);
  
  // Destructive command allowed for safe targets
  assert.equal(validateCommand("rm -rf node_modules").allowed, true);
  assert.equal(validateCommand("Remove-Item -Recurse dist").allowed, true);
});

test("Command execution structured policy: Credential access", () => {
  assert.equal(validateCommand("aws s3 ls").allowed, false);
  assert.equal(validateCommand("docker run hello-world").allowed, false);
  assert.equal(validateCommand("get-credential").allowed, false);
});

test("Command execution structured policy: Workspace escape via cd", () => {
  assert.equal(validateCommand("cd ..; ls").allowed, false);
  assert.equal(validateCommand("cd /; ls").allowed, false);
  assert.equal(validateCommand("set-location C:\\").allowed, false);
  
  // Safe cd allowed
  assert.equal(validateCommand("cd src; ls").allowed, true);
});

test("Command execution structured policy: System configuration", () => {
  assert.equal(validateCommand("reg add HKLM\\Software").allowed, false);
  assert.equal(validateCommand("netsh advfirewall").allowed, false);
});

test("Command output bounding and timeout", async () => {
  const wsDir = await makeTempDir("sandbox-timeout");
  
  // Test timeout (should throw timeout error, not run forever)
  await assert.rejects(
    runCommand("Start-Sleep -Seconds 5", wsDir, 1000),
    /Command timed out after 1000ms/,
    "Command should timeout"
  );
  
  await fs.rm(wsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("Normal development commands continue to work", () => {
  assert.equal(validateCommand("npm install express").allowed, true);
  assert.equal(validateCommand("npm run build").allowed, true);
  assert.equal(validateCommand("tsc --noEmit").allowed, true);
  assert.equal(validateCommand("node index.js").allowed, true);
});
