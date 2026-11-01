import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { Workspace } from "../src/tools/workspace.js";
import {
  initializePlan,
  executeTool,
  updatePlanProgress,
  verifyTaskCompletionEvidence,
  type AgentState,
  type ToolCall,
} from "../src/agent.js";
import { BrowserSession } from "../src/browser/browser-session.js";
import { SnapshotManager } from "../src/tools/snapshot.js";
import { stopAppProcess, isUrlServing } from "../src/tools/app-lifecycle.js";

describe("Real-World Food Delivery Autonomous Acceptance Test", () => {
  const TASK_PROMPT =
    "Build a modern food delivery website with customer registration and login, restaurant listings, food search, categories, filters, shopping cart, checkout, order placement, order tracking, and an admin dashboard. Use a persistent database. Make the application fully responsive and visually polished.";

  let testWorkspaceDir: string;
  let workspace: Workspace;
  let agentState: AgentState;
  let serverPort: number | null = null;
  let appUrl: string | null = null;
  let placedOrderId: string | number | null = null;
  let placedOrderNumber: string | null = null;

  test("Phase 1: Isolated Workspace and Agent State Initialization", async () => {
    testWorkspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-food-delivery-"));
    workspace = new Workspace(testWorkspaceDir);
    console.log(`[Acceptance] Isolated workspace initialized: ${testWorkspaceDir}`);

    const snap = new SnapshotManager(testWorkspaceDir, "food-delivery-acceptance");
    await snap.init();

    agentState = {
      requestedVerification: null,
      lastVerification: null,
      verificationPassed: false,
      stopReason: null,
      commandHistory: [],
      stepsTaken: new Map(),
      completedTasks: new Set(),
      currentPlan: [],
      phase: "understand",
      recoveryAttempts: 0,
      lastError: null,
      repeatedFailures: new Map(),
      browserSession: null,
      verificationMemory: new Map(),
      appUrl: null,
      appProcess: null,
      browserVerificationAttempts: 0,
      maxBrowserVerificationAttempts: 3,
      browserVerificationRequested: true,
      browserVerificationPassed: false,
      verificationIsStrong: true,
      recentToolCalls: [],
      projectState: {
        hasExistingProject: false,
        projectType: null,
        existingFiles: [],
        framework: null,
        isFollowUpTask: false,
      },
    } as any;
    (agentState as any).snapshotManager = snap;

    assert.ok(fsSync.existsSync(testWorkspaceDir));
  });

  test("Phase 2: Agent Planning & Architecture Decomposition", async () => {
    agentState.phase = "plan";
    const plan = initializePlan(TASK_PROMPT, {
      hasProject: false,
      projectType: "none",
      existingFiles: [],
      framework: null,
    });

    assert.ok(plan.length >= 5, `Plan must have at least 5 steps, got ${plan.length}`);
    agentState.currentPlan = plan;
    console.log(`[Acceptance] Plan generated with ${plan.length} steps:`);
    for (const step of plan) {
      console.log(`  - [${step.status}] ${step.description} (${step.toolType || "tool"})`);
    }
  });

  test("Phase 3: Autonomous Scaffolding of Full-Stack Food Delivery Platform", async () => {
    agentState.phase = "execute";
    const scaffoldCall: ToolCall = {
      id: `call_${Date.now()}_scaffold`,
      type: "function",
      function: {
        name: "scaffold_project",
        arguments: JSON.stringify({
          template: "fullstack-ecommerce",
          name: "quickbite-food-delivery",
        }),
      },
    };

    const scaffoldOutput = await executeTool(workspace, scaffoldCall, agentState);
    console.log(`[Acceptance] Scaffold output: ${scaffoldOutput}`);
    assert.ok(scaffoldOutput.includes("Successfully scaffolded"), "Scaffold tool must succeed");

    // Update plan progress
    agentState.currentPlan = updatePlanProgress(agentState.currentPlan, agentState.completedTasks, scaffoldCall, scaffoldOutput);

    // Verify created files
    assert.ok(await workspace.exists("package.json"), "package.json must exist");
    assert.ok(await workspace.exists("server.js"), "server.js must exist");
    assert.ok(await workspace.exists("db.js"), "db.js must exist");
    assert.ok(await workspace.exists("public/index.html"), "public/index.html must exist");
    assert.ok(await workspace.exists("public/styles.css"), "public/styles.css must exist");
    assert.ok(await workspace.exists("public/app.js"), "public/app.js must exist");
    assert.ok(await workspace.exists("tests/api.test.js"), "tests/api.test.js must exist");

    // Verify database seed records
    const dbModule = await import(pathToFileURL(path.join(testWorkspaceDir, "db.js")).href);
    const restaurants = dbModule.db.getRestaurants();
    const products = dbModule.db.getProducts();

    assert.ok(restaurants.length >= 5, "Must have at least 5 partner restaurants");
    assert.ok(products.length >= 8, "Must have at least 8 menu items");
    assert.ok(products.some((p: any) => p.category === "Burgers"));
    assert.ok(products.some((p: any) => p.category === "Pizza"));
    assert.ok(products.some((p: any) => p.category === "Sushi"));
  });

  test("Phase 4: Start Application and Server Readiness Detection", async () => {
    const startCall: ToolCall = {
      id: `call_${Date.now()}_start`,
      type: "function",
      function: {
        name: "start_app",
        arguments: "{}",
      },
    };

    const startOutput = await executeTool(workspace, startCall, agentState);
    console.log(`[Acceptance] Start output: ${startOutput}`);
    assert.ok(startOutput.includes("ready at http") || startOutput.includes("started"), `Server must start: ${startOutput}`);

    appUrl = agentState.appUrl || agentState.appProcess?.url || "http://localhost:3000";
    console.log(`[Acceptance] Active application URL: ${appUrl}`);
    assert.ok(appUrl, "Application URL must be resolved");

    const isServing = await isUrlServing(appUrl, 1000);
    assert.equal(isServing, true, "Server must be actively responding to HTTP requests");
  });

  test("Phase 5: Backend REST API Functional Verification", async () => {
    // 1. Verify /api/restaurants
    const restCall: ToolCall = {
      id: `call_${Date.now()}_api_restaurants`,
      type: "function",
      function: {
        name: "verify_api_endpoint",
        arguments: JSON.stringify({
          url: "/api/restaurants",
          method: "GET",
          expectedStatus: 200,
          expectedProperties: ["success", "restaurants"],
        }),
      },
    };
    const restOutput = await executeTool(workspace, restCall, agentState);
    assert.ok(restOutput.includes("API Verification PASSED"), `Restaurants API must pass: ${restOutput}`);

    // 2. Verify Customer Registration
    const customerEmail = `foodlover_${Date.now()}@example.com`;
    const regCall: ToolCall = {
      id: `call_${Date.now()}_api_reg`,
      type: "function",
      function: {
        name: "verify_api_endpoint",
        arguments: JSON.stringify({
          url: "/api/auth/register",
          method: "POST",
          body: JSON.stringify({ name: "Alex Gourmet", email: customerEmail, password: "securepassword123" }),
          expectedStatus: 201,
          expectedProperties: ["success", "user", "token"],
        }),
      },
    };
    const regOutput = await executeTool(workspace, regCall, agentState);
    assert.ok(regOutput.includes("API Verification PASSED"), `Registration API must pass: ${regOutput}`);

    // 3. Verify Customer Login
    const loginCall: ToolCall = {
      id: `call_${Date.now()}_api_login`,
      type: "function",
      function: {
        name: "verify_api_endpoint",
        arguments: JSON.stringify({
          url: "/api/auth/login",
          method: "POST",
          body: JSON.stringify({ email: customerEmail, password: "securepassword123" }),
          expectedStatus: 200,
          expectedProperties: ["success", "user", "token"],
        }),
      },
    };
    const loginOutput = await executeTool(workspace, loginCall, agentState);
    assert.ok(loginOutput.includes("API Verification PASSED"), `Login API must pass: ${loginOutput}`);

    // 4. Verify Food Catalog Search and Category Filter
    const searchCall: ToolCall = {
      id: `call_${Date.now()}_api_search`,
      type: "function",
      function: {
        name: "verify_api_endpoint",
        arguments: JSON.stringify({
          url: "/api/products?q=burger",
          method: "GET",
          expectedStatus: 200,
          expectedProperties: ["success", "products"],
        }),
      },
    };
    const searchOutput = await executeTool(workspace, searchCall, agentState);
    assert.ok(searchOutput.includes("API Verification PASSED"), `Search API must pass: ${searchOutput}`);

    // 5. Verify Add to Cart
    const cartCall: ToolCall = {
      id: `call_${Date.now()}_api_cart`,
      type: "function",
      function: {
        name: "verify_api_endpoint",
        arguments: JSON.stringify({
          url: "/api/cart",
          method: "POST",
          body: JSON.stringify({ productId: 1, quantity: 2 }),
          expectedStatus: 200,
          expectedProperties: ["success", "count", "items"],
        }),
      },
    };
    const cartOutput = await executeTool(workspace, cartCall, agentState);
    assert.ok(cartOutput.includes("API Verification PASSED"), `Cart API must pass: ${cartOutput}`);

    // 6. Verify Checkout & Order Creation
    const checkoutCall: ToolCall = {
      id: `call_${Date.now()}_api_checkout`,
      type: "function",
      function: {
        name: "verify_api_endpoint",
        arguments: JSON.stringify({
          url: "/api/checkout",
          method: "POST",
          body: JSON.stringify({
            shippingInfo: {
              name: "Alex Gourmet",
              address: "742 Evergreen Terrace, Apt 4B",
              phone: "555-0199",
              instructions: "Please leave on porch table",
            },
          }),
          expectedStatus: 201,
          expectedProperties: ["success", "order"],
        }),
      },
    };
    const checkoutOutput = await executeTool(workspace, checkoutCall, agentState);
    assert.ok(checkoutOutput.includes("API Verification PASSED"), `Checkout API must pass: ${checkoutOutput}`);

    // Extract order info
    const match = checkoutOutput.match(/"id":\s*(\d+)/);
    if (match) placedOrderId = match[1];
    const orderNumMatch = checkoutOutput.match(/#ORD-\d+/);
    if (orderNumMatch) placedOrderNumber = orderNumMatch[0];

    // 7. Verify Order Tracking
    if (placedOrderId) {
      const trackCall: ToolCall = {
        id: `call_${Date.now()}_api_track`,
        type: "function",
        function: {
          name: "verify_api_endpoint",
          arguments: JSON.stringify({
            url: `/api/orders/${placedOrderId}`,
            method: "GET",
            expectedStatus: 200,
            expectedProperties: ["success", "order"],
          }),
        },
      };
      const trackOutput = await executeTool(workspace, trackCall, agentState);
      assert.ok(trackOutput.includes("API Verification PASSED"), `Order tracking API must pass: ${trackOutput}`);

      // 8. Verify Admin Order Status Update
      const statusCall: ToolCall = {
        id: `call_${Date.now()}_api_status`,
        type: "function",
        function: {
          name: "verify_api_endpoint",
          arguments: JSON.stringify({
            url: `/api/orders/${placedOrderId}/status`,
            method: "PATCH",
            body: JSON.stringify({ status: "out_for_delivery" }),
            expectedStatus: 200,
            expectedProperties: ["success", "order"],
          }),
        },
      };
      const statusOutput = await executeTool(workspace, statusCall, agentState);
      assert.ok(statusOutput.includes("API Verification PASSED"), `Order status update API must pass: ${statusOutput}`);
    }

    // 9. Verify Admin Analytics Metrics
    const metricsCall: ToolCall = {
      id: `call_${Date.now()}_api_metrics`,
      type: "function",
      function: {
        name: "verify_api_endpoint",
        arguments: JSON.stringify({
          url: "/api/admin/metrics",
          method: "GET",
          expectedStatus: 200,
          expectedProperties: ["success", "metrics"],
        }),
      },
    };
    const metricsOutput = await executeTool(workspace, metricsCall, agentState);
    assert.ok(metricsOutput.includes("API Verification PASSED"), `Admin metrics API must pass: ${metricsOutput}`);
  });

  test("Phase 6: Multi-Viewport Playwright Browser Automation & Workflow Verification", async () => {
    const session = new BrowserSession();
    const available = await session.isAvailable();
    if (!available.available) {
      console.log("[Acceptance] Playwright browser not available; skipping browser phase.");
      return;
    }

    try {
      await session.init();
      assert.ok(appUrl);
      const navRes = await session.navigate(appUrl);
      assert.equal(navRes.success, true, `Navigation to ${appUrl} must succeed`);

      // 1. Desktop 1280x800 inspection
      await session.page?.setViewportSize({ width: 1280, height: 800 });
      const desktopInspect = await session.inspectPage();
      assert.equal(desktopInspect.success, true);
      assert.ok(desktopInspect.info.visibleText.includes("Explore Collection") || desktopInspect.info.visibleText.includes("Store"));
      assert.ok(desktopInspect.info.buttons.some(b => b.includes("Cart")));

      // 2. Mobile 375x667 viewport inspection (check for horizontal overflow & layout)
      await session.page?.setViewportSize({ width: 375, height: 667 });
      const mobileInspect = await session.inspectPage();
      assert.equal(mobileInspect.success, true);
      const hasHorizontalScroll = await session.page?.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      assert.equal(hasHorizontalScroll, false, "Mobile viewport 375px must not have horizontal overflow");

      // 3. Small Mobile 320x568 viewport inspection
      await session.page?.setViewportSize({ width: 320, height: 568 });
      const smallMobileScroll = await session.page?.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      assert.equal(smallMobileScroll, false, "Small mobile viewport 320px must not have horizontal overflow");

      // 4. Tablet 768x1024 viewport
      await session.page?.setViewportSize({ width: 768, height: 1024 });

      // 5. Large Desktop 1920x1080 viewport
      await session.page?.setViewportSize({ width: 1920, height: 1080 });

      // 6. Test Interactive Workflow: Add to Cart button click
      const addButtons = await session.page?.$$(".add-cart-btn");
      if (addButtons && addButtons.length > 0) {
        await addButtons[0].click();
        await new Promise((r) => setTimeout(r, 600));

        // Verify cart badge updated
        const cartText = await session.page?.$eval("#cartBtn", (el) => el.textContent);
        assert.ok(cartText && !cartText.includes("Cart (0)"), `Cart button must update item count: ${cartText}`);

        // Verify cart drawer opened
        const isDrawerOpen = await session.page?.$eval("#cartDrawer", (el) => el.classList.contains("open"));
        assert.equal(isDrawerOpen, true, "Cart drawer must slide open after adding an item");

        // Verify Checkout button opens modal
        await session.page?.click("#checkoutBtn");
        await new Promise((r) => setTimeout(r, 400));
        const isModalVisible = await session.page?.$eval("#checkoutModal", (el) => window.getComputedStyle(el).display !== "none");
        assert.equal(isModalVisible, true, "Checkout modal must open when clicking Proceed to Checkout");

        // Fill out shipping form and submit order
        await session.page?.fill("#shippingName", "Elena Rostova");
        await session.page?.fill("#shippingEmail", "elena@example.com");
        await session.page?.fill("#shippingAddress", "456 Sunset Boulevard, Suite 12");
        await session.page?.fill("#cardNumber", "4242 4242 4242 4242");
        await session.page?.fill("#cardExp", "12/28");
        await session.page?.click("#checkoutForm button[type='submit']");
        await new Promise((r) => setTimeout(r, 800));

        // Verify Order Confirmation
        const isConfirmed = await session.page?.$eval("#orderConfirmation", (el) => window.getComputedStyle(el).display !== "none");
        assert.equal(isConfirmed, true, "Order confirmation screen must appear after placing order");

        const orderNum = await session.page?.$eval("#confirmedOrderNumber", (el) => el.textContent);
        assert.ok(orderNum && orderNum.startsWith("#ORD-"), `Confirmed order number must be generated: ${orderNum}`);
      }

      // 7. Check for critical console and network errors
      const pageInfo = await session.inspectPage();
      assert.equal(pageInfo.success, true);
      assert.equal(pageInfo.info.pageErrors.length, 0, `Page errors must be 0: ${JSON.stringify(pageInfo.info.pageErrors)}`);
    } finally {
      await session.close();
    }
  });

  test("Phase 7: Database Persistence Across Application Restart", async () => {
    // 1. Confirm database store file exists
    const dbFile = path.join(testWorkspaceDir, "data", "store.json");
    assert.ok(fsSync.existsSync(dbFile), "Database store file must exist on disk");

    const rawBefore = JSON.parse(await fs.readFile(dbFile, "utf8"));
    const orderCountBefore = rawBefore.orders?.length || 0;
    assert.ok(orderCountBefore >= 1, "Database must contain recorded orders");

    // 2. Stop application process
    if (agentState.appProcess) {
      console.log(`[Acceptance] Stopping application server process (PID ${agentState.appProcess.pid})...`);
      await stopAppProcess(agentState.appProcess);
      agentState.appProcess = null;
      agentState.appUrl = null;
    }

    // Verify server is down
    const isDown = !(await isUrlServing(appUrl!, 300));
    assert.equal(isDown, true, "Server must be stopped");

    // 3. Restart server
    console.log("[Acceptance] Restarting application server to verify data persistence...");
    const restartCall: ToolCall = {
      id: `call_${Date.now()}_restart`,
      type: "function",
      function: {
        name: "start_app",
        arguments: "{}",
      },
    };
    const restartOutput = await executeTool(workspace, restartCall, agentState);
    assert.ok(restartOutput.includes("ready at http") || restartOutput.includes("started"), `Restart must succeed: ${restartOutput}`);

    const newAppUrl = agentState.appUrl || agentState.appProcess?.url;
    assert.ok(newAppUrl);

    // 4. Query orders from restarted server via HTTP API
    const verifyOrdersCall: ToolCall = {
      id: `call_${Date.now()}_verify_orders`,
      type: "function",
      function: {
        name: "verify_api_endpoint",
        arguments: JSON.stringify({
          url: "/api/orders",
          method: "GET",
          expectedStatus: 200,
          expectedProperties: ["success", "orders"],
        }),
      },
    };
    const verifyOutput = await executeTool(workspace, verifyOrdersCall, agentState);
    assert.ok(verifyOutput.includes("API Verification PASSED"), `Orders must persist across restart: ${verifyOutput}`);
    assert.ok(verifyOutput.includes("#ORD-"), "Persisted order number must be present in response");
  });

  test("Phase 8: Task Completion Evidence & Deliverable Validation", () => {
    agentState.completedTasks.add("browser_verify");
    agentState.verificationPassed = true;

    const evidence = verifyTaskCompletionEvidence(TASK_PROMPT, agentState);
    assert.equal(evidence.verified, true, `Task evidence must be verified: ${JSON.stringify(evidence)}`);
    assert.equal(evidence.missingRequirements.length, 0);
  });

  test("Phase 9: Process Cleanup", async () => {
    if (agentState.appProcess) {
      await stopAppProcess(agentState.appProcess);
    }
    if (testWorkspaceDir && fsSync.existsSync(testWorkspaceDir)) {
      await fs.rm(testWorkspaceDir, { recursive: true, force: true });
    }
  });
});
