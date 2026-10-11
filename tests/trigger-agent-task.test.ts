import { test } from "node:test";
import assert from "node:assert/strict";
import { codingAgentTask } from "../src/trigger/agent-task.js";

test("codingAgentTask is registered with correct id", () => {
  assert.equal(codingAgentTask.id, "coding-agent-run");
});

test("codingAgentTask is a valid task definition object", () => {
  assert.ok(codingAgentTask);
  assert.equal(typeof codingAgentTask, "object");
});