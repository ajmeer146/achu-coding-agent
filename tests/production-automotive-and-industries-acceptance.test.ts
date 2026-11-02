import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { chromium, type Browser, type Page } from "playwright";
import { Workspace } from "../src/tools/workspace.js";
import { scaffoldStaticProject, scaffoldReactViteProject } from "../src/tools/scaffold.js";
import { generateDesignSpec, analyseTaskBrief } from "../src/tools/design-planner.js";
import {
  searchImages,
  downloadAndValidateImage,
  provisionVisualAssets,
  repairBrokenImage,
  type ImageAssetManifest
} from "../src/tools/image-intelligence.js";
import { BrowserSession } from "../src/browser/browser-session.js";

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

async function findFreePort(start = 54200): Promise<number> {
  for (let p = start; p < start + 200; p++) {
    try {
      const s = await listenOn(p, (_req, res) => res.end("ok"));
      await closeServer(s);
      return p;
    } catch {}
  }
  throw new Error("No free port found");
}

describe("Critical Production Bug Fix — Image Intelligence & Browser Verification Suite", () => {
  let browser: Browser;

  test.before(async () => {
    browser = await chromium.launch({ headless: true });
  });

  test.after(async () => {
    if (browser) await browser.close();
  });

  // TEST 1: Exact Automotive Production Task Verification
  test("Automotive: Ajmeer Luxury Automobiles renders real photography with zero broken images and zero mobile overflow", async () => {
    const prompt = "Create a premium luxury automotive website for Ajmeer Luxury Automobiles featuring real sports cars, premium vehicle photography, a vehicle collection gallery, specifications, and a test-drive enquiry section. Use a black and gold luxury design.";
    
    // 1. Brief & Design Spec
    const productType = analyseTaskBrief(prompt);
    assert.equal(productType, "automotive", "Must detect automotive product type");
    const spec = generateDesignSpec(prompt);
    assert.equal(spec.productType, "automotive");
    assert.equal(spec.direction, "luxury_brand");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ajmeer-auto-test-"));
    const ws = new Workspace(tmpDir);

    try {
      // 2. Scaffold Static Automotive Project
      const scaffoldRes = await scaffoldStaticProject(ws, "ajmeer-luxury-automobiles", spec);
      assert.equal(scaffoldRes.success, true, "Scaffold must succeed");

      // Verify files created
      assert.ok(fs.existsSync(path.join(tmpDir, "index.html")), "index.html must exist");
      assert.ok(fs.existsSync(path.join(tmpDir, "styles.css")), "styles.css must exist");
      assert.ok(fs.existsSync(path.join(tmpDir, "script.js")), "script.js must exist");
      assert.ok(fs.existsSync(path.join(tmpDir, "image-manifest.json")), "image-manifest.json must exist");

      // Verify provisioned images on disk
      assert.ok(fs.existsSync(path.join(tmpDir, "images", "hero-car.jpg")), "hero-car.jpg must exist on disk");
      assert.ok(fs.existsSync(path.join(tmpDir, "images", "front-car.jpg")), "front-car.jpg must exist on disk");
      assert.ok(fs.existsSync(path.join(tmpDir, "images", "cockpit-car.jpg")), "cockpit-car.jpg must exist on disk");
      assert.ok(fs.existsSync(path.join(tmpDir, "images", "rear-car.jpg")), "rear-car.jpg must exist on disk");

      // Verify public/ mirroring
      assert.ok(fs.existsSync(path.join(tmpDir, "public", "images", "hero-car.jpg")), "public/images/hero-car.jpg must be mirrored");

      // Verify manifest content
      const manifest: ImageAssetManifest = JSON.parse(fs.readFileSync(path.join(tmpDir, "image-manifest.json"), "utf8"));
      assert.equal(manifest.industry, "automotive");
      assert.ok(manifest.assets.length >= 4, "Must have at least 4 provisioned vehicle photography assets");
      for (const asset of manifest.assets) {
        assert.equal(asset.validationStatus, "verified");
        assert.ok(asset.width > 0 && asset.height > 0);
      }

      // 3. Serve with Static Server
      const port = await findFreePort();
      const server = await listenOn(port, (req, res) => {
        const rawPath = decodeURIComponent(String(req.url || "/").split("?")[0]);
        let filePath = path.join(tmpDir, rawPath === "/" ? "index.html" : rawPath);
        if (!fs.existsSync(filePath)) {
          const publicPath = path.join(tmpDir, "public", rawPath);
          if (fs.existsSync(publicPath)) filePath = publicPath;
        }

        if (!fs.existsSync(filePath)) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const types: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".js": "application/javascript; charset=utf-8",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".webp": "image/webp",
          ".json": "application/json",
        };
        const body = fs.readFileSync(filePath);
        res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Content-Length": body.length });
        res.end(body);
      });

      const baseUrl = `http://localhost:${port}`;
      const page = await browser.newPage();
      const failedRequests: string[] = [];
      const consoleErrors: string[] = [];

      page.on("requestfailed", req => failedRequests.push(`${req.url()}: ${req.failure()?.errorText}`));
      page.on("response", res => {
        if (res.status() >= 400) failedRequests.push(`${res.url()}: HTTP ${res.status()}`);
      });
      page.on("console", msg => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });

      // 4. Desktop Viewport Inspection (1280x800)
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(baseUrl, { waitUntil: "networkidle" });

      // Inspect images in browser
      const imageElements = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll("img"));
        return imgs.map(img => ({
          src: img.src,
          currentSrc: img.currentSrc,
          alt: img.alt,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          complete: img.complete,
          displayedWidth: img.getBoundingClientRect().width,
          displayedHeight: img.getBoundingClientRect().height,
        }));
      });

      assert.ok(imageElements.length >= 4, `Must render at least 4 vehicle images, got ${imageElements.length}`);
      console.log(`  ✓ Found ${imageElements.length} image elements on rendered page`);

      for (const img of imageElements) {
        assert.ok(img.complete, `Image ${img.src} must be complete`);
        assert.ok(img.naturalWidth > 0, `Image ${img.src} must have naturalWidth > 0 (got ${img.naturalWidth})`);
        assert.ok(img.naturalHeight > 0, `Image ${img.src} must have naturalHeight > 0 (got ${img.naturalHeight})`);
        assert.ok(img.displayedWidth > 0 && img.displayedHeight > 0, `Image ${img.src} must have non-zero rendered box`);
        assert.ok(!/model\s*[1-9]|placeholder/i.test(img.alt), `Image alt must not be placeholder: got '${img.alt}'`);
        console.log(`    • Rendered: "${img.alt}" -> ${img.naturalWidth}x${img.naturalHeight}px (display: ${Math.round(img.displayedWidth)}x${Math.round(img.displayedHeight)}px)`);
      }

      // Check zero failed requests & zero console errors
      assert.equal(failedRequests.length, 0, `Must have zero failed requests, got: ${JSON.stringify(failedRequests)}`);
      assert.equal(consoleErrors.length, 0, `Must have zero console errors, got: ${JSON.stringify(consoleErrors)}`);

      // 5. Test Multiple Mobile Viewports (Zero horizontal overflow)
      const mobileViewports = [
        { width: 320, height: 568, name: "320px (iPhone SE 1st gen)" },
        { width: 375, height: 667, name: "375px (iPhone SE 2nd gen)" },
        { width: 390, height: 844, name: "390px (iPhone 12/13/14)" },
        { width: 768, height: 1024, name: "768px (iPad Portrait)" },
        { width: 1280, height: 800, name: "1280px (Desktop / Laptop)" }
      ];

      for (const vp of mobileViewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(100);
        const overflow = await page.evaluate(() => {
          return {
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            hasOverflow: document.documentElement.scrollWidth > window.innerWidth,
          };
        });
        assert.equal(overflow.hasOverflow, false, `Viewport ${vp.name} must have zero horizontal overflow: scrollWidth=${overflow.scrollWidth}, innerWidth=${overflow.innerWidth}`);
        console.log(`  ✓ Viewport ${vp.name}: scrollWidth=${overflow.scrollWidth} <= innerWidth=${overflow.innerWidth}`);
      }

      // 6. Test Mobile Menu Interaction
      await page.setViewportSize({ width: 375, height: 667 });
      const navToggle = page.locator("#navToggle");
      assert.ok(await navToggle.isVisible(), "Mobile nav toggle button must be visible on 375px");
      await navToggle.click();
      const navLinks = page.locator("#navLinks");
      assert.ok(await navLinks.isVisible(), "Nav links drawer must open when clicking hamburger button");
      await navToggle.click();
      assert.ok(!(await navLinks.isVisible()), "Nav links drawer must close on second toggle click");
      console.log("  ✓ Mobile hamburger toggle and drawer verified");

      // 7. Test Drive Form Interaction
      const submitBtn = page.locator("#submit-btn");
      await submitBtn.click();
      const feedback = page.locator("#form-feedback");
      assert.ok(await feedback.isVisible(), "Validation feedback must appear on empty submit");
      await page.locator("#name").fill("Prince Ajmeer");
      await page.locator("#email").fill("ajmeer@luxury.com");
      await page.locator("#message").fill("Interested in private track demonstration of the GT Coupe.");
      await submitBtn.click();
      const feedbackText = await feedback.textContent();
      assert.match(feedbackText || "", /thank you|received/i, "Must show successful submission confirmation");
      console.log("  ✓ Test-drive enquiry form interaction verified");

      await page.close();
      await closeServer(server);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // TEST 2: Multi-Industry Photographic Asset Verification
  test("Multi-Industry: Real Estate, Restaurant, Luxury Brand, SaaS, Ecommerce provision genuine images", async () => {
    const industries = [
      { productType: "real_estate", task: "Luxury Beverly Hills Architectural Villa with infinity pool and modern kitchen", requiredTerms: ["villa", "kitchen", "living"] },
      { productType: "restaurant_hospitality", task: "Artisanal fine dining bistro with Michelin-starred culinary dishes and master chef", requiredTerms: ["restaurant", "dish", "chef"] },
      { productType: "luxury_fashion", task: "Haute horlogerie Swiss chronometer luxury timepiece brand", requiredTerms: ["timepiece", "watch"] },
      { productType: "ecommerce", task: "High-end tech accessories store with acoustic headphones and mechanical keyboard", requiredTerms: ["headphones", "keyboard"] },
      { productType: "saas_app", task: "Modern cloud analytics SaaS platform for software engineers", requiredTerms: ["workspace", "office"] },
    ];

    for (const ind of industries) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `ind-test-${ind.productType}-`));
      try {
        const manifest = await provisionVisualAssets(tmpDir, ind.productType, ind.task);
        assert.ok(manifest.assets.length >= 2, `Industry ${ind.productType} must provision at least 2 assets`);
        for (const asset of manifest.assets) {
          assert.equal(asset.validationStatus, "verified", `Asset ${asset.subject} must be verified`);
          const fullPath = path.join(tmpDir, asset.localPath);
          assert.ok(fs.existsSync(fullPath), `Asset file ${asset.localPath} must exist on disk`);
          const stat = fs.statSync(fullPath);
          assert.ok(stat.size > 1000, `Asset file ${asset.localPath} must be > 1000 bytes (got ${stat.size})`);
        }
        console.log(`  ✓ Industry '${ind.productType}': ${manifest.assets.length} assets verified on disk`);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });

  // TEST 3: Automatic Image Repair Loop
  test("Automatic Image Repair Loop: Repairs broken image reference and updates HTML with verified asset", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repair-test-"));
    try {
      const htmlWithBrokenImg = `<!DOCTYPE html>
<html>
<head><title>Car Showcase</title></head>
<body>
  <h1>Ajmeer Luxury Automobiles</h1>
  <img id="car1" src="/images/broken-fake-car.jpg" alt="Black high-performance sports car coupe" />
</body>
</html>`;
      fs.writeFileSync(path.join(tmpDir, "index.html"), htmlWithBrokenImg, "utf8");

      // Execute repair loop
      const repairRes = await repairBrokenImage(
        tmpDir,
        "/images/broken-fake-car.jpg",
        "Black high-performance sports car coupe",
        "automotive luxury sports car"
      );

      assert.equal(repairRes.success, true, `Repair must succeed: ${repairRes.error}`);
      assert.ok(repairRes.newSrc, "Repair must return new verified src");

      // Verify file exists on disk
      const newFilePath = path.join(tmpDir, repairRes.newSrc);
      assert.ok(fs.existsSync(newFilePath), `Repaired image file must exist: ${newFilePath}`);
      const stat = fs.statSync(newFilePath);
      assert.ok(stat.size > 1000, `Repaired image must be valid size: ${stat.size} bytes`);

      // Verify HTML was updated
      const updatedHtml = fs.readFileSync(path.join(tmpDir, "index.html"), "utf8");
      assert.ok(!updatedHtml.includes("/images/broken-fake-car.jpg"), "HTML must not contain broken image path");
      assert.ok(updatedHtml.includes(repairRes.newSrc), "HTML must contain repaired image path");

      console.log(`  ✓ Auto-repair successfully replaced broken image with '${repairRes.newSrc}' (${stat.size} bytes)`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // TEST 4: BrowserSession verifyImageRendering integration
  test("BrowserSession: verifyImageRendering detects broken images and validates healthy images", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-verify-test-"));
    try {
      // 1. Provision a real asset
      const manifest = await provisionVisualAssets(tmpDir, "automotive", "luxury sports car");
      const realAsset = manifest.assets[0];

      // Create an HTML page with 1 real image and 1 broken image
      const testHtml = `<!DOCTYPE html>
<html>
<head><title>Image Test</title></head>
<body>
  <h1>Test Page</h1>
  <img id="goodImg" src="${realAsset.localPath}" alt="Real automotive photography" style="display:block;width:300px;height:200px;" />
  <img id="badImg" src="images/does-not-exist.jpg" alt="Broken non-existent image" style="display:block;width:300px;height:200px;" />
</body>
</html>`;
      fs.writeFileSync(path.join(tmpDir, "index.html"), testHtml, "utf8");

      const port = await findFreePort();
      const server = await listenOn(port, (req, res) => {
        const rawPath = decodeURIComponent(String(req.url || "/").split("?")[0]);
        const filePath = path.join(tmpDir, rawPath === "/" ? "index.html" : rawPath);
        if (!fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }
        res.writeHead(200, { "Content-Type": filePath.endsWith(".html") ? "text/html" : "image/jpeg" });
        res.end(fs.readFileSync(filePath));
      });

      const session = new BrowserSession();
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      const verification = await session.verifyImageRendering();
      assert.equal(verification.passed, false, "Must detect broken image");
      assert.equal(verification.total, 2, "Must count 2 total images");
      assert.equal(verification.loaded, 1, "Must report 1 successfully loaded image");
      assert.equal(verification.broken.length, 1, "Must report 1 broken image");
      assert.ok(verification.broken[0].src.includes("does-not-exist.jpg"), "Must identify the exact broken src");

      console.log(`  ✓ BrowserSession correctly detected broken image '${verification.broken[0].src}' while validating good image`);

      await session.close();
      await closeServer(server);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
