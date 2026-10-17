import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { BrowserSession } from "../src/browser/browser-session.js";
import {
  normalizeInputCriteria,
  buildInputSelector,
  isSemanticInputType,
  looksLikeCssSelector,
  verifyInputExists,
  runVerificationSuite,
  applyVerificationOutcome,
  signatureForTarget,
  VerificationTarget,
  BrowserVerificationSummary,
} from "../src/browser/browser-verification.js";
import { generateRecoveryHint, isBrowserVerificationIncomplete } from "../src/agent.js";

function listenOn(port: number, handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function findFreePort(start = 51500): Promise<number> {
  for (let p = start; p < start + 200; p++) {
    try {
      const s = await listenOn(p, (_req, res) => res.end("ok"));
      await closeServer(s);
      return p;
    } catch {
      // try next
    }
  }
  throw new Error("No free port found");
}

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><title>Login Page</title></head>
<body>
  <h1>Login</h1>
  <form>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" placeholder="you@example.com" />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" placeholder="Your password" />
    <button type="submit">Login</button>
  </form>
</body>
</html>`;

const LOGIN_PAGE_NO_PASSWORD = `<!DOCTYPE html>
<html lang="en">
<head><title>Login Page</title></head>
<body>
  <h1>Login</h1>
  <form>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" placeholder="you@example.com" />
    <button type="submit">Login</button>
  </form>
</body>
</html>`;

async function startPage(content: string): Promise<{ port: number; server: http.Server }> {
  const port = await findFreePort();
  const server = await listenOn(port, (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(content);
  });
  return { port, server };
}

describe("Browser verification selector normalization & truthful outcome regression tests", () => {
  test("1. Semantic inputType 'email' becomes input[type=\"email\"] exactly once", () => {
    const norm = normalizeInputCriteria({ inputType: "email" });
    assert.equal(norm.problem, undefined);
    assert.equal(norm.inputType, "email");
    assert.equal(norm.selector, undefined);
    assert.equal(buildInputSelector(norm), `input[type="email"]`);
  });

  test("2. Semantic inputType 'password' becomes input[type=\"password\"] exactly once", () => {
    const norm = normalizeInputCriteria({ inputType: "password" });
    assert.equal(norm.problem, undefined);
    assert.equal(norm.inputType, "password");
    assert.equal(buildInputSelector(norm), `input[type="password"]`);
  });

  test("3. CSS selector '#email' stays a CSS selector and is never wrapped in a type selector", () => {
    const norm = normalizeInputCriteria({ selector: "#email" });
    assert.equal(norm.problem, undefined);
    assert.equal(norm.selector, "#email");
    assert.equal(norm.inputType, undefined);
    assert.equal(buildInputSelector(norm), "#email");
    assert.ok(!buildInputSelector(norm)!.includes("input[type="), "selector must not be wrapped into a type selector");
  });

  test("4. Attribute selectors (single and double quoted) remain valid unchanged selectors", () => {
    const single = normalizeInputCriteria({ selector: "input[type='email']" });
    assert.equal(single.problem, undefined);
    assert.equal(single.selector, "input[type='email']", "single-quoted selector must be preserved byte-for-byte");
    assert.equal(buildInputSelector(single), "input[type='email']");

    const double = normalizeInputCriteria({ selector: `input[type="password"]` });
    assert.equal(double.problem, undefined);
    assert.equal(double.selector, `input[type="password"]`);
    assert.equal(buildInputSelector(double), `input[type="password"]`);

    // A discouraged but unambiguous double-wrapped string is still preserved
    // as-is when passed as a selector: never re-wrapped into something worse.
    const wrapped = normalizeInputCriteria({ selector: `input[type='input[type='email']']` });
    assert.equal(wrapped.selector, `input[type='input[type='email']']`);

    // A semantic type in the selector field is a deterministic criteria defect.
    const semanticInSelector = normalizeInputCriteria({ selector: "email" });
    assert.ok(semanticInSelector.problem, "semantic type in selector field must be reported as a criteria defect");
    assert.ok(semanticInSelector.problem!.includes("inputType"), "defect message must point to the inputType field");
  });

  test("5. Absent or literal-'undefined' optional fields are never emitted into selectors", () => {
    const onlyType = normalizeInputCriteria({ inputType: "email" });
    assert.equal(onlyType.placeholder, undefined);
    assert.equal(buildInputSelector(onlyType), `input[type="email"]`);
    assert.ok(!buildInputSelector(onlyType)!.includes("placeholder"));
    assert.ok(!buildInputSelector(onlyType)!.toLowerCase().includes("undefined"));

    const undefinedLiteral = normalizeInputCriteria({ inputType: "email", placeholder: "undefined", name: "null" });
    assert.equal(undefinedLiteral.placeholder, undefined, "literal 'undefined' placeholder must be dropped");
    assert.equal(undefinedLiteral.name, undefined, "literal 'null' name must be dropped");
    assert.equal(buildInputSelector(undefinedLiteral), `input[type="email"]`);

    const withPlaceholder = normalizeInputCriteria({ inputType: "email", placeholder: "you@example.com" });
    assert.equal(buildInputSelector(withPlaceholder), `input[type="email"][placeholder*="you@example.com"]`);

    // Field discipline helpers
    assert.equal(isSemanticInputType("email"), true);
    assert.equal(isSemanticInputType("#email"), false);
    assert.equal(looksLikeCssSelector("#email"), true);
    assert.equal(looksLikeCssSelector(`input[type="email"]`), true);
    assert.equal(looksLikeCssSelector("email"), false, "a bare semantic type is not a CSS selector");
  });

  test("6. Real login page verifies: heading, email input (by selector), password input (by inputType), enabled Login button", async () => {
    const { port, server } = await startPage(LOGIN_PAGE);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      const url = `http://localhost:${port}`;
      const nav = await session.navigate(url);
      assert.equal(nav.success, true, `Navigation must succeed: ${nav.error ?? ""}`);

      const targets: VerificationTarget[] = [
        { type: "heading", text: "Login" },
        { type: "button", text: "Login" },
        { type: "input", selector: `input[type='email']` },
        { type: "input", inputType: "password" },
      ];
      const summary = await runVerificationSuite(session, url, targets);
      const lines = summary.results.map(r => `${r.target.type}: ${r.passed ? "PASS" : "FAIL"} ${r.error ?? r.actual ?? ""}`);
      assert.equal(summary.results.length, 4, `All four assertions must run:\n${lines.join("\n")}`);
      assert.equal(summary.overallPassed, true, `Verification must pass for the correct reasons:\n${lines.join("\n")}`);

      const emailResult = summary.results[2];
      assert.equal(emailResult.passed, true, `Email input selector assertion must pass: ${emailResult.error ?? ""}`);
      const passwordResult = summary.results[3];
      assert.equal(passwordResult.passed, true, `Password input inputType assertion must pass: ${passwordResult.error ?? ""}`);
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("7. Login page missing the password input fails that assertion with DOM evidence", async () => {
    const { port, server } = await startPage(LOGIN_PAGE_NO_PASSWORD);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      const url = `http://localhost:${port}`;
      const nav = await session.navigate(url);
      assert.equal(nav.success, true);

      const summary = await runVerificationSuite(session, url, [{ type: "input", inputType: "password" }]);
      assert.equal(summary.overallPassed, false, "Missing password input must fail verification");
      const result = summary.results[0];
      assert.equal(result.passed, false);
      assert.ok(result.error, "Failed assertion must carry an error/evidence string");
      assert.ok(result.error!.includes("password"), `Error must identify the expected password input: ${result.error}`);
      assert.ok(
        /Page inputs:|not found/i.test(result.error!),
        `Error must contain DOM evidence or an explicit not-found statement: ${result.error}`
      );

      const direct = await verifyInputExists(session, { inputType: "password" });
      assert.equal(direct.passed, false);
      assert.ok(direct.error && direct.error.includes('type="password"'), "Error must state the criteria that failed");
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("8. A later smaller passing run cannot overwrite an earlier failed assertion", () => {
    const failing: BrowserVerificationSummary = {
      overallPassed: false,
      results: [
        {
          passed: false,
          target: { type: "input", inputType: "password" },
          error: 'Input (type="password") not found. Page inputs: <input type="email" name="email">',
        },
      ],
    };
    const laterPassing: BrowserVerificationSummary = {
      overallPassed: true,
      results: [
        { passed: true, target: { type: "heading", text: "Login" }, actual: 'Found heading with "Login"' },
      ],
    };

    const failures = new Map<string, string>();
    const first = applyVerificationOutcome(failures, failing);
    assert.equal(first.overallPassed, false);
    assert.equal(failures.size, 1);
    assert.equal(signatureForTarget({ type: "input", inputType: "password" }), signatureForTarget({ type: "input", inputType: "password" }));

    const second = applyVerificationOutcome(failures, laterPassing);
    assert.equal(second.overallPassed, false, "overallPassed must stay false while a recorded assertion is still failing");
    assert.equal(second.outstandingFailures.length, 1);
    assert.ok(second.outstandingFailures[0].includes("password"), "The original failure must remain recorded verbatim");
    assert.equal(failures.size, 1, "The failure entry must not be silently deleted");

    const verifiedAgain: BrowserVerificationSummary = {
      overallPassed: true,
      results: [
        { passed: true, target: { type: "input", inputType: "password" }, actual: 'Found input (type="password")' },
      ],
    };
    const third = applyVerificationOutcome(failures, verifiedAgain);
    assert.equal(third.overallPassed, true, "Re-running the same assertion and passing clears it");
    assert.equal(failures.size, 0);
  });

  test("9. Task status cannot claim PASSED while failed verification assertions are outstanding", () => {
    const lifecyclePlan: any = [
      { description: "Start the app", toolType: "start_app", status: "completed" },
      { description: "Verify the application in the browser", toolType: "browser_verify", status: "running" },
    ];
    const baseState: any = {
      currentPlan: lifecyclePlan,
      browserVerificationRequested: true,
      browserVerificationPassed: false,
      browserVerificationFailedTargets: new Map<string, string>([
        [signatureForTarget({ type: "input", inputType: "password" }), 'Input (type="password") not found'],
      ]),
    };
    assert.equal(
      isBrowserVerificationIncomplete(baseState),
      true,
      "Outstanding failed assertions must block a PASSED result"
    );

    const passedState: any = { ...baseState, browserVerificationPassed: true, browserVerificationFailedTargets: new Map() };
    assert.equal(isBrowserVerificationIncomplete(passedState), false);

    const nonLifecycleState: any = { ...baseState, currentPlan: [{ description: "Fix a bug", toolType: "edit_file", status: "completed" }] };
    assert.equal(
      isBrowserVerificationIncomplete(nonLifecycleState),
      false,
      "Non-lifecycle tasks are unaffected by the browser verification truth check"
    );
  });

  test("10. Recovery guidance for a criteria defect forbids file rewrites and explains target fields", () => {
    const state: any = {
      phase: "recover",
      lastError: {
        command: "browser_verify",
        exitCode: 1,
        stdout: "",
        stderr: "",
        errorMessage: `Invalid input verification criteria: "email" is a semantic input type, not a CSS selector. Put it in the inputType field, or provide a real selector (e.g. #email, input[type="email"]).`,
      },
      repeatedFailures: new Map(),
      appUrl: "http://localhost:3005",
      appProcess: null,
      browserVerificationFailedTargets: new Map<string, string>([
        ["input:email", "Invalid input verification criteria"],
      ]),
    };
    const hint = generateRecoveryHint(state);
    assert.ok(hint, "A recovery hint must be produced for a browser_verify criteria defect");
    assert.ok(hint!.includes("BROWSER VERIFICATION GUIDANCE"));
    assert.ok(
      hint!.includes("Do NOT edit or rewrite source files"),
      "Hint must explicitly forbid repeated source rewrites for deterministic criteria defects"
    );
    assert.ok(hint!.includes('"inputType"') && hint!.includes('"selector"'), "Hint must explain the correct target fields");
    assert.ok(hint!.includes("http://localhost:3005"), "Hint must carry the authoritative app URL");
  });
});
