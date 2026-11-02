/**
 * Visual Intelligence Engine v1.1.0 Master Acceptance Suite
 *
 * Verifies:
 * 1. BMW M4 Automotive Acceptance Scenario (Real photography, specs bar, bento grid, gallery, test drive)
 * 2. Industry Classification (Automotive, Real Estate, Restaurant, Luxury, SaaS)
 * 3. Real Image Intelligence (Wikimedia search, curated fallback, magic bytes validator)
 * 4. React/Vite and Static Scaffolding with real images & design tokens
 * 5. Playwright headless browser rendering across desktop (1280x800) and mobile (375x667)
 * 6. Actual screenshot captures saved to screenshots/v1-1-acceptance/
 * 7. Zero broken images, zero horizontal overflow, and zero console errors
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { Workspace } from "../src/tools/workspace.js";
import {
  scaffoldStaticProject,
  scaffoldReactViteProject,
} from "../src/tools/scaffold.js";
import {
  analyseTaskBrief,
  generateDesignSpec,
  formatDesignSpecForPrompt,
  buildRequiredVisualAssets,
} from "../src/tools/design-planner.js";
import {
  searchImages,
  downloadAndValidateImage,
} from "../src/tools/image-intelligence.js";

const screenshotDir = path.resolve("screenshots/v1-1-acceptance");
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

console.log("==========================================================================");
console.log("  ACHU CODING AGENT — VISUAL INTELLIGENCE V1.1.0 MASTER ACCEPTANCE SUITE");
console.log("==========================================================================\n");

// ---------------------------------------------------------------------------
// TEST 1: Industry-Specific Planning & Archetype Detection
// ---------------------------------------------------------------------------
console.log("--- [Test 1] Industry Classification & Archetype Intelligence ---");

const testBriefs = [
  { brief: "Create premium black BMW M4 Competition automotive model page", expectedType: "automotive", expectedDir: "luxury_brand" },
  { brief: "Build an ultra-modern luxury real estate villa listing showcase with panoramic pool", expectedType: "real_estate", expectedDir: "editorial_luxury" },
  { brief: "Design a cozy artisan bakery and cafe website with seasonal sourdough menu", expectedType: "restaurant_hospitality", expectedDir: "warm_organic" },
  { brief: "Create an exclusive haute horlogerie luxury timepiece brand website", expectedType: "luxury_fashion", expectedDir: "luxury_brand" },
  { brief: "Build a corporate healthcare hospital network website with doctor directory", expectedType: "healthcare_medical", expectedDir: "professional_corporate" },
  { brief: "Create an online coding academy platform with curriculum and enrollment", expectedType: "education", expectedDir: "modern_saas_light" },
  { brief: "Build a fintech wealth management platform with interactive rate calculator", expectedType: "finance_fintech", expectedDir: "professional_corporate" },
];

for (const t of testBriefs) {
  const detectedType = analyseTaskBrief(t.brief);
  const spec = generateDesignSpec(t.brief);
  assert.equal(detectedType, t.expectedType, `Brief '${t.brief}' must detect type=${t.expectedType}, got ${detectedType}`);
  assert.equal(spec.direction, t.expectedDir, `Brief '${t.brief}' must select direction=${t.expectedDir}, got ${spec.direction}`);
  assert.ok(spec.expectedSections.length >= 5, "Expected sections must be non-empty");
  assert.ok(spec.visualAssets && spec.visualAssets.length > 0, "Visual assets requirements must be generated");
  console.log(`  ✓ Detected: ${detectedType} -> Direction: ${spec.direction} (${spec.expectedSections.length} sections)`);
}

// ---------------------------------------------------------------------------
// TEST 2: Real Image Intelligence Engine (Search & Download Validation)
// ---------------------------------------------------------------------------
console.log("\n--- [Test 2] Real Image Intelligence Engine & Downloader ---");

const bmwImages = await searchImages("BMW M4", 3);
assert.ok(bmwImages.length >= 1, "Must find at least 1 BMW M4 image");
console.log(`  ✓ Search query 'BMW M4' returned ${bmwImages.length} images:`);
for (const img of bmwImages) {
  assert.ok(img.url.startsWith("http"), "Image URL must be a valid HTTP URL");
  assert.ok(img.title, "Image must have a descriptive title");
  console.log(`    • [${img.source.toUpperCase()}] ${img.title} -> ${img.url.slice(0, 60)}...`);
}

// Test image download and magic byte validation
const sampleImageUrl = bmwImages[0].thumbnailUrl || bmwImages[0].url;
const testDownloadDir = makeTmpDir("img-dl-test-");
const testDownloadFile = path.join(testDownloadDir, "test-bmw-asset.jpg");
const dlResult = await downloadAndValidateImage(sampleImageUrl, testDownloadFile);

assert.equal(dlResult.success, true, `Image download must succeed: ${dlResult.error}`);
assert.ok(dlResult.bytes > 1000, `Downloaded file must be valid size (>1000 bytes, got ${dlResult.bytes})`);
assert.ok(fs.existsSync(testDownloadFile), "Downloaded file must exist on disk");
console.log(`  ✓ Download & Magic Bytes Validation passed: ${dlResult.bytes} bytes verified on disk`);
fs.rmSync(testDownloadDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// TEST 3: BMW M4 Automotive Acceptance Scenario (Real Browser Verification)
// ---------------------------------------------------------------------------
console.log("\n--- [Test 3] BMW M4 Automotive Acceptance Scenario ---");

const bmwBrief = "Create premium black BMW M4 Competition automotive model page with performance specs, aerodynamics, cockpit, vehicle gallery, and test drive booking";
const bmwSpec = generateDesignSpec(bmwBrief);

assert.equal(bmwSpec.productType, "automotive");
assert.equal(bmwSpec.direction, "luxury_brand");
assert.ok(bmwSpec.tokens.gradientHero, "Gradient hero token must exist");
assert.ok(bmwSpec.tokens.gradientAccent, "Gradient accent token must exist");
assert.ok(bmwSpec.visualAssets && bmwSpec.visualAssets.length >= 3, "Automotive spec must require vehicle visual assets");

// 3A. Test Static Project Scaffolding
const tmpStaticBmw = makeTmpDir("bmw-m4-static-");
const wsStatic = new Workspace(tmpStaticBmw);
const staticRes = await scaffoldStaticProject(wsStatic, "bmw-m4-model", bmwSpec);
assert.equal(staticRes.success, true, "Static automotive scaffold must succeed");

const bmwHtml = await wsStatic.read("index.html");
const bmwCss = await wsStatic.read("styles.css");
const bmwJs = await wsStatic.read("script.js");

// Verify essential automotive DOM structures and assets
assert.ok(bmwHtml.includes("vehicle-hero"), "HTML must contain .vehicle-hero");
assert.ok(bmwHtml.includes("specs-bar"), "HTML must contain .specs-bar");
assert.ok(bmwHtml.includes("503 HP"), "HTML must contain key performance stat (503 HP)");
assert.ok(bmwHtml.includes("3.4s"), "HTML must contain acceleration stat (3.4s)");
assert.ok(bmwHtml.includes("vehicle-gallery-grid"), "HTML must contain .vehicle-gallery-grid");
assert.ok(bmwHtml.includes("https://images.unsplash.com/photo-1555215695-3004980ad54e"), "HTML must contain genuine vehicle hero photo");
assert.ok(bmwHtml.includes("contact-form"), "HTML must contain test drive contact form");
assert.ok(bmwCss.includes(".vehicle-hero"), "CSS must style .vehicle-hero");
assert.ok(bmwCss.includes(".specs-bar"), "CSS must style .specs-bar");
assert.ok(bmwCss.includes("prefers-reduced-motion"), "CSS must contain reduced motion media query");
console.log("  ✓ Static files generated and verified on disk");

// 3B. Test React/Vite Project Scaffolding
const tmpReactBmw = makeTmpDir("bmw-m4-react-");
const wsReact = new Workspace(tmpReactBmw);
const reactRes = await scaffoldReactViteProject(wsReact, "bmw-m4-react", bmwSpec);
assert.equal(reactRes.success, true, "React automotive scaffold must succeed");
const reactAppJsx = await wsReact.read("src/App.jsx");
assert.ok(reactAppJsx.includes("503 HP"), "React App.jsx must include automotive stats");
assert.ok(reactAppJsx.includes("https://images.unsplash.com/photo-1555215695-3004980ad54e"), "React App.jsx must include genuine vehicle photo");
console.log("  ✓ React/Vite files generated and verified on disk");
fs.rmSync(tmpReactBmw, { recursive: true, force: true });

// 3C. Launch Real Playwright Headless Browser
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(err.message));

try {
  const filePath = path.join(tmpStaticBmw, "index.html");
  const fileUrl = `file:///${filePath.replace(/\\/g, "/")}`;

  // Desktop Viewport Test: 1280x800
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(fileUrl, { waitUntil: "load" });

  // 1. Verify title and brand
  const pageTitle = await page.title();
  assert.ok(/bmw\s*m4/i.test(pageTitle), `Page title must include BMW M4, got: ${pageTitle}`);

  // 2. Verify all images loaded with real non-zero dimensions (Zero broken images)
  const imageStats = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    return imgs.map((img) => ({
      src: img.src,
      alt: img.alt,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    }));
  });

  console.log(`  ✓ Found ${imageStats.length} image elements in DOM:`);
  for (const img of imageStats) {
    assert.ok(img.complete, `Image ${img.src} must be complete`);
    assert.ok(img.naturalWidth > 0, `Image ${img.src} must have naturalWidth > 0 (not broken)`);
    assert.ok(img.alt, `Image ${img.src} must have accessible alt text`);
    console.log(`    • Loaded: ${img.alt.slice(0, 45)}... [${img.naturalWidth}x${img.naturalHeight}px]`);
  }

  // 3. Verify desktop layout & stats
  const statValues = await page.$$eval(".stat-value", (els) => els.map((e) => e.textContent?.trim()));
  assert.ok(statValues.includes("503 HP"), "Must display 503 HP");
  assert.ok(statValues.includes("3.4s"), "Must display 3.4s");
  console.log(`  ✓ Performance Stats Bar: ${statValues.join(" | ")}`);

  // 4. Test Form Submission & Validation
  const submitBtn = page.locator("#submit-btn");
  await submitBtn.click();
  const feedback = page.locator("#form-feedback");
  assert.ok(await feedback.isVisible(), "Form validation error must appear when required fields are empty");
  console.log("  ✓ Form validation feedback triggered successfully");

  // Fill valid inputs and submit
  await page.locator("#name").fill("Marcus Sterling");
  await page.locator("#email").fill("marcus@example.com");
  await page.locator("#message").fill("Interested in booking a weekend track demonstration for the M4 Competition.");
  await submitBtn.click();
  const successFeedback = await feedback.textContent();
  assert.match(successFeedback || "", /thank you|received/i, "Form must display success confirmation");
  console.log("  ✓ Form submission completed successfully");

  // Capture Desktop Screenshot
  const desktopShot = path.join(screenshotDir, "bmw-m4-desktop-1280x800.png");
  await page.screenshot({ path: desktopShot, fullPage: true });
  console.log(`  ✓ Desktop Screenshot captured: ${path.basename(desktopShot)}`);

  // Mobile Viewport Test: 375x667
  await page.setViewportSize({ width: 375, height: 667 });
  await page.reload({ waitUntil: "load" });

  const hasMobileOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth;
  });
  assert.equal(hasMobileOverflow, false, "Mobile automotive layout must have ZERO horizontal overflow");
  console.log("  ✓ Mobile zero-horizontal-overflow verified");

  // Capture Mobile Screenshot
  const mobileShot = path.join(screenshotDir, "bmw-m4-mobile-375x667.png");
  await page.screenshot({ path: mobileShot, fullPage: true });
  console.log(`  ✓ Mobile Screenshot captured: ${path.basename(mobileShot)}`);

  assert.equal(consoleErrors.length, 0, `Must have 0 console errors, got: ${JSON.stringify(consoleErrors)}`);
  console.log("  ✓ Browser console verified: 0 errors");
} finally {
  await browser.close();
  fs.rmSync(tmpStaticBmw, { recursive: true, force: true });
}

console.log("\n==========================================================================");
console.log("  ALL ACCEPTANCE CRITERIA PASSED FOR VISUAL INTELLIGENCE V1.1.0!");
console.log("==========================================================================");
