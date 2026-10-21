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
});
