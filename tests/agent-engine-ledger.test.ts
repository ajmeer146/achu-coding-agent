import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateRecoveryHint, isBrowserVerificationIncomplete, AgentState, ExecutionLedger } from "../src/agent.js";

function createMockState(overrides: Partial<AgentState> = {}): AgentState {
  const ledger: ExecutionLedger = {
    filesInspected: new Set<string>(),
    filesModified: new Set<string>(),
    commandsExecuted: [],
    verificationResults: [],
    serverStartAttempts: 0,
    browserChecks: 0,
    recoveryAttempts: 0,
    lastBlocker: null,
  };

  return {
    requestedVerification: null,
    lastVerification: null,
    verificationPassed: false,
    stopReason: null,
    commandHistory: [],
    stepsTaken: new Map(),
    completedTasks: new Set(),
    currentPlan: [],
    phase: "recover",
    recoveryAttempts: 1,
    lastError: {
      command: "start_app",
      exitCode: 1,
      stdout: "",
      stderr: "Port 5173 occupied",
      errorMessage: "Failed to start development server",
    },
    repeatedFailures: new Map(),
    browserSession: null,
    verificationMemory: new Map(),
    appUrl: null,
    appProcess: null,
    browserVerificationAttempts: 0,
    maxBrowserVerificationAttempts: 3,
    browserVerificationRequested: false,
    browserVerificationPassed: false,
    browserVerificationFailedTargets: new Map(),
    verificationIsStrong: false,
    recentToolCalls: [],
    projectState: {
      hasExistingProject: false,
      projectType: null,
      existingFiles: [],
      framework: null,
      isFollowUpTask: false,
    },
    snapshotManager: null as any,
    executionLedger: ledger,
    ...overrides,
  };
}

describe("Agent Engine - Execution Ledger & Recovery Intelligence", () => {
  test("1. ExecutionLedger surfaces repeated server start attempts in recovery hints", () => {
    const state = createMockState();
    state.executionLedger!.serverStartAttempts = 3;
    state.lastError = {
      command: "start_app",
      exitCode: 1,
      stdout: "",
      stderr: "Error: EADDRINUSE",
      errorMessage: "Port 5173 occupied",
    };

    const hint = generateRecoveryHint(state);
    assert.ok(hint !== null, "Recovery hint should be generated");
    assert.match(hint, /Server start was attempted 3 times/, "Hint must mention repeated server start attempts");
    assert.match(hint, /do NOT restart it; use browser_verify directly/, "Hint should guide towards browser_verify");
  });

  test("2. ExecutionLedger surfaces recently modified files in recovery hints", () => {
    const state = createMockState();
    state.executionLedger!.filesModified.add("src/App.jsx");
    state.executionLedger!.filesModified.add("src/components/Header.jsx");
    state.lastError = {
      command: "edit_file",
      exitCode: 1,
      stdout: "",
      stderr: "SyntaxError: Unexpected token",
      errorMessage: "Failed to compile JSX",
    };

    const hint = generateRecoveryHint(state);
    assert.ok(hint !== null);
    assert.match(hint, /Recently modified files \(2\):/, "Hint should list modified file count");
    assert.match(hint, /src\/App\.jsx/, "Hint should include modified file names");
    assert.match(hint, /src\/components\/Header\.jsx/, "Hint should include all recent modified files");
  });

  test("3. isBrowserVerificationIncomplete truthfully blocks completion when assertions failed", () => {
    const state = createMockState({
      phase: "execute",
      browserVerificationRequested: true,
      browserVerificationPassed: false,
      browserVerificationFailedTargets: new Map([["heading:Welcome", "Heading 'Welcome' not found"]]),
      currentPlan: [
        { id: "1", description: "Start app", toolType: "start_app", status: "completed" },
        { id: "2", description: "Verify app", toolType: "browser_verify", status: "failed" },
      ],
    });

    assert.equal(isBrowserVerificationIncomplete(state), true, "Incomplete verification must block completion");

    // Once resolved and passed:
    state.browserVerificationFailedTargets.clear();
    state.browserVerificationPassed = true;
    assert.equal(isBrowserVerificationIncomplete(state), false, "Cleared failures and passed verification allow completion");
  });

  test("4. AGENT_TOOLS definition in source includes take_screenshot tool", () => {
    const agentSource = fs.readFileSync(path.resolve("src/agent.ts"), "utf-8");
    assert.match(agentSource, /name:\s*"take_screenshot"/, "AGENT_TOOLS must declare take_screenshot tool");
    assert.match(agentSource, /case\s*"take_screenshot":/, "executeTool must implement take_screenshot handler");
  });

  test("5. Message history trimming threshold is configured to 60 with tool output compression", () => {
    const agentSource = fs.readFileSync(path.resolve("src/agent.ts"), "utf-8");
    assert.match(agentSource, /const\s+MAX_MESSAGE_HISTORY\s*=\s*60/, "MAX_MESSAGE_HISTORY must be set to 60");
    assert.match(agentSource, /function\s+summarizeToolOutput/, "Must include summarizeToolOutput helper for context compression");
  });
});
