import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../src/tools/workspace.js";
import {
  initializePlan,
  isToolResultFailure,
  isToolResultSuccess,
  updatePlanProgress,
  generateRecoveryHint,
  type AgentState,
  type PlanStep,
} from "../src/agent.ts";
import {
  scaffoldReactViteProject,
  validateProjectStructure,
} from "../src/tools/scaffold.js";
import { validateCommand } from "../src/utils/command-guard.js";

describe("Achu Test Lab Defect Regression Tests", () => {
  const achuTestLabPrompt = `Build a complete, working React + Vite website named **Achu Test Lab** inside a new, isolated workspace project.

### Requirements
1. Inspect the current workspace and create a new project directory named \`achu-test-lab\`. Do not modify or overwrite unrelated existing projects.
2. Scaffold a valid React + Vite application with all required files, including \`package.json\`, \`index.html\`, \`src/main.jsx\`, \`src/App.jsx\`, and \`vite.config.js\`.
3. Create a polished, responsive testing dashboard with:
   - Heading: “Achu Test Lab”
   - A status badge showing “Application Running”
   - A counter initialized to 0
   - A working Increment button that increases the counter by 1
   - A Reset button that resets the counter to 0
   - A task checklist with three interactive checkboxes
   - Responsive styling for desktop and mobile.
4. Install dependencies if necessary, run the correct Vite development server, and use the actual selected port if the default port is unavailable.
5. Verify that every file was saved successfully and that the application builds without errors.
6. Open the running application using the available browser verification and Live Preview tools. Confirm that the rendered page contains “Achu Test Lab” and that the counter buttons work.
7. If an error occurs, inspect the actual error, fix the root cause, and retry with bounded attempts. Do not repeat ineffective commands indefinitely.
8. Keep the project root consistent across file operations, terminal commands, server lifecycle, and Live Preview. Keep the development server running after successful verification.`;

  test("1. Planning specificity: React/Vite creation request does NOT generate auth, validation, or test-file steps", () => {
    const plan = initializePlan(achuTestLabPrompt, {
      hasProject: false,
      projectType: "none",
      existingFiles: [],
      framework: null,
    });

    // 1. Must NOT include authentication or validation steps
    const hasAuthStep = plan.some(
      (s) =>
        s.description.toLowerCase().includes("auth") ||
        s.description.toLowerCase().includes("validation") ||
        (s.toolType === "search_code" && (s.target || "").includes("auth"))
    );
    assert.equal(
      hasAuthStep,
      false,
      "New React/Vite request must not include authentication/validation search steps"
    );

    // 2. Must NOT include test file creation or inspection steps
    const hasTestFileStep = plan.some(
      (s) =>
        s.description.toLowerCase().includes("test file") ||
        s.description.toLowerCase().includes("identify test") ||
        (s.toolType === "create_file" && (s.target || "").includes("test"))
    );
    assert.equal(
      hasTestFileStep,
      false,
      "New React/Vite request must not include unrelated test file creation steps"
    );

    // 3. Must NOT include 'Read target file to understand current implementation' on brand new project
    const hasReadTargetStep = plan.some((s) =>
      s.description.toLowerCase().includes("read target file to understand")
    );
    assert.equal(
      hasReadTargetStep,
      false,
      "New project must not plan to read non-existent target files"
    );

    // 4. Must enforce complete web application lifecycle
    const toolTypes = plan.map((s) => s.toolType);
    assert.ok(toolTypes.includes("scaffold_project"), "Plan must include scaffolding");
    assert.ok(toolTypes.includes("edit_file"), "Plan must include component editing");
    assert.ok(
      toolTypes.includes("run_command") || toolTypes.includes("run_verification"),
      "Plan must include build step"
    );
    assert.ok(toolTypes.includes("start_app"), "Plan must include start_app");
    assert.ok(toolTypes.includes("open_browser"), "Plan must include open_browser");
    assert.ok(toolTypes.includes("browser_verify"), "Plan must include browser_verify");
    assert.ok(toolTypes.includes("close_browser"), "Plan must include close_browser");
    assert.ok(toolTypes.includes("stop_app"), "Plan must include stop_app");

    // 5. Must maintain strict ordering dependencies
    const scaffoldIdx = plan.findIndex((s) => s.toolType === "scaffold_project");
    const editIdx = plan.findIndex((s) => s.toolType === "edit_file");
    const buildIdx = plan.findIndex(
      (s) =>
        (s.toolType === "run_command" || s.toolType === "run_verification") &&
        s.description.toLowerCase().includes("build")
    );
    const startIdx = plan.findIndex((s) => s.toolType === "start_app");
    const browserVerifyIdx = plan.findIndex((s) => s.toolType === "browser_verify");

    assert.ok(scaffoldIdx < editIdx, "Scaffold must precede component edit");
    assert.ok(editIdx < buildIdx, "Component edit must precede build");
    assert.ok(buildIdx < startIdx, "Build must precede server start");
    assert.ok(startIdx < browserVerifyIdx, "Server start must precede browser verification");
  });

  test("2. Authoritative project root & de-duplication: resolves relative paths exactly once without duplicated segments", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-root-test-"));
    const workspaceRoot = path.join(tempDir, "intrn py");
    const projectSubdir = path.join(workspaceRoot, "achu-test-lab");

    await fs.mkdir(projectSubdir, { recursive: true });
    await fs.writeFile(
      path.join(projectSubdir, "package.json"),
      JSON.stringify({ name: "achu-test-lab", scripts: { dev: "vite" } }),
      "utf8"
    );
    await fs.mkdir(path.join(projectSubdir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(projectSubdir, "src", "App.jsx"),
      "export default function App() { return <h1>Achu Test Lab</h1>; }",
      "utf8"
    );

    const workspace = new Workspace(workspaceRoot);

    // Initial root discovery finds package.json in child directory
    const authRoot = await workspace.getAuthoritativeProjectRoot();
    assert.equal(authRoot, projectSubdir);

    // Switch workspace root to authoritative child directory
    workspace.setRoot(projectSubdir);
    assert.equal(workspace.parentRoot, workspaceRoot);

    // Test A: Resolving path prefixed with child directory name does NOT produce duplicated segment
    const resolvedPre = workspace.resolve("achu-test-lab/package.json");
    const expectedPath = path.resolve(projectSubdir, "package.json");
    assert.equal(
      resolvedPre,
      expectedPath,
      "Path prefixed with child directory name must resolve to child file, not child/child/file"
    );
    assert.ok(
      !resolvedPre.includes(path.join("achu-test-lab", "achu-test-lab")),
      "Must not contain duplicated child directory segment"
    );

    // Test B: Resolving standard relative path works identically
    const resolvedStd = workspace.resolve("package.json");
    assert.equal(resolvedStd, expectedPath);

    // Test C: Nested source file resolution
    const resolvedSrc = workspace.resolve("achu-test-lab/src/App.jsx");
    const expectedSrc = path.resolve(projectSubdir, "src", "App.jsx");
    assert.equal(resolvedSrc, expectedSrc);

    // Test D: File reads via workspace use deduplicated path
    const content = await workspace.read("achu-test-lab/package.json");
    assert.ok(content.includes("achu-test-lab"));

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("3. Lifecycle dependencies: start_app blocked before package.json exists", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-lifecycle-test-"));
    const workspace = new Workspace(tempDir);

    // Verify workspace has no package.json
    assert.equal(fsSync.existsSync(path.join(tempDir, "package.json")), false);

    // Verify validateProjectStructure catches missing entry files
    const validation = validateProjectStructure(tempDir);
    assert.equal(validation.valid, false);
    assert.ok(validation.error?.includes("missing package.json"));

    // Scaffolding creates valid project
    const scaffoldRes = await scaffoldReactViteProject(workspace, "achu-test-lab");
    assert.equal(scaffoldRes.success, true);

    const validPkg = path.join(workspace.root, "package.json");
    assert.equal(fsSync.existsSync(validPkg), true);

    const postValidation = validateProjectStructure(workspace.root);
    assert.equal(postValidation.valid, true);
    assert.equal(postValidation.projectType, "react");

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("4. Structured tool status: successful file reads and directory listings are NOT treated as failures", () => {
    // 1. JSON file content starting with {
    const jsonContent = JSON.stringify({ name: "achu-test-lab", version: "0.1.0" }, null, 2);
    assert.equal(
      isToolResultFailure("read_file", jsonContent),
      false,
      "Valid JSON content starting with { must NOT be treated as a failure"
    );

    // 2. JSX/JavaScript content starting with import
    const jsxContent = "import React from 'react';\nexport default function App() { return <div>Achu Test Lab</div>; }";
    assert.equal(
      isToolResultFailure("read_file", jsxContent),
      false,
      "Valid JSX content starting with import must NOT be treated as a failure"
    );

    // 3. JSX content starting with <
    const rawJsx = "<div className=\"container\">\n  <h1>Achu Test Lab</h1>\n</div>";
    assert.equal(
      isToolResultFailure("read_file", rawJsx),
      false,
      "Valid JSX content starting with < must NOT be treated as a failure"
    );

    // 4. HTML content starting with <!DOCTYPE
    const htmlContent = "<!DOCTYPE html>\n<html><head><title>Achu Test Lab</title></head></html>";
    assert.equal(
      isToolResultFailure("read_file", htmlContent),
      false,
      "Valid HTML content must NOT be treated as a failure"
    );

    // 5. Directory listing starting with [DIR] or [FILE]
    const dirContent = "[DIR] src\n[FILE] index.html\n[FILE] package.json\n[FILE] vite.config.js";
    assert.equal(
      isToolResultFailure("list_directory", dirContent),
      false,
      "Directory listing starting with [DIR] must NOT be treated as a failure"
    );

    // 6. Real error prefixes ARE treated as failures
    assert.equal(isToolResultFailure("read_file", "Tool error: ENOENT no such file"), true);
    assert.equal(isToolResultFailure("read_file", "BLOCKED: Path outside workspace"), true);
  });

  test("5. Recovery loop: successful file inspection does not consume recovery attempts or overwrite lastError", () => {
    const samplePlan: PlanStep[] = [
      { id: "1", description: "Scaffold React app", status: "completed", toolType: "scaffold_project" },
      { id: "2", description: "Start the development server", status: "failed", toolType: "start_app" },
      { id: "3", description: "Verify in browser", status: "pending", toolType: "browser_verify" },
    ];

    const state: AgentState = {
      requestedVerification: null,
      lastVerification: null,
      verificationPassed: false,
      stopReason: null,
      commandHistory: [],
      stepsTaken: new Map(),
      completedTasks: new Set(["scaffold_project:app"]),
      currentPlan: samplePlan,
      phase: "recover",
      recoveryAttempts: 1,
      lastError: {
        command: "start_app",
        exitCode: 1,
        stdout: "",
        stderr: "",
        errorMessage: "No start command found in package.json",
      },
      repeatedFailures: new Map(),
      browserSession: null,
      verificationMemory: new Map(),
      appUrl: null,
      appProcess: null,
      browserVerificationAttempts: 0,
      maxBrowserVerificationAttempts: 3,
      browserVerificationRequested: true,
      browserVerificationPassed: false,
      verificationIsStrong: false,
      recentToolCalls: [],
      projectState: { hasExistingProject: true, projectType: "react", existingFiles: ["package.json"], framework: "vite", isFollowUpTask: false },
      snapshotManager: null as any,
    };

    // Simulate agent calling read_file during recovery to inspect package.json
    const toolCall = {
      id: "call-1",
      type: "function" as const,
      function: { name: "read_file", arguments: JSON.stringify({ path: "package.json" }) },
    };
    const toolResult = '{\n  "name": "achu-test-lab",\n  "scripts": { "dev": "vite" }\n}';

    // Verify tool result is considered successful
    const isFailure = isToolResultFailure(toolCall.function.name, toolResult);
    assert.equal(isFailure, false, "read_file result must not be considered a failure");

    // The existing lastError must remain the real root cause, not the first line of JSON "{"
    assert.equal(state.lastError?.command, "start_app");
    assert.equal(state.lastError?.errorMessage, "No start command found in package.json");

    // Generate recovery hint preserves actual root cause diagnostic
    const hint = generateRecoveryHint(state);
    assert.ok(hint !== null);
    assert.ok(hint?.includes("SERVER STARTUP RECOVERY GUIDANCE"));
    assert.ok(!hint?.includes("Stop-Process"));
  });

  test("6. Safety policy: broad process killing commands are blocked", () => {
    const dangerousCommands = [
      'Get-Process | Where-Object {$_.ProcessName -eq "node"} | Stop-Process -Force',
      'Stop-Process -Name node',
      'taskkill /F /IM node.exe',
      'npx kill-port 5173',
      'pkill -f node',
      'killall node',
    ];

    for (const cmd of dangerousCommands) {
      const res = validateCommand(cmd);
      assert.equal(
        res.allowed,
        false,
        `Dangerous process killing command must be blocked: ${cmd}`
      );
    }
  });
});
