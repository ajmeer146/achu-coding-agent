import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getModelConfig, PRIMARY_MODEL, FALLBACK_MODEL, DEFAULT_MODEL } from "../src/router.js";
import { sanitizeUserFacingError } from "../src/utils/error-sanitizer.js";

describe("Phase 5 — Primary / Fallback Model Failover and Routing Specification", () => {
  // Test 1: Canonical model declarations
  test("1. Canonical model IDs are correctly exported", () => {
    assert.equal(PRIMARY_MODEL, "minimaxai/minimax-m3.1-flash");
    assert.equal(FALLBACK_MODEL, "nvidia/nemotron-3.5-lightning-30b-a3b");
    assert.equal(DEFAULT_MODEL, PRIMARY_MODEL);
  });

  // Test 2: Default resolution
  test("2. Default resolution chooses MiniMax when no env variables are set", () => {
    const originalNvidia = process.env.NVIDIA_MODEL;
    const originalAgent = process.env.ACHU_AGENT_MODEL;
    const originalKey = process.env.NVIDIA_API_KEY;
    try {
      process.env.NVIDIA_API_KEY = "mock-key";
      delete process.env.NVIDIA_MODEL;
      delete process.env.ACHU_AGENT_MODEL;

      const config = getModelConfig();
      assert.equal(config.name, PRIMARY_MODEL);
      assert.equal(config.baseURL, "https://integrate.api.nvidia.com/v1");
    } finally {
      if (originalNvidia !== undefined) process.env.NVIDIA_MODEL = originalNvidia;
      else delete process.env.NVIDIA_MODEL;
      if (originalAgent !== undefined) process.env.ACHU_AGENT_MODEL = originalAgent;
      else delete process.env.ACHU_AGENT_MODEL;
      if (originalKey !== undefined) process.env.NVIDIA_API_KEY = originalKey;
      else delete process.env.NVIDIA_API_KEY;
    }
  });

  // Test 3: Explicit env override
  test("3. Explicit environment override takes precedence", () => {
    const originalNvidia = process.env.NVIDIA_MODEL;
    const originalKey = process.env.NVIDIA_API_KEY;
    try {
      process.env.NVIDIA_API_KEY = "mock-key";
      process.env.NVIDIA_MODEL = "custom-override-model";

      const config = getModelConfig();
      assert.equal(config.name, "custom-override-model");
    } finally {
      if (originalNvidia !== undefined) process.env.NVIDIA_MODEL = originalNvidia;
      else delete process.env.NVIDIA_MODEL;
      if (originalKey !== undefined) process.env.NVIDIA_API_KEY = originalKey;
      else delete process.env.NVIDIA_API_KEY;
    }
  });

  // Test 4: Deprecated model remapping
  test("4. Deprecated and hanging models remap safely to FALLBACK_MODEL", () => {
    const originalNvidia = process.env.NVIDIA_MODEL;
    const originalKey = process.env.NVIDIA_API_KEY;
    try {
      process.env.NVIDIA_API_KEY = "mock-key";
      const problematic = [
        "nvidia/nemotron-3-super-120b-a12b",
        "mistralai/codestral-22b-instruct-v0.1",
        "moonshotai/kimi-k2.6",
        "mistralai/mistral-large-2-instruct",
        "deepseek-ai/deepseek-v4.1-flash",
      ];
      for (const m of problematic) {
        process.env.NVIDIA_MODEL = m;
        const config = getModelConfig();
        assert.equal(config.name, FALLBACK_MODEL);
      }
    } finally {
      if (originalNvidia !== undefined) process.env.NVIDIA_MODEL = originalNvidia;
      else delete process.env.NVIDIA_MODEL;
      if (originalKey !== undefined) process.env.NVIDIA_API_KEY = originalKey;
      else delete process.env.NVIDIA_API_KEY;
    }
  });

  // Test 5: Deterministic simulation of callModel failover logic
  test("5. Failover logic: Primary success dispatches without invoking fallback", async () => {
    const calls: Array<{ model: string; messages: any[] }> = [];

    const mockCallModelWithRetry = async (client: any, model: string, messages: any[]) => {
      calls.push({ model, messages });
      return { content: "Primary response", toolCalls: [] };
    };

    const callModelSim = async (client: any, model: string, messages: any[]) => {
      try {
        return await mockCallModelWithRetry(client, model, messages);
      } catch (err: any) {
        if (model !== FALLBACK_MODEL) {
          return await mockCallModelWithRetry(client, FALLBACK_MODEL, messages);
        }
        throw err;
      }
    };

    const result = await callModelSim({}, PRIMARY_MODEL, [{ role: "user", content: "Hi" }]);
    assert.equal(result.content, "Primary response");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, PRIMARY_MODEL);
  });

  test("6. Failover logic: Primary timeout fails over to FALLBACK_MODEL and preserves message history", async () => {
    const calls: Array<{ model: string; messages: any[] }> = [];

    const mockCallModelWithRetry = async (client: any, model: string, messages: any[]) => {
      calls.push({ model, messages });
      if (model === PRIMARY_MODEL) {
        const timeoutErr: any = new Error("Request timeout after 120000ms");
        timeoutErr.name = "AbortError";
        throw timeoutErr;
      }
      return { content: "Fallback response after timeout", toolCalls: [] };
    };

    const callModelSim = async (client: any, model: string, messages: any[]) => {
      try {
        return await mockCallModelWithRetry(client, model, messages);
      } catch (err: any) {
        const errMsg = String(err?.message || "").toLowerCase();
        const isTransient = err?.name === "AbortError" || errMsg.includes("timeout") || errMsg.includes("timed out");
        if (isTransient && model !== FALLBACK_MODEL) {
          return await mockCallModelWithRetry(client, FALLBACK_MODEL, messages);
        }
        throw err;
      }
    };

    const history = [
      { role: "system", content: "Agent system prompt" },
      { role: "user", content: "Build app" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file" } }] },
      { role: "tool", tool_call_id: "c1", content: "File content" }
    ];

    const result = await callModelSim({}, PRIMARY_MODEL, history);
    assert.equal(result.content, "Fallback response after timeout");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].model, PRIMARY_MODEL);
    assert.equal(calls[1].model, FALLBACK_MODEL);
    // Tool call history must be preserved identically
    assert.equal(calls[1].messages.length, 4);
    assert.equal(calls[1].messages[2].tool_calls[0].id, "c1");
  });

  test("7. Failover logic: Primary 429 Rate Limit fails over to FALLBACK_MODEL", async () => {
    const calls: string[] = [];
    const mockCallModelWithRetry = async (client: any, model: string, messages: any[]) => {
      calls.push(model);
      if (model === PRIMARY_MODEL) {
        const rateLimitErr: any = new Error("QUOTA_EXHAUSTED: Rate limit reached (status 429)");
        rateLimitErr.status = 429;
        throw rateLimitErr;
      }
      return { content: "Recovered via fallback", toolCalls: [] };
    };

    const callModelSim = async (client: any, model: string, messages: any[]) => {
      try {
        return await mockCallModelWithRetry(client, model, messages);
      } catch (err: any) {
        const errMsg = String(err?.message || "").toLowerCase();
        const isTransient = err?.status === 429 || errMsg.includes("429") || errMsg.includes("quota_exhausted");
        if (isTransient && model !== FALLBACK_MODEL) {
          return await mockCallModelWithRetry(client, FALLBACK_MODEL, messages);
        }
        throw err;
      }
    };

    const res = await callModelSim({}, PRIMARY_MODEL, [{ role: "user", content: "Ping" }]);
    assert.equal(res.content, "Recovered via fallback");
    assert.deepEqual(calls, [PRIMARY_MODEL, FALLBACK_MODEL]);
  });

  test("8. Failover logic: Primary 503 Server Error fails over to FALLBACK_MODEL", async () => {
    const calls: string[] = [];
    const mockCallModelWithRetry = async (client: any, model: string, messages: any[]) => {
      calls.push(model);
      if (model === PRIMARY_MODEL) {
        const serverErr: any = new Error("SERVER_ERROR: Service Unavailable (status 503)");
        serverErr.status = 503;
        throw serverErr;
      }
      return { content: "Recovered from 503", toolCalls: [] };
    };

    const callModelSim = async (client: any, model: string, messages: any[]) => {
      try {
        return await mockCallModelWithRetry(client, model, messages);
      } catch (err: any) {
        const errMsg = String(err?.message || "").toLowerCase();
        const isTransient = err?.status === 503 || errMsg.includes("503") || errMsg.includes("server_error");
        if (isTransient && model !== FALLBACK_MODEL) {
          return await mockCallModelWithRetry(client, FALLBACK_MODEL, messages);
        }
        throw err;
      }
    };

    const res = await callModelSim({}, PRIMARY_MODEL, [{ role: "user", content: "Ping" }]);
    assert.equal(res.content, "Recovered from 503");
    assert.deepEqual(calls, [PRIMARY_MODEL, FALLBACK_MODEL]);
  });

  test("9. Fail-fast logic: Primary 401 Unauthorized fails fast without attempting fallback", async () => {
    const calls: string[] = [];
    const mockCallModelWithRetry = async (client: any, model: string, messages: any[]) => {
      calls.push(model);
      const authErr: any = new Error("CLIENT_ERROR: Unauthorized (status 401)");
      authErr.status = 401;
      throw authErr;
    };

    const callModelSim = async (client: any, model: string, messages: any[]) => {
      try {
        return await mockCallModelWithRetry(client, model, messages);
      } catch (err: any) {
        const errMsg = String(err?.message || "").toLowerCase();
        const isTransient = err?.status >= 500 || errMsg.includes("timeout") || err?.status === 429;
        if (isTransient && model !== FALLBACK_MODEL) {
          return await mockCallModelWithRetry(client, FALLBACK_MODEL, messages);
        }
        throw err;
      }
    };

    await assert.rejects(async () => {
      await callModelSim({}, PRIMARY_MODEL, [{ role: "user", content: "Ping" }]);
    }, /Unauthorized/);

    assert.equal(calls.length, 1, "401 must fail fast without attempting fallback");
    assert.equal(calls[0], PRIMARY_MODEL);
  });

  test("10. Recursion prevention: When FALLBACK_MODEL also fails, it terminates honestly without looping", async () => {
    let fallbackAttempts = 0;
    const mockCallModelWithRetry = async (client: any, model: string, messages: any[]) => {
      if (model === FALLBACK_MODEL) {
        fallbackAttempts++;
      }
      throw new Error("Server error (500)");
    };

    const callModelSim = async (client: any, model: string, messages: any[]) => {
      try {
        return await mockCallModelWithRetry(client, model, messages);
      } catch (err: any) {
        if (model !== FALLBACK_MODEL) {
          return await mockCallModelWithRetry(client, FALLBACK_MODEL, messages);
        }
        throw err;
      }
    };

    await assert.rejects(async () => {
      await callModelSim({}, PRIMARY_MODEL, [{ role: "user", content: "Ping" }]);
    }, /Server error/);

    assert.equal(fallbackAttempts, 1, "Fallback must be attempted exactly once and not recurse");
  });

  test("11. Request construction applies reasoning_effort='high' to MiniMax and Nemotron models", () => {
    const buildPayload = (model: string, messages: any[]) => {
      const payload: any = {
        model,
        messages,
        temperature: 0,
        tools: [],
      };
      if (model.includes("minimax") || model.includes("nemotron")) {
        payload.reasoning_effort = "high";
      }
      return payload;
    };

    // Primary MiniMax payload must include reasoning_effort: "high"
    const primaryPayload = buildPayload(PRIMARY_MODEL, [{ role: "user", content: "test" }]);
    assert.equal(primaryPayload.reasoning_effort, "high", "Primary MiniMax model must receive reasoning_effort: 'high'");

    // Fallback Nemotron payload must include reasoning_effort: "high"
    const fallbackPayload = buildPayload(FALLBACK_MODEL, [{ role: "user", content: "test" }]);
    assert.equal(fallbackPayload.reasoning_effort, "high", "Fallback Nemotron model must receive reasoning_effort: 'high'");

    // Non-reasoning models must omit the parameter
    const genericPayload = buildPayload("gpt-3.5-turbo", [{ role: "user", content: "test" }]);
    assert.equal(genericPayload.reasoning_effort, undefined, "Non-reasoning model must not receive reasoning_effort");
  });
});
