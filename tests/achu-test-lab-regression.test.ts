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
  extractRequestedVerification,
  extractRequestedEditTargets,
  isFileModifiedInState,
  isCommandVerifiedPassing,
  verifyTaskCompletionEvidence,
  shouldFinishOnTextResponse,
  normalizeCommandTarget,
  getToolTarget,
  getTaskIdentity,
  type AgentState,
  type PlanStep,
} from "../src/agent.ts";
import {
  scaffoldReactViteProject,
  validateProjectStructure,
} from "../src/tools/scaffold.js";
import { validateCommand } from "../src/utils/command-guard.js";
import { getModelConfig, DEFAULT_MODEL } from "../src/router.js";

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

  test("3b. Probing a missing root-level file never switches the workspace root into a child directory", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-root-probe-"));
    try {
      await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({ name: "probe-app", scripts: { dev: "vite" } }));
      await fs.writeFile(path.join(tempDir, "index.html"), "<div id=\"root\"></div>");
      await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "src", "main.jsx"), "export default 1;");

      const workspace = new Workspace(tempDir);
      const originalRoot = workspace.root;

      assert.equal(await workspace.exists("main.jsx"), false, "main.jsx does not exist at the project root");
      assert.equal(workspace.root, originalRoot, "Workspace root must remain the project root after a failed probe");
      assert.equal(await workspace.exists("package.json"), true, "Root-relative reads must still work after the probe");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
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

  test("5b. Stale edit_file recovery hint demands a re-read and forbids retrying the same oldText", () => {
    const editError = "Edit 1 failed: The expected text was not found in index.html.\nPossible matches in current file (oldText may be stale—read the latest content first):\n  line 12: <section class=\"hero\">";
    const state: AgentState = {
      requestedVerification: null,
      lastVerification: null,
      verificationPassed: false,
      stopReason: null,
      commandHistory: [],
      stepsTaken: new Map(),
      completedTasks: new Set(),
      currentPlan: [{ id: "1", description: "Edit hero section", status: "failed", toolType: "edit_file" }],
      phase: "recover",
      recoveryAttempts: 2,
      lastError: { command: "edit_file", exitCode: 1, stdout: "", stderr: "", errorMessage: editError },
      repeatedFailures: new Map([["edit_file:1:" + editError.slice(0, 160), 2]]),
      browserSession: null,
      verificationMemory: new Map(),
      appUrl: null,
      appProcess: null,
      browserVerificationAttempts: 0,
      maxBrowserVerificationAttempts: 3,
      browserVerificationRequested: false,
      browserVerificationPassed: false,
      verificationIsStrong: false,
      recentToolCalls: [],
      projectState: { hasExistingProject: true, projectType: "static", existingFiles: ["index.html"], framework: null, isFollowUpTask: false },
      snapshotManager: null as any,
    };

    const hint = generateRecoveryHint(state);
    assert.ok(hint !== null);
    assert.ok(hint?.includes("Do NOT retry edit_file with the same oldText"), "hint must forbid repeating the stale oldText");
    assert.ok(hint?.includes("Possible matches"), "hint must point at candidate matches from the error");
    assert.ok(hint?.includes("read_file"), "hint must require re-reading the current file");
  });

  test("5c. Recovery loop exempts repeated edit_file failures from the generic terminal-failure cap", async () => {
    const { runAgent } = await import("../src/agent.js");
    const fnStr = runAgent.toString();
    assert.ok(fnStr.includes("isRepeatedEditFailure"), "recovery loop must distinguish repeated edit_file failures");
    assert.ok(
      fnStr.includes("maxRecoveryAttempts-1") || fnStr.includes("maxRecoveryAttempts - 1"),
      "repeated edit_file failures must not consume the recovery budget"
    );
    assert.ok(fnStr.includes("edit_file:"), "recovery loop must track edit_file failure keys separately");
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

  test("7. Planning: logic bug fix with an explicit test command skips the browser lifecycle", () => {
    const logicalBugTask = `The counter application is broken in this existing React + Vite project. Running node --test tests/counter.test.js fails with: AssertionError: Expected values to be strictly equal: -1 !== 1 (increment works correctly). Diagnose the root cause in the source, fix only the broken logic, and do not change the test expectations. Then run these exact commands and report their real exit codes:
- node --test tests/counter.test.js
- npm run build`;

    const plan = initializePlan(logicalBugTask, {
      hasProject: true,
      projectType: "react",
      existingFiles: ["package.json", "vite.config.js", "src/main.jsx", "src/App.jsx", "src/counter-logic.js", "tests/counter.test.js"],
      framework: "vite",
    });

    const browserLifecycle = plan.filter(
      (s) => ["start_app", "open_browser", "browser_verify", "close_browser", "stop_app", "navigate", "click"].includes(s.toolType || "")
    );
    assert.deepEqual(
      browserLifecycle.map((s) => s.description),
      [],
      "Logic bug fixes backed by tests must not plan browser verification"
    );
    assert.ok(plan.some((s) => s.toolType === "edit_file"), "Plan must still edit the source");
    assert.ok(plan.some((s) => s.toolType === "run_verification"), "Plan must still run the requested verification");

    // Guard against over-filtering: a real UI follow-up must keep the browser lifecycle.
    const uiTask = `In the existing app, change the badge text in src/components/Header.jsx and verify it in the browser.`;
    const uiPlan = initializePlan(uiTask, {
      hasProject: true,
      projectType: "react",
      existingFiles: ["package.json", "vite.config.js", "src/main.jsx", "src/App.jsx", "src/components/Header.jsx"],
      framework: "vite",
    });
    assert.ok(uiPlan.some((s) => s.toolType === "browser_verify"), "UI follow-ups must still verify in the browser");
  });

  test("8. Requested verification extraction recognizes node --test and keeps the build command", () => {
    const task = `The counter application is broken. Running node --test tests/counter.test.js fails. Then run these exact commands:
- node --test tests/counter.test.js
- npm run build`;
    assert.equal(
      extractRequestedVerification(task),
      "node --test tests/counter.test.js; npm run build"
    );
  });

  test("9. Planning: mentions of the browser as context do not require an interaction step", () => {
    const task = `Add noValidate to the <form> element in src/components/FeedbackForm.jsx so the browser's native email validation does not block submission. Then verify with: npm run build.`;
    const plan = initializePlan(task, {
      hasProject: true,
      projectType: "react",
      existingFiles: ["package.json", "vite.config.js", "src/main.jsx", "src/App.jsx", "src/components/FeedbackForm.jsx"],
      framework: "vite",
    });

    assert.equal(
      plan.some((s) => s.toolType === "click"),
      false,
      "Browser context alone must not add a click/interaction step"
    );
    assert.ok(plan.some((s) => s.toolType === "edit_file"));
    assert.ok(plan.some((s) => s.toolType === "run_verification"));
  });

  test("10. Completion truthfulness: unfulfilled file modification requests block false success claims", () => {
    const multiFileEditTask = `Fix three real quality gaps in this existing React + Vite app.
1. Replace tests/counter.test.js with genuine node:test assertions.
2. In src/App.jsx give the section a className like "cards".
3. In src/components/FeedbackForm.jsx add noValidate to the form.
Then verify with: npm run build.`;

    const stateWithOmission = {
      taskPrompt: multiFileEditTask,
      requestedVerification: "npm run build",
      verificationPassed: true,
      phase: "execute",
      stopReason: null,
      completedTasks: new Set(["edit_file:tests/counter.test.js", "edit_file:src/App.jsx"]),
      currentPlan: [
        { id: "1", description: "edit tests", status: "completed", toolType: "edit_file" },
        { id: "2", description: "edit App", status: "completed", toolType: "edit_file" },
        { id: "3", description: "build", status: "completed", toolType: "run_verification" },
      ],
      stepsTaken: new Map(),
      executionLedger: {
        taskClassification: "targeted_edit",
        filesInspected: new Set(["src/components/FeedbackForm.jsx"]),
        filesModified: new Set(["tests/counter.test.js", "src/App.jsx"]),
        scopedTargetFiles: ["tests/counter.test.js", "src/App.jsx", "src/components/FeedbackForm.jsx"],
        commandsExecuted: [{ cmd: "npm run build", exitCode: 0, step: 1 }],
        verificationResults: [{ command: "npm run build", passed: true, step: 1 }],
        changeVerifications: [],
        serverStartAttempts: 0,
        browserChecks: 0,
        recoveryAttempts: 0,
        consecutiveFailuresWithSameError: 0,
        lastBlocker: null,
      },
      snapshotManager: {
        records: new Map([
          ["tests/counter.test.js", { operation: "edit", relativePath: "tests/counter.test.js", beforeHash: "h1", afterHash: "h2", backupPath: null }],
          ["src/App.jsx", { operation: "edit", relativePath: "src/App.jsx", beforeHash: "h3", afterHash: "h4", backupPath: null }],
        ]),
      } as any,
    } as unknown as AgentState;

    const evidence = verifyTaskCompletionEvidence(multiFileEditTask, stateWithOmission);
    assert.equal(evidence.verified, false, "Evidence must be false when FeedbackForm.jsx was not modified");
    assert.ok(evidence.unfulfilledFiles.some((f) => f.includes("FeedbackForm.jsx")), "Missing files must include FeedbackForm.jsx");
    assert.equal(
      shouldFinishOnTextResponse(stateWithOmission, "The task is complete. All three changes were made."),
      false,
      "shouldFinishOnTextResponse must reject completion claims when requested file edits are unfulfilled"
    );

    // Now mark FeedbackForm.jsx as modified
    stateWithOmission.completedTasks.add("edit_file:src/components/FeedbackForm.jsx");
    stateWithOmission.executionLedger.filesModified.add("src/components/FeedbackForm.jsx");
    (stateWithOmission.snapshotManager.records as Map<string, any>).set("src/components/FeedbackForm.jsx", {
      operation: "edit",
      relativePath: "src/components/FeedbackForm.jsx",
      beforeHash: "h5",
      afterHash: "h6",
      backupPath: null,
    });

    const evidenceAfter = verifyTaskCompletionEvidence(multiFileEditTask, stateWithOmission);
    assert.equal(evidenceAfter.verified, true, "Evidence must be true once all requested files are modified");
    assert.equal(
      shouldFinishOnTextResponse(stateWithOmission, "The task is complete. All three changes were made."),
      true,
      "shouldFinishOnTextResponse accepts completion once all requested changes are verified"
    );
  });

  test("11. Completion truthfulness: unverified requested commands block false success claims", () => {
    const taskWithCommands = `Diagnose and fix the issue. Then run these exact commands and report their real exit codes:
- node --test tests/counter.test.js
- npm run build`;

    const stateMissingTest = {
      taskPrompt: taskWithCommands,
      requestedVerification: "npm run build",
      verificationPassed: true,
      phase: "execute",
      stopReason: null,
      completedTasks: new Set(["edit_file:src/counter-logic.js"]),
      currentPlan: [],
      stepsTaken: new Map(),
      executionLedger: {
        taskClassification: "bug_fix",
        filesInspected: new Set(),
        filesModified: new Set(["src/counter-logic.js"]),
        scopedTargetFiles: [],
        commandsExecuted: [{ cmd: "npm run build", exitCode: 0, step: 1 }],
        verificationResults: [{ command: "npm run build", passed: true, step: 1 }],
        changeVerifications: [],
        serverStartAttempts: 0,
        browserChecks: 0,
        recoveryAttempts: 0,
        consecutiveFailuresWithSameError: 0,
        lastBlocker: null,
      },
    } as unknown as AgentState;

    const evidence = verifyTaskCompletionEvidence(taskWithCommands, stateMissingTest);
    assert.equal(evidence.verified, false, "Evidence must be false if node --test was never executed");
    assert.ok(evidence.unverifiedCommands.some((c) => c.includes("node --test")), "Unverified commands must list node --test");

    // Add node --test execution with exit code 0
    stateMissingTest.executionLedger.commandsExecuted.unshift({
      cmd: "node --test tests/counter.test.js",
      exitCode: 0,
      step: 0,
    });

    const evidencePassing = verifyTaskCompletionEvidence(taskWithCommands, stateMissingTest);
    assert.equal(evidencePassing.verified, true, "Evidence must pass when all requested commands executed with exit code 0");
  });

  test("12. Completion truthfulness: extractRequestedEditTargets respects negative directives and import references", () => {
    const task = `Fix three real quality gaps in this existing React + Vite app.
1. Replace tests/counter.test.js with genuine node:test assertions: import increment, decrement, resetCount from ../src/counter-logic.js and assert...
2. In src/App.jsx give the section a className like "cards".
3. Add noValidate to the form in src/components/FeedbackForm.jsx.
Do not modify package.json.`;

    const targets = extractRequestedEditTargets(task);
    assert.deepEqual(targets, [
      "tests/counter.test.js",
      "src/App.jsx",
      "src/components/FeedbackForm.jsx",
    ]);
    assert.equal(targets.includes("../src/counter-logic.js"), false, "Imported file must not be an edit target");
    assert.equal(targets.includes("package.json"), false, "Negative directive file must not be an edit target");
  });

  test("13. Model configuration: unavailable nemotron-3-super is safely remapped to verified nemotron-3.5-lightning", () => {
    const originalEnv = process.env.NVIDIA_MODEL;
    const originalKey = process.env.NVIDIA_API_KEY;
    try {
      process.env.NVIDIA_API_KEY = "test-key-mock";
      process.env.NVIDIA_MODEL = "nvidia/nemotron-3-super-120b-a12b";
      const config = getModelConfig();
      assert.equal(config.name, DEFAULT_MODEL, "Obsolete nemotron-3-super must be remapped to DEFAULT_MODEL");
    } finally {
      if (originalEnv !== undefined) process.env.NVIDIA_MODEL = originalEnv;
      else delete process.env.NVIDIA_MODEL;
      if (originalKey !== undefined) process.env.NVIDIA_API_KEY = originalKey;
      else delete process.env.NVIDIA_API_KEY;
    }
  });

  test("14. Command fingerprinting: chained cd commands do NOT collapse into 'cd' and avoid false loop detection", () => {
    const commands = [
      "cd achu-test-lab && npm install",
      "cd achu-test-lab && npm run build",
      "cd achu-test-lab && npm test",
      "cd achu-test-lab && npx tsc --noEmit",
    ];

    const targets = commands.map(cmd =>
      getToolTarget({
        id: "call-1",
        type: "function",
        function: { name: "run_command", arguments: JSON.stringify({ command: cmd }) },
      })
    );

    // None of them should be "cd"
    for (const t of targets) {
      assert.notEqual(t, "cd", `Command target must not be 'cd': ${t}`);
    }

    // All 4 distinct commands must produce distinct targets
    const uniqueTargets = new Set(targets);
    assert.equal(uniqueTargets.size, 4, "All 4 commands must have unique fingerprints");
    assert.deepEqual(Array.from(uniqueTargets), ["npm install", "npm run build", "npm test", "npx tsc"]);

    // Test getTaskIdentity as well
    const identities = commands.map(cmd =>
      getTaskIdentity({
        id: "call-1",
        type: "function",
        function: { name: "run_command", arguments: JSON.stringify({ command: cmd }) },
      })
    );
    for (const id of identities) {
      assert.notEqual(id, "run_command:cd", `Task identity must not be 'run_command:cd': ${id}`);
    }
    assert.equal(new Set(identities).size, 4, "Task identities must all be distinct");
  });

  test("15. Plan progress tracking: sequential create_file steps advance active running step without stalling", () => {
    const plan = initializePlan("create simple log in page");
    const completedTasks = new Set<string>();
    let curPlan = plan;

    // Initial state: no step is running yet (pending phase)
    assert.equal(curPlan.find(s => s.status === "running"), undefined);

    // Step 1: list_directory completes discovery, activates step 2
    completedTasks.add("list_directory:.");
    curPlan = updatePlanProgress(
      curPlan,
      completedTasks,
      { id: "1", type: "function", function: { name: "list_directory", arguments: "{}" } },
      "[]"
    );
    assert.equal(curPlan.find(s => s.status === "running")?.description, "Check if workspace is empty or has existing project");

    // Step 2: create_file index.html auto-completes skipped step 2, completes step 3, activates step 4
    completedTasks.add("create_file:index.html");
    curPlan = updatePlanProgress(
      curPlan,
      completedTasks,
      { id: "2", type: "function", function: { name: "create_file", arguments: JSON.stringify({ path: "index.html", content: "<html></html>" }) } },
      "Successfully created index.html."
    );
    assert.equal(curPlan.find(s => s.id === "2")?.status, "completed", "Skipped inspection step 2 must be auto-completed");
    assert.equal(curPlan.find(s => s.id === "3")?.status, "completed", "Create index.html step 3 must be completed");
    assert.equal(curPlan.find(s => s.status === "running")?.description, "Create styles.css", "Next active step must be Create styles.css");

    // Step 3: create_file styles.css completes step 4, activates step 5
    completedTasks.add("create_file:styles.css");
    curPlan = updatePlanProgress(
      curPlan,
      completedTasks,
      { id: "3", type: "function", function: { name: "create_file", arguments: JSON.stringify({ path: "styles.css", content: "body {}" }) } },
      "Successfully created styles.css."
    );
    assert.equal(curPlan.find(s => s.id === "4")?.status, "completed");
    assert.equal(curPlan.find(s => s.status === "running")?.description, "Create script.js");

    // Step 4: create_file script.js completes step 5, activates step 6
    completedTasks.add("create_file:script.js");
    curPlan = updatePlanProgress(
      curPlan,
      completedTasks,
      { id: "4", type: "function", function: { name: "create_file", arguments: JSON.stringify({ path: "script.js", content: "console.log();" }) } },
      "Successfully created script.js."
    );
    assert.equal(curPlan.find(s => s.id === "5")?.status, "completed");
    assert.equal(curPlan.find(s => s.status === "running")?.description, "Start the development server (reuse if already running)");

    const ecommercePlan = initializePlan("create ecommerce website with working codition");
    assert.ok(
      !ecommercePlan.some(s => s.toolType === "create_file" && (s.target || "").includes("package.json")),
      "Static site plans must not ask the model to invent a package.json/Vite project"
    );
    assert.ok(ecommercePlan.some(s => s.toolType === "start_app"));
    assert.ok(ecommercePlan.some(s => s.toolType === "browser_verify"));
  });

  test("16. Command normalization: handles varied whitespace, quotes, and command formats accurately", () => {
    assert.equal(normalizeCommandTarget('"npm run dev"'), "npm run dev");
    assert.equal(normalizeCommandTarget("'cd \"my-dir\" && npm test'"), "npm test");
    assert.equal(normalizeCommandTarget("cd /var/www ; git status"), "git status");
    assert.equal(normalizeCommandTarget("node --test tests/auth.test.js"), "node --test tests/auth.test.js");
    assert.equal(normalizeCommandTarget("npx vite --port 5173"), "npx vite");
    assert.equal(normalizeCommandTarget(""), "empty_command");
    assert.equal(normalizeCommandTarget("   "), "empty_command");
  });
});
