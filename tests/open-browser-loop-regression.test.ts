import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { updatePlanProgress } from "../src/agent.js";
import type { PlanStep } from "../src/session/session-types.js";

describe("Open Browser Lifecycle Loop & Plan Recovery Regression Suite", () => {
  const agentSrc = fs.readFileSync("src/agent.ts", "utf8");

  test("1. updatePlanProgress recovers a previously failed start_app step when it subsequently succeeds", () => {
    const plan: PlanStep[] = [
      { id: "1", description: "Scaffold project", toolType: "scaffold_project", status: "completed" },
      { id: "2", description: "Start the development server", toolType: "start_app", status: "failed" },
      { id: "3", description: "Open a browser session for live preview", toolType: "open_browser", status: "pending", dependsOn: ["2"] },
    ];
    const completedTasks = new Set<string>();

    const toolCall = {
      id: "call_start_retry",
      type: "function" as const,
      function: { name: "start_app", arguments: "{}" },
    };
    const successResult = "Development server is ready at http://localhost:3000";

    const updated = updatePlanProgress(plan, completedTasks, toolCall, successResult);
    const startStep = updated.find(s => s.toolType === "start_app");
    assert.ok(startStep, "start_app step must exist in plan");
    assert.equal(startStep.status, "completed", "A successful start_app execution must recover and mark the failed step completed");
  });

  test("2. updatePlanProgress marks open_browser completed on success and clears lifecycle block", () => {
    const plan: PlanStep[] = [
      { id: "1", description: "Start the development server", toolType: "start_app", status: "completed" },
      { id: "2", description: "Open a browser session for live preview", toolType: "open_browser", status: "pending", dependsOn: ["1"] },
      { id: "3", description: "Verify the application in the browser", toolType: "browser_verify", status: "pending", dependsOn: ["2"] },
    ];
    const completedTasks = new Set<string>();

    const openCall = {
      id: "call_open_1",
      type: "function" as const,
      function: { name: "open_browser", arguments: "{}" },
    };
    const openRes = "Browser opened successfully";

    const updated = updatePlanProgress(plan, completedTasks, openCall, openRes);
    const openStep = updated.find(s => s.toolType === "open_browser");
    assert.ok(openStep, "open_browser step must exist in plan");
    assert.equal(openStep.status, "completed", "open_browser must be marked completed upon successful execution");
  });

  test("3. Auto-executing open_browser is strictly guarded against infinite loops", () => {
    const autoExecIdx = agentSrc.indexOf('pendingLifecycle[0].toolType === "open_browser"');
    assert.ok(autoExecIdx > 0, "Must contain open_browser auto-execution block");

    const block = agentSrc.slice(autoExecIdx, autoExecIdx + 1200);
    assert.match(
      block,
      /state\.browserSession\s*\|\|\s*state\.completedTasks\.has\(["']open_browser["']\)/,
      "Auto-execution must check whether browserSession is already active or open_browser already completed"
    );
    assert.match(
      block,
      /state\.completedTasks\.add\(["']open_browser["']\)/,
      "Auto-execution must register open_browser into completedTasks to prevent repetition"
    );
  });
});
