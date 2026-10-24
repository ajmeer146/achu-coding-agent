import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { runAgent } from "../dist/agent.js";
import { BrowserSession } from "../dist/browser/browser-session.js";

async function runAutonomousAcceptance() {
  console.log("================================================================================");
  console.log("PHASE NINE: AUTONOMOUS ACCEPTANCE TESTING (2 INDEPENDENT WORKSPACES)");
  console.log("================================================================================");

  const results = [];

  // ============================================================================
  // ACCEPTANCE TASK 1: PREMIUM E-COMMERCE STOREFRONT
  // ============================================================================
  console.log("\n>>> EXECUTING ACCEPTANCE TASK 1: PREMIUM CONSUMER TECH E-COMMERCE STOREFRONT");
  const ws1 = path.join(os.tmpdir(), `achu-accept-ecommerce-${Date.now()}`);
  await fs.mkdir(ws1, { recursive: true });
  console.log(`[Task 1 Workspace] ${ws1}`);

  const task1Prompt =
    "Build a distinctive, premium ecommerce website for a fictional consumer technology brand called ApexTech. " +
    "Choose a cohesive visual identity, create a polished responsive storefront with product search, categories, " +
    "sorting, product cards, a working shopping cart, quantity updates, removal, and a validated checkout demonstration. " +
    "Use professional spacing, typography, meaningful product imagery where available, and a responsive mobile layout. " +
    "Implement the website, run it, inspect it in a real browser, test its interactions, identify defects, fix them, " +
    "rerun regression tests, and provide a final evidence-based report. Do not claim production integrations that are not implemented.";

  const t0_1 = Date.now();
  process.env.WORKSPACE_ROOT = ws1;
  process.env.SESSION_ID = `accept_ecom_${Date.now()}`;

  let task1Result;
  try {
    task1Result = await runAgent(task1Prompt, { maxSteps: 25, maxRecoveryAttempts: 3 });
  } catch (err) {
    console.error("Task 1 error:", err);
    task1Result = { success: false, error: String(err) };
  }
  const duration1 = ((Date.now() - t0_1) / 1000).toFixed(1);

  console.log(`\n[Task 1 Completed] Duration: ${duration1}s, Success: ${task1Result.success}`);
  console.log(`[Task 1 Steps] Completed: ${task1Result.completedSteps}, Total: ${task1Result.totalSteps}`);
  console.log(`[Task 1 Files Modified] ${task1Result.filesModified?.join(", ")}`);

  // Verify Task 1 files on disk
  const files1 = await fs.readdir(ws1);
  console.log(`[Task 1 Files on Disk] ${files1.join(", ")}`);

  // Verify with real browser
  let browserResult1 = { passed: false, viewports: {}, defects: [] };
  const session1 = new BrowserSession();
  const available1 = await session1.isAvailable();
  if (available1.available && fsSync.existsSync(path.join(ws1, "index.html"))) {
    try {
      await session1.init();
      const htmlPath = path.join(ws1, "index.html");
      const fileUrl = `file://${htmlPath.replace(/\\/g, "/")}`;
      await session1.navigate(fileUrl);

      // Test all required viewports
      const vps = [
        { name: "small_mobile", width: 320, height: 568 },
        { name: "mobile", width: 375, height: 667 },
        { name: "tablet", width: 768, height: 1024 },
        { name: "tablet_landscape", width: 1024, height: 768 },
        { name: "desktop_standard", width: 1366, height: 768 },
      ];

      let criticalCount = 0;
      for (const vp of vps) {
        const layoutRes = await session1.analyzeLayout(vp);
        if (layoutRes.success) {
          browserResult1.viewports[`${vp.width}x${vp.height}`] = {
            overflow: layoutRes.analysis.horizontalOverflow,
            overflowPx: layoutRes.analysis.overflowPx,
            defectsCount: layoutRes.analysis.defects.length,
          };
          const crits = layoutRes.analysis.defects.filter(d => d.severity === "critical");
          criticalCount += crits.length;
          if (crits.length > 0) browserResult1.defects.push(...crits);
        }
      }

      // Check search and cart elements
      const hasSearch = await session1.page.$('input[type="search"], .search-input, input[placeholder*="search" i]');
      const hasCart = await session1.page.$('.cart-btn, #cartBtn, [aria-label*="cart" i]');
      console.log(`[Task 1 Browser Check] Search Input present: ${Boolean(hasSearch)}, Cart Button present: ${Boolean(hasCart)}`);
      browserResult1.passed = Boolean(hasSearch && hasCart && criticalCount === 0);

      // Capture screenshot
      const shot = await session1.screenshot({ viewport: "desktop" });
      if (shot.success) {
        const shotPath = path.join(ws1, "apextech-desktop.png");
        await fs.writeFile(shotPath, Buffer.from(shot.screenshot, "base64"));
        console.log(`[Task 1 Screenshot] Saved to ${shotPath}`);
      }
    } catch (e) {
      console.warn("Task 1 browser check warning:", e);
    } finally {
      await session1.close();
    }
  }

  results.push({
    task: "ApexTech E-Commerce Storefront",
    success: task1Result.success,
    duration: duration1,
    files: files1,
    browserPassed: browserResult1.passed,
    viewports: browserResult1.viewports,
    defects: browserResult1.defects,
  });

  // ============================================================================
  // ACCEPTANCE TASK 2: SECOND INDEPENDENT TASK (SAAS PRODUCTIVITY PLATFORM)
  // ============================================================================
  console.log("\n>>> EXECUTING ACCEPTANCE TASK 2: SAAS PRODUCTIVITY PLATFORM (INDEPENDENT WORKSPACE)");
  const ws2 = path.join(os.tmpdir(), `achu-accept-saas-${Date.now()}`);
  await fs.mkdir(ws2, { recursive: true });
  console.log(`[Task 2 Workspace] ${ws2}`);

  const task2Prompt =
    "Build a distinctive, high-converting SaaS landing page for an AI productivity tool called FlowSync. " +
    "Include a sticky navigation header with working anchor links, a hero section with actionable CTA buttons, " +
    "an interactive features grid, live pricing toggle (monthly vs annual), interactive ROI calculator demonstration, " +
    "and a validated contact/demo request form with client-side feedback. Ensure responsive mobile layout without horizontal overflow.";

  const t0_2 = Date.now();
  process.env.WORKSPACE_ROOT = ws2;
  process.env.SESSION_ID = `accept_saas_${Date.now()}`;

  let task2Result;
  try {
    task2Result = await runAgent(task2Prompt, { maxSteps: 25, maxRecoveryAttempts: 3 });
  } catch (err) {
    console.error("Task 2 error:", err);
    task2Result = { success: false, error: String(err) };
  }
  const duration2 = ((Date.now() - t0_2) / 1000).toFixed(1);

  console.log(`\n[Task 2 Completed] Duration: ${duration2}s, Success: ${task2Result.success}`);
  console.log(`[Task 2 Steps] Completed: ${task2Result.completedSteps}, Total: ${task2Result.totalSteps}`);

  const files2 = await fs.readdir(ws2);
  console.log(`[Task 2 Files on Disk] ${files2.join(", ")}`);

  let browserResult2 = { passed: false, viewports: {}, defects: [] };
  const session2 = new BrowserSession();
  const available2 = await session2.isAvailable();
  if (available2.available && fsSync.existsSync(path.join(ws2, "index.html"))) {
    try {
      await session2.init();
      const htmlPath = path.join(ws2, "index.html");
      const fileUrl = `file://${htmlPath.replace(/\\/g, "/")}`;
      await session2.navigate(fileUrl);

      const vps = [
        { name: "small_mobile", width: 320, height: 568 },
        { name: "mobile", width: 375, height: 667 },
        { name: "tablet", width: 768, height: 1024 },
        { name: "desktop_standard", width: 1366, height: 768 },
      ];

      let criticalCount = 0;
      for (const vp of vps) {
        const layoutRes = await session2.analyzeLayout(vp);
        if (layoutRes.success) {
          browserResult2.viewports[`${vp.width}x${vp.height}`] = {
            overflow: layoutRes.analysis.horizontalOverflow,
            overflowPx: layoutRes.analysis.overflowPx,
            defectsCount: layoutRes.analysis.defects.length,
          };
          const crits = layoutRes.analysis.defects.filter(d => d.severity === "critical");
          criticalCount += crits.length;
        }
      }

      const hasForm = await session2.page.$('form, input[type="email"], textarea');
      const hasHeading = await session2.page.$('h1');
      console.log(`[Task 2 Browser Check] Form present: ${Boolean(hasForm)}, H1 Heading present: ${Boolean(hasHeading)}`);
      browserResult2.passed = Boolean(hasForm && hasHeading && criticalCount === 0);

      const shot = await session2.screenshot({ viewport: "desktop" });
      if (shot.success) {
        const shotPath = path.join(ws2, "flowsync-desktop.png");
        await fs.writeFile(shotPath, Buffer.from(shot.screenshot, "base64"));
        console.log(`[Task 2 Screenshot] Saved to ${shotPath}`);
      }
    } catch (e) {
      console.warn("Task 2 browser check warning:", e);
    } finally {
      await session2.close();
    }
  }

  results.push({
    task: "FlowSync SaaS Productivity Platform",
    success: task2Result.success,
    duration: duration2,
    files: files2,
    browserPassed: browserResult2.passed,
    viewports: browserResult2.viewports,
  });

  console.log("\n================================================================================");
  console.log("AUTONOMOUS ACCEPTANCE SUMMARY");
  console.log("================================================================================");
  console.log(JSON.stringify(results, null, 2));
}

runAutonomousAcceptance().catch((err) => {
  console.error("FATAL ACCEPTANCE ERROR:", err);
  process.exit(1);
});
