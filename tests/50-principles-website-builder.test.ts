import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import {
  WEBSITE_50_PRINCIPLES_VERSION,
  WEBSITE_50_PRINCIPLES,
  PRINCIPLE_PHASES,
  evaluatePrinciplesApplicability,
  format50PrinciplesChecklist,
  evaluateWebsiteQuality,
  isWebsiteQualityTask,
  buildWebsiteQualityGuidance,
} from "../src/quality/website-design-guide.js";
import { BrowserSession } from "../src/browser/browser-session.js";
import {
  generateVerificationTargetsFromTask,
  runVerificationSuite,
  verifyButtonInteraction,
  verifyFormInteraction,
} from "../src/browser/browser-verification.js";
import { generateDesignSpec } from "../src/tools/design-planner.js";
import { buildInitialSystemPrompt } from "../src/agent.js";
import { sanitizeUserFacingError } from "../src/utils/error-sanitizer.js";

test("Complete Website Development Guide — 50 Essential Principles Master Suite", async (t) => {
  await t.test("1. 50 Essential Principles framework completeness and phase mapping", () => {
    assert.equal(WEBSITE_50_PRINCIPLES_VERSION, "2.0.0");
    assert.equal(WEBSITE_50_PRINCIPLES.length, 50, "Framework must contain exactly 50 principles");
    assert.equal(PRINCIPLE_PHASES.length, 6, "Must define all 6 implementation phases");

    // Phase 1 — Planning and Architecture: 1 to 5
    const p1 = WEBSITE_50_PRINCIPLES.filter((p) => p.phase === 1);
    assert.equal(p1.length, 5);
    assert.deepEqual(p1.map((p) => p.number), [1, 2, 3, 4, 5]);

    // Phase 2 — UI/UX Design and Visual Consistency: 6 to 15
    const p2 = WEBSITE_50_PRINCIPLES.filter((p) => p.phase === 2);
    assert.equal(p2.length, 10);
    assert.deepEqual(p2.map((p) => p.number), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    // Phase 3 — Frontend Development and Interactions: 16 to 25
    const p3 = WEBSITE_50_PRINCIPLES.filter((p) => p.phase === 3);
    assert.equal(p3.length, 10);
    assert.deepEqual(p3.map((p) => p.number), [16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);

    // Phase 4 — Backend, Database, and Security: 26 to 35
    const p4 = WEBSITE_50_PRINCIPLES.filter((p) => p.phase === 4);
    assert.equal(p4.length, 10);
    assert.deepEqual(p4.map((p) => p.number), [26, 27, 28, 29, 30, 31, 32, 33, 34, 35]);

    // Phase 5 — Performance, Testing, and Deployment: 36 to 45
    const p5 = WEBSITE_50_PRINCIPLES.filter((p) => p.phase === 5);
    assert.equal(p5.length, 10);
    assert.deepEqual(p5.map((p) => p.number), [36, 37, 38, 39, 40, 41, 42, 43, 44, 45]);

    // Phase 6 — Reliability, Maintenance, and Final Quality: 46 to 50
    const p6 = WEBSITE_50_PRINCIPLES.filter((p) => p.phase === 6);
    assert.equal(p6.length, 5);
    assert.deepEqual(p6.map((p) => p.number), [46, 47, 48, 49, 50]);
  });

  await t.test("2. Applicability determination across diverse website archetypes", () => {
    // Archetype A: Static Landing Page without backend
    const landingEval = evaluatePrinciplesApplicability("create a modern landing page for an AI productivity app", "landing_page");
    assert.ok(landingEval.applicableCount >= 30, "landing page should have core principles applicable");
    const pAuth = landingEval.evaluations.find((e) => e.principle.number === 30);
    assert.ok(pAuth && !pAuth.applicable, "auth principle should not be applicable without user accounts request");
    assert.ok(pAuth.reason.includes("public informational website"));

    // Archetype B: E-Commerce Storefront
    const storeEval = evaluatePrinciplesApplicability("create an ecommerce shop with catalog, cart, and checkout", "ecommerce");
    const pForms = storeEval.evaluations.find((e) => e.principle.number === 18);
    assert.ok(pForms && pForms.applicable, "forms must be applicable for ecommerce checkout");
    const pWidgets = storeEval.evaluations.find((e) => e.principle.number === 19);
    assert.ok(pWidgets && pWidgets.applicable, "interactive widgets must be applicable for catalog/cart");

    // Archetype C: Full-Stack SaaS with Postgres Database & Auth
    const saasEval = evaluatePrinciplesApplicability("build a fullstack dashboard with postgres database, migrations, and jwt auth", "saas_app");
    const pDb = saasEval.evaluations.find((e) => e.principle.number === 28);
    assert.ok(pDb && pDb.applicable, "database persistence must be applicable");
    const pMigr = saasEval.evaluations.find((e) => e.principle.number === 29);
    assert.ok(pMigr && pMigr.applicable, "database migrations must be applicable");
    const pSaasAuth = saasEval.evaluations.find((e) => e.principle.number === 30);
    assert.ok(pSaasAuth && pSaasAuth.applicable, "auth must be applicable");
  });

  await t.test("3. Formatted 50 principles checklist integrates into system prompt", () => {
    const guidance = buildWebsiteQualityGuidance("create responsive landing page for SaaS startup", "landing_page");
    assert.ok(guidance !== null);
    assert.ok(guidance.includes("COMPLETE WEBSITE DEVELOPMENT GUIDE — 50 ESSENTIAL PRINCIPLES WORKFLOW"));
    assert.ok(guidance.includes("Phase 1 — Planning and Architecture"));
    assert.ok(guidance.includes("Phase 2 — UI/UX Design and Visual Consistency"));
    assert.ok(guidance.includes("Phase 3 — Frontend Development and Interactions"));
    assert.ok(guidance.includes("Phase 4 — Backend, Database, and Security"));
    assert.ok(guidance.includes("Phase 5 — Performance, Testing, and Deployment"));
    assert.ok(guidance.includes("Phase 6 — Reliability, Maintenance, and Final Quality"));
  });

  await t.test("4. Multi-viewport layout verification across 320px, 375px, 390px, 430px, 768px, 1280px, 1440px, 1920px", async () => {
    const responsiveHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Responsive Test Page</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; overflow-x: hidden; }
    .container { max-width: 1200px; width: 100%; margin: 0 auto; padding: 0 1rem; }
    header { padding: 1rem 0; border-bottom: 1px solid #334155; }
    .nav { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
    .logo { font-size: 1.25rem; font-weight: bold; color: #38bdf8; text-decoration: none; }
    .links { display: flex; gap: 1rem; flex-wrap: wrap; }
    .links a { color: #94a3b8; text-decoration: none; }
    .hero { padding: 3rem 0; }
    h1 { font-size: clamp(1.75rem, 5vw, 3rem); line-height: 1.2; word-break: break-word; }
    p { margin-top: 1rem; color: #94a3b8; font-size: clamp(0.95rem, 2vw, 1.2rem); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr)); gap: 1.5rem; margin-top: 2rem; }
    .card { background: #1e293b; padding: 1.5rem; border-radius: 8px; border: 1px solid #334155; }
    @media (max-width: 480px) { .container { padding: 0 0.75rem; } }
  </style>
</head>
<body>
  <header>
    <div class="container nav">
      <a href="#" class="logo">AchuApp</a>
      <div class="links">
        <a href="#features">Features</a>
        <a href="#about">About</a>
      </div>
    </div>
  </header>
  <main class="container hero">
    <h1>Autonomous Website Builder</h1>
    <p>Delivering production-grade responsive applications with strict quality guarantees.</p>
    <div class="grid">
      <div class="card"><h3>Resilience</h3><p>Self-diagnosing build loops.</p></div>
      <div class="card"><h3>Parity</h3><p>Unified local & cloud execution.</p></div>
    </div>
  </main>
</body>
</html>`;

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(responsiveHtml);
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const url = `http://localhost:${port}`;

    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(url);

      const standardViewports = [
        { width: 320, height: 568 },  // Small mobile
        { width: 375, height: 667 },  // Small mobile standard
        { width: 390, height: 844 },  // Standard mobile
        { width: 430, height: 932 },  // Standard mobile plus
        { width: 768, height: 1024 }, // Tablet
        { width: 1280, height: 800 }, // Laptop
        { width: 1440, height: 900 }, // Desktop
        { width: 1920, height: 1080 } // Wide desktop
      ];

      for (const vp of standardViewports) {
        const layoutRes = await session.analyzeLayout(vp);
        assert.equal(layoutRes.success, true);
        if (layoutRes.success) {
          assert.equal(
            layoutRes.analysis.horizontalOverflow,
            false,
            `No horizontal overflow allowed at ${vp.width}x${vp.height}`
          );
        }
      }
    } finally {
      await session.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test("5. Real button and form interaction verification", async () => {
    const interactiveHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Interactive Components Test</title>
</head>
<body>
  <div id="counter-display">Count: 0</div>
  <button id="btn-increment">Increment</button>

  <form id="subscribe-form" style="margin-top:20px;">
    <input type="email" id="sub-email" name="email" placeholder="Enter email">
    <button type="submit" id="btn-subscribe">Subscribe</button>
    <div id="sub-feedback" style="display:none;">Subscription confirmed!</div>
  </form>

  <script>
    let count = 0;
    document.getElementById("btn-increment").addEventListener("click", () => {
      count++;
      document.getElementById("counter-display").textContent = "Count: " + count;
    });

    document.getElementById("subscribe-form").addEventListener("submit", (e) => {
      e.preventDefault();
      document.getElementById("sub-feedback").style.display = "block";
    });
  </script>
</body>
</html>`;

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(interactiveHtml);
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const url = `http://localhost:${port}`;

    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(url);

      // Verify button click causes state update
      const clickRes = await verifyButtonInteraction(session, "#btn-increment", {
        text: "Count: 1",
      });
      assert.equal(clickRes.passed, true);

      // Verify form submission shows feedback
      const formRes = await verifyFormInteraction(session, {
        inputs: [{ selector: "#sub-email", value: "test@example.com" }],
        submitButton: "Subscribe",
        expectedFeedback: "Subscription confirmed!",
      });
      assert.equal(formRes.passed, true);
    } finally {
      await session.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test("6. 12-category quality audit scoring and blocker enforcement", () => {
    // Audit with zero defects
    const passingAudit = evaluateWebsiteQuality({
      task: "build modern portfolio",
      pageTitle: "John Doe Portfolio",
      visibleText: "Full stack software engineer specializing in distributed cloud systems and frontend architecture.",
      headings: ["John Doe", "Featured Projects"],
      buttons: ["Contact Me", "View Projects"],
      semanticCount: 5,
      stylesheetCount: 1,
      totalCssRules: 25,
      fontFamily: "Inter, sans-serif",
      criticalLayoutDefects: [],
      warningLayoutDefects: [],
      consoleErrors: [],
      pageErrors: [],
      verificationPassed: true,
      buildPassed: true,
      secretLeaksFound: false,
    });

    assert.equal(passingAudit.categories.length, 12);
    assert.equal(passingAudit.overallPassed, true);
    assert.equal(passingAudit.mandatoryGatesPassed, true);
    assert.equal(passingAudit.blockers.length, 0);
    assert.ok(passingAudit.overallScore >= 80);

    // Audit with failing gate (e.g. secret leak)
    const failingAudit = evaluateWebsiteQuality({
      task: "build app",
      secretLeaksFound: true,
    });
    assert.equal(failingAudit.overallPassed, false);
    assert.ok(failingAudit.overallScore <= 40, "Secret leak must cap score at failing grade");
    assert.ok(failingAudit.blockers.includes("Secret leak detected"));
  });
});
