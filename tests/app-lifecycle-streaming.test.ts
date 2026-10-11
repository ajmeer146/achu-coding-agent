import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnAppProcess, readAppOutput, stopAppProcess } from "../src/tools/app-lifecycle.js";

test("spawnAppProcess captures stdout/stderr across platforms", async () => {
  // Use a simple command that prints something.
  // We'll use node to execute a one-liner to be platform independent.
  const command = 'node -e "console.log(\'test output\'); console.error(\'error output\'); setTimeout(() => process.exit(0), 100);"';
  const appInfo = spawnAppProcess(command, process.cwd());
  
  if (appInfo.process.stdout) {
    appInfo.process.stdout.on('data', d => console.log("CMD STDOUT:", d.toString()));
    appInfo.process.stderr.on('data', d => console.log("CMD STDERR:", d.toString()));
  }
  
  console.log("FULL COMMAND:", appInfo.command);
  console.log("OUTPUT PATH:", appInfo.outputPath);
  
  assert.ok(appInfo.outputPath, "outputPath should be defined");
  
  // Wait for it to finish writing
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const output = readAppOutput(appInfo);
  console.log("ACTUAL OUTPUT:", output);
  assert.ok(output.includes("test output"), "stdout should be captured");
  assert.ok(output.includes("error output"), "stderr should be captured");
  
  // Cleanup
  await stopAppProcess(appInfo);
  if (appInfo.outputPath) {
    try { fs.rmSync(appInfo.outputPath, { force: true }); } catch {}
  }
});
