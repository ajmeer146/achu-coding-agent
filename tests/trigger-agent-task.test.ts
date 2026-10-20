import { test } from "node:test";
import assert from "node:assert/strict";
import { codingAgentTask, AgentTaskPayloadSchema, getWorkspaceRoot } from "../src/trigger/agent-task.js";
import { Workspace } from "../src/tools/workspace.js";

test("codingAgentTask is registered with correct id", () => {
  assert.equal(codingAgentTask.id, "coding-agent-run");
});

test("codingAgentTask is a valid task definition object", () => {
  assert.ok(codingAgentTask);
  assert.equal(typeof codingAgentTask, "object");
});

test("AgentTaskPayloadSchema validates gitUrl cloud payloads", () => {
  const validGit = AgentTaskPayloadSchema.safeParse({
    task: "Build landing page",
    gitUrl: "https://github.com/ajmeer146/achu-coding-agent-smoke-test",
    branch: "main",
  });
  assert.equal(validGit.success, true);
});

test("AgentTaskPayloadSchema validates uploaded files array payloads", () => {
  const validFiles = AgentTaskPayloadSchema.safeParse({
    task: "Fix styling",
    files: [{ path: "src/App.jsx", content: "export default () => <div>App</div>;" }],
  });
  assert.equal(validFiles.success, true);
});

test("AgentTaskPayloadSchema rejects empty task descriptions", () => {
  const emptyTask = AgentTaskPayloadSchema.safeParse({
    task: "",
    gitUrl: "https://github.com/ajmeer146/smoke-test",
  });
  assert.equal(emptyTask.success, false);
});

test("getWorkspaceRoot returns authoritative root from Workspace", () => {
  const ws = new Workspace("C:/Users/Achu146/temp-test");
  assert.equal(typeof getWorkspaceRoot(ws), "string");
  assert.ok(getWorkspaceRoot(ws).includes("temp-test"));
});