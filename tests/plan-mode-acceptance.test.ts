import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runAgent, PlanStep } from "../src/agent.js";
import { AgentTaskPayloadSchema, AgentTaskResultSchema } from "../src/trigger/agent-task.js";

test("Interactive Plan Mode Specification & Schema Acceptance Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "achu-plan-mode-test-"));

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  process.env.WORKSPACE_ROOT = tmpDir;

  await t.test("1. AgentTaskPayloadSchema accepts planOnly and approvedPlan fields", () => {
    const payload = {
      task: "Build a modern task dashboard with SQLite backend and responsive UI",
      workspaceRoot: tmpDir,
      planOnly: true,
      approvedPlan: [
        { id: "1", description: "Create package.json", status: "pending" as const, toolType: "create_file", target: "package.json" },
        { id: "2", description: "Create server.js", status: "pending" as const, toolType: "create_file", target: "server.js" },
      ],
    };

    const parsed = AgentTaskPayloadSchema.safeParse(payload);
    assert.ok(parsed.success, `Schema parse failed: ${JSON.stringify(parsed.error)}`);
    assert.equal(parsed.data.planOnly, true);
    assert.equal(parsed.data.approvedPlan?.length, 2);
    assert.equal(parsed.data.approvedPlan?.[0].target, "package.json");
  });

  await t.test("2. AgentTaskResultSchema accepts plan with PlanStep array", () => {
    const result = {
      success: true,
      stopReason: "PLAN_READY",
      verificationPassed: false,
      completedSteps: 0,
      totalSteps: 2,
      filesModified: [],
      plan: [
        { id: "1", description: "Create package.json", status: "pending" as const, toolType: "create_file", target: "package.json" },
        { id: "2", description: "Create server.js", status: "pending" as const, toolType: "create_file", target: "server.js" },
      ],
    };

    const parsed = AgentTaskResultSchema.safeParse(result);
    assert.ok(parsed.success, `Result schema parse failed: ${JSON.stringify(parsed.error)}`);
    assert.equal(parsed.data.plan?.length, 2);
    assert.equal(parsed.data.stopReason, "PLAN_READY");
  });

  await t.test("3. runAgent with planOnly: true generates and returns structured plan without file mutations", async () => {
    const result = await runAgent("Build an e-commerce storefront with products catalog and shopping cart", {
      planOnly: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.stopReason, "PLAN_READY");
    assert.equal(result.filesModified.length, 0, "Plan mode must not mutate or create any files");
    assert.ok(Array.isArray(result.plan), "Plan must be returned as an array");
    assert.ok(result.plan.length >= 3, `Plan should have at least 3 steps, got ${result.plan.length}`);
    assert.equal(result.totalSteps, result.plan.length);
    assert.equal(result.completedSteps, 0);

    for (const step of result.plan) {
      assert.ok(step.id, "Each step must have an id");
      assert.ok(step.description, "Each step must have a description");
      assert.equal(step.status, "pending");
    }
  });

  await t.test("4. runAgent with approvedPlan in planOnly mode respects pre-approved steps", async () => {
    const customApprovedPlan: PlanStep[] = [
      { id: "step-1", description: "Initialize custom config", status: "pending", toolType: "create_file", target: "config.json" },
      { id: "step-2", description: "Scaffold main app", status: "pending", toolType: "create_file", target: "app.js", dependsOn: ["step-1"] },
    ];

    const result = await runAgent("Custom task prompt", {
      planOnly: true,
      approvedPlan: customApprovedPlan,
    });

    assert.equal(result.success, true);
    assert.equal(result.stopReason, "PLAN_READY");
    assert.equal(result.plan?.length, 2);
    assert.equal(result.plan?.[0].id, "step-1");
    assert.equal(result.plan?.[1].id, "step-2");
  });
});
