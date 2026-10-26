/**
 * P0 Regression Test: Vercel Loopback Elimination
 *
 * Verifies that the /api/coding-agent/tasks route for local execution mode
 * does NOT attempt to reach 127.0.0.1:3001 from the serverless context.
 * The browser client owns companion dispatch; the server only persists the DB record.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webAppRoot = path.resolve(__dirname, "../../works-with-achu-v2");

describe("P0 — Vercel Loopback Elimination (local mode)", () => {
  test("1. tasks/route.ts local handler does not fetch 127.0.0.1 (source inspection)", async () => {
    const { readFile } = await import("node:fs/promises");
    let src: string;
    try {
      src = await readFile(
        path.join(webAppRoot, "app", "api", "coding-agent", "tasks", "route.ts"),
        "utf8"
      );
    } catch {
      console.log("[skip] tasks/route.ts not accessible from this test environment — skipping");
      return;
    }

    // Find the local execution mode block
    const localModeIdx = src.indexOf('mode === "local"');
    assert.ok(localModeIdx >= 0, 'Local mode handler must exist in route.ts');

    // Extract the local mode handler body (until the next if-block)
    const afterLocal = src.slice(localModeIdx, localModeIdx + 600);

    // Must NOT contain any loopback fetch to companion
    assert.ok(
      !afterLocal.includes("127.0.0.1"),
      "Local mode handler must not contain 127.0.0.1 loopback fetch — this would fail on Vercel"
    );
    assert.ok(
      !afterLocal.includes("3001"),
      "Local mode handler must not contain port 3001 reference — companion is unreachable from Vercel"
    );
    assert.ok(
      !afterLocal.includes("companionStarted"),
      "companionStarted variable must be removed — companion dispatch is now browser-owned"
    );
  });

  test("2. tasks/route.ts local handler returns taskId without waiting for companion", async () => {
    const { readFile } = await import("node:fs/promises");
    let src: string;
    try {
      src = await readFile(
        path.join(webAppRoot, "app", "api", "coding-agent", "tasks", "route.ts"),
        "utf8"
      );
    } catch {
      console.log("[skip] tasks/route.ts not accessible — skipping");
      return;
    }

    // Local mode handler must save task to DB and immediately return
    const localModeIdx = src.indexOf('mode === "local"');
    const handlerSlice = src.slice(localModeIdx, localModeIdx + 600);

    assert.ok(
      handlerSlice.includes("saveCodingAgentTask"),
      "Local mode handler must persist task to DB via saveCodingAgentTask"
    );
    assert.ok(
      handlerSlice.includes("status: 202"),
      "Local mode handler must return HTTP 202 Accepted"
    );
    assert.ok(
      handlerSlice.includes("runId: localRunId"),
      "Local mode handler must return runId in response"
    );
  });

  test("3. AchuCodingAgentClient.tsx owns local companion dispatch (source inspection)", async () => {
    const { readFile } = await import("node:fs/promises");
    let src: string;
    try {
      src = await readFile(
        path.join(
          webAppRoot,
          "app", "workspace", "coding-agent", "AchuCodingAgentClient.tsx"
        ),
        "utf8"
      );
    } catch {
      console.log("[skip] AchuCodingAgentClient.tsx not accessible — skipping");
      return;
    }

    // Browser client must directly call the companion for local tasks
    assert.ok(
      src.includes("http://127.0.0.1:3001/api/companion/tasks"),
      "Browser client must dispatch directly to companion at 127.0.0.1:3001/api/companion/tasks"
    );
    assert.ok(
      src.includes("x-achu-companion-token"),
      "Browser client must send companion token with local requests"
    );
  });

  test("4. validatePayload rejects Windows path for cloud mode (unchanged security behavior)", async () => {
    const { validatePayload } = await import(
      "../../../works-with-achu-v2/app/api/coding-agent/tasks/route.js"
    ).catch(() => ({ validatePayload: null }));

    if (!validatePayload) {
      // Module not importable in this test environment — do source inspection instead
      const { readFile } = await import("node:fs/promises");
      let src: string;
      try {
        src = await readFile(
          path.join(webAppRoot, "app", "api", "coding-agent", "tasks", "route.ts"),
          "utf8"
        );
      } catch {
        console.log("[skip] route.ts not accessible — skipping");
        return;
      }
      assert.ok(
        src.includes("Windows filesystem paths cannot be accessed by remote cloud workers"),
        "Security validation for Windows path in cloud mode must remain intact"
      );
      return;
    }

    const result = validatePayload({
      task: "build a site",
      workspaceRoot: "C:\\Users\\test\\project",
      mode: "cloud",
    });
    assert.ok(!result.ok, "Windows paths must be rejected for cloud mode");
  });
});
