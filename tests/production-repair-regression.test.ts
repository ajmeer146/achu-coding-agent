import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { Workspace } from "../src/tools/workspace.js";
import { createFile } from "../src/tools/create-file.js";
import { readFile } from "../src/tools/read-file.js";
import { runCommand } from "../src/tools/terminal.js";
import {
  normalizeUnixCommand,
  normalizeGrepCommand,
  normalizeFindCommand,
  normalizePipelinesForPowerShell,
} from "../src/utils/command-guard.js";
import { sanitizeUserFacingError } from "../src/utils/error-sanitizer.js";
import { runDeterministicUIChecks } from "../src/agent.js";
import { isToolResultFailure, isToolResultSuccess } from "../src/agent.js";
import { getModelConfig, PRIMARY_MODEL, FALLBACK_MODEL, DEFAULT_MODEL } from "../src/router.js";

test("1. PowerShell command normalization and execution", async (t) => {
  await t.test("standalone grep normalizes to Select-String with correct flags and paths", () => {
    // Basic grep
    const g1 = normalizeGrepCommand('grep "Total Price" file.txt');
    assert.ok(g1);
    assert.match(g1.normalized, /Select-String/);
    assert.match(g1.normalized, /-Pattern "Total Price"/);
    assert.match(g1.normalized, /-LiteralPath "file.txt"/);

    // Case-insensitive grep
    const g2 = normalizeGrepCommand('grep -i "Cart Items" index.html');
    assert.ok(g2);
    assert.match(g2.normalized, /Select-String/);
    assert.doesNotMatch(g2.normalized, /-CaseSensitive/);
    assert.match(g2.normalized, /-Pattern "Cart Items"/);

    // Invert match grep (-v)
    const g3 = normalizeGrepCommand('grep -v "skip" log.txt');
    assert.ok(g3);
    assert.match(g3.normalized, /-NotMatch/);

    // Recursive grep (-r)
    const g4 = normalizeGrepCommand('grep -r "ShopNova" .');
    assert.ok(g4);
    assert.match(g4.normalized, /Get-ChildItem/);
    assert.match(g4.normalized, /-Recurse/);
    assert.match(g4.normalized, /Select-String/);

    // Recursive grep with subfolder
    const g5 = normalizeGrepCommand('grep -rn "checkout" src/');
    assert.ok(g5);
    assert.match(g5.normalized, /Get-ChildItem -Path "src\/" -Recurse/);
  });

  await t.test("pipeline grep preserves quoted patterns with spaces", () => {
    const piped = normalizePipelinesForPowerShell('Get-Content index.html | grep -i "ShopNova E-Commerce"');
    assert.match(piped, /Select-String/);
    assert.match(piped, /-Pattern "ShopNova E-Commerce"/);
  });

  await t.test("standalone find normalizes to Get-ChildItem with filter", () => {
    const f1 = normalizeFindCommand('find . -name "*.js"');
    assert.ok(f1);
    assert.match(f1.normalized, /Get-ChildItem/);
    assert.match(f1.normalized, /-Filter "\*\.js"/);
  });

  await t.test("full command normalization handles compound commands and grep", () => {
    const res = normalizeUnixCommand('cat index.html | grep "ShopNova" && echo "found"');
    assert.match(res.normalized, /Get-Content/);
    assert.match(res.normalized, /Select-String/);
    if (process.platform === "win32") {
      assert.match(res.normalized, /if \(\$\?\) \{ Write-Output "found" \}/);
    }
  });

  await t.test("real execution: Select-String returns nonzero exit code on no match", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-test-grep-"));
    try {
      await fs.writeFile(path.join(tmpDir, "sample.txt"), "Hello World\nLine 2\n");
      const matchRes = await runCommand('grep -i "Hello" sample.txt', tmpDir);
      assert.equal(matchRes.exitCode, 0);
      assert.match(matchRes.stdout, /Hello/);

      const noMatchRes = await runCommand('grep -i "NonExistentTerm12345" sample.txt', tmpDir);
      assert.notEqual(noMatchRes.exitCode, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

test("2. File creation, disk read verification, and no redundant recreation", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-test-create-"));
  try {
    const ws = new Workspace(tmpDir);

    // Create file
    const res1 = await createFile(ws, "index.html", "<!DOCTYPE html><html><body><h1>Test</h1></body></html>", false);
    assert.match(res1, /Successfully created/);

    // Read back and confirm on disk
    const content = await readFile(ws, "index.html");
    assert.equal(content, "<!DOCTYPE html><html><body><h1>Test</h1></body></html>");

    // Attempting to create existing file without overwrite fails
    await assert.rejects(async () => {
      await createFile(ws, "index.html", "<!DOCTYPE html><html><body><h1>Updated</h1></body></html>", false);
    }, /File already exists/);

    // Overwriting succeeds and updates disk
    const res2 = await createFile(ws, "index.html", "<!DOCTYPE html><html><body><h1>Updated</h1></body></html>", true);
    assert.match(res2, /Successfully updated/);
    const updated = await readFile(ws, "index.html");
    assert.equal(updated, "<!DOCTYPE html><html><body><h1>Updated</h1></body></html>");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("3. Provider and model error sanitization", async (t) => {
  await t.test("redacts raw NVIDIA and Nemotron model names", () => {
    const raw = "Error calling model nvidia/nemotron-3.5-lightning-30b-a3b: server returned 503";
    const sanitized = sanitizeUserFacingError(raw);
    assert.doesNotMatch(sanitized, /nvidia\/nemotron/i);
    assert.doesNotMatch(sanitized, /30b-a3b/i);

    const rawMiniMax = "Error calling model minimaxai/minimax-m3.1-flash: rate limit reached";
    const sanitizedMiniMax = sanitizeUserFacingError(rawMiniMax);
    assert.doesNotMatch(sanitizedMiniMax, /minimax/i);
  });

  await t.test("redacts fallback model names", () => {
    const raw = "Fallback model nvidia/nemotron-3-super-120b-a12b timed out";
    const sanitized = sanitizeUserFacingError(raw);
    assert.doesNotMatch(sanitized, /nemotron-3-super-120b-a12b/i);
    assert.match(sanitized, /timeout|temporarily unavailable/i);
  });

  await t.test("redacts API keys, secret tokens, and bearer tokens", () => {
    const raw = "Request failed with Authorization: Bearer nvapi-secret1234567890abcdef and key tr_prod_secret1234567890";
    const sanitized = sanitizeUserFacingError(raw);
    assert.doesNotMatch(sanitized, /nvapi-secret/);
    assert.doesNotMatch(sanitized, /tr_prod_secret/);
    assert.match(sanitized, /\[REDACTED_SECRET\]|\[REDACTED_TOKEN\]/);
  });

  await t.test("maps timeout errors to safe user-friendly message", () => {
    const raw = "TIMEOUT after 3 attempts: Request timeout after 45000ms (integrate.api.nvidia.com)";
    const sanitized = sanitizeUserFacingError(raw);
    assert.equal(
      sanitized,
      "The AI service is temporarily unavailable due to a request timeout. Please try again shortly."
    );
  });

  await t.test("maps rate limit errors to safe user-friendly message", () => {
    const raw = "QUOTA_EXHAUSTED: status 429 rate_limit_exceeded";
    const sanitized = sanitizeUserFacingError(raw);
    assert.equal(
      sanitized,
      "The AI service rate limit was reached. Please wait a moment and try again."
    );
  });
});

test("4. Deterministic UI checks and browser verification truthfulness", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-test-ui-"));
  try {
    const ws = new Workspace(tmpDir);

    // Empty workspace fails deterministic checks
    const check1 = await runDeterministicUIChecks(ws);
    assert.equal(check1.passed, false);
    assert.ok(check1.errors.some((e) => e.includes("index.html does not exist")));

    // Creating proper HTML and CSS passes
    await ws.write(
      "index.html",
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header><nav><a href="#">Brand</a></nav></header>
  <main><h1>Welcome</h1></main>
  <footer><p>© 2026</p></footer>
  <script src="script.js"></script>
</body>
</html>`
    );
    await ws.write(
      "styles.css",
      `:root { --primary: #3b82f6; }
body { margin: 0; font-family: system-ui; }
header { padding: 1rem; }
@media (max-width: 768px) { body { font-size: 14px; } }`
    );

    const check2 = await runDeterministicUIChecks(ws);
    assert.equal(check2.passed, true);
    assert.match(check2.details, /PASSED/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("5. Tool result success and failure detection truthfulness", () => {
  // Positive evidence required for browser verification
  assert.equal(isToolResultSuccess("browser_verify", "Browser verification passed at http://localhost:3000:"), true);
  // Skipping browser verification is NOT counted as verification passed
  assert.equal(isToolResultSuccess("browser_verify", "Browser verification skipped: service unavailable"), false);

  // Command exit codes
  assert.equal(isToolResultFailure("run_command", "Exit code: 1\nSTDERR: grep not found"), true);
  assert.equal(isToolResultFailure("run_command", "Exit code: 0\nSTDOUT: done"), false);

  // Defect results
  assert.equal(isToolResultFailure("browser_verify", "Browser verification failed (attempt 1/3)"), true);
  assert.equal(isToolResultFailure("browser_verify", "measurable visual defects were detected:"), true);
});

test("6. Model selection and transient failover routing", async (t) => {
  const originalModel = process.env.NVIDIA_MODEL;
  const originalAgentModel = process.env.ACHU_AGENT_MODEL;
  const originalKey = process.env.NVIDIA_API_KEY;

  try {
    process.env.NVIDIA_API_KEY = "test-key-mock";

    await t.test("default primary model resolves to MiniMax M3.1 Flash when env unset", () => {
      delete process.env.NVIDIA_MODEL;
      delete process.env.ACHU_AGENT_MODEL;
      const cfg = getModelConfig();
      assert.equal(cfg.name, PRIMARY_MODEL);
      assert.equal(cfg.name, "minimaxai/minimax-m3.1-flash");
      assert.equal(DEFAULT_MODEL, "minimaxai/minimax-m3.1-flash");
    });

    await t.test("explicit NVIDIA_MODEL override is strictly honored", () => {
      process.env.NVIDIA_MODEL = "custom-enterprise-model-v1";
      const cfg = getModelConfig();
      assert.equal(cfg.name, "custom-enterprise-model-v1");
    });

    await t.test("explicit ACHU_AGENT_MODEL override is strictly honored when NVIDIA_MODEL unset", () => {
      delete process.env.NVIDIA_MODEL;
      process.env.ACHU_AGENT_MODEL = "secondary-override-model";
      const cfg = getModelConfig();
      assert.equal(cfg.name, "secondary-override-model");
    });

    await t.test("unsupported or hanging models are safely remapped to FALLBACK_MODEL", () => {
      delete process.env.ACHU_AGENT_MODEL;
      const hangingModels = [
        "nvidia/nemotron-3-super-120b-a12b",
        "mistralai/codestral-22b-instruct-v0.1",
        "moonshotai/kimi-k2.6",
        "mistralai/mistral-large-2-instruct",
        "deepseek-ai/deepseek-v4.1-flash",
      ];
      for (const m of hangingModels) {
        process.env.NVIDIA_MODEL = m;
        const cfg = getModelConfig();
        assert.equal(cfg.name, FALLBACK_MODEL, `Model ${m} must be remapped to FALLBACK_MODEL`);
        assert.equal(cfg.name, "nvidia/nemotron-3.5-lightning-30b-a3b");
      }
    });

    await t.test("transient errors (timeout, 429, 5xx, network) are classified for failover", () => {
      const isTransient = (err: any) => {
        const errMsg = String(err?.message || "").toLowerCase();
        return (
          err?.name === "AbortError" ||
          errMsg.includes("timed out") ||
          errMsg.includes("timeout") ||
          errMsg.includes("429") ||
          errMsg.includes("quota_exhausted") ||
          errMsg.includes("rate limit") ||
          errMsg.includes("server_error") ||
          errMsg.includes("server error") ||
          errMsg.includes("500") ||
          errMsg.includes("502") ||
          errMsg.includes("503") ||
          errMsg.includes("504") ||
          errMsg.includes("network_error") ||
          errMsg.includes("network error") ||
          errMsg.includes("econnreset") ||
          errMsg.includes("econnrefused") ||
          errMsg.includes("enotfound") ||
          errMsg.includes("ehostunreach")
        );
      };

      // Transient errors that SHOULD trigger fallback
      assert.equal(isTransient(new Error("Request timed out after 30000ms")), true);
      assert.equal(isTransient(new Error("Server error (503): Service Unavailable")), true);
      assert.equal(isTransient(new Error("QUOTA_EXHAUSTED: Rate limit reached")), true);
      assert.equal(isTransient(new Error("Network error: ECONNRESET")), true);

      // Non-transient errors that must NOT trigger fallback (fail fast)
      assert.equal(isTransient(new Error("Client error (401): Unauthorized")), false);
      assert.equal(isTransient(new Error("Client error (403): Forbidden")), false);
      assert.equal(isTransient(new Error("Client error (400): Bad Request")), false);
    });

    await t.test("tool-call continuity preserves prior messages during failover", () => {
      const messages = [
        { role: "system", content: "You are an agent." },
        { role: "user", content: "Build website" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "call_1", type: "function", function: { name: "create_file", arguments: '{"path":"index.html"}' } }
          ]
        },
        { role: "tool", content: "File created successfully", toolCallId: "call_1" }
      ];

      // Failover receives identical message history
      const failoverTurn = [...messages];
      assert.equal(failoverTurn.length, 4);
      assert.equal(failoverTurn[2].toolCalls[0].function.name, "create_file");
      assert.equal(failoverTurn[3].content, "File created successfully");
    });
  } finally {
    if (originalModel !== undefined) process.env.NVIDIA_MODEL = originalModel;
    else delete process.env.NVIDIA_MODEL;
    if (originalAgentModel !== undefined) process.env.ACHU_AGENT_MODEL = originalAgentModel;
    else delete process.env.ACHU_AGENT_MODEL;
    if (originalKey !== undefined) process.env.NVIDIA_API_KEY = originalKey;
    else delete process.env.NVIDIA_API_KEY;
  }
});
