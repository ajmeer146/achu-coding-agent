import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WEBSITE_DESIGN_GUIDE_VERSION,
  WEBSITE_DESIGN_GUIDE_SOURCE_FILE,
  WEBSITE_DESIGN_GUIDE_SOURCE_SHA256,
  WEBSITE_DESIGN_GUIDE_SECTION_COUNT,
  GUIDE_SECTIONS,
  QUALITY_PRIORITY_RULES,
  buildQualityChecklist,
  isWebsiteQualityTask,
  formatChecklist,
  formatGuideSectionIndex,
  buildWebsiteQualityGuidance,
  buildFullGuideReference,
  WEBSITE_50_PRINCIPLES_VERSION,
  WEBSITE_50_PRINCIPLES,
  PRINCIPLE_PHASES,
  evaluatePrinciplesApplicability,
  format50PrinciplesChecklist,
  evaluateWebsiteQuality,
} from "../src/quality/website-design-guide.js";
import { generateDesignSpec } from "../src/tools/design-planner.js";
import { buildInitialSystemPrompt, createSystemPrompt } from "../src/agent.js";
import { generateVerificationTargetsFromTask } from "../src/browser/browser-verification.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Website Design Guide integration (Complete Master Website Design Guide A–Z)", async (t) => {
  await t.test("1. Guide metadata is complete and consistent", () => {
    assert.equal(WEBSITE_DESIGN_GUIDE_VERSION, "1.0.0");
    assert.equal(WEBSITE_DESIGN_GUIDE_SOURCE_FILE, "Complete_Master_Website_Design_Guide_A_to_Z.pdf");
    assert.match(WEBSITE_DESIGN_GUIDE_SOURCE_SHA256, /^[0-9A-F]{64}$/);
    assert.equal(WEBSITE_DESIGN_GUIDE_SECTION_COUNT, 35);

    assert.equal(GUIDE_SECTIONS.length, WEBSITE_DESIGN_GUIDE_SECTION_COUNT);
    const numbers = GUIDE_SECTIONS.map((s) => s.number);
    assert.deepEqual(numbers, Array.from({ length: 35 }, (_, i) => i + 1));
    const ids = new Set(GUIDE_SECTIONS.map((s) => s.id));
    assert.equal(ids.size, GUIDE_SECTIONS.length, "section ids must be unique");
    assert.ok(GUIDE_SECTIONS.some((s) => s.priorities.includes("P2")), "guide must keep P2 as optional extras");
  });

  await t.test("2. Canonical guide document contains every section heading", () => {
    const docPath = path.join(repoRoot, "docs", "WEBSITE_DESIGN_GUIDE.md");
    assert.ok(fs.existsSync(docPath), "docs/WEBSITE_DESIGN_GUIDE.md must exist");
    const doc = fs.readFileSync(docPath, "utf8");
    for (const section of GUIDE_SECTIONS) {
      assert.ok(
        doc.includes(`## ${section.number}. ${section.title}`),
        `guide document must contain heading for section ${section.number} (${section.title})`
      );
    }
    assert.ok(doc.includes(WEBSITE_DESIGN_GUIDE_SOURCE_SHA256), "guide document must record the source SHA-256");
  });

  await t.test("3. buildQualityChecklist is category-specific", () => {
    const ecommerce = buildQualityChecklist("ecommerce", "create ecommerce website with working checkout");
    const ids = new Set(ecommerce.map((i) => i.id));
    assert.ok(ids.has("ecommerce-catalog"));
    assert.ok(ids.has("ecommerce-search"));
    assert.ok(ids.has("ecommerce-cart"));
    assert.ok(ids.has("responsive"));
    assert.ok(ids.has("accessibility"));

    const portfolio = buildQualityChecklist("portfolio", "build my portfolio website");
    const portfolioIds = new Set(portfolio.map((i) => i.id));
    assert.ok(portfolioIds.has("portfolio-projects"));
    assert.ok(!portfolioIds.has("ecommerce-cart"), "portfolio checklist must not include e-commerce items");

    const unknown = buildQualityChecklist("not-a-real-type", "build a website");
    assert.ok(unknown.some((i) => i.id === "generic-hero"), "unknown product type falls back to generic website");

    const featureOnly = buildQualityChecklist("landing_page", "landing page with a newsletter search field");
    assert.ok(featureOnly.some((i) => i.id === "feature-search"));
  });

  await t.test("4. P2 extras stay optional and are never forced", () => {
    const plain = buildQualityChecklist("landing_page", "create a landing page for a bakery");
    const plainP2 = plain.filter((i) => i.priority === "P2");
    assert.ok(!plainP2.some((i) => i.id === "feature-advanced"), "no 3D/parallax item unless asked");

    const asked = buildQualityChecklist("landing_page", "create a landing page with a 3d hero and parallax");
    assert.ok(asked.some((i) => i.id === "feature-advanced" && i.priority === "P2"));

    assert.match(QUALITY_PRIORITY_RULES.P2, /ONLY when/i);
  });

  await t.test("5. isWebsiteQualityTask distinguishes website tasks from unrelated work", () => {
    assert.equal(isWebsiteQualityTask("create ecommerce website with working condition"), true);
    assert.equal(isWebsiteQualityTask("build a portfolio site"), true);
    assert.equal(isWebsiteQualityTask("redesign the dashboard pages"), true);
    assert.equal(isWebsiteQualityTask("fix the calculator.ts bug"), false);
    assert.equal(isWebsiteQualityTask("run the test suite and report failures"), false);
  });

  await t.test("6. buildWebsiteQualityGuidance injects the standard only for website tasks", () => {
    const unrelated = buildWebsiteQualityGuidance("fix the calculator.ts bug", null);
    assert.equal(unrelated, null, "non-website tasks must not receive website guidance");

    const guidance = buildWebsiteQualityGuidance("create ecommerce website with working condition", "ecommerce");
    assert.ok(guidance, "e-commerce website task must receive guidance");
    assert.ok(guidance!.includes(`v${WEBSITE_DESIGN_GUIDE_VERSION}`));
    assert.ok(guidance!.includes(WEBSITE_DESIGN_GUIDE_SOURCE_SHA256));
    assert.ok(guidance!.includes("e-commerce storefront"));
    assert.ok(guidance!.includes("Working product search"));
    assert.ok(guidance!.includes("Cart drawer or modal"));
    assert.ok(guidance!.includes("35. Master Acceptance Criteria"), "all 35 sections must be referenced");
    assert.ok(guidance!.includes("REJECT CONDITIONS"));
    assert.ok(guidance!.includes("PASS / FAIL / NOT VERIFIED"));

    const portfolio = buildWebsiteQualityGuidance("build my portfolio website", "portfolio");
    assert.ok(portfolio!.includes("portfolio"));
    assert.ok(!portfolio!.includes("ecommerce-cart"), "category label text from other types must not leak");
  });

  await t.test("7. Checklist and section index formatting stay grouped and readable", () => {
    const text = formatChecklist(buildQualityChecklist("ecommerce", "create ecommerce website"));
    assert.match(text, /^P0:/m);
    assert.match(text, /^P1:/m);
    assert.match(text, /^P2:/m);
    assert.ok(text.includes("- [ ] "));

    const index = formatGuideSectionIndex();
    assert.equal(index.split("\n").length, 35);
    assert.ok(index.includes("1. Project Planning and Design Strategy"));
    assert.ok(buildFullGuideReference().includes("Complete Master Website Design Guide"));
  });

  await t.test("8. Design spec carries the guide version and checklist", () => {
    const spec = generateDesignSpec("create ecommerce website with working condition");
    assert.equal(spec.productType, "ecommerce");
    assert.equal(spec.qualityGuideVersion, WEBSITE_DESIGN_GUIDE_VERSION);
    assert.ok(spec.qualityChecklist.some((i) => i.id === "ecommerce-cart"));
  });

  await t.test("9. The shared runAgent prompt includes the standard for website tasks only", () => {
    const websitePrompt = buildInitialSystemPrompt(
      "create ecommerce website with working condition",
      repoRoot,
      null,
      null
    );
    assert.ok(
      websitePrompt.includes("WEBSITE QUALITY STANDARD — Complete Master Website Design Guide A–Z"),
      "website task prompt must embed the quality standard"
    );
    assert.ok(websitePrompt.includes(`v${WEBSITE_DESIGN_GUIDE_VERSION}`));
    assert.ok(websitePrompt.includes("35. Master Acceptance Criteria"));

    const unrelatedPrompt = buildInitialSystemPrompt(
      "fix the calculator.ts bug",
      repoRoot,
      null,
      null
    );
    assert.ok(
      !unrelatedPrompt.includes("WEBSITE QUALITY STANDARD"),
      "non-website prompt must not be bloated with the quality standard"
    );
    assert.ok(websitePrompt.length > unrelatedPrompt.length);
  });

  await t.test("10. Local and cloud modes share the same prompt pipeline (source-level wiring)", () => {
    const agentSource = fs.readFileSync(path.join(repoRoot, "src", "agent.ts"), "utf8");
    assert.ok(agentSource.includes("buildInitialSystemPrompt"));
    assert.ok(agentSource.includes("buildWebsiteQualityGuidance"));

    const serverSource = fs.readFileSync(path.join(repoRoot, "src", "server.ts"), "utf8");
    assert.ok(serverSource.includes("runAgentWithWorkspace"), "local companion must use the shared workspace runner");
    assert.ok(serverSource.includes("runAgent"), "local companion must reach the shared agent entry point");

    const cloudSource = fs.readFileSync(path.join(repoRoot, "src", "trigger", "agent-task.ts"), "utf8");
    assert.ok(cloudSource.includes("runAgent"), "cloud worker must reach the shared agent entry point");

    const manualPrompt = createSystemPrompt(repoRoot, null, null);
    assert.ok(!manualPrompt.includes("WEBSITE QUALITY STANDARD"));
  });

  await t.test("11. E-commerce browser verification requires working search and cart controls", () => {
    const targets = generateVerificationTargetsFromTask(
      "create ecommerce website with working condition"
    );
    assert.ok(
      targets.some((t) => t.type === "input" && /search/i.test(t.selector ?? "")),
      "e-commerce verification must assert a search input"
    );
    assert.ok(
      targets.some((t) => t.type === "button" && /cart/i.test(t.text ?? "")),
      "e-commerce verification must assert a cart control"
    );

    const nonCommerce = generateVerificationTargetsFromTask("create a landing page for a bakery");
    assert.ok(
      !nonCommerce.some((t) => t.type === "button" && /cart/i.test(t.text ?? "")),
      "non-e-commerce tasks must not be forced to include a cart"
    );
  });

  await t.test("12. Verification controls follow the requested website type", () => {
    const landing = generateVerificationTargetsFromTask(
      "create a responsive landing page for a modern AI SaaS analytics product with pricing, features, testimonials and a signup form"
    );
    assert.ok(
      !landing.some((t) => t.type === "button" && /cart/i.test(t.text ?? "")),
      "a landing page must not be forced to include a cart control"
    );
    assert.ok(
      !landing.some((t) => t.type === "input" && /search/i.test(t.selector ?? "")),
      "a landing page must not be forced to include a search control"
    );
    assert.ok(
      !landing.some((t) => t.type === "heading" && /login/i.test(t.text ?? "")),
      "a landing page must not be forced to include a login heading"
    );

    const shop = generateVerificationTargetsFromTask(
      "create a responsive landing page for our Shopify store"
    );
    assert.ok(
      !shop.some((t) => t.type === "button" && /cart/i.test(t.text ?? "")),
      "a landing page for a store must not inherit shop-only controls"
    );

    const auth = generateVerificationTargetsFromTask(
      "create a login page with email validation and a password visibility toggle"
    );
    assert.ok(
      auth.some((t) => t.type === "input" && t.inputType === "password"),
      "an authentication page must still assert a password input"
    );
    assert.ok(
      auth.some((t) => t.type === "heading" && /login/i.test(t.text ?? "")),
      "an authentication page must still assert a login heading"
    );
  });

  await t.test("13. 50 Essential Principles coverage and phase distribution", () => {
    assert.equal(WEBSITE_50_PRINCIPLES.length, 50, "must define exactly 50 principles");
    assert.equal(WEBSITE_50_PRINCIPLES_VERSION, "2.0.0");
    assert.equal(PRINCIPLE_PHASES.length, 6, "must structure principles into 6 phases");

    const numbers = WEBSITE_50_PRINCIPLES.map((p) => p.number);
    assert.deepEqual(numbers, Array.from({ length: 50 }, (_, i) => i + 1));

    // Verify phase distributions match specification
    const phase1 = WEBSITE_50_PRINCIPLES.filter((p) => p.phase === 1);
    const phase2 = WEBSITE_50_PRINCIPLES.filter((p) => p.phase === 2);
    const phase3 = WEBSITE_50_PRINCIPLES.filter((p) => p.phase === 3);
    const phase4 = WEBSITE_50_PRINCIPLES.filter((p) => p.phase === 4);
    const phase5 = WEBSITE_50_PRINCIPLES.filter((p) => p.phase === 5);
    const phase6 = WEBSITE_50_PRINCIPLES.filter((p) => p.phase === 6);

    assert.equal(phase1.length, 5, "Phase 1 must have principles 1-5");
    assert.equal(phase2.length, 10, "Phase 2 must have principles 6-15");
    assert.equal(phase3.length, 10, "Phase 3 must have principles 16-25");
    assert.equal(phase4.length, 10, "Phase 4 must have principles 26-35");
    assert.equal(phase5.length, 10, "Phase 5 must have principles 36-45");
    assert.equal(phase6.length, 5, "Phase 6 must have principles 46-50");
  });

  await t.test("14. Principles applicability determination is tailored and recorded", () => {
    // Static portfolio task
    const portfolioEval = evaluatePrinciplesApplicability("create my developer portfolio website", "portfolio");
    assert.ok(portfolioEval.applicableCount > 0);
    assert.ok(portfolioEval.notApplicableCount > 0);
    const pDb = portfolioEval.evaluations.find((e) => e.principle.number === 28);
    assert.ok(pDb && !pDb.applicable, "database principle should not be applicable for static portfolio");
    assert.ok(pDb.reason.includes("does not require persistent server database"));

    // Full-stack database task
    const dbEval = evaluatePrinciplesApplicability("create a full stack dashboard with postgres database and migrations", "dashboard");
    const dbPrinciple = dbEval.evaluations.find((e) => e.principle.number === 28);
    assert.ok(dbPrinciple && dbPrinciple.applicable, "database principle must be applicable for full stack task");

    // Formatted checklist contains phase headers and principle entries
    const formatted = format50PrinciplesChecklist(portfolioEval.evaluations);
    assert.ok(formatted.includes("Phase 1 — Planning and Architecture"));
    assert.ok(formatted.includes("Phase 6 — Reliability, Maintenance, and Final Quality"));
    assert.ok(formatted.includes("[N/A] Principle 28:"));
  });

  await t.test("15. 12-category design quality scoring evaluates evidence and detects defects", () => {
    // Clean website audit
    const cleanAudit = evaluateWebsiteQuality({
      task: "build clean modern landing page",
      pageTitle: "Nova SaaS — AI Platform",
      visibleText: "Experience the next generation of cloud productivity. Start your free trial today with instantaneous deployment and automated scaling across all environments.",
      headings: ["Nova SaaS", "Features", "Pricing"],
      buttons: ["Get Started", "Learn More"],
      semanticCount: 5,
      stylesheetCount: 1,
      totalCssRules: 35,
      fontFamily: "Inter, sans-serif",
      criticalLayoutDefects: [],
      warningLayoutDefects: [],
      consoleErrors: [],
      pageErrors: [],
      verificationPassed: true,
      buildPassed: true,
      secretLeaksFound: false,
    });

    assert.equal(cleanAudit.categories.length, 12, "must score all 12 independent categories");
    assert.ok(cleanAudit.overallScore >= 85, "clean website should achieve >= 85 quality score");
    assert.equal(cleanAudit.overallPassed, true);
    assert.equal(cleanAudit.blockers.length, 0);

    // Broken website with critical defects
    const brokenAudit = evaluateWebsiteQuality({
      task: "build ecommerce store",
      pageTitle: "Store",
      visibleText: "Short",
      headings: [],
      buttons: [],
      semanticCount: 0,
      stylesheetCount: 0,
      totalCssRules: 0,
      criticalLayoutDefects: [{ type: "horizontal_overflow", message: "Page content is 45px wider than viewport" }],
      consoleErrors: ["Uncaught TypeError: Cannot read property 'map' of undefined"],
      verificationPassed: false,
      buildPassed: false,
      secretLeaksFound: true,
    });

    assert.ok(brokenAudit.overallScore < 50, "broken website must fail quality score");
    assert.equal(brokenAudit.overallPassed, false);
    assert.ok(brokenAudit.blockers.length >= 2, "must identify critical blockers");
    assert.ok(brokenAudit.blockers.includes("Secret leak detected"));
  });

  await t.test("16. Multi-viewport testing targets span 320px to 1920px", () => {
    const agentSource = fs.readFileSync(path.join(repoRoot, "src", "agent.ts"), "utf8");
    assert.ok(agentSource.includes("320"), "must test small mobile (320px)");
    assert.ok(agentSource.includes("375"), "must test standard mobile (375px)");
    assert.ok(agentSource.includes("390"), "must test standard mobile large (390px)");
    assert.ok(agentSource.includes("768"), "must test tablet (768px)");
    assert.ok(agentSource.includes("1280"), "must test laptop (1280px)");
    assert.ok(agentSource.includes("1440"), "must test laptop/desktop (1440px)");
    assert.ok(agentSource.includes("1920"), "must test wide desktop (1920px)");
  });

  await t.test("17. Interactive verification targets support button clicks, form submissions, and state verification", () => {
    const targets = generateVerificationTargetsFromTask(
      "create a contact page with a name field, email input, message input, and Submit button that shows Thank You after sending"
    );
    assert.ok(targets.some((t) => t.type === "input" && /email/i.test(t.inputType || t.selector || "")));
    assert.ok(targets.some((t) => t.type === "button" && /submit/i.test(t.text || "")));
    assert.ok(targets.some((t) => t.type === "text" && /thank you/i.test(t.text || "")));
  });
});
