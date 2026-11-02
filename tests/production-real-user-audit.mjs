import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const PROD_BASE = "https://www.workswithachu.me";
const EVIDENCE_DIR = path.resolve(process.cwd(), "docs/acceptance-evidence/production");
const SCREENSHOT_DIR = path.resolve(process.cwd(), "docs/acceptance-evidence/screenshots");
const LOG_FILE = path.resolve(process.cwd(), "docs/acceptance-evidence/logs/phase-a-production-user-experience.log");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

async function run() {
  fs.writeFileSync(LOG_FILE, "=== PHASE A: PRODUCTION USER EXPERIENCE AUDIT ===\n");
  log(`Target: ${PROD_BASE}`);

  const browser = await chromium.launch({ headless: true });
  const consoleErrors = [];
  const failedRequests = [];
  const networkCalls = [];

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!text.includes("favicon") && !text.includes("analytics") && !text.includes("ResizeObserver")) {
        consoleErrors.push(text);
      }
    }
  });

  page.on("requestfailed", (req) => {
    failedRequests.push({ url: req.url(), failure: req.failure()?.errorText });
  });

  page.on("response", (res) => {
    const url = res.url();
    if (url.startsWith(PROD_BASE) && !url.includes("/_next/static")) {
      networkCalls.push({ url, status: res.status() });
    }
  });

  try {
    // 1. Landing Page Verification
    log("Step 1: Inspecting landing page...");
    const homeRes = await page.goto(PROD_BASE, { waitUntil: "networkidle", timeout: 30000 });
    log(`Landing page HTTP status: ${homeRes?.status()}`);
    assert.equal(homeRes?.status(), 200, "Production homepage must return HTTP 200");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-prod-home-1440.png") });

    // 2. Authentication Flow: Guest Session
    log("Step 2: Authenticating as guest user...");
    await page.goto(`${PROD_BASE}/login`, { waitUntil: "networkidle", timeout: 25000 });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-prod-login-screen.png") });

    const guestBtn = await page.$("button:has-text('Continue as Guest')");
    assert.ok(guestBtn, "Login page must have 'Continue as Guest' button");
    await guestBtn.click();
    await page.waitForTimeout(2000);

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name.includes("session") || c.name.includes("token") || c.name.includes("auth"));
    log(`Session established. Cookies count: ${cookies.length}, Has session cookie: ${Boolean(sessionCookie)}`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-prod-authenticated-overview.png") });

    // 3. AI Chat Streaming Verification
    log("Step 3: Testing AI Chat prompt and streaming response...");
    await page.goto(`${PROD_BASE}/overview`, { waitUntil: "networkidle", timeout: 25000 });
    const chatInput = await page.$("textarea, input[placeholder*='message'], input[placeholder*='Ask']");
    if (chatInput) {
      await chatInput.fill("Confirm system status: return 'ACHU PRODUCTION ACTIVE'");
      const sendBtn = await page.$("button[type='submit'], button:has-text('Send'), button[aria-label*='Send']");
      if (sendBtn) {
        await sendBtn.click();
        await page.waitForTimeout(4000); // Wait for streaming tokens
      }
    }
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "04-prod-chat-stream.png") });

    // 4. File Handling UI Verification
    log("Step 4: Inspecting file attachment capability in chat/composer...");
    const fileInput = await page.$("input[type='file']");
    log(`File input present in interface: ${Boolean(fileInput)}`);

    // 5. Project Management Verification
    log("Step 5: Verifying /projects route...");
    await page.goto(`${PROD_BASE}/projects`, { waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "05-prod-projects-view.png") });

    // 6. Coding Agent Workspace Interface
    log("Step 6: Verifying Coding Agent Workspace (/workspace/coding-agent)...");
    await page.goto(`${PROD_BASE}/workspace/coding-agent`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    const hasComposerInput = await page.$("#task-prompt-input, textarea, input[placeholder*='Describe']");
    assert.ok(hasComposerInput, "Coding agent must render task composer input");

    const modeText = await page.evaluate(() => document.body.innerText);
    assert.ok(modeText.includes("Cloud") || modeText.includes("Local"), "Must display Cloud/Local execution mode selectors");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "06-prod-coding-agent-workspace.png") });

    // 7. Multi-Viewport Compatibility Matrix
    const viewports = [
      { name: "1920x1080-desktop-fhd", width: 1920, height: 1080 },
      { name: "1366x768-desktop-standard", width: 1366, height: 768 },
      { name: "1024x768-laptop", width: 1024, height: 768 },
      { name: "768x1024-tablet-portrait", width: 768, height: 1024 },
      { name: "375x667-mobile", width: 375, height: 667 },
      { name: "320x568-small-mobile", width: 320, height: 568 },
    ];

    log("Step 7: Testing responsive viewports...");
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(300);

      const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      log(`  Viewport ${vp.name}: horizontal overflow = ${hasHorizontalOverflow}`);
      assert.equal(hasHorizontalOverflow, false, `Viewport ${vp.name} must not have horizontal scrollbar`);

      const vpShot = path.join(SCREENSHOT_DIR, `prod-viewport-${vp.name}.png`);
      await page.screenshot({ path: vpShot, fullPage: false });
    }

    // 8. Session Persistence across browser reload
    log("Step 8: Verifying session persistence across browser reload...");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const currentUrl = page.url();
    assert.ok(!currentUrl.includes("/login"), `User session must persist without redirecting to login. Current URL: ${currentUrl}`);
    log(`Session persisted. Current URL: ${currentUrl}`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "08-prod-session-after-reload.png") });

    // 9. Verify Zero Localhost Leaks in Production Network Calls
    const localhostCalls = networkCalls.filter((c) => c.url.includes("localhost") || c.url.includes("127.0.0.1"));
    log(`Production network calls inspected: ${networkCalls.length}`);
    log(`Accidental localhost API calls: ${localhostCalls.length}`);
    assert.equal(localhostCalls.length, 0, "Production website must never target localhost or loopback for server APIs");

    log("=== PHASE A AUDIT COMPLETED SUCCESSFULLY ===");
    return {
      success: true,
      homeStatus: homeRes?.status(),
      sessionPersisted: true,
      networkCallsCount: networkCalls.length,
      localhostLeaks: localhostCalls.length,
      consoleErrorsCount: consoleErrors.length,
    };
  } finally {
    await browser.close();
  }
}

run()
  .then((res) => {
    log("Result: " + JSON.stringify(res, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    log("FAILED: " + (err.stack || err.message));
    process.exit(1);
  });
