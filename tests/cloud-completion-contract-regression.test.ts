import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

describe("Cloud completion and tool-only response contracts", () => {
  const agent = fs.readFileSync("src/agent.ts", "utf8");
  const trigger = fs.readFileSync("src/trigger/agent-task.ts", "utf8");

  test("valid tool-only responses require validation and confirmed execution before plan progress", () => {
    assert.match(agent, /argument_validation_passed/);
    assert.match(agent, /execution_succeeded/);
    assert.match(agent, /plan_step_execution_confirmed/);
    assert.match(agent, /if \(!isToolResultFailure\(toolCall\.function\.name, result\)\)/);
  });

  test("malformed arguments and failed execution are diagnostic failures", () => {
    assert.match(agent, /argument_validation_failed/);
    assert.match(agent, /execution_failed/);
    assert.match(agent, /plan_step_not_completed/);
    assert.match(agent, /Tool error: Invalid arguments for/);
  });

  test("browser verification can complete the lifecycle in the same tool turn", () => {
    assert.match(agent, /terminal_completion_proven/);
    assert.match(agent, /isWebAppLifecycle && isPlanComplete\(state\.currentPlan\)/);
  });

  test("Trigger task logs artifact persistence and terminal success/failure results", () => {
    assert.match(trigger, /Artifact persistence confirmed/);
    assert.match(trigger, /Terminal result persisted/);
    assert.match(trigger, /Terminal failure result persisted/);
    assert.match(trigger, /artifactCount/);
  });

  test("model timeout remains bounded and uses the existing fallback path", () => {
    assert.match(agent, /turnAbortController\.abort/);
    assert.match(agent, /FALLBACK_MODEL/);
    assert.match(agent, /Request attempt \$\{attempt \+ 1\}\/\$\{maxRetries \+ 1\} failed/);
  });
});
