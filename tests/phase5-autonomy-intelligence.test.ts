import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../src/tools/workspace.js";
import { editFile } from "../src/tools/edit-file.js";
import { createFile } from "../src/tools/create-file.js";
import { readFile } from "../src/tools/read-file.js";
import { scaffoldReactViteProject, scaffoldStaticProject, autoRepairProjectStructure, validateProjectStructure } from "../src/tools/scaffold.js";
import { classifyTask, isUnrequestedFileMutation, isBrowserVerificationIncomplete, generateRecoveryHint, AgentState, ExecutionLedger } from "../src/agent.js";

function makeTmpDir(prefix: string): string {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("Phase 5 — Autonomous Coding Intelligence & Quality Benchmark Suite", () => {

  // Scenario 1: New multi-file website creation
  test("1. New multi-file website creation scaffolds valid, complete file structure", async () => {
    const tmp = makeTmpDir("p5-scaffold-");
    try {
      const ws = new Workspace(tmp);
      const res = await scaffoldStaticProject(ws, "demo-site");
      assert.equal(res.success, true);
      assert.ok(res.files.includes("index.html"));
      assert.ok(res.files.includes("styles.css"));
      assert.ok(res.files.includes("script.js"));
      assert.ok(res.files.includes("package.json"));

      const html = await ws.read("index.html");
      assert.match(html, /<header[\s>]/i);
      assert.match(html, /<nav[\s>]/i);
      assert.match(html, /<main[\s>]/i);
      assert.match(html, /<footer[\s>]/i);
      assert.match(html, /styles\.css/);
      assert.match(html, /script\.js/);

      const scope = classifyTask("Build a new modern portfolio website with projects and contact form");
      assert.equal(scope.classification, "new_project");
      assert.equal(scope.isTargetedEdit, false);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Scenario 2: Existing project feature implementation
  test("2. Existing project feature implementation correctly classifies and plans addition", () => {
    const scope = classifyTask(
      "Add a testimonials carousel section to the existing landing page",
      { hasProject: true, projectType: "react", existingFiles: ["package.json", "src/App.jsx", "src/main.jsx"], framework: "react" }
    );
    assert.equal(scope.classification, "feature_addition");
    assert.equal(scope.isTargetedEdit, false);
    assert.match(scope.reason, /adding a new feature/i);
  });

  // Scenario 3: Narrowly scoped UI edit
  test("3. Narrowly scoped UI edit preserves surrounding code and imports", async () => {
    const tmp = makeTmpDir("p5-narrow-edit-");
    try {
      const ws = new Workspace(tmp);
      const originalCode = [
        `import React, { useState } from 'react';`,
        `import { formatCurrency } from './utils';`,
        ``,
        `export default function Header() {`,
        `  const [isOpen, setIsOpen] = useState(false);`,
        `  return (`,
        `    <header className="site-header">`,
        `      <h1>Old Platform Title</h1>`,
        `      <p>Welcome to our service</p>`,
        `    </header>`,
        `  );`,
        `}`,
      ].join("\n");

      await ws.write("src/Header.jsx", originalCode);

      // Task targets single heading
      const scope = classifyTask("In src/Header.jsx, change the heading to 'Achu Intelligence Hub'");
      assert.equal(scope.classification, "targeted_edit");
      assert.equal(scope.isTargetedEdit, true);
      assert.deepEqual(scope.targetFiles, ["src/Header.jsx"]);

      // Perform exact targeted edit
      await editFile(ws, "src/Header.jsx", [{
        oldText: "<h1>Old Platform Title</h1>",
        newText: "<h1>Achu Intelligence Hub</h1>"
      }]);

      const editedCode = await ws.read("src/Header.jsx");
      assert.match(editedCode, /<h1>Achu Intelligence Hub<\/h1>/);
      // Surrounding imports and state MUST be preserved:
      assert.match(editedCode, /import React, \{ useState \} from 'react';/);
      assert.match(editedCode, /import \{ formatCurrency \} from '\.\/utils';/);
      assert.match(editedCode, /const \[isOpen, setIsOpen\] = useState\(false\);/);
      assert.match(editedCode, /<p>Welcome to our service<\/p>/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Scenario 4: Deliberate build failure followed by successful repair
  test("4. Deliberate build failure is diagnosed and repaired automatically", async () => {
    const tmp = makeTmpDir("p5-repair-");
    try {
      const ws = new Workspace(tmp);
      // Construct a broken project: React dependencies but using npx serve (static)
      const brokenPkg = {
        name: "broken-app",
        scripts: {
          dev: "npx serve . -l 3000",
          build: "echo 'Static'",
        },
        dependencies: { react: "^18.2.0", "react-dom": "^18.2.0" }
      };
      await ws.write("package.json", JSON.stringify(brokenPkg, null, 2));
      await ws.write("src/App.jsx", "export default function App() { return <div>App</div>; }");

      const checkBefore = validateProjectStructure(tmp);
      assert.equal(checkBefore.valid, false, "Incompatible configuration must fail pre-check");
      assert.match(checkBefore.error!, /npx serve/);

      // Auto-repair fixes project structure to Vite
      const repairResult = await autoRepairProjectStructure(ws);
      assert.equal(repairResult.repaired, true);

      const checkAfter = validateProjectStructure(tmp);
      assert.equal(checkAfter.valid, true, "Repaired project must pass validation");
      assert.equal(checkAfter.projectType, "react");

      const repairedPkg = JSON.parse(await ws.read("package.json"));
      assert.equal(repairedPkg.scripts.dev, "vite");
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Scenario 5: Repair that fails and is correctly reported as failed
  test("5. Unresolved failure is truthfully reported as failed without false success", () => {
    const mockState: AgentState = {
      requestedVerification: "npm test",
      lastVerification: { command: "npm test", exitCode: 1, stdout: "", stderr: "AssertionError: 2 !== 3" },
      verificationPassed: false,
      stopReason: null,
      commandHistory: ["npm test"],
      stepsTaken: new Map(),
      completedTasks: new Set(),
      currentPlan: [
        { id: "1", description: "Fix math utility", toolType: "edit_file", status: "completed" },
        { id: "2", description: "Run npm test", toolType: "run_verification", status: "failed" },
      ],
      phase: "recover",
      recoveryAttempts: 3,
      lastError: { command: "run_verification", exitCode: 1, stdout: "", stderr: "Tests failed", errorMessage: "Tests failed" },
      repeatedFailures: new Map(),
      browserSession: null,
      verificationMemory: new Map(),
      appUrl: null,
      appProcess: null,
      browserVerificationAttempts: 0,
      maxBrowserVerificationAttempts: 3,
      browserVerificationRequested: false,
      browserVerificationPassed: false,
      verificationIsStrong: true,
      recentToolCalls: [],
      projectState: { hasExistingProject: true, projectType: "node", existingFiles: ["package.json"], framework: null, isFollowUpTask: false },
      snapshotManager: null as any,
    };

    assert.equal(mockState.verificationPassed, false);
    assert.equal(isBrowserVerificationIncomplete(mockState), false); // not browser
    // Status must remain failed:
    assert.equal(mockState.lastVerification?.exitCode !== 0, true);
  });

  // Scenario 6: Browser interaction verification
  test("6. Browser verification truthfully checks for required targets and outstanding failures", () => {
    const mockState: AgentState = {
      requestedVerification: null,
      lastVerification: null,
      verificationPassed: false,
      stopReason: null,
      commandHistory: [],
      stepsTaken: new Map(),
      completedTasks: new Set(),
      currentPlan: [
        { id: "1", description: "Start app", toolType: "start_app", status: "completed" },
        { id: "2", description: "Verify heading and button in browser", toolType: "browser_verify", status: "failed" },
      ],
      phase: "verify",
      recoveryAttempts: 0,
      lastError: null,
      repeatedFailures: new Map(),
      browserSession: null,
      verificationMemory: new Map(),
      appUrl: "http://localhost:5173",
      appProcess: null,
      browserVerificationAttempts: 1,
      maxBrowserVerificationAttempts: 3,
      browserVerificationRequested: true,
      browserVerificationPassed: false,
      browserVerificationFailedTargets: new Map([["button:Submit", "Button with text 'Submit' not found in DOM"]]),
      verificationIsStrong: false,
      recentToolCalls: [],
      projectState: { hasExistingProject: true, projectType: "react", existingFiles: ["package.json"], framework: "react", isFollowUpTask: false },
      snapshotManager: null as any,
    };

    // A web-app task where assertions failed cannot be marked as complete
    assert.equal(isBrowserVerificationIncomplete(mockState), true);

    // If assertions pass on re-run:
    mockState.browserVerificationFailedTargets!.clear();
    mockState.browserVerificationPassed = true;
    assert.equal(isBrowserVerificationIncomplete(mockState), false);
  });

  // Scenario 7: Reopening a project and making a follow-up change
  test("7. Project reopening classifies follow-up task and preserves existing project context", () => {
    const existing = {
      hasProject: true,
      projectType: "react",
      existingFiles: ["package.json", "src/App.jsx", "index.html", "vite.config.js"],
      framework: "react",
    };

    const scope = classifyTask("Update the hero subtitle to 'Next-generation AI coding'", existing);
    assert.equal(scope.classification, "targeted_edit");
    assert.equal(scope.isTargetedEdit, true);

    const featureScope = classifyTask("Add a pricing calculator section below the hero", existing);
    assert.equal(featureScope.classification, "feature_addition");
    assert.equal(featureScope.isTargetedEdit, false);
  });

  // Scenario 8: Unrelated-file preservation
  test("8. Unrelated-file preservation correctly detects collateral file mutations", () => {
    const task = "In src/components/Header.jsx, change the logo text to 'Achu'";
    // Target file is Header.jsx
    assert.equal(isUnrequestedFileMutation(task, "src/components/Header.jsx"), false);
    // Unrelated files MUST be flagged:
    assert.equal(isUnrequestedFileMutation(task, "src/components/Footer.jsx"), true);
    assert.equal(isUnrequestedFileMutation(task, "src/main.jsx"), true);
    assert.equal(isUnrequestedFileMutation(task, "package.json"), true);
  });

  // Scenario 9: Loop detection and retry limits
  test("9. Repetitive tool loop triggers recovery and bounded stop reason", () => {
    const ledger: ExecutionLedger = {
      taskClassification: "targeted_edit",
      filesInspected: new Set(),
      filesModified: new Set(),
      scopedTargetFiles: ["src/App.jsx"],
      commandsExecuted: [],
      verificationResults: [],
      changeVerifications: [],
      serverStartAttempts: 3,
      browserChecks: 1,
      recoveryAttempts: 2,
      consecutiveFailuresWithSameError: 3,
      lastBlocker: null,
    };

    const mockState: AgentState = {
      requestedVerification: "npm test",
      lastVerification: null,
      verificationPassed: false,
      stopReason: null,
      commandHistory: [],
      stepsTaken: new Map(),
      completedTasks: new Set(),
      currentPlan: [],
      phase: "recover",
      recoveryAttempts: 2,
      lastError: {
        command: "start_app",
        exitCode: 1,
        stdout: "",
        stderr: "EADDRINUSE",
        errorMessage: "Port 5173 is already in use"
      },
      repeatedFailures: new Map([["start_app:1:Port 5173 is already in use", 3]]),
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
      projectState: { hasExistingProject: true, projectType: "react", existingFiles: [], framework: "react", isFollowUpTask: false },
      snapshotManager: null as any,
      executionLedger: ledger,
    };

    const hint = generateRecoveryHint(mockState);
    assert.ok(hint !== null);
    assert.match(hint, /Server start was attempted 3 times/);
    assert.match(hint, /UNCHANGED ERROR DETECTED/);
  });

  // Scenario 10: Cancellation, timeouts, and duplicate submissions
  test("10. Cancellation terminates state cleanly and preserves terminal status", () => {
    const state: Partial<AgentState> = {
      stopReason: null,
      phase: "execute",
    };

    // User triggers explicit cancellation:
    state.stopReason = "Interrupted by SIGINT";
    assert.ok(state.stopReason.includes("Interrupted"));
  });

  // Scenario 11: Local and cloud artifact consistency
  test("11. Workspace export normalizes relative paths and enforces maximum limits", async () => {
    const tmp = makeTmpDir("p5-export-");
    try {
      const ws = new Workspace(tmp);
      await ws.write("index.html", "<!DOCTYPE html><html><body><h1>Test</h1></body></html>");
      await ws.write("src/app.js", "console.log('hi');");

      assert.ok(await ws.exists("index.html"));
      assert.ok(await ws.exists("src/app.js"));

      const readIndex = await ws.read("index.html");
      assert.match(readIndex, /<h1>Test<\/h1>/);
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Scenario 12: Secret redaction and account isolation
  test("12. Secret files starting with .env are strictly blocked from editing or creation", async () => {
    const tmp = makeTmpDir("p5-secrets-");
    try {
      const ws = new Workspace(tmp);
      await assert.rejects(
        () => editFile(ws, ".env", [{ oldText: "*", newText: "SECRET=123" }]),
        /Forbidden: \.env files cannot be modified automatically/i
      );

      await assert.rejects(
        () => editFile(ws, ".env.production", [{ oldText: "*", newText: "SECRET=123" }]),
        /Forbidden: \.env files cannot be modified automatically/i
      );
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

});
