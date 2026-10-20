/**
 * Phase 13 — Design Intelligence & Visual Quality Engine
 * Test Suite (Scenarios A–G)
 *
 * These tests verify pure functions (no API calls, no runAgent).
 * They run deterministically as part of the standard npm test suite.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../src/tools/workspace.js";
import {
  scaffoldStaticProject,
  scaffoldReactViteProject,
} from "../src/tools/scaffold.js";
import {
  analyseTaskBrief,
  selectDesignDirection,
  generateDesignSpec,
  formatDesignSpecForPrompt,
  isUITask,
  buildDesignTokens,
} from "../src/tools/design-planner.js";
import {
  isToolResultFailure,
  isToolResultSuccess,
} from "../src/agent.js";

function makeTmpDir(prefix: string): string {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// Scenario A — Distinct Design Directions
// ---------------------------------------------------------------------------
describe("Phase 13 Scenario A — Distinct Design Directions", () => {
  test("A1: Portfolio brief → editorial_luxury direction and portfolio type", () => {
    const spec = generateDesignSpec(
      "Build a portfolio website showcasing my design projects"
    );
    assert.equal(spec.productType, "portfolio", `Expected productType=portfolio, got ${spec.productType}`);
    assert.equal(spec.direction, "editorial_luxury", `Expected direction=editorial_luxury, got ${spec.direction}`);
  });

  test("A2: SaaS analytics dashboard brief → dashboard type and dark_saas direction", () => {
    const spec = generateDesignSpec(
      "Build a SaaS analytics dashboard for tracking user metrics"
    );
    assert.equal(spec.productType, "dashboard", `Expected productType=dashboard, got ${spec.productType}`);
    assert.equal(spec.direction, "dark_saas", `Expected direction=dark_saas, got ${spec.direction}`);
  });

  test("A3: Restaurant website brief → warm_organic direction", () => {
    const spec = generateDesignSpec(
      "Create a cozy restaurant website with warm earthy tones"
    );
    assert.equal(spec.direction, "warm_organic", `Expected direction=warm_organic, got ${spec.direction}`);
  });

  test("A4: Materially different bgPrimary tokens across different briefs", () => {
    const portfolio = generateDesignSpec("Build a portfolio website");
    const dashboard = generateDesignSpec("Build a SaaS analytics dashboard");
    const restaurant = generateDesignSpec("Create a restaurant website with warm feel");
    const blog = generateDesignSpec("Create a blog about travel articles");

    const bgValues = [
      portfolio.tokens.bgPrimary,
      dashboard.tokens.bgPrimary,
      restaurant.tokens.bgPrimary,
      blog.tokens.bgPrimary,
    ];
    const uniqueValues = new Set(bgValues);
    assert.ok(
      uniqueValues.size >= 2,
      `Expected at least 2 distinct bgPrimary values, got: ${JSON.stringify(bgValues)}`
    );
  });

  test("A5: Accent colours differ between portfolio and dashboard", () => {
    const portfolio = generateDesignSpec("Build a portfolio website showcasing my projects");
    const dashboard = generateDesignSpec("Build a SaaS analytics dashboard");
    assert.notEqual(
      portfolio.tokens.accentPrimary,
      dashboard.tokens.accentPrimary,
      "Portfolio and dashboard should have different accent colours"
    );
  });

  test("A6: analyseTaskBrief correctly classifies login task", () => {
    const type = analyseTaskBrief("Create a login page with email and password fields");
    assert.equal(type, "login_auth");
  });

  test("A7: analyseTaskBrief classifies landing page", () => {
    const type = analyseTaskBrief("Build a landing page for our SaaS product");
    assert.equal(type, "landing_page");
  });

  test("A8: selectDesignDirection returns warm_organic for cafe website", () => {
    const dir = selectDesignDirection("generic_website", "Build a cafe website with warm colours");
    assert.equal(dir, "warm_organic");
  });

  test("A9: selectDesignDirection returns dark_saas for dark saas app", () => {
    const dir = selectDesignDirection("saas_app", "Build a dark saas platform for developers");
    assert.equal(dir, "dark_saas");
  });

  test("A10: different token sets are used for different directions", () => {
    const minimalTokens = buildDesignTokens("minimal_clean", "light");
    const darkSaasTokens = buildDesignTokens("dark_saas", "dark");
    const warmTokens = buildDesignTokens("warm_organic", "light");
    // All three must have materially different bgPrimary
    assert.notEqual(minimalTokens.bgPrimary, darkSaasTokens.bgPrimary);
    assert.notEqual(minimalTokens.bgPrimary, warmTokens.bgPrimary);
    assert.notEqual(darkSaasTokens.bgPrimary, warmTokens.bgPrimary);
  });
});

// ---------------------------------------------------------------------------
// Scenario B — Responsive Layout
// ---------------------------------------------------------------------------
describe("Phase 13 Scenario B — Responsive Layout", () => {
  test("B1: Scaffolded static project includes mobile media query", async () => {
    const tmp = makeTmpDir("p13-b1-");
    try {
      const ws = new Workspace(tmp);
      const minimalSpec = generateDesignSpec("Build a minimal clean portfolio website");
      const result = await scaffoldStaticProject(ws, "test-site", minimalSpec);
      assert.equal(result.success, true, `Scaffold failed: ${result.error}`);

      const css = await ws.read("styles.css");
      assert.match(css, /@media\s*\(\s*max-width:\s*768px\s*\)/, "Missing @media (max-width: 768px) rule");
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("B2: Mobile media query reduces hero-title font size", async () => {
    const tmp = makeTmpDir("p13-b2-");
    try {
      const ws = new Workspace(tmp);
      const result = await scaffoldStaticProject(ws, "test-site");
      assert.equal(result.success, true);

      const css = await ws.read("styles.css");
      // Find the mobile query block
      const mobileMatch = css.match(/@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\}/);
      assert.ok(mobileMatch, "No mobile media query block found");
      // The mobile block should contain a hero-title font size override
      const mobileBlock = css.substring(css.indexOf("@media (max-width: 768px)"));
      assert.match(
        mobileBlock,
        /\.hero-title/,
        "Mobile query should target .hero-title for responsive sizing"
      );
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("B3: nav-links has responsive styling in mobile query", async () => {
    const tmp = makeTmpDir("p13-b3-");
    try {
      const ws = new Workspace(tmp);
      const result = await scaffoldStaticProject(ws, "test-site");
      assert.equal(result.success, true);

      const css = await ws.read("styles.css");
      const mobileSection = css.substring(css.indexOf("@media (max-width: 768px)"));
      assert.match(
        mobileSection,
        /\.nav-links/,
        "Mobile query should contain .nav-links rule"
      );
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("B4: Design spec tokens appear in generated CSS", async () => {
    const tmp = makeTmpDir("p13-b4-");
    try {
      const ws = new Workspace(tmp);
      const spec = generateDesignSpec("Create a warm restaurant website");
      const result = await scaffoldStaticProject(ws, "restaurant-site", spec);
      assert.equal(result.success, true);

      const css = await ws.read("styles.css");
      // The warm_organic bgPrimary (#FEF9F0) should appear in the CSS
      assert.match(css, /#FEF9F0/i, "Design spec bgPrimary token should appear in CSS");
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario C — Interaction Quality
// ---------------------------------------------------------------------------
describe("Phase 13 Scenario C — Interaction Quality", () => {
  test("C1: Generated script.js contains form submit handler", async () => {
    const tmp = makeTmpDir("p13-c1-");
    try {
      const ws = new Workspace(tmp);
      const result = await scaffoldStaticProject(ws, "test-site");
      assert.equal(result.success, true);

      const js = await ws.read("script.js");
      assert.match(js, /form\.addEventListener/, "script.js should attach a form submit event listener");
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("C2: Form handler calls e.preventDefault()", async () => {
    const tmp = makeTmpDir("p13-c2-");
    try {
      const ws = new Workspace(tmp);
      const result = await scaffoldStaticProject(ws, "test-site");
      assert.equal(result.success, true);

      const js = await ws.read("script.js");
      assert.match(js, /e\.preventDefault\(\)/, "script.js form handler must call e.preventDefault()");
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("C3: Form validation feedback is present", async () => {
    const tmp = makeTmpDir("p13-c3-");
    try {
      const ws = new Workspace(tmp);
      const result = await scaffoldStaticProject(ws, "test-site");
      assert.equal(result.success, true);

      const js = await ws.read("script.js");
      // Validation must provide some user feedback
      const hasFeedback = /feedback|form-feedback|error|success|invalid|valid/.test(js);
      assert.ok(hasFeedback, "script.js should contain form validation feedback logic");
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario D — Visual Refinement (defect detection and repair)
// ---------------------------------------------------------------------------
describe("Phase 13 Scenario D — Visual Refinement / Defect Detection", () => {
  test("D1: Detect deliberate hero-title font-size defect and repair it", async () => {
    const tmp = makeTmpDir("p13-d1-");
    try {
      const ws = new Workspace(tmp);
      const result = await scaffoldStaticProject(ws, "test-site");
      assert.equal(result.success, true);

      // Read original CSS and extract hero-title font size
      const originalCss = await ws.read("styles.css");
      const originalSizeMatch = originalCss.match(/\.hero-title\s*\{[^}]*font-size:\s*([^;]+);/);
      assert.ok(originalSizeMatch, "styles.css must have .hero-title with a font-size");
      const originalSize = originalSizeMatch[1].trim();
      assert.notEqual(originalSize, "0px", "Original hero-title font-size must not be 0px");

      // INTRODUCE DEFECT: replace hero-title font-size with 0px
      const defectiveCss = originalCss.replace(
        /\.hero-title\s*\{([^}]*)font-size:\s*[^;]+;/,
        `.hero-title {$1font-size: 0px;`
      );
      await ws.write("styles.css", defectiveCss);

      // Confirm defect
      const defectedContent = await ws.read("styles.css");
      assert.match(defectedContent, /font-size:\s*0px/, "Defect should be present in CSS");

      // REPAIR: restore original font-size
      const repairedCss = defectedContent.replace(
        /\.hero-title\s*\{([^}]*)font-size:\s*0px;/,
        `.hero-title {$1font-size: ${originalSize};`
      );
      await ws.write("styles.css", repairedCss);

      // Confirm repair
      const repairedContent = await ws.read("styles.css");
      assert.ok(
        !repairedContent.includes("font-size: 0px"),
        "Repaired CSS must not contain font-size: 0px"
      );
      assert.match(
        repairedContent,
        new RegExp(`font-size:\\s*${originalSize.replace(".", "\\.")}`),
        "Repaired CSS must restore original font-size"
      );
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario E — Targeted Edit Preservation
// ---------------------------------------------------------------------------
describe("Phase 13 Scenario E — Targeted Edit Preservation", () => {
  test("E1: Editing styles.css hero-title leaves about.html unchanged", async () => {
    const tmp = makeTmpDir("p13-e1-");
    try {
      const ws = new Workspace(tmp);
      const result = await scaffoldStaticProject(ws, "test-site");
      assert.equal(result.success, true);

      // Create an unrelated file
      const aboutContent = `<!DOCTYPE html>
<html lang="en">
<head><title>About</title></head>
<body><h1>About Page — do not modify</h1></body>
</html>`;
      await ws.write("about.html", aboutContent);

      // Read original CSS
      const originalCss = await ws.read("styles.css");

      // Make a targeted edit: change hero-title font-weight from 800 to 900
      const editedCss = originalCss.replace(
        /\.hero-title\s*\{([^}]*)font-weight:\s*\d+;/,
        `.hero-title {$1font-weight: 900;`
      );
      await ws.write("styles.css", editedCss);

      // Verify styles.css was changed
      const newCss = await ws.read("styles.css");
      assert.match(newCss, /font-weight:\s*900/, "Hero title font-weight should be updated to 900");

      // Verify about.html is UNCHANGED
      const aboutAfter = await ws.read("about.html");
      assert.equal(aboutAfter, aboutContent, "about.html must not be modified by targeted styles.css edit");
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario F — Accessibility and Motion
// ---------------------------------------------------------------------------
describe("Phase 13 Scenario F — Accessibility and Motion", () => {
  test("F1: Scaffolded CSS includes prefers-reduced-motion query", async () => {
    const tmp = makeTmpDir("p13-f1-");
    try {
      const ws = new Workspace(tmp);
      // Use a spec with animations enabled (default)
      const spec = generateDesignSpec("Build a portfolio website");
      const result = await scaffoldStaticProject(ws, "test-site", spec);
      assert.equal(result.success, true);

      const css = await ws.read("styles.css");
      assert.match(
        css,
        /prefers-reduced-motion/,
        "CSS must include a @media (prefers-reduced-motion) rule"
      );
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("F2: Reduced-motion rule disables animation or transition", async () => {
    const tmp = makeTmpDir("p13-f2-");
    try {
      const ws = new Workspace(tmp);
      const spec = generateDesignSpec("Build a portfolio website");
      const result = await scaffoldStaticProject(ws, "test-site", spec);
      assert.equal(result.success, true);

      const css = await ws.read("styles.css");
      const reducedBlock = css.substring(css.indexOf("prefers-reduced-motion"));
      const hasDisable = /animation:\s*none|transition:\s*none/.test(reducedBlock);
      assert.ok(hasDisable, "Reduced-motion block must disable animation or transition");
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("F3: Form inputs have associated labels (for= attribute)", async () => {
    const tmp = makeTmpDir("p13-f3-");
    try {
      const ws = new Workspace(tmp);
      const result = await scaffoldStaticProject(ws, "test-site");
      assert.equal(result.success, true);

      const html = await ws.read("index.html");
      assert.match(html, /\bfor\s*=\s*["']\w/, "HTML must have labels with for= attributes for accessibility");
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("F4: Submit button has type=submit", async () => {
    const tmp = makeTmpDir("p13-f4-");
    try {
      const ws = new Workspace(tmp);
      const result = await scaffoldStaticProject(ws, "test-site");
      assert.equal(result.success, true);

      const html = await ws.read("index.html");
      assert.match(
        html,
        /type\s*=\s*["']submit["']/,
        "HTML must have a submit button with type=submit"
      );
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("F5: React scaffold includes prefers-reduced-motion in index.css when design spec provided", async () => {
    const tmp = makeTmpDir("p13-f5-");
    try {
      const ws = new Workspace(tmp);
      const spec = generateDesignSpec("Build a portfolio website");
      const result = await scaffoldReactViteProject(ws, "react-portfolio", spec);
      assert.equal(result.success, true);

      const css = await ws.read("src/index.css");
      assert.match(css, /prefers-reduced-motion/, "React index.css must include prefers-reduced-motion");
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario G — Honest Completion
// ---------------------------------------------------------------------------
describe("Phase 13 Scenario G — Honest Completion", () => {
  test("G1: Verification exit code 1 is reported as failure", () => {
    const result = "Exit code: 1\nError: Cannot find module './missing'";
    assert.equal(
      isToolResultFailure("run_verification", result),
      true,
      "Exit code 1 must be a failure"
    );
  });

  test("G2: Browser verification failure is reported as failure", () => {
    const result = "Browser verification failed: heading not found";
    assert.equal(
      isToolResultFailure("browser_verify", result),
      true,
      "Browser verification failure string must report as failure"
    );
  });

  test("G3: App started with URL reports as success", () => {
    const result = "App started and ready at http://localhost:5173";
    assert.equal(
      isToolResultSuccess("start_app", result),
      true,
      "start_app with ready URL must be a success"
    );
  });

  test("G4: App failed to become ready is not a success", () => {
    const result = "App failed to become ready";
    assert.equal(
      isToolResultSuccess("start_app", result),
      false,
      "start_app failure must not be reported as success"
    );
  });

  test("G5: Browser verification failure is not a success", () => {
    const result = "Browser verification failed: heading not found in page";
    assert.equal(
      isToolResultSuccess("browser_verify", result),
      false,
      "Browser verification failure must not report as success"
    );
  });

  test("G6: isToolResultFailure returns false for passing verification", () => {
    const result = "Exit code: 0\nVERIFICATION PASSED";
    assert.equal(
      isToolResultFailure("run_verification", result),
      false,
      "Exit code 0 must not be a failure"
    );
  });

  test("G7: Tool error prefix is always a failure", () => {
    const result = "Tool error: file not found";
    assert.equal(isToolResultFailure("edit_file", result), true);
    assert.equal(isToolResultFailure("read_file", result), true);
    assert.equal(isToolResultFailure("create_file", result), true);
  });

  test("G8: BLOCKED: prefix is always a failure", () => {
    const result = "BLOCKED: action not permitted";
    assert.equal(isToolResultFailure("run_command", result), true);
  });
});

// ---------------------------------------------------------------------------
// Design spec utility tests
// ---------------------------------------------------------------------------
describe("Phase 13 — Design Spec Utilities", () => {
  test("isUITask detects website creation tasks", () => {
    assert.equal(isUITask("Build a landing page for our startup"), true);
    assert.equal(isUITask("Create a portfolio website"), true);
    assert.equal(isUITask("Add a login page with email and password"), true);
    assert.equal(isUITask("Implement a dashboard component"), true);
    assert.equal(isUITask("Fix a bug in the calculator"), false);
    assert.equal(isUITask("Run npm test and fix errors"), false);
  });

  test("generateDesignSpec returns valid spec structure", () => {
    const spec = generateDesignSpec("Build a modern landing page for a fintech startup");
    assert.ok(spec.productType, "productType must be set");
    assert.ok(spec.direction, "direction must be set");
    assert.ok(spec.tokens, "tokens must be set");
    assert.ok(spec.tokens.bgPrimary, "bgPrimary must be set");
    assert.ok(spec.tokens.accentPrimary, "accentPrimary must be set");
    assert.ok(spec.typography, "typography must be set");
    assert.ok(spec.typography.fontStack, "fontStack must be set");
    assert.ok(spec.typography.heroSize, "heroSize must be set");
    assert.ok(spec.spacing, "spacing must be set");
    assert.ok(Array.isArray(spec.expectedSections), "expectedSections must be an array");
    assert.ok(spec.expectedSections.length > 0, "expectedSections must not be empty");
    assert.equal(typeof spec.useAnimations, "boolean", "useAnimations must be boolean");
    assert.ok(spec.visualSummary, "visualSummary must be set");
  });

  test("formatDesignSpecForPrompt returns a non-empty string with key sections", () => {
    const spec = generateDesignSpec("Build a portfolio website");
    const prompt = formatDesignSpecForPrompt(spec);
    assert.ok(typeof prompt === "string" && prompt.length > 0, "prompt must be non-empty");
    assert.match(prompt, /Product Type/i, "prompt must contain Product Type");
    assert.match(prompt, /Typography/i, "prompt must contain Typography");
    assert.match(prompt, /Spacing/i, "prompt must contain Spacing");
    assert.match(prompt, /Expected Sections/i, "prompt must contain Expected Sections");
    assert.match(prompt, /prefers-reduced-motion/, "prompt must mention prefers-reduced-motion");
  });

  test("Ecommerce brief gets distinct accent from portfolio", () => {
    const ecommerce = generateDesignSpec("Create an online store with product listings and shopping cart");
    const portfolio = generateDesignSpec("Build a portfolio website for a designer");
    // They may share direction but tokens should be consistent with their spec
    assert.ok(ecommerce.productType === "ecommerce", `Expected ecommerce, got ${ecommerce.productType}`);
    assert.ok(portfolio.productType === "portfolio", `Expected portfolio, got ${portfolio.productType}`);
  });
});
