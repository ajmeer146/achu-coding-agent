import test from "node:test";
import assert from "node:assert/strict";
import { generateVerificationTargetsFromTask, runVerificationSuite } from "../src/browser/browser-verification.js";
import { BrowserSession } from "../src/browser/browser-session.js";
import http from "node:http";

test("Cloud Agent Quality Parity & Truthful Verification Regression Suite", async (t) => {

  await t.test("1. Natural language prompts extract specific UI verification targets", () => {
    // Login prompt with natural language
    const loginTargets = generateVerificationTargetsFromTask(
      "Create a modern, responsive login page with polished styling and working client-side validation."
    );
    assert.ok(loginTargets.length >= 3, "Login prompt must extract at least heading, inputs, and button");
    assert.ok(loginTargets.some(t => t.type === "input" && (t.inputType === "email" || t.selector?.includes("email"))), "Must include email input target");
    assert.ok(loginTargets.some(t => t.type === "input" && (t.inputType === "password" || t.selector?.includes("password"))), "Must include password input target");
    assert.ok(loginTargets.some(t => t.type === "button" && /login/i.test(t.text || "")), "Must include login button target");

    // Natural qualifiers: email input, password input, submit button
    const explicitTargets = generateVerificationTargetsFromTask(
      "Add an email input, password input, and a login button to the form"
    );
    assert.ok(explicitTargets.some(t => t.type === "input" && t.inputType === "email"));
    assert.ok(explicitTargets.some(t => t.type === "input" && t.inputType === "password"));
    assert.ok(explicitTargets.some(t => t.type === "button" && /login/i.test(t.text || "")));
  });

  await t.test("2. Unstyled bare HTML page FAILS browser verification instead of silently passing", async () => {
    // Spin up a server serving a bare, unstyled 3-line HTML page
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><head><title>Bare Page</title></head><body><h1>Bare Page</h1><p>Bare text.</p></body></html>`);
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const url = `http://localhost:${port}`;

    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(url);
      const summary = await runVerificationSuite(session, url, []);

      // Must NOT pass verification because page has 0 stylesheets and default serif
      assert.equal(summary.overallPassed, false, "Completely unstyled page must FAIL verification");
      const cssFailure = summary.results.find(r => r.target.text?.includes("Stylesheet") || r.target.text?.includes("Styling"));
      assert.ok(cssFailure, "Must fail with active stylesheet or styling check");
      assert.ok(cssFailure.error?.includes("unstyled") || cssFailure.error?.includes("stylesheet"), "Must provide actionable styling failure feedback");
    } finally {
      await session.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test("3. Properly styled page with CSS design system and semantic markup PASSES browser verification", async () => {
    const styledHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Modern Application</title>
  <style>
    :root { --bg: #0b0f19; --text: #f8fafc; --accent: #38bdf8; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background-color: var(--bg); color: var(--text); padding: 2rem; }
    header { padding: 1.5rem; text-align: center; }
    h1 { font-size: 2.25rem; margin-bottom: 1rem; }
    p { font-size: 1rem; color: #94a3b8; line-height: 1.6; }
    .card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin-top: 2rem; }
    .card { background: #1e293b; padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); }
    .btn { display: inline-block; padding: 0.75rem 1.5rem; background: var(--accent); color: #000; border-radius: 8px; font-weight: 600; text-decoration: none; cursor: pointer; }
    @media (max-width: 600px) { body { padding: 1rem; } }
  </style>
</head>
<body>
  <header>
    <h1>Modern Application</h1>
    <p>Welcome to our high-performance, beautifully styled, responsive cloud web application built with modern engineering standards.</p>
  </header>
  <main>
    <div class="card-grid">
      <div class="card">
        <h2>Feature One</h2>
        <p>Responsive layout with CSS grid, fluid typography, and accessible design tokens.</p>
        <button class="btn">Explore</button>
      </div>
      <div class="card">
        <h2>Feature Two</h2>
        <p>Polished micro-interactions, dark theme styling, and modern UI components.</p>
        <button class="btn">Learn More</button>
      </div>
    </div>
  </main>
</body>
</html>`;

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(styledHtml);
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const url = `http://localhost:${port}`;

    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(url);
      const summary = await runVerificationSuite(session, url, []);

      assert.equal(summary.overallPassed, true, `Styled page must pass verification: ${summary.results.map(r => r.error).filter(Boolean).join(", ")}`);
    } finally {
      await session.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
