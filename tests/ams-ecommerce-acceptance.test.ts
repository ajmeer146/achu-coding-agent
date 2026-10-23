import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BrowserSession } from "../src/browser/browser-session.js";
import { Workspace } from "../src/tools/workspace.js";
import { scaffoldStaticProject } from "../src/tools/scaffold.js";
import { generateDesignSpec } from "../src/tools/design-planner.js";
import { runVerificationSuite, verifyInputExists } from "../src/browser/browser-verification.js";

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

async function findFreePort(start = 52500): Promise<number> {
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

describe("AMS E-Commerce Storefront Acceptance & Verification Suite", () => {
  test("Complete AMS E-Commerce lifecycle: scaffolding, multi-viewport layout, functional search, cart, demo checkout, and fresh reload", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-ams-test-"));
    const workspace = new Workspace(tempDir);
    const spec = generateDesignSpec("create a responsive e-commerce store with search, filters, sorting, cart, and checkout");
    assert.equal(spec.productType, "ecommerce", "Spec must identify as ecommerce archetype");

    // 1. Scaffold static e-commerce project
    const scaffoldRes = await scaffoldStaticProject(workspace, "ams-store", spec);
    assert.equal(scaffoldRes.success, true, `Scaffolding must succeed: ${scaffoldRes.error}`);
    assert.ok(await workspace.exists("index.html"), "index.html must exist");
    assert.ok(await workspace.exists("styles.css"), "styles.css must exist");
    assert.ok(await workspace.exists("script.js"), "script.js must exist");

    const htmlContent = await workspace.read("index.html");
    const cssContent = await workspace.read("styles.css");
    const jsContent = await workspace.read("script.js");

    assert.ok(htmlContent.includes('type="search"'), "Must contain a real HTML search input");
    assert.ok(htmlContent.includes('id="cartBtn"'), "Must contain a cart button");
    assert.ok(htmlContent.includes('id="cartDrawer"'), "Must contain a cart drawer");
    assert.ok(htmlContent.includes('id="checkoutModal"'), "Must contain a demo checkout modal");
    assert.ok(cssContent.includes("@media (max-width: 480px)"), "CSS must contain small mobile media query");
    assert.ok(cssContent.includes(".hero-actions"), "CSS must contain hero actions styles");

    // 2. Start HTTP server serving the generated storefront
    const port = await findFreePort();
    const server = await listenOn(port, (req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      if (urlPath === "/" || urlPath === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(htmlContent);
      } else if (urlPath === "/styles.css") {
        res.writeHead(200, { "Content-Type": "text/css" });
        res.end(cssContent);
      } else if (urlPath === "/script.js") {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(jsContent);
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      const appUrl = `http://localhost:${port}`;
      const nav = await session.navigate(appUrl);
      assert.equal(nav.success, true, `Navigation must succeed: ${nav.error}`);

      const page = session.getPage()!;
      assert.ok(page, "Browser page must be active");

      // 3. Multi-viewport verification across ALL 4 required viewports:
      // 320x568, 375x667, 768x1024, 1366x768
      const viewports = [
        { name: "320x568 (Small Mobile)", width: 320, height: 568 },
        { name: "375x667 (Standard Mobile)", width: 375, height: 667 },
        { name: "768x1024 (Tablet)", width: 768, height: 1024 },
        { name: "1366x768 (Desktop)", width: 1366, height: 768 },
      ];

      for (const vp of viewports) {
        const layoutRes = await session.analyzeLayout({ width: vp.width, height: vp.height });
        assert.equal(layoutRes.success, true, `analyzeLayout must succeed at ${vp.name}`);
        if (layoutRes.success) {
          const criticalDefects = layoutRes.analysis.defects.filter(d => d.severity === "critical");
          const overflow = layoutRes.analysis.defects.find(d => d.type === "horizontal_overflow");
          const clipped = layoutRes.analysis.defects.filter(d => d.type === "clipped_interactive");

          assert.equal(
            layoutRes.analysis.horizontalOverflow,
            false,
            `Viewport ${vp.name} must have zero horizontal overflow. Reported: ${overflow?.message ?? ""}`
          );
          assert.equal(
            clipped.length,
            0,
            `Viewport ${vp.name} must have zero clipped interactive elements. Clipped: ${clipped.map(c => c.message).join("; ")}`
          );
          assert.equal(
            criticalDefects.length,
            0,
            `Viewport ${vp.name} must have zero critical layout defects. Found: ${criticalDefects.map(d => d.message).join("; ")}`
          );
        }

        // Programmatically inspect hero buttons bounding rects at each viewport
        const heroButtons = await page.locator(".hero-actions .btn").all();
        assert.ok(heroButtons.length >= 2, "Hero must contain at least 2 CTA buttons");
        for (const btn of heroButtons) {
          const box = await btn.boundingBox();
          assert.ok(box, "Hero button must have a bounding box");
          assert.ok(
            box!.x + box!.width <= vp.width + 2,
            `Hero button right edge (${Math.round(box!.x + box!.width)}px) must not exceed viewport width (${vp.width}px) at ${vp.name}`
          );
          assert.ok(box!.x >= -2, `Hero button left edge must not be off-screen to the left at ${vp.name}`);
        }
      }

      // 4. Verifier tests: Accessible search input detection
      await session.setViewport({ width: 1366, height: 768 });
      const searchVerification = await verifyInputExists(session, {
        selector: 'input[type="search"], input[placeholder*="search" i], input[name*="search" i], #search, .search-input',
      });
      assert.equal(searchVerification.passed, true, `Accessible search input must pass verification: ${searchVerification.error}`);

      const semanticSearchVer = await verifyInputExists(session, { inputType: "search" });
      assert.equal(semanticSearchVer.passed, true, `Semantic search input must pass verification: ${semanticSearchVer.error}`);

      // 5. Verification suite
      const suiteSummary = await runVerificationSuite(session, appUrl, [
        { type: "heading", text: "Ams Store" },
        { type: "input", selector: 'input[type="search"]', required: true },
        { type: "button", text: "Cart", required: true },
        { type: "button", text: "Shop Now", required: true },
      ]);
      assert.equal(suiteSummary.overallPassed, true, `Full verification suite must pass`);

      // 6. Real functional DOM testing: Catalog Products
      const productCards = await page.locator(".product-card").all();
      assert.equal(productCards.length, 8, "Storefront must render 8 initial products");

      // Verify each product has real SVG illustration
      const productSvgs = await page.locator(".product-card svg").all();
      assert.equal(productSvgs.length, 8, "Every product card must have an inline SVG illustration");

      // 7. Case-insensitive search interaction & No-Results state
      const searchBox = page.locator("#searchInput");
      await searchBox.fill("headphones");
      await page.waitForTimeout(100);
      let filteredCards = await page.locator(".product-card:visible").all();
      assert.equal(filteredCards.length, 1, "Searching for 'headphones' must filter to 1 product");

      // Nonexistent search query -> No Results empty state
      await searchBox.fill("NonexistentXYZItem");
      await page.waitForTimeout(100);
      filteredCards = await page.locator(".product-card:visible").all();
      assert.equal(filteredCards.length, 0, "Nonexistent query must filter out all products");
      const noResultsVisible = await page.locator("#noResults").isVisible();
      assert.equal(noResultsVisible, true, "No results message must be visible");

      // Reset filters button
      await page.locator("#resetFiltersBtn").click();
      await page.waitForTimeout(100);
      filteredCards = await page.locator(".product-card:visible").all();
      assert.equal(filteredCards.length, 8, "Reset filters must restore all 8 products");

      // 8. Category filter interaction
      await page.locator('.filter-btn[data-category="electronics"]').click();
      await page.waitForTimeout(100);
      const electronicsCards = await page.locator(".product-card:visible").all();
      assert.equal(electronicsCards.length, 3, "Electronics category must filter to 3 products");

      await page.locator('.filter-btn[data-category="all"]').click();
      await page.waitForTimeout(100);
      assert.equal((await page.locator(".product-card:visible").all()).length, 8);

      // 9. Sorting interaction
      await page.locator("#sortSelect").selectOption("price-low");
      await page.waitForTimeout(100);
      const firstPriceText = await page.locator(".product-card:visible .product-price").first().textContent();
      assert.equal(firstPriceText?.trim(), "$34.99", "Lowest price product must be first when sorted price-low");

      // 10. Add to Cart & Cart Drawer interactions
      const initialBadge = await page.locator("#cartCount").textContent();
      assert.equal(initialBadge?.trim(), "0");

      // Click Add to Cart on first product
      await page.locator(".product-card:visible .btn-add-to-cart").first().click();
      await page.waitForTimeout(200);

      const updatedBadge = await page.locator("#cartCount").textContent();
      assert.equal(updatedBadge?.trim(), "1", "Cart badge must increment to 1");

      const drawerIsOpen = await page.locator("#cartDrawer").evaluate(el => el.classList.contains("open"));
      assert.equal(drawerIsOpen, true, "Cart drawer must open after adding item");

      // Quantity increment in drawer
      await page.locator("#cartDrawer .inc-btn").first().click();
      await page.waitForTimeout(100);
      const qtyText = await page.locator("#cartDrawer .qty-val").first().textContent();
      assert.equal(qtyText?.trim(), "2", "Quantity must increment to 2");

      const subtotalText = await page.locator("#subtotalPrice").textContent();
      assert.equal(subtotalText?.trim(), "$69.98", "Subtotal must update correctly (34.99 * 2 = 69.98)");

      // 11. Simulated Checkout modal
      await page.locator("#checkoutBtn").click();
      await page.waitForTimeout(200);

      const modalIsVisible = await page.locator("#checkoutModal").isVisible();
      assert.equal(modalIsVisible, true, "Checkout modal must open");

      const demoBannerText = await page.locator(".demo-banner").textContent();
      assert.ok(demoBannerText?.includes("Simulated Checkout"), "Modal must clearly state simulated demo status");

      // Submit checkout form
      await page.locator("#shippingName").fill("Jordan Smith");
      await page.locator("#shippingEmail").fill("jordan@example.com");
      await page.locator("#shippingAddress").fill("456 Mission Blvd");
      await page.locator("#shippingCity").fill("Oakland");
      await page.locator("#shippingZip").fill("94607");
      await page.locator("#placeOrderBtn").click();
      await page.waitForTimeout(200);

      const orderConfirmVisible = await page.locator("#orderConfirmation").isVisible();
      assert.equal(orderConfirmVisible, true, "Order confirmation must be displayed");

      const orderRef = await page.locator("#orderNumber").textContent();
      assert.match(orderRef?.trim() ?? "", /^#ORD-\d+$/, "Must generate an order reference like #ORD-12345");

      // 12. Fresh reload verification: verify state persistence and clean reload
      await page.locator("#returnToStoreBtn").click();
      await page.waitForTimeout(100);

      // Add one item so cart has content
      await page.locator(".product-card:visible .btn-add-to-cart").first().click();
      await page.waitForTimeout(100);
      assert.equal((await page.locator("#cartCount").textContent())?.trim(), "1");

      // Reload page freshly
      await page.reload({ waitUntil: "networkidle" });
      const reloadedBadge = await page.locator("#cartCount").textContent();
      assert.equal(reloadedBadge?.trim(), "1", "Cart item count must survive fresh page reload via localStorage");

      const reloadedCards = await page.locator(".product-card").all();
      assert.equal(reloadedCards.length, 8, "All 8 product cards must remain after reload");
    } finally {
      await session.close();
      await closeServer(server);
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  test("Regression: Broken product images are detected as critical defects and FAIL browser verification instead of falsely passing", async () => {
    const port = await findFreePort();
    const brokenHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Store with Broken Image</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #fff; }
    .navbar { padding: 1rem; }
    .product-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; padding: 1rem; }
    .card { background: #1e293b; padding: 1rem; border-radius: 8px; }
    img { width: 100%; height: 160px; object-fit: cover; }
  </style>
</head>
<body>
  <header class="navbar"><h1>Store</h1></header>
  <main class="product-grid">
    <div class="card">
      <img src="http://localhost:${port}/nonexistent-product-image.jpg" alt="Broken Product">
      <h3>Premium Headphones</h3>
    </div>
  </main>
</body>
</html>`;

    const server = await listenOn(port, (req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      if (urlPath === "/" || urlPath === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(brokenHtml);
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      const appUrl = `http://localhost:${port}`;
      await session.navigate(appUrl);

      // 1. inspectPage must detect broken image in qualityIssues
      const inspectRes = await session.inspectPage();
      assert.equal(inspectRes.success, true);
      if (inspectRes.success) {
        const brokenIssue = inspectRes.info.qualityIssues?.find(q => q.toLowerCase().includes("broken image") || q.toLowerCase().includes("failed to load"));
        assert.ok(brokenIssue, `inspectPage must detect broken image in qualityIssues: ${JSON.stringify(inspectRes.info.qualityIssues)}`);
      }

      // 2. analyzeLayout must report broken_image as critical defect
      const layoutRes = await session.analyzeLayout("desktop");
      assert.equal(layoutRes.success, true);
      if (layoutRes.success) {
        const brokenDefect = layoutRes.analysis.defects.find(d => d.type === "broken_image");
        assert.ok(brokenDefect, `analyzeLayout must report broken_image defect: ${JSON.stringify(layoutRes.analysis.defects)}`);
        assert.equal(brokenDefect!.severity, "critical", "broken_image must have critical severity");
      }

      // 3. runVerificationSuite must FAIL overall verification
      const summary = await runVerificationSuite(session, appUrl, []);
      assert.equal(summary.overallPassed, false, "Verification must FAIL when page contains broken images");
      const imgCheck = summary.results.find(r => r.target.text?.includes("Image asset rendering") || r.target.text?.includes("Asset loading"));
      assert.ok(imgCheck, `Must report image asset failure: ${JSON.stringify(summary.results)}`);
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("Regression: Unintended vertical bulleted navigation in header is detected as critical defect and FAILS browser verification", async () => {
    const port = await findFreePort();
    const unstyledNavHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Store with Vertical Nav</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #fff; }
    header.navbar { padding: 1rem; }
    .hero-section { padding: 2rem; }
  </style>
</head>
<body>
  <header class="navbar">
    <nav class="nav-links">
      <ul>
        <li><a href="#catalog">Catalog</a></li>
        <li><a href="#about">About</a></li>
        <li><a href="#contact">Contact</a></li>
      </ul>
    </nav>
  </header>
  <main>
    <section class="hero-section"><h1>Store Title</h1></section>
  </main>
</body>
</html>`;

    const server = await listenOn(port, (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(unstyledNavHtml);
    });

    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      const appUrl = `http://localhost:${port}`;
      await session.navigate(appUrl);

      const layoutRes = await session.analyzeLayout({ width: 1280, height: 800 });
      assert.equal(layoutRes.success, true);
      if (layoutRes.success) {
        const navDefect = layoutRes.analysis.defects.find(d => d.type === "bulleted_navigation" || d.type === "vertical_navigation_list");
        assert.ok(navDefect, `analyzeLayout must report bulleted_navigation or vertical_navigation_list: ${JSON.stringify(layoutRes.analysis.defects)}`);
        assert.equal(navDefect!.severity, "critical", "Nav layout defect must have critical severity");
      }
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("Regression: Collapsed hero visual container is detected as critical layout defect", async () => {
    const port = await findFreePort();
    const collapsedHeroHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Store with Collapsed Hero</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #fff; }
    .hero-section { display: grid; grid-template-columns: 1fr 1fr; padding: 2rem; }
    .hero-visual { width: 300px; height: 0px; overflow: hidden; }
  </style>
</head>
<body>
  <header><nav><a href="#">Home</a></nav></header>
  <main>
    <section class="hero-section">
      <div class="hero-content"><h1>Welcome to AMS</h1><p>Gadgets and Tech</p></div>
      <div class="hero-visual"></div>
    </section>
  </main>
</body>
</html>`;

    const server = await listenOn(port, (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(collapsedHeroHtml);
    });

    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      const appUrl = `http://localhost:${port}`;
      await session.navigate(appUrl);

      const layoutRes = await session.analyzeLayout({ width: 1280, height: 800 });
      assert.equal(layoutRes.success, true);
      if (layoutRes.success) {
        const heroDefect = layoutRes.analysis.defects.find(d => d.type === "collapsed_hero_visual");
        assert.ok(heroDefect, `analyzeLayout must report collapsed_hero_visual: ${JSON.stringify(layoutRes.analysis.defects)}`);
        assert.equal(heroDefect!.severity, "critical", "collapsed_hero_visual must have critical severity");
      }
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("Regression: Enhanced AMS Storefront renders flagship hero visual and passes all viewports with zero critical defects", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-ams-enhanced-"));
    const workspace = new Workspace(tempDir);
    const spec = generateDesignSpec("build a modern ecommerce website named AMS for premium electronics and gadgets");

    const scaffoldRes = await scaffoldStaticProject(workspace, "AMS", spec);
    assert.equal(scaffoldRes.success, true);

    const htmlContent = await workspace.read("index.html");
    const cssContent = await workspace.read("styles.css");
    const jsContent = await workspace.read("script.js");

    assert.ok(htmlContent.includes("hero-showcase-card"), "Must include hero showcase card");
    assert.ok(htmlContent.includes("hero-flagship-svg"), "Must include hero flagship SVG");
    assert.ok(htmlContent.includes("hero-trust-chips"), "Must include trust chips in hero");
    assert.ok(cssContent.includes(".hero-grid"), "Must include responsive hero grid styles");
    assert.ok(cssContent.includes(".hero-showcase-card"), "Must include showcase card styling");

    const port = await findFreePort();
    const server = await listenOn(port, (req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      if (urlPath === "/" || urlPath === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(htmlContent);
      } else if (urlPath === "/styles.css") {
        res.writeHead(200, { "Content-Type": "text/css" });
        res.end(cssContent);
      } else if (urlPath === "/script.js") {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(jsContent);
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      const appUrl = `http://localhost:${port}`;
      await session.navigate(appUrl);
      const page = session.getPage()!;

      // Viewport test across 320px, 375px, 768px, 1024px, 1366px
      const viewports = [
        { width: 320, height: 568 },
        { width: 375, height: 667 },
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
        { width: 1366, height: 768 },
      ];

      for (const vp of viewports) {
        const layoutRes = await session.analyzeLayout(vp);
        assert.equal(layoutRes.success, true);
        if (layoutRes.success) {
          const criticals = layoutRes.analysis.defects.filter(d => d.severity === "critical");
          assert.equal(criticals.length, 0, `Viewport ${vp.width}x${vp.height} must have zero critical layout defects. Found: ${criticals.map(d => d.message).join("; ")}`);
        }
      }

      // Check hero showcase is rendered and visible
      const heroSvg = page.locator(".hero-flagship-svg");
      assert.ok(await heroSvg.isVisible(), "Hero flagship SVG must be visible");
      const heroSvgBox = await heroSvg.boundingBox();
      assert.ok(heroSvgBox && heroSvgBox.width > 50 && heroSvgBox.height > 50, "Hero SVG must have substantial dimensions");

      // Verify all product cards have valid visuals
      const productVisuals = await page.locator(".product-visual svg").all();
      assert.equal(productVisuals.length, 8, "All 8 products must have valid inline SVG illustrations");

      // Run verification suite
      const summary = await runVerificationSuite(session, appUrl, [
        { type: "heading", text: "AMS" },
        { type: "input", selector: 'input[type="search"]', required: true },
        { type: "button", text: "Cart", required: true },
        { type: "button", text: "Shop Now", required: true },
        { type: "section", selector: "#catalog", required: true },
      ]);
      assert.equal(summary.overallPassed, true, `AMS Storefront must pass verification: ${summary.results.filter(r => !r.passed).map(r => r.error).join("; ")}`);
    } finally {
      await session.close();
      await closeServer(server);
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
});
