import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldFinishOnTextResponse } from "../src/agent.js";

// Dummy AgentState for testing
function createDummyState(overrides = {}): any {
  return {
    requestedVerification: null,
    verificationPassed: false,
    phase: "execute",
    stopReason: null,
    completedTasks: new Set(["some_task"]),
    currentPlan: [],
    stepsTaken: new Map(),
    ...overrides
  };
}

test("shouldFinishOnTextResponse requires TASK COMPLETE or legacy patterns", () => {
  const state = createDummyState({
    currentPlan: [
      { id: "step1", toolType: "read_file", status: "completed", description: "read" },
      { id: "step2", toolType: "edit_file", status: "completed", description: "edit" },
      { id: "step3", toolType: "run_command", status: "pending", description: "run" }
    ]
  });
  
  assert.equal(shouldFinishOnTextResponse(state, "I have updated the file. TASK COMPLETE"), true);
  assert.equal(shouldFinishOnTextResponse(state, "The task is complete."), true); // legacy pattern
  assert.equal(shouldFinishOnTextResponse(state, "Here is the code."), false);
  assert.equal(shouldFinishOnTextResponse(state, null), false);
});

test("shouldFinishOnTextResponse respects verification requirements", () => {
  const state = createDummyState({
    requestedVerification: "npm test",
    verificationPassed: false,
    currentPlan: [] // no pending steps
  });
  
  assert.equal(shouldFinishOnTextResponse(state, "TASK COMPLETE"), false, "Cannot finish if verification requested but not passed");
  
  state.verificationPassed = true;
  assert.equal(shouldFinishOnTextResponse(state, "TASK COMPLETE"), true, "Can finish if verification passed");
});

test("shouldFinishOnTextResponse prevents finishing if web app lifecycle is incomplete", () => {
  const state = createDummyState({
    currentPlan: [
      { id: "1", toolType: "start_app", status: "completed" },
      { id: "2", toolType: "browser_verify", status: "completed" },
      { id: "3", toolType: "close_browser", status: "pending" }, // missing cleanup
    ]
  });
  
  assert.equal(shouldFinishOnTextResponse(state, "TASK COMPLETE"), false, "Must complete close_browser");
  
  state.currentPlan[2].status = "completed";
  assert.equal(shouldFinishOnTextResponse(state, "TASK COMPLETE"), true, "Can finish after cleanup");
});

test("shouldFinishOnTextResponse stops immediately if stopReason is set", () => {
  const state = createDummyState({ stopReason: "Execution loop detected" });
  assert.equal(shouldFinishOnTextResponse(state, "Just a random message"), true, "Must finish if there's a stop reason");
});
