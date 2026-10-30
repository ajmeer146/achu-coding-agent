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
  computeVerificationOverallPassed,
  signatureForTarget,
  mergeVerificationTargets,
  normalizeProvidedVerificationTargets,
  isCriteriaDefectResult,
  verifySelectExists,
  verifySectionExists,
  generateVerificationTargetsFromTask,
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
    assert.equal(looksLikeCssSelector("Confirm"), false, "a bare button label is not a CSS selector");
    assert.equal(looksLikeCssSelector("Sign in"), false, "a multi-word button label is not a CSS selector");
    assert.equal(looksLikeCssSelector("button"), true, "a bare HTML tag remains a CSS selector");
    assert.equal(looksLikeCssSelector("button.primary"), true, "tag plus class remains a CSS selector");
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

  test("11. A malformed verification target fails that assertion instead of throwing", async () => {
    const { port, server } = await startPage(LOGIN_PAGE);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      const malformed = [
        { type: "text" } as VerificationTarget,
        { type: "heading" } as VerificationTarget,
        { type: "link" } as VerificationTarget,
        { type: "button" } as VerificationTarget,
        { type: "route" } as VerificationTarget,
      ];

      let summary: BrowserVerificationSummary | undefined;
      await assert.doesNotReject(async () => {
        summary = await runVerificationSuite(session, `http://localhost:${port}`, malformed);
      }, "A malformed target must never abort the whole verification run");

      assert.ok(summary);
      assert.equal(summary!.results.length, malformed.length, "Every target must produce a result");
      for (const result of summary!.results) {
        assert.equal(result.passed, false, "A malformed target must fail");
        assert.match(result.error ?? "", /Invalid verification target:/);
        assert.equal(
          isCriteriaDefectResult(result),
          true,
          "A malformed target must be classified as a criteria defect, not a page defect"
        );
      }
      assert.equal(summary!.overallPassed, false);
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("12. Button verification recognizes button-styled CTA anchor tags (a.btn, a.btn-primary)", async () => {
    const pageWithCta = `<!DOCTYPE html>
<html>
<head><title>CTA Page</title></head>
<body>
  <div class="hero">
    <h1>Welcome</h1>
    <a href="#signup" class="btn-primary">Start Free Trial</a>
    <button type="submit">Submit Form</button>
  </div>
</body>
</html>`;
    const { port, server } = await startPage(pageWithCta);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      const summary = await runVerificationSuite(session, `http://localhost:${port}`, [
        { type: "button", text: "Start Free Trial" },
        { type: "button", text: "Submit Form" },
      ]);
      assert.equal(summary.overallPassed, true, "Both the standard button and CTA anchor button must pass verification");
      assert.equal(summary.results[0].passed, true);
      assert.equal(summary.results[1].passed, true);
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("13. A retry re-runs outstanding failed assertions even when its target list omits them", async () => {
    const page = `<!DOCTYPE html>
<html>
<head><title>ShopNova</title></head>
<body>
  <h1>Discover Excellence</h1>
  <input type="search" placeholder="Search products...">
</body>
</html>`;
    const failedTarget: VerificationTarget = { type: "input", placeholder: "Search" };
    const failures = new Map<string, string>();
    const first = applyVerificationOutcome(failures, {
      overallPassed: false,
      results: [
        {
          passed: false,
          target: failedTarget,
          error: 'Input (placeholder="Search") not found',
        },
      ],
    });
    assert.equal(first.overallPassed, false);
    assert.equal(failures.size, 1);

    const { port, server } = await startPage(page);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      const merged = mergeVerificationTargets([{ type: "text", text: "Discover Excellence" }], [failedTarget]);
      assert.equal(merged.length, 2, "The outstanding failed target must be appended to the retry run");
      assert.equal(
        mergeVerificationTargets(merged, [failedTarget]).length,
        2,
        "Merging the same outstanding target twice must not duplicate it"
      );

      const summary = await runVerificationSuite(session, `http://localhost:${port}`, merged);
      assert.equal(summary.overallPassed, true, "The previously failed search input now matches by placeholder substring");
      const outcome = applyVerificationOutcome(failures, summary);
      assert.equal(outcome.overallPassed, true);
      assert.equal(failures.size, 0, "Re-running the outstanding assertion and passing clears the failure");
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("14. Optional assertions warn instead of blocking, and an explicit downgrade clears an outstanding failure", () => {
    const inventedLink: VerificationTarget = { type: "link", text: "Cart" };
    const requiredResults = [
      { passed: false, target: inventedLink, error: 'Link with text "Cart" not found' },
    ];
    assert.equal(
      computeVerificationOverallPassed(requiredResults),
      false,
      "A required assertion failure must still block verification"
    );

    const failures = new Map<string, string>();
    const first = applyVerificationOutcome(failures, {
      overallPassed: false,
      results: requiredResults,
    });
    assert.equal(first.overallPassed, false);
    assert.equal(failures.size, 1);

    const downgraded: VerificationTarget = { ...inventedLink, required: false };
    const merged = mergeVerificationTargets([downgraded], [inventedLink]);
    assert.equal(merged.length, 1, "The downgraded target must not be duplicated by the merge");
    assert.equal(merged[0].required, false);

    const optionalResults = [
      { passed: false, target: downgraded, error: 'Link with text "Cart" not found' },
    ];
    assert.equal(
      computeVerificationOverallPassed(optionalResults),
      true,
      "An optional-only failure must not block verification"
    );
    const outcome = applyVerificationOutcome(failures, {
      overallPassed: true,
      results: optionalResults,
    });
    assert.equal(outcome.overallPassed, true);
    assert.equal(failures.size, 0, "Downgrading the assertion to optional clears the outstanding failure");
  });

  test("15. Uncaught inline-handler syntax errors fail verification as runtime defects", async () => {
    const page = `<!DOCTYPE html>
<html>
<head><title>Broken Shop</title></head>
<body>
  <h1>Broken Shop</h1>
  <img src="missing.png" onerror="this.src='fallback' font-size='14'">
</body>
</html>`;
    const { port, server } = await startPage(page);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      const nav = await session.navigate(`http://localhost:${port}`);
      assert.equal(nav.success, true);
      const summary = await runVerificationSuite(session, `http://localhost:${port}`, [
        { type: "heading", text: "Broken Shop" },
      ]);
      assert.equal(summary.overallPassed, false, "A page with an uncaught handler SyntaxError must not pass");
      const runtimeFailure = summary.results.find(r => r.target.text === "Page runtime check");
      assert.ok(runtimeFailure, "Verification must report a page runtime failure");
      assert.match(runtimeFailure?.error ?? "", /SyntaxError/);
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("16. Select targets verify dropdowns and reject missing dropdowns", async () => {
    const page = `<!DOCTYPE html>
<html>
<head><title>Catalog</title></head>
<body>
  <h1>Catalog</h1>
  <select id="sortSelect" name="sort">
    <option value="featured">Featured</option>
    <option value="price">Price</option>
  </select>
</body>
</html>`;
    const { port, server } = await startPage(page);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);
      const passing = await runVerificationSuite(session, `http://localhost:${port}`, [
        { type: "select", selector: "#sortSelect" },
      ]);
      assert.equal(passing.overallPassed, true, "An existing dropdown with options must pass verification");
      assert.match(passing.results[0].actual ?? "", /2 option/);

      const missing = await runVerificationSuite(session, `http://localhost:${port}`, [
        { type: "select", selector: "#noSuchSelect" },
      ]);
      assert.equal(missing.overallPassed, false, "A missing dropdown must fail verification");
      assert.match(missing.results[0].error ?? "", /not found/i);
    } finally {
      await session.close();
      await closeServer(server);
    }
  });
  test("17. Structural failures are re-checked live, not persisted as literal targets", () => {
    const outstanding = new Map<string, string>();
    const failedSummary: BrowserVerificationSummary = {
      overallPassed: false,
      results: [
        {
          passed: false,
          target: { type: "text", text: "Page runtime check" },
          error: "TypeError: Cannot read properties of undefined",
          structural: true,
        },
        { passed: true, target: { type: "heading", text: "NovaMart" } },
      ],
    };
    const failedOutcome = applyVerificationOutcome(outstanding, failedSummary);
    assert.equal(failedOutcome.overallPassed, false, "A live runtime defect must still block this attempt");
    assert.equal(outstanding.size, 0, "Structural checks must not become outstanding literal text targets");

    const fixedOutcome = applyVerificationOutcome(outstanding, {
      overallPassed: true,
      results: [{ passed: true, target: { type: "heading", text: "NovaMart" } }],
    });
    assert.equal(fixedOutcome.overallPassed, true, "A fixed live check must allow the next attempt to pass");
  });

  test("18. Task-derived assertions stay required while invented extras are advisory by default", () => {
    const taskTargets: VerificationTarget[] = [
      { type: "input", selector: 'input[type="search"]', required: true },
      { type: "button", text: "cart", required: true },
    ];
    const provided: VerificationTarget[] = [
      { type: "button", text: "Cart" },
      { type: "input", placeholder: "real-time search" },
      { type: "link", text: "Checkout" },
      { type: "text", text: "Free shipping", required: true },
    ];
    const normalized = normalizeProvidedVerificationTargets(provided, taskTargets);
    assert.equal(normalized[0].required, true, "A check matching a task-derived assertion must stay required");
    assert.equal(normalized[1].required, false, "An invented check must be advisory even without an explicit flag");
    assert.equal(normalized[2].required, false, "Invented links must not block verification");
    assert.equal(normalized[3].required, true, "An explicit required:true must be honored");

    const merged = mergeVerificationTargets(taskTargets, normalized);
    assert.equal(merged.filter(t => signatureForTarget(t) === signatureForTarget(taskTargets[1])).length, 1);
    assert.equal(merged.find(t => signatureForTarget(t) === signatureForTarget(taskTargets[1]))?.required, true);
  });

  test("19. Search input nested inside a container (div#search, .search-input) resolves and passes", async () => {
    const pageWithContainer = `<!DOCTYPE html>
<html>
<head><title>Search Page</title></head>
<body>
  <h1>Store</h1>
  <div class="search-input" id="search">
    <input type="text" id="searchInput" name="q" placeholder="Search catalog..." />
  </div>
</body>
</html>`;
    const { port, server } = await startPage(pageWithContainer);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      // Verify with container selector: unwraps to nested input
      const containerRes = await verifyInputExists(session, { selector: "#search" });
      assert.equal(containerRes.passed, true, `Nested input inside #search must be resolved: ${containerRes.error}`);

      const classContainerRes = await verifyInputExists(session, { selector: ".search-input" });
      assert.equal(classContainerRes.passed, true, `Nested input inside .search-input must be resolved: ${classContainerRes.error}`);

      // Verify with semantic search inputType
      const semanticRes = await verifyInputExists(session, { inputType: "search" });
      assert.equal(semanticRes.passed, true, `Input with search placeholder/id must satisfy search inputType: ${semanticRes.error}`);

      // Verify e-commerce task target
      const targets: VerificationTarget[] = [
        {
          type: "input",
          selector: 'input[type="search"], input[placeholder*="search" i], input[name*="search" i], input[id*="search" i], input[class*="search" i], input[aria-label*="search" i], [role="searchbox"], #search, .search-input, .search-bar, .search-box',
          required: true,
        },
      ];
      const summary = await runVerificationSuite(session, `http://localhost:${port}`, targets);
      assert.equal(summary.overallPassed, true, `E-commerce search target must pass against nested search input`);
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("20. Truly missing search input fails with DOM evidence", async () => {
    const pageWithoutSearch = `<!DOCTYPE html>
<html>
<head><title>No Search Page</title></head>
<body>
  <h1>Store</h1>
  <div class="newsletter">
    <input type="email" name="email" placeholder="Subscribe to newsletter..." />
  </div>
</body>
</html>`;
    const { port, server } = await startPage(pageWithoutSearch);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      const semanticRes = await verifyInputExists(session, { inputType: "search" });
      assert.equal(semanticRes.passed, false, "Page without search must fail search assertion");
      assert.ok(semanticRes.error?.includes("not found"), `Error must state not found: ${semanticRes.error}`);

      const targetRes = await verifyInputExists(session, { selector: "#search" });
      assert.equal(targetRes.passed, false, "Missing #search must fail");
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("21. Select and Section verification accept generic targets and find existing page elements", async () => {
    const pageWithControls = `<!DOCTYPE html>
<html>
<head><title>Controls Page</title></head>
<body>
  <header><h1>Dashboard</h1></header>
  <main>
    <section id="metrics">
      <h2>Metrics</h2>
      <select id="timeRangeSelect" name="timeRange">
        <option value="24h">Last 24 Hours</option>
        <option value="7d">Last 7 Days</option>
      </select>
    </section>
  </main>
</body>
</html>`;
    const { port, server } = await startPage(pageWithControls);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      // Generic select target
      const selectRes = await verifySelectExists(session, {});
      assert.equal(selectRes.passed, true, `Generic select target must pass when select exists: ${selectRes.error}`);

      // Text-guided select target
      const selectTextRes = await verifySelectExists(session, { text: "Last 24 Hours" });
      assert.equal(selectTextRes.passed, true, `Select target matching option text must pass: ${selectTextRes.error}`);

      // Generic section target
      const sectionRes = await verifySectionExists(session, {});
      assert.equal(sectionRes.passed, true, `Generic section target must pass when section exists: ${sectionRes.error}`);
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("22. Corrected target clears prior criteria defect and prevents recovery loop", () => {
    const failedTargets = new Map<string, string>();
    const malformedSelectTarget: VerificationTarget = { type: "select" };
    const malformedSig = signatureForTarget(malformedSelectTarget);

    // Initial attempt has criteria defect
    failedTargets.set(malformedSig, 'Invalid select verification criteria: "invalid[selector" is not a valid CSS selector.');

    // Next attempt provides corrected, passing target of the same type
    const correctedSelectTarget: VerificationTarget = { type: "select", selector: "select#timeRangeSelect" };
    const passingSummary: BrowserVerificationSummary = {
      overallPassed: true,
      results: [
        {
          passed: true,
          target: correctedSelectTarget,
          actual: 'Found select (selector "select#timeRangeSelect")',
        },
      ],
    };

    const outcome = applyVerificationOutcome(failedTargets, passingSummary);
    assert.equal(outcome.overallPassed, true, "Passing corrected target must clear prior criteria defect and yield overallPassed: true");
    assert.equal(failedTargets.has(malformedSig), false, "Prior criteria defect must be removed from failedTargets map");
  });

  test("23. Dropdown labeled by option or id matches select assertion without label element and avoids recovery loop", async () => {
    const pageWithSort = `<!DOCTYPE html>
<html>
<head><title>NovaMart</title></head>
<body>
  <header><h1>NovaMart</h1></header>
  <main>
    <select id="sortSelect" class="sort-select">
      <option value="default">Sort: Default</option>
      <option value="price-low">Price: Low to High</option>
      <option value="price-high">Price: High to Low</option>
    </select>
  </main>
</body>
</html>`;
    const { port, server } = await startPage(pageWithSort);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      // Target with label: "Sort" (matches option text or id="sortSelect")
      const selectRes = await verifySelectExists(session, { label: "Sort" });
      assert.equal(selectRes.passed, true, `Select target with label="Sort" must find dropdown via option text or id: ${selectRes.error}`);

      // Target with text: "Sort"
      const selectTextRes = await verifySelectExists(session, { text: "Sort" });
      assert.equal(selectTextRes.passed, true, `Select target with text="Sort" must find dropdown: ${selectTextRes.error}`);
    } finally {
      await session.close();
      await server.close();
    }
  });

  test("24. Bare button labels in the selector field resolve as accessible text, not CSS", async () => {
    const page = `<!DOCTYPE html>
<html>
<head><title>Achu Cloud Check</title></head>
<body>
  <h1>Achu Cloud Check</h1>
  <p>Fresh production acceptance passed</p>
  <button id="confirm">Confirm</button>
  <button id="signin">Sign in</button>
</body>
</html>`;
    const { port, server } = await startPage(page);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      const url = `http://localhost:${port}`;
      await session.navigate(url);

      const summary = await runVerificationSuite(session, url, [
        { type: "button", selector: "Confirm" },
        { type: "button", text: "Confirm", selector: "Confirm" },
        { type: "button", selector: "Sign in" },
      ]);
      assert.equal(summary.overallPassed, true, "Bare button labels must verify by accessible text");
      assert.equal(summary.results[0].passed, true, `Selector-only label must pass: ${summary.results[0].error ?? ""}`);
      assert.equal(summary.results[0].target.text, "Confirm");
      assert.equal(summary.results[0].target.selector, undefined, "A bare label must not be retained as a selector");
      assert.equal(summary.results[2].passed, true, `Multi-word label must pass: ${summary.results[2].error ?? ""}`);
      assert.equal(summary.results[2].target.text, "Sign in");

      const missing = await runVerificationSuite(session, url, [{ type: "button", selector: "#does-not-exist" }]);
      assert.equal(missing.results[0].passed, false, "A genuine missing CSS selector must still fail");
      assert.match(missing.results[0].error ?? "", /did not match any element/);
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("25. Quoted attributes, IDs, filenames, and storage keys in prompts are not extracted as visible text targets", () => {
    const prompt = "In this workspace, build a simple single-page website for 'AppBeta'. It must show the heading 'AppBeta', an interactive button with id 'beta-btn' labeled 'Click Beta', and a status output with id 'beta-output' showing 'Ready Beta'. Save index.html and styles.css.";
    const targets = generateVerificationTargetsFromTask(prompt);

    // Identifiers and filenames must NOT be text targets
    assert.equal(targets.some(t => t.type === "text" && t.text === "beta-btn"), false, "'beta-btn' is an HTML ID and must not be a text target");
    assert.equal(targets.some(t => t.type === "text" && t.text === "beta-output"), false, "'beta-output' is an HTML ID and must not be a text target");
    assert.equal(targets.some(t => t.type === "text" && t.text === "index.html"), false, "Filenames must not be text targets");
    assert.equal(targets.some(t => t.type === "text" && t.text === "styles.css"), false, "Filenames must not be text targets");

    // Real visible text and button targets must be present
    assert.ok(targets.some(t => t.type === "heading" && t.text === "AppBeta"), "Must extract heading 'AppBeta'");
    assert.ok(targets.some(t => t.type === "button" && t.text === "Click Beta"), "Must extract button 'Click Beta'");
    assert.ok(targets.some(t => t.type === "text" && t.text === "Ready Beta"), "Must extract visible text 'Ready Beta'");
  });
});
