import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

describe("Cloud Task Timeout, Message Protocol & Reasoning Effort Regression Suite", () => {
  const agentSrc = fs.readFileSync("src/agent.ts", "utf8");

  test("1. open_browser auto-execution must add tool_calls to preceding assistant message", () => {
    // Locate the open_browser auto-execution block
    const autoExecIdx = agentSrc.indexOf('pendingLifecycle[0].toolType === "open_browser"');
    assert.ok(autoExecIdx > 0, "Must contain open_browser auto-execution block");

    const block = agentSrc.slice(autoExecIdx, autoExecIdx + 1500);
    assert.match(
      block,
      /lastMsg\.tool_calls\s*=\s*\[\.\.\.\(lastMsg\.tool_calls \|\| \[\]\),\s*openCall\]/,
      "Must append openCall to preceding assistant message tool_calls"
    );
    assert.match(
      block,
      /role:\s*["']assistant["'],\s*content:\s*null,\s*tool_calls:\s*\[openCall\]/,
      "Must create assistant message with tool_calls if preceding message is not assistant"
    );
  });

  test("2. reasoning_effort must be set to 'low' for reasoning models to avoid multi-minute latency stalls", () => {
    assert.match(
      agentSrc,
      /requestPayload\.reasoning_effort\s*=\s*["']low["']/,
      "Must configure reasoning_effort as 'low' to prevent 300+ second latency stalls"
    );
    assert.doesNotMatch(
      agentSrc,
      /requestPayload\.reasoning_effort\s*=\s*["']high["']/,
      "Must NOT set reasoning_effort to 'high'"
    );
  });

  test("3. Streaming model response must be bounded by a turn timeout with AbortController", () => {
    assert.match(
      agentSrc,
      /turnAbortController\.abort/,
      "Must abort turn stream on timeout"
    );
    assert.match(
      agentSrc,
      /signal:\s*turnAbortController\.signal/,
      "Must pass turnAbortController signal to chat.completions.create"
    );
  });
});
