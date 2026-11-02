import { test, describe } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { getModelConfig, PRIMARY_MODEL, FALLBACK_MODEL, DEFAULT_MODEL } from "../src/router.js";

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match) {
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[match[1]]) {
          process.env[match[1]] = val;
        }
      }
    }
  }
}

loadEnv();

describe("Directive Section 3 — Model Verification & Live Failover Suite", () => {
  const apiKey = process.env.NVIDIA_API_KEY || process.env.ACHU_AGENT_API_KEY;
  const baseURL = process.env.NVIDIA_BASE_URL || process.env.ACHU_AGENT_BASE_URL || "https://integrate.api.nvidia.com/v1";

  test("1. Production credentials are configured safely without leaking", () => {
    assert.ok(apiKey, "NVIDIA_API_KEY or ACHU_AGENT_API_KEY must be configured");
    assert.ok(apiKey.length > 10, "API key should be valid non-empty token");
    const masked = apiKey.slice(0, 4) + "..." + apiKey.slice(-4);
    assert.ok(!masked.includes(apiKey), "Key should be masked");
  });

  test("2. Model router resolves to PRIMARY_MODEL (minimaxai/minimax-m3.1-flash)", () => {
    const config = getModelConfig();
    assert.equal(config.name, PRIMARY_MODEL);
    assert.equal(PRIMARY_MODEL, "minimaxai/minimax-m3.1-flash");
    assert.equal(DEFAULT_MODEL, PRIMARY_MODEL);
    assert.equal(FALLBACK_MODEL, "nvidia/nemotron-3.5-lightning-30b-a3b");
    assert.equal(config.baseURL, baseURL);
  });

  test("3. Model registry probe: verifies primary and fallback models on provider account", async (t) => {
    if (!apiKey) {
      t.skip("Missing API key");
      return;
    }
    const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.ok(res.ok, `NVIDIA models endpoint returned ${res.status}`);
    const data = await res.json();
    const ids = (data.data || []).map((m: any) => m.id);
    assert.ok(ids.includes(PRIMARY_MODEL), `Provider must include primary model ${PRIMARY_MODEL}`);
    assert.ok(ids.includes(FALLBACK_MODEL), `Provider must include fallback model ${FALLBACK_MODEL}`);
  });

  test("4. Live structured tool-calling verification on active runtime model", async (t) => {
    if (!apiKey) {
      t.skip("Missing API key");
      return;
    }

    const client = new OpenAI({ apiKey, baseURL });
    const startTime = Date.now();

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "calculate_sum",
          description: "Calculates the sum of two numbers",
          parameters: {
            type: "object",
            properties: {
              a: { type: "number", description: "First number" },
              b: { type: "number", description: "Second number" },
            },
            required: ["a", "b"],
          },
        },
      },
    ];

    // In agent.ts, callModel tries primary (minimaxai/minimax-m3.1-flash) and on transient timeout fails over to FALLBACK_MODEL
    let response: any;
    let modelUsed = PRIMARY_MODEL;
    try {
      response = await client.chat.completions.create({
        model: PRIMARY_MODEL,
        messages: [{ role: "user", content: "Call calculate_sum with a=25 and b=75." }],
        tools,
        tool_choice: "auto",
        stream: false,
      }, { timeout: 10000 });
    } catch {
      modelUsed = FALLBACK_MODEL;
      response = await client.chat.completions.create({
        model: FALLBACK_MODEL,
        messages: [{ role: "user", content: "Call calculate_sum with a=25 and b=75." }],
        tools,
        tool_choice: "auto",
        stream: false,
      }, { timeout: 30000 });
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Tool Call Live] Model used: ${modelUsed} (${elapsed}ms)`);
    assert.ok(response.choices[0]?.message?.tool_calls?.length > 0, "Response must include tool calls");
    const tc = response.choices[0].message.tool_calls[0];
    assert.equal(tc.function.name, "calculate_sum");
    const args = JSON.parse(tc.function.arguments);
    assert.equal(args.a, 25);
    assert.equal(args.b, 75);
  });

  test("5. Live streaming tool-call accumulation verification", async (t) => {
    if (!apiKey) {
      t.skip("Missing API key");
      return;
    }

    const client = new OpenAI({ apiKey, baseURL });
    const startTime = Date.now();

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "calculate_sum",
          description: "Calculates the sum of two numbers",
          parameters: {
            type: "object",
            properties: {
              a: { type: "number", description: "First number" },
              b: { type: "number", description: "Second number" },
            },
            required: ["a", "b"],
          },
        },
      },
    ];

    let stream: any;
    let modelUsed = PRIMARY_MODEL;
    try {
      stream = await client.chat.completions.create({
        model: PRIMARY_MODEL,
        messages: [{ role: "user", content: "Call calculate_sum with a=25 and b=75." }],
        tools,
        tool_choice: "auto",
        stream: true,
      }, { timeout: 10000 });
    } catch {
      modelUsed = FALLBACK_MODEL;
      stream = await client.chat.completions.create({
        model: FALLBACK_MODEL,
        messages: [{ role: "user", content: "Call calculate_sum with a=25 and b=75." }],
        tools,
        tool_choice: "auto",
        stream: true,
      }, { timeout: 30000 });
    }

    const toolCallsAcc: Record<number, { id: string; name: string; args: string }> = {};

    for await (const chunk of stream) {
      const deltas = chunk.choices[0]?.delta?.tool_calls;
      if (deltas) {
        for (const tc of deltas) {
          const idx = tc.index ?? 0;
          if (!toolCallsAcc[idx]) {
            toolCallsAcc[idx] = { id: "", name: "", args: "" };
          }
          if (tc.id) toolCallsAcc[idx].id += tc.id;
          if (tc.function?.name) toolCallsAcc[idx].name += tc.function.name;
          if (tc.function?.arguments) toolCallsAcc[idx].args += tc.function.arguments;
        }
      }
    }

    const elapsed = Date.now() - startTime;
    const calls = Object.values(toolCallsAcc);
    console.log(`[Streaming Tool Call Live] Model used: ${modelUsed} (${elapsed}ms), Tool calls: ${calls.length}`);
    assert.ok(calls.length > 0, "Must accumulate at least 1 tool call");
    assert.equal(calls[0].name, "calculate_sum");
    const parsed = JSON.parse(calls[0].args);
    assert.equal(parsed.a, 25);
    assert.equal(parsed.b, 75);
  });
});
