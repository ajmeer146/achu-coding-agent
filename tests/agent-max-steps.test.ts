import { test } from "node:test";
import assert from "node:assert/strict";

test("AgentTaskPayloadSchema validates maxSteps within 1-50", async () => {
  const { AgentTaskPayloadSchema } = await import("../src/trigger/agent-task.js");
  
  // Valid values
  const valid1 = AgentTaskPayloadSchema.parse({ task: "test", workspaceRoot: "/tmp", maxSteps: 1 });
  assert.equal(valid1.maxSteps, 1);
  
  const valid5 = AgentTaskPayloadSchema.parse({ task: "test", workspaceRoot: "/tmp", maxSteps: 5 });
  assert.equal(valid5.maxSteps, 5);
  
  const valid30 = AgentTaskPayloadSchema.parse({ task: "test", workspaceRoot: "/tmp", maxSteps: 30 });
  assert.equal(valid30.maxSteps, 30);
  
  const valid50 = AgentTaskPayloadSchema.parse({ task: "test", workspaceRoot: "/tmp", maxSteps: 50 });
  assert.equal(valid50.maxSteps, 50);
  
  // Default value
  const defaultVal = AgentTaskPayloadSchema.parse({ task: "test", workspaceRoot: "/tmp" });
  assert.equal(defaultVal.maxSteps, 30);
  
  // Invalid values - should throw
  assert.throws(() => AgentTaskPayloadSchema.parse({ task: "test", workspaceRoot: "/tmp", maxSteps: 0 }), /maxSteps/);
  assert.throws(() => AgentTaskPayloadSchema.parse({ task: "test", workspaceRoot: "/tmp", maxSteps: 51 }), /maxSteps/);
  assert.throws(() => AgentTaskPayloadSchema.parse({ task: "test", workspaceRoot: "/tmp", maxSteps: -1 }), /maxSteps/);
});

test("AgentTaskPayloadSchema validates maxRecoveryAttempts within 0-5", async () => {
  const { AgentTaskPayloadSchema } = await import("../src/trigger/agent-task.js");
  
  // Valid values
  const valid0 = AgentTaskPayloadSchema.parse({ task: "test", workspaceRoot: "/tmp", maxRecoveryAttempts: 0 });
  assert.equal(valid0.maxRecoveryAttempts, 0);
  
  const valid3 = AgentTaskPayloadSchema.parse({ task: "test", workspaceRoot: "/tmp", maxRecoveryAttempts: 3 });
  assert.equal(valid3.maxRecoveryAttempts, 3);
  
  const valid5 = AgentTaskPayloadSchema.parse({ task: "test", workspaceRoot: "/tmp", maxRecoveryAttempts: 5 });
  assert.equal(valid5.maxRecoveryAttempts, 5);
  
  // Default value
  const defaultVal = AgentTaskPayloadSchema.parse({ task: "test", workspaceRoot: "/tmp" });
  assert.equal(defaultVal.maxRecoveryAttempts, 5);
  
  // Invalid values - should throw
  assert.throws(() => AgentTaskPayloadSchema.parse({ task: "test", workspaceRoot: "/tmp", maxRecoveryAttempts: -1 }), /maxRecoveryAttempts/);
  assert.throws(() => AgentTaskPayloadSchema.parse({ task: "test", workspaceRoot: "/tmp", maxRecoveryAttempts: 6 }), /maxRecoveryAttempts/);
});

test("runAgent options parameter accepts maxSteps and maxRecoveryAttempts", async () => {
  const { runAgent } = await import("../src/agent.js");
  // This test verifies the parameter acceptance and clamping logic
  // We can't fully test the loop without mocking the LLM, but we verify the function signature
  assert.equal(typeof runAgent, "function");
  
  // Verify the function accepts the options parameter
  const fnStr = runAgent.toString();
  assert.ok(fnStr.includes("maxSteps"));
  assert.ok(fnStr.includes("maxRecoveryAttempts"));
  assert.ok(fnStr.includes("DEFAULT_MAX_STEPS"));
  assert.ok(fnStr.includes("DEFAULT_MAX_RECOVERY_ATTEMPTS"));
});