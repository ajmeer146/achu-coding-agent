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
});
