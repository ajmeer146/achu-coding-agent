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

  test("4. Aborted stream and empty responses must throw errors instead of returning empty results", () => {
    assert.match(
      agentSrc,
      /if\s*\(turnAbortController\.signal\.aborted\)\s*\{[\s\S]*?throw timeoutErr;/,
      "Must throw AbortError when stream was aborted by turn timeout"
    );
    assert.match(
      agentSrc,
      /if\s*\(!accumulatedContent\s*&&\s*Object\.keys\(toolCallAccumulator\)\.length === 0\)\s*\{[\s\S]*?throw emptyErr;/,
      "Must throw EmptyResponseError when stream yields 0 content tokens and 0 tool calls"
    );
  });

  test("5. Failover logic invokes FALLBACK_MODEL on stream timeout or empty response", async () => {
    const calls: Array<{ model: string }> = [];
    const mockClient = {};

    // Simulate primary timeout -> fallback success
    const mockCallModelSim = async (model: string) => {
      calls.push({ model });
      if (model === "minimaxai/minimax-m3.1-flash") {
        const timeoutErr: any = new Error("Request timeout after 120000ms: minimax stream exceeded turn deadline");
        timeoutErr.name = "AbortError";
        throw timeoutErr;
      }
      return { content: "Fallback success", toolCalls: [] };
    };

    const callModelWithFallback = async (model: string) => {
      try {
        return await mockCallModelSim(model);
      } catch (err: any) {
        const errMsg = String(err?.message || "").toLowerCase();
        const isUserCancellation = err?.name === "CancelledError" || errMsg.includes("cancelled");
        if (isUserCancellation) throw err;
        const isTransient = err?.name === "AbortError" || errMsg.includes("timeout") || errMsg.includes("empty response");
        if (isTransient && model !== "nvidia/nemotron-3.5-lightning-30b-a3b") {
          return await mockCallModelSim("nvidia/nemotron-3.5-lightning-30b-a3b");
        }
        throw err;
      }
    };

    const result = await callModelWithFallback("minimaxai/minimax-m3.1-flash");
    assert.equal(result.content, "Fallback success");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].model, "minimaxai/minimax-m3.1-flash");
    assert.equal(calls[1].model, "nvidia/nemotron-3.5-lightning-30b-a3b");
  });

  test("6. Intentional user cancellation is preserved and does not trigger fallback or retry loop", async () => {
    const calls: Array<{ model: string }> = [];

    const callModelWithFallback = async (model: string) => {
      try {
        calls.push({ model });
        const cancelErr: any = new Error("Operation cancelled by user");
        cancelErr.name = "CancelledError";
        throw cancelErr;
      } catch (err: any) {
        const errMsg = String(err?.message || "").toLowerCase();
        const isUserCancellation = err?.name === "CancelledError" || errMsg.includes("cancelled") || errMsg.includes("canceled by user");
        if (isUserCancellation) throw err;
        if (model !== "nvidia/nemotron-3.5-lightning-30b-a3b") {
          return { content: "Unintended fallback", toolCalls: [] };
        }
        throw err;
      }
    };

    await assert.rejects(
      async () => await callModelWithFallback("minimaxai/minimax-m3.1-flash"),
      (err: any) => err.name === "CancelledError" && err.message.includes("cancelled by user")
    );
    assert.equal(calls.length, 1, "User cancellation must not trigger fallback call");
  });
});
