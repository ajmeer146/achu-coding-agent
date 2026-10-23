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
import { runVerificationSuite } from "../src/browser/browser-verification.js";
import { evaluateWebsiteQuality } from "../src/quality/website-design-guide.js";

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

async function findFreePort(start = 53800): Promise<number> {
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

describe("Master Engineering Directive Acceptance Suite", () => {
  test("1. AMS E-Commerce flagship storefront satisfies all 5 directive viewports with zero critical defects", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-master-ams-"));
    const workspace = new Workspace(tempDir);
    const spec = generateDesignSpec("build a modern ecommerce website named AMS for premium electronics and gadgets");
    assert.equal(spec.productType, "ecommerce");

    const scaffoldRes = await scaffoldStaticProject(workspace, "AMS", spec);
    assert.equal(scaffoldRes.success, true);

    const html = await workspace.read("index.html");
    const css = await workspace.read("styles.css");
    const js = await workspace.read("script.js");

    // Structural elements
    assert.ok(html.includes('class="navbar"'), "Must include navbar");
    assert.ok(html.includes('class="hero-grid"'), "Must include hero-grid");
    assert.ok(html.includes('class="hero-showcase-card"'), "Must include hero showcase card");
    assert.ok(html.includes('class="hero-flagship-svg"'), "Must include hero flagship SVG");
    assert.ok(html.includes('id="productGrid"'), "Must include productGrid");
    assert.ok(html.includes('id="cartDrawer"'), "Must include cart drawer");
    assert.ok(html.includes('id="checkoutModal"'), "Must include demo checkout modal");

    const port = await findFreePort();
    const server = await listenOn(port, (req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      if (urlPath === "/" || urlPath === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      } else if (urlPath === "/styles.css") {
        res.writeHead(200, { "Content-Type": "text/css" });
        res.end(css);
      } else if (urlPath === "/script.js") {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(js);
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

      // Verify all 5 directive viewports:
      // 320x568, 375x667, 768x1024, 1024x768, 1366x768
      const viewports = [
        { name: "320x568 (Small Mobile)", width: 320, height: 568 },
        { name: "375x667 (Standard Mobile)", width: 375, height: 667 },
        { name: "768x1024 (Tablet Portrait)", width: 768, height: 1024 },
        { name: "1024x768 (Tablet Landscape / Small Desktop)", width: 1024, height: 768 },
        { name: "1366x768 (Standard Desktop)", width: 1366, height: 768 },
      ];

      for (const vp of viewports) {
        const layoutRes = await session.analyzeLayout({ width: vp.width, height: vp.height });
        assert.equal(layoutRes.success, true);
        if (layoutRes.success) {
          const criticalDefects = layoutRes.analysis.defects.filter(d => d.severity === "critical");
          assert.equal(
            criticalDefects.length,
            0,
            `Viewport ${vp.name} must have zero critical layout defects. Found: ${criticalDefects.map(d => d.message).join("; ")}`
          );
        }
      }

      // Functional verification: Search, Filter, Sort, Cart, Drawer, Checkout, Persistence
      // 1. Search
      const searchInput = page.locator("#searchInput");
      await searchInput.fill("keyboard");
      await page.waitForTimeout(100);
      let visibleCards = await page.locator(".product-card:visible").all();
      assert.equal(visibleCards.length, 1, "Searching for 'keyboard' must show 1 product");

      await searchInput.fill("");
      await page.waitForTimeout(100);

      // 2. Add to cart
      const cartCount = page.locator("#cartCount");
      assert.equal((await cartCount.textContent())?.trim(), "0");

      await page.locator(".product-card:visible .btn-add-to-cart").first().click();
      await page.waitForTimeout(200);
      assert.equal((await cartCount.textContent())?.trim(), "1");

      // 3. Cart drawer open
      const drawerIsOpen = await page.locator("#cartDrawer").evaluate(el => el.classList.contains("open"));
      assert.equal(drawerIsOpen, true, "Cart drawer must open automatically");

      // 4. Quantity increment
      await page.locator("#cartDrawer .inc-btn").first().click();
      await page.waitForTimeout(100);
      const qtyText = await page.locator("#cartDrawer .qty-val").first().textContent();
      assert.equal(qtyText?.trim(), "2");

      // 5. Checkout demo modal
      await page.locator("#checkoutBtn").click();
      await page.waitForTimeout(200);
      assert.equal(await page.locator("#checkoutModal").isVisible(), true);

      // 6. Complete demo order
      await page.locator("#shippingName").fill("Alex Taylor");
      await page.locator("#shippingEmail").fill("alex@example.com");
      await page.locator("#shippingAddress").fill("100 Innovation Way");
      await page.locator("#shippingCity").fill("San Francisco");
      await page.locator("#shippingZip").fill("94105");
      await page.locator("#placeOrderBtn").click();
      await page.waitForTimeout(200);

      assert.equal(await page.locator("#orderConfirmation").isVisible(), true);
      const orderNum = await page.locator("#orderNumber").textContent();
      assert.match(orderNum?.trim() ?? "", /^#ORD-\d+$/);

      // 7. Fresh reload state persistence
      await page.locator("#returnToStoreBtn").click();
      await page.waitForTimeout(100);
      await page.locator(".product-card:visible .btn-add-to-cart").first().click();
      await page.waitForTimeout(100);
      assert.equal((await cartCount.textContent())?.trim(), "1");

      await page.reload({ waitUntil: "networkidle" });
      assert.equal((await page.locator("#cartCount").textContent())?.trim(), "1", "Cart items must persist after reload");

      // Verification suite passes
      const summary = await runVerificationSuite(session, appUrl, [
        { type: "heading", text: "AMS" },
        { type: "input", selector: 'input[type="search"]', required: true },
        { type: "button", text: "Cart", required: true },
        { type: "button", text: "Shop Now", required: true },
        { type: "section", selector: "#catalog", required: true },
      ]);
      assert.equal(summary.overallPassed, true);
    } finally {
      await session.close();
      await closeServer(server);
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  test("2. Verification hardening rejects broken assets, vertical nav lists, and collapsed hero visuals", async () => {
    const port = await findFreePort();
    // HTML with all 3 defects simultaneously: broken image, unstyled vertical list nav, and collapsed hero visual
    const defectHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Defective Store</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #fff; }
    header.navbar { padding: 1rem; }
    /* ul is unstyled (list-style: disc) and vertical */
    .hero-section { display: grid; grid-template-columns: 1fr 1fr; padding: 2rem; }
    .hero-visual { width: 300px; height: 0px; }
  </style>
</head>
<body>
  <header class="navbar">
    <nav class="nav-links">
      <ul>
        <li><a href="#1">Link One</a></li>
        <li><a href="#2">Link Two</a></li>
      </ul>
    </nav>
  </header>
  <main>
    <section class="hero-section">
      <div class="hero-content"><h1>Defective Store</h1></div>
      <div class="hero-visual"></div>
    </section>
    <div class="product-card">
      <img src="http://localhost:${port}/broken-image-404.jpg" alt="Missing Product">
    </div>
  </main>
</body>
</html>`;

    const server = await listenOn(port, (req, res) => {
      if (req.url === "/" || req.url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(defectHtml);
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

      // analyzeLayout must catch broken_image, bulleted_navigation, and collapsed_hero_visual
      const layoutRes = await session.analyzeLayout({ width: 1280, height: 800 });
      assert.equal(layoutRes.success, true);
      if (layoutRes.success) {
        const defects = layoutRes.analysis.defects;
        assert.ok(defects.some(d => d.type === "broken_image"), "Must detect broken_image");
        assert.ok(defects.some(d => d.type === "bulleted_navigation" || d.type === "vertical_navigation_list"), "Must detect navigation layout defect");
        assert.ok(defects.some(d => d.type === "collapsed_hero_visual"), "Must detect collapsed_hero_visual");
      }

      // runVerificationSuite must FAIL
      const summary = await runVerificationSuite(session, appUrl, []);
      assert.equal(summary.overallPassed, false, "Verification MUST fail on defective page");

      // 12-category quality audit must detect blockers
      const qualityReport = evaluateWebsiteQuality({
        task: "build ecommerce store",
        visibleText: "Defective Store",
        criticalLayoutDefects: layoutRes.success ? layoutRes.analysis.defects : [],
        verificationPassed: summary.overallPassed,
      });
      assert.equal(qualityReport.overallPassed, false, "Quality audit must fail quality gates");
      assert.ok(qualityReport.blockers.length > 0, "Quality audit must record blockers");
    } finally {
      await session.close();
      await closeServer(server);
    }
  });
});
