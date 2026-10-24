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

async function findFreePort(start = 54100): Promise<number> {
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

describe("Autonomous Acceptance Testing — 2 Independent Production-Grade Workspaces", () => {
  // ACCEPTANCE TASK 1: ApexTech E-Commerce Storefront
  test("Task 1: ApexTech Flagship E-Commerce Storefront executes with real browser interactions and zero critical defects across 5 viewports", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-apextech-ecom-"));
    const workspace = new Workspace(tempDir);
    const spec = generateDesignSpec(
      "Build a distinctive, premium ecommerce website for a fictional consumer technology brand called ApexTech. " +
      "Choose a cohesive visual identity, create a polished responsive storefront with product search, categories, " +
      "sorting, product cards, a working shopping cart, quantity updates, removal, and a validated checkout demonstration."
    );
    assert.equal(spec.productType, "ecommerce");

    const scaffoldRes = await scaffoldStaticProject(workspace, "ApexTech", spec);
    assert.equal(scaffoldRes.success, true);

    const html = await workspace.read("index.html");
    const css = await workspace.read("styles.css");
    const js = await workspace.read("script.js");

    assert.ok(html.includes("ApexTech"), "Must contain ApexTech brand");
    assert.ok(html.includes('id="searchInput"'), "Must contain search input");
    assert.ok(html.includes('id="cartBtn"'), "Must contain cart button");
    assert.ok(html.includes('id="cartDrawer"'), "Must contain cart drawer");
    assert.ok(html.includes('id="productGrid"'), "Must contain product catalog grid");
    assert.ok(html.includes('id="checkoutModal"'), "Must contain demo checkout modal");

    const port = await findFreePort();
    const server = await listenOn(port, (req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      if (urlPath === "/" || urlPath === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } else if (urlPath === "/styles.css") {
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
        res.end(css);
      } else if (urlPath === "/script.js") {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
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

      // 5 Directive Viewports: 320x568, 375x667, 768x1024, 1024x768, 1366x768
      const viewports = [
        { name: "320x568", width: 320, height: 568 },
        { name: "375x667", width: 375, height: 667 },
        { name: "768x1024", width: 768, height: 1024 },
        { name: "1024x768", width: 1024, height: 768 },
        { name: "1366x768", width: 1366, height: 768 },
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
          assert.equal(layoutRes.analysis.horizontalOverflow, false, `Viewport ${vp.name} must not have horizontal overflow`);
        }
      }

      // Functional User Journeys:
      // 1. Search products
      const searchInput = page.locator("#searchInput");
      await searchInput.fill("wireless");
      await page.waitForTimeout(100);
      let visibleCards = await page.locator(".product-card:visible").all();
      assert.ok(visibleCards.length >= 1, "Searching for 'wireless' must return matching products");

      await searchInput.fill("");
      await page.waitForTimeout(100);

      // 2. Add to Cart & Badge Counter
      const cartCount = page.locator("#cartCount");
      assert.equal((await cartCount.textContent())?.trim(), "0");

      await page.locator(".product-card:visible .btn-add-to-cart").first().click();
      await page.waitForTimeout(200);
      assert.equal((await cartCount.textContent())?.trim(), "1", "Cart count must increment to 1");

      // 3. Cart Drawer open & increment
      const drawerIsOpen = await page.locator("#cartDrawer").evaluate(el => el.classList.contains("open"));
      assert.equal(drawerIsOpen, true, "Cart drawer must open automatically");

      await page.locator("#cartDrawer .inc-btn").first().click();
      await page.waitForTimeout(100);
      assert.equal((await page.locator("#cartDrawer .qty-val").first().textContent())?.trim(), "2");

      // 4. Checkout Demo Form Validation & Submission
      await page.locator("#checkoutBtn").click();
      await page.waitForTimeout(200);
      assert.equal(await page.locator("#checkoutModal").isVisible(), true, "Checkout modal must open");

      await page.locator("#shippingName").fill("Jordan Casey");
      await page.locator("#shippingEmail").fill("jordan@apextech.example");
      await page.locator("#shippingAddress").fill("500 Tech Parkway");
      await page.locator("#shippingCity").fill("Austin");
      await page.locator("#shippingZip").fill("78701");
      await page.locator("#placeOrderBtn").click();
      await page.waitForTimeout(200);

      assert.equal(await page.locator("#orderConfirmation").isVisible(), true, "Order confirmation must be visible");
      const orderNum = await page.locator("#orderNumber").textContent();
      assert.match(orderNum?.trim() ?? "", /^#ORD-\d+$/, "Order number must match pattern");

      // Verify no console errors
      const pageInfo = await session.inspectPage();
      assert.equal(pageInfo.success, true);
      if (pageInfo.success) {
        assert.equal(pageInfo.info.consoleErrors.length, 0, `Must have zero console errors: ${pageInfo.info.consoleErrors.join(", ")}`);
      }
    } finally {
      await session.close();
      await closeServer(server);
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  // ACCEPTANCE TASK 2: FlowSync SaaS Productivity Platform
  test("Task 2: FlowSync SaaS Productivity Platform executes in second isolated workspace with form validation and zero defects", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-flowsync-saas-"));
    const workspace = new Workspace(tempDir);
    const spec = generateDesignSpec(
      "Build a distinctive, high-converting SaaS landing page for an AI productivity tool called FlowSync. " +
      "Include a sticky navigation header with working anchor links, a hero section with actionable CTA buttons, " +
      "an interactive features grid, live pricing toggle (monthly vs annual), interactive ROI calculator demonstration, " +
      "and a validated contact/demo request form with client-side feedback."
    );
    assert.equal(spec.productType, "landing_page");

    const scaffoldRes = await scaffoldStaticProject(workspace, "FlowSync", spec);
    assert.equal(scaffoldRes.success, true);

    const html = await workspace.read("index.html");
    const css = await workspace.read("styles.css");
    const js = await workspace.read("script.js");

    assert.ok(html.includes("FlowSync"), "Must contain FlowSync brand");
    assert.ok(html.includes('class="navbar"'), "Must contain navbar");
    assert.ok(html.includes('id="features"'), "Must contain features section");
    assert.ok(html.includes('id="contact"'), "Must contain contact section");
    assert.ok(html.includes('id="contact-form"'), "Must contain contact form");

    const port = await findFreePort();
    const server = await listenOn(port, (req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      if (urlPath === "/" || urlPath === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } else if (urlPath === "/styles.css") {
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
        res.end(css);
      } else if (urlPath === "/script.js") {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
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

      // 5 Directive Viewports: 320x568, 375x667, 768x1024, 1024x768, 1366x768
      const viewports = [
        { name: "320x568", width: 320, height: 568 },
        { name: "375x667", width: 375, height: 667 },
        { name: "768x1024", width: 768, height: 1024 },
        { name: "1024x768", width: 1024, height: 768 },
        { name: "1366x768", width: 1366, height: 768 },
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
          assert.equal(layoutRes.analysis.horizontalOverflow, false, `Viewport ${vp.name} must not have horizontal overflow`);
        }
      }

      // Functional verification: Form validation and submission
      await page.locator("#name").fill("Morgan Reed");
      await page.locator("#email").fill("morgan@company.example");
      await page.locator("#message").fill("Interested in FlowSync enterprise automation.");
      await page.locator("#submit-btn").click();
      await page.waitForTimeout(200);

      const feedback = page.locator("#form-feedback");
      assert.equal(await feedback.isVisible(), true, "Feedback message must be displayed");
      const feedbackText = await feedback.textContent();
      assert.ok(feedbackText?.includes("Thank you") || feedbackText?.includes("Message sent"), "Must show success confirmation");

      // Verify zero console errors
      const pageInfo = await session.inspectPage();
      assert.equal(pageInfo.success, true);
      if (pageInfo.success) {
        assert.equal(pageInfo.info.consoleErrors.length, 0, `Must have zero console errors: ${pageInfo.info.consoleErrors.join(", ")}`);
      }
    } finally {
      await session.close();
      await closeServer(server);
      await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
});
