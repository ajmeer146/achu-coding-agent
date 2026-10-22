import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
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

async function findFreePort(start = 51900): Promise<number> {
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

async function startPage(html: string): Promise<{ port: number; server: http.Server }> {
  const port = await findFreePort();
  const server = await listenOn(port, (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  });
  return { port, server };
}

const CLEAN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Clean</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    header { padding: 1rem; background: #111; color: #fff; }
    main { padding: 1rem; }
    button { width: 140px; height: 44px; }
  </style>
</head>
<body>
  <header><nav><a href="#home">Home</a></nav></header>
  <main class="main-content"><h1>Hello</h1><button>Action</button></main>
</body>
</html>`;

const OVERFLOW_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Overflow</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    .wide { width: 900px; height: 40px; background: crimson; }
  </style>
</head>
<body>
  <main class="main-content"><h1>Wide</h1><div class="wide"></div></main>
</body>
</html>`;

const SIDEBAR_OVERLAP_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Overlap</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    .sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: 220px; background: #111; }
    .nav-link { display: block; padding: 1rem; color: #fff; text-decoration: none; }
    .main-content { padding: 1rem; }
  </style>
</head>
<body>
  <aside class="sidebar"><a class="nav-link" href="#dashboard">Dashboard</a></aside>
  <main class="main-content"><h1>Dashboard</h1><p>Content beside an overlaying sidebar.</p></main>
</body>
</html>`;

const TEXT_OVERFLOW_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Text Overflow</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    .sidebar { float: left; width: 60px; height: 100vh; background: #111; }
    .nav-link { display: block; width: 60px; padding: 0; white-space: nowrap; color: #fff; }
    .main-content { margin-left: 60px; padding: 1rem; }
  </style>
</head>
<body>
  <aside class="sidebar"><a class="nav-link" href="#dashboard">Dashboard</a></aside>
  <main class="main-content"><h1>Hi</h1></main>
</body>
</html>`;

const SMALL_TARGET_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Small Target</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    .main-content { padding: 1rem; }
    .tiny { width: 20px; height: 20px; padding: 0; }
  </style>
</head>
<body>
  <main class="main-content"><h1>Targets</h1><button class="tiny">x</button></main>
</body>
</html>`;

// A standard closed off-canvas cart drawer: translated fully out of view.
const OFF_CANVAS_DRAWER_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Drawer</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    .cart-drawer { position: fixed; top: 0; right: 0; width: 360px; height: 100vh; background: #fff; transform: translateX(100%); }
    .cart-drawer.open { transform: translateX(0); }
    .cart-drawer-close { position: absolute; top: 16px; right: 16px; width: 40px; height: 40px; }
    .checkout-btn { width: 100%; height: 44px; }
  </style>
</head>
<body>
  <main class="main-content"><h1>Shop</h1></main>
  <div class="cart-drawer" id="cart-drawer">
    <button class="cart-drawer-close" id="cart-close-btn" aria-label="Close cart">&times;</button>
    <button class="checkout-btn" id="checkout-btn">Checkout</button>
  </div>
</body>
</html>`;

// Horizontally scrollable filter strip: off-screen chips are reachable by scrolling.
const SCROLLABLE_FILTER_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Filters</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    .category-filters { display: flex; gap: 8px; overflow-x: auto; padding: 12px; }
    .filter-btn { flex: 0 0 auto; width: 120px; height: 44px; }
  </style>
</head>
<body>
  <nav class="category-filters">
    <button class="filter-btn" data-category="all">All</button>
    <button class="filter-btn" data-category="electronics">Electronics</button>
    <button class="filter-btn" data-category="fashion">Fashion</button>
    <button class="filter-btn" data-category="home">Home</button>
    <button class="filter-btn" data-category="books">Books</button>
  </nav>
  <main class="main-content"><h1>Products</h1></main>
</body>
</html>`;

// A control pushed off-screen with no hidden or scrollable ancestor: a real defect.
const TRULY_OFFSCREEN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Offscreen</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; overflow-x: hidden; }
    .pushed { position: absolute; left: 2000px; top: 100px; }
    .pushed button { width: 120px; height: 44px; }
  </style>
</head>
<body>
  <main class="main-content"><h1>Broken</h1><div class="pushed"><button>Unreachable</button></div></main>
</body>
</html>`;

describe("Phase 13.2 — Measurable visual quality checks (real browser geometry)", () => {
  test("1. Clean responsive page reports no defects at desktop and mobile viewports", async () => {
    const { port, server } = await startPage(CLEAN_PAGE);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      const nav = await session.navigate(`http://localhost:${port}`);
      assert.equal(nav.success, true, `Navigation must succeed: ${nav.error ?? ""}`);

      const desktop = await session.analyzeLayout("desktop");
      assert.equal(desktop.success, true);
      if (desktop.success) {
        assert.equal(desktop.analysis.width, 1440, "Desktop analysis must measure the 1440px viewport");
        assert.equal(desktop.analysis.horizontalOverflow, false);
        assert.equal(desktop.analysis.defects.filter(d => d.severity === "critical").length, 0);
      }

      const laptop = await session.analyzeLayout("laptop");
      assert.equal(laptop.success, true);
      if (laptop.success) {
        assert.equal(laptop.analysis.width, 1280, "Laptop analysis must measure the 1280px viewport");
        assert.equal(laptop.analysis.horizontalOverflow, false);
      }

      const mobile = await session.analyzeLayout("mobile");
      assert.equal(mobile.success, true);
      if (mobile.success) {
        assert.equal(mobile.analysis.width, 375, "Mobile analysis must measure the 375px viewport");
        assert.equal(mobile.analysis.horizontalOverflow, false);
        assert.equal(mobile.analysis.defects.filter(d => d.severity === "critical").length, 0);
      }
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("2. Page wider than the viewport reports a critical horizontal overflow with pixel evidence", async () => {
    const { port, server } = await startPage(OVERFLOW_PAGE);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      const mobile = await session.analyzeLayout("mobile");
      assert.equal(mobile.success, true);
      if (mobile.success) {
        assert.equal(mobile.analysis.horizontalOverflow, true);
        assert.ok(mobile.analysis.overflowPx >= 500, `Expected >=500px overflow, got ${mobile.analysis.overflowPx}`);
        const overflow = mobile.analysis.defects.find(d => d.type === "horizontal_overflow");
        assert.ok(overflow, "horizontal_overflow defect must be reported");
        assert.equal(overflow!.severity, "critical");
      }

      const desktop = await session.analyzeLayout("desktop");
      assert.equal(desktop.success, true);
      if (desktop.success) {
        assert.equal(desktop.analysis.horizontalOverflow, false, "900px content fits a 1280px desktop viewport");
      }
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("3. Sidebar overlaying main content is reported as a critical navigation overlap", async () => {
    const { port, server } = await startPage(SIDEBAR_OVERLAP_PAGE);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      const desktop = await session.analyzeLayout("desktop");
      assert.equal(desktop.success, true);
      if (desktop.success) {
        const overlap = desktop.analysis.defects.find(d => d.type === "navigation_overlap");
        assert.ok(overlap, `navigation_overlap must be reported; defects: ${JSON.stringify(desktop.analysis.defects)}`);
        assert.equal(overlap!.severity, "critical");
        assert.match(overlap!.message, /overlaps/);
      }
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("4. Navigation label wider than its container is reported as critical text overflow", async () => {
    const { port, server } = await startPage(TEXT_OVERFLOW_PAGE);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      const mobile = await session.analyzeLayout("mobile");
      assert.equal(mobile.success, true);
      if (mobile.success) {
        const textOverflow = mobile.analysis.defects.find(d => d.type === "text_overflow");
        assert.ok(textOverflow, `text_overflow must be reported; defects: ${JSON.stringify(mobile.analysis.defects)}`);
        assert.equal(textOverflow!.severity, "critical");
        assert.match(textOverflow!.message, /Dashboard/);
      }
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("5. Small touch target is a mobile warning, not a critical defect", async () => {
    const { port, server } = await startPage(SMALL_TARGET_PAGE);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      const mobile = await session.analyzeLayout("mobile");
      assert.equal(mobile.success, true);
      if (mobile.success) {
        const warning = mobile.analysis.defects.find(d => d.type === "small_touch_target");
        assert.ok(warning, `small_touch_target warning must be reported; defects: ${JSON.stringify(mobile.analysis.defects)}`);
        assert.equal(warning!.severity, "warning");
        assert.equal(
          mobile.analysis.defects.filter(d => d.severity === "critical").length,
          0,
          "Small targets alone must not be critical"
        );
      }

      const desktop = await session.analyzeLayout("desktop");
      assert.equal(desktop.success, true);
      if (desktop.success) {
        assert.equal(desktop.analysis.defects.filter(d => d.type === "small_touch_target").length, 0);
      }
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("6. Agent wiring: measurable checks integrated and no fake screenshot-based visual claims", () => {
    const agentSource = fs.readFileSync(path.join(process.cwd(), "src", "agent.ts"), "utf8");
    assert.match(agentSource, /name: "inspect_visual_quality"/, "AGENT_TOOLS must declare inspect_visual_quality");
    assert.match(agentSource, /case "inspect_visual_quality":/, "executeTool must implement inspect_visual_quality");
    assert.match(agentSource, /runVisualQualityChecks\(state\.browserSession, baseUrl\)/, "browser_verify must run measurable visual checks");
    assert.match(agentSource, /cannot interpret screenshot pixels/i, "take_screenshot must state screenshot pixels are not interpreted");
    assert.match(agentSource, /You CANNOT see screenshot pixels/, "prompt must forbid claiming visual inspection from screenshots");
    assert.match(agentSource, /measurable visual defects/, "visual defect results must be classified as failures");
  });

  test("7. Closed off-canvas drawer controls are not reported as layout defects", async () => {
    const { port, server } = await startPage(OFF_CANVAS_DRAWER_PAGE);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      const desktop = await session.analyzeLayout("desktop");
      assert.equal(desktop.success, true);
      if (desktop.success) {
        const critical = desktop.analysis.defects.filter(d => d.severity === "critical");
        assert.equal(critical.length, 0, `closed drawer must not create critical defects: ${JSON.stringify(desktop.analysis.defects)}`);
        assert.equal(
          desktop.analysis.defects.filter(d => d.type === "offscreen_interactive").length,
          0,
          "controls inside a closed drawer are intentionally hidden and must not be reported"
        );
      }

      const mobile = await session.analyzeLayout("mobile");
      assert.equal(mobile.success, true);
      if (mobile.success) {
        assert.equal(
          mobile.analysis.defects.filter(d => d.severity === "critical").length,
          0,
          `closed drawer must not create critical defects on mobile: ${JSON.stringify(mobile.analysis.defects)}`
        );
      }
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("8. Controls inside a horizontally scrollable strip stay reachable and are not clipped defects", async () => {
    const { port, server } = await startPage(SCROLLABLE_FILTER_PAGE);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      const mobile = await session.analyzeLayout("mobile");
      assert.equal(mobile.success, true);
      if (mobile.success) {
        assert.equal(
          mobile.analysis.defects.filter(d => d.type === "clipped_interactive").length,
          0,
          `scrollable filter strip must not be reported as clipped: ${JSON.stringify(mobile.analysis.defects)}`
        );
        assert.equal(
          mobile.analysis.defects.filter(d => d.severity === "critical").length,
          0,
          `scrollable filter strip must not block verification: ${JSON.stringify(mobile.analysis.defects)}`
        );
      }
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("9. Genuinely unreachable off-screen controls are still reported", async () => {
    const { port, server } = await startPage(TRULY_OFFSCREEN_PAGE);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      const desktop = await session.analyzeLayout("desktop");
      assert.equal(desktop.success, true);
      if (desktop.success) {
        const offscreen = desktop.analysis.defects.find(d => d.type === "offscreen_interactive");
        assert.ok(
          offscreen,
          `a control pushed off-screen with no hidden or scrollable ancestor must still be reported: ${JSON.stringify(desktop.analysis.defects)}`
        );
      }
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  const SVG_FIXED_WIDTH_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>SVG Fixed Width</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    .hero-svg { width: 600px; height: 400px; }
  </style>
</head>
<body>
  <main class="main-content"><h1>Hero</h1><svg class="hero-svg"><rect width="100" height="100"/></svg></main>
</body>
</html>`;

  const DESKTOP_DRAWER_OVERFLOW_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Drawer Overflow</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    .drawer { position: fixed; top: 0; right: -50px; width: 400px; height: 100vh; background: #111; }
  </style>
</head>
<body>
  <main class="main-content"><h1>Drawer</h1><div class="drawer"></div></main>
</body>
</html>`;

  const LAYOUT_CORRECTION_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Layout Correction</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    .wide-img { width: 500px; height: 300px; background: crimson; }
  </style>
</head>
<body>
  <main class="main-content"><h1>Before</h1><div class="wide-img"></div></main>
</body>
</html>`;

  test("10. Mobile SVG with fixed width exceeding viewport is reported", async () => {
    const { port, server } = await startPage(SVG_FIXED_WIDTH_PAGE);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      const mobile320 = await session.analyzeLayout({ width: 320, height: 568 });
      assert.equal(mobile320.success, true);
      if (mobile320.success) {
        const mediaDefect = mobile320.analysis.defects.find(d => d.type === "media_fixed_width");
        assert.ok(mediaDefect, `SVG fixed width exceeding 320px viewport must be reported: ${JSON.stringify(mobile320.analysis.defects)}`);
      }
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("11. Desktop fixed-position drawer extending beyond viewport is reported", async () => {
    const { port, server } = await startPage(DESKTOP_DRAWER_OVERFLOW_PAGE);
    const session = new BrowserSession({ headless: true });
    try {
      await session.init();
      await session.navigate(`http://localhost:${port}`);

      const desktop = await session.analyzeLayout("desktop");
      assert.equal(desktop.success, true);
      if (desktop.success) {
        const fixedDefect = desktop.analysis.defects.find(d => d.type === "fixed_outside_viewport");
        assert.ok(fixedDefect, `Fixed drawer extending beyond viewport must be reported: ${JSON.stringify(desktop.analysis.defects)}`);
      }
    } finally {
      await session.close();
      await closeServer(server);
    }
  });

  test("12. Successful re-verification after layout correction", async () => {
    const first = await startPage(LAYOUT_CORRECTION_PAGE);
    const session = new BrowserSession({ headless: true });
    let correctedServer: http.Server | undefined;
    try {
      await session.init();
      await session.navigate(`http://localhost:${first.port}`);

      // Before correction: wide image causes horizontal overflow on 320px mobile
      const before = await session.analyzeLayout({ width: 320, height: 568 });
      assert.equal(before.success, true);
      if (before.success) {
        const overflow = before.analysis.defects.find(d => d.type === "horizontal_overflow");
        assert.ok(overflow, `Wide image should cause horizontal overflow on 320px: ${JSON.stringify(before.analysis.defects)}`);
      }

      // Simulate CSS correction: make image responsive
      const correctedHtml = LAYOUT_CORRECTION_PAGE.replace(
        ".wide-img { width: 500px; height: 300px; background: crimson; }",
        ".wide-img { width: 100%; max-width: 100%; height: auto; background: crimson; }"
      );
      const corrected = await startPage(correctedHtml);
      correctedServer = corrected.server;

      await session.navigate(`http://localhost:${corrected.port}`);

      // After correction: no horizontal overflow
      const after = await session.analyzeLayout({ width: 320, height: 568 });
      assert.equal(after.success, true);
      if (after.success) {
        const overflow = after.analysis.defects.find(d => d.type === "horizontal_overflow");
        assert.ok(!overflow, `After correction, no horizontal overflow should remain: ${JSON.stringify(after.analysis.defects)}`);
      }
    } finally {
      await session.close();
      await closeServer(first.server);
      if (correctedServer) await closeServer(correctedServer);
    }
  });
});
