import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "https://www.workswithachu.me";
const RUN_ID = "run_06gpcl89i21cl5kcf9l3219ra2";
const SCREENSHOT_DIR = path.join(process.cwd(), "screenshots");

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

console.log("================================================================================");
console.log("   ACHU CODING AGENT — PRODUCTION QA: CLOUD PREVIEW IMAGE RENDERING AUDIT   ");
console.log("================================================================================");

// =============================================================================
// PHASE 1: RECOVER TASK & PREVIEW TOKEN
// =============================================================================
console.log("\n[PHASE 1] Initializing authorized session & querying task endpoint...");
const guestRes = await fetch(`${BASE_URL}/api/auth/guest`, { method: "POST" });
if (!guestRes.ok) {
  throw new Error(`Failed to create guest session: HTTP ${guestRes.status}`);
}
const authCookie = guestRes.headers.get("set-cookie") || "";
const guestUser = (await guestRes.json()).user;
console.log(`- Authenticated User: ${guestUser.id} (${guestUser.displayName})`);

const taskRes = await fetch(`${BASE_URL}/api/coding-agent/tasks/${RUN_ID}`, {
  headers: { cookie: authCookie },
});
if (!taskRes.ok) {
  throw new Error(`Failed to retrieve task ${RUN_ID}: HTTP ${taskRes.status}`);
}
const taskData = await taskRes.json();
const task = taskData.task;
console.log(`- Task Recovered: ${task.id}`);
console.log(`- Run ID: ${task.runId}`);
console.log(`- Status: ${task.status}`);
console.log(`- Artifacts Count: ${task.result?.artifacts?.length ?? 0}`);

const imageArtifact = task.result?.artifacts?.find((a) => a.path.includes("dp.jpeg"));
if (!imageArtifact) {
  throw new Error("Missing dp.jpeg in task artifacts!");
}
console.log(`- Image Artifact: ${imageArtifact.path} (${imageArtifact.content.length} chars base64 data URI)`);

const previewUrl = task.previewUrl;
if (!previewUrl) {
  throw new Error("No previewUrl returned for task!");
}
console.log(`- Preview Path: ${previewUrl.split("?")[0]}`);
console.log(`- Preview Token Present: ${previewUrl.includes("token=")}`);

// =============================================================================
// PHASE 2: PLAYWRIGHT BROWSER AUTOMATION & IMAGE NETWORK INTERCEPTION
// =============================================================================
console.log("\n[PHASE 2] Launching Playwright browser for external verification...");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();

let htmlResponseStatus = 0;
let htmlContentType = "";
let imgResponseStatus = 0;
let imgContentType = "";
let imgBufferLength = 0;
let imgIsJpeg = false;
let imgUrlPath = "";

pageInterception: {
  const page = await context.newPage();

  page.on("request", (req) => {
    console.log(`[Browser Request] ${req.method()} ${req.url()}`);
  });

  page.on("requestfailed", (req) => {
    console.log(`[Browser Request Failed] ${req.url()} - ${req.failure()?.errorText}`);
  });

  page.on("response", async (response) => {
    const url = response.url();
    console.log(`[Browser Response] ${response.status()} ${url}`);
    const cleanUrl = url.split("?")[0];

    if (cleanUrl.endsWith(`/preview/${RUN_ID}`) || cleanUrl.endsWith(`/preview/${RUN_ID}/`)) {
      htmlResponseStatus = response.status();
      htmlContentType = response.headers()["content-type"] || "";
    }

    if (cleanUrl.includes("images/dp.jpeg")) {
      imgResponseStatus = response.status();
      imgContentType = response.headers()["content-type"] || "";
      imgUrlPath = new URL(url).pathname;
      try {
        const body = await response.body();
        imgBufferLength = body.length;
        // Verify JPEG magic bytes FF D8
        imgIsJpeg = body.length > 2 && body[0] === 0xff && body[1] === 0xd8;
      } catch (err) {
        console.warn("Failed to read image response body:", err.message);
      }
    }
  });

  const fullPreviewUrl = `${BASE_URL}${previewUrl}`;
  console.log(`- Navigating to: ${BASE_URL}${previewUrl.split("?")[0]} (with signed token)`);
  await page.goto(fullPreviewUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait specifically for the image network response and for the DOM image to complete loading
  console.log("- Waiting for image network response and DOM render...");
  await page.waitForResponse((res) => res.url().includes("images/dp.jpeg"), { timeout: 30000 });
  await page.waitForFunction(() => {
    const img = document.querySelector("img.hero-avatar, img[src*='dp.jpeg']");
    return img && img.complete && img.naturalWidth > 0;
  }, { timeout: 15000 });

  console.log(`- HTML Response: HTTP ${htmlResponseStatus} (${htmlContentType})`);
  console.log(`- Image Response: HTTP ${imgResponseStatus} (${imgContentType})`);
  console.log(`- Image Buffer: ${imgBufferLength} bytes`);
  console.log(`- Image Binary Magic Bytes Valid (JPEG 0xFFD8): ${imgIsJpeg}`);
  console.log(`- Image URL Path: ${imgUrlPath}`);

  // Query image element state inside DOM
  const imgElement = page.locator("img.hero-avatar, img[src*='dp.jpeg']").first();
  await imgElement.waitFor({ state: "visible", timeout: 10000 });

  const domMetrics = await imgElement.evaluate((img) => {
    const rect = img.getBoundingClientRect();
    const style = window.getComputedStyle(img);
    return {
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      renderedWidth: rect.width,
      renderedHeight: rect.height,
      visible: style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0",
      src: img.currentSrc || img.src,
      alt: img.alt,
    };
  });

  console.log("\n- In-Browser Image DOM Metrics:");
  console.log(`  * complete: ${domMetrics.complete}`);
  console.log(`  * naturalWidth: ${domMetrics.naturalWidth}px`);
  console.log(`  * naturalHeight: ${domMetrics.naturalHeight}px`);
  console.log(`  * renderedSize: ${domMetrics.renderedWidth.toFixed(1)}px x ${domMetrics.renderedHeight.toFixed(1)}px`);
  console.log(`  * isVisible: ${domMetrics.visible}`);
  console.log(`  * altText: "${domMetrics.alt}"`);

  // Assertions for Phase 2
  if (htmlResponseStatus !== 200) throw new Error(`HTML status is ${htmlResponseStatus}`);
  if (imgResponseStatus !== 200) throw new Error(`Image status is ${imgResponseStatus}`);
  if (!imgContentType.includes("image/jpeg")) throw new Error(`Image Content-Type is ${imgContentType}`);
  if (!imgIsJpeg) throw new Error("Image buffer does not contain genuine JPEG binary bytes");
  if (!domMetrics.complete) throw new Error("Image complete is false");
  if (domMetrics.naturalWidth <= 0 || domMetrics.naturalHeight <= 0) throw new Error("Image natural dimensions are 0");
  if (!domMetrics.visible) throw new Error("Image is not visible");

  // =============================================================================
  // PHASE 3: MULTI-VIEWPORT VISUAL VERIFICATION & SCREENSHOTS
  // =============================================================================
  console.log("\n[PHASE 3] Performing multi-viewport audit and screenshot capture...");
  const viewports = [
    { name: "320px", width: 320, height: 568 },
    { name: "375px", width: 375, height: 667 },
    { name: "768px", width: 768, height: 1024 },
    { name: "1280px", width: 1280, height: 800 },
    { name: "1920px", width: 1920, height: 1080 },
  ];

  const viewportResults = [];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(300);

    const vpMetrics = await page.evaluate(() => {
      const img = document.querySelector("img.hero-avatar, img[src*='dp.jpeg']");
      const rect = img ? img.getBoundingClientRect() : null;
      const scrollW = document.documentElement.scrollWidth;
      const innerW = window.innerWidth;
      return {
        hasOverflow: scrollW > innerW,
        scrollWidth: scrollW,
        innerWidth: innerW,
        imgVisible: rect ? rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight : false,
        imgRect: rect ? { width: rect.width, height: rect.height } : null,
      };
    });

    const screenshotPath = path.join(SCREENSHOT_DIR, `preview-viewport-${vp.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    viewportResults.push({
      viewport: vp.name,
      dimensions: `${vp.width}x${vp.height}`,
      hasOverflow: vpMetrics.hasOverflow,
      imgVisible: vpMetrics.imgVisible,
      renderedImg: vpMetrics.imgRect ? `${vpMetrics.imgRect.width.toFixed(0)}x${vpMetrics.imgRect.height.toFixed(0)}` : "missing",
      screenshot: screenshotPath,
    });

    console.log(`  [${vp.name} Viewport] Overflow: ${vpMetrics.hasOverflow ? "FAIL" : "NONE (PASS)"} | Image Visible: ${vpMetrics.imgVisible ? "YES" : "NO"} | Image Rendered: ${vpMetrics.imgRect?.width.toFixed(0)}x${vpMetrics.imgRect?.height.toFixed(0)}px -> ${path.basename(screenshotPath)}`);
    if (vpMetrics.hasOverflow) {
      throw new Error(`Horizontal overflow detected at viewport ${vp.name}: scrollWidth=${vpMetrics.scrollWidth} > innerWidth=${vpMetrics.innerWidth}`);
    }
  }

  // =============================================================================
  // PHASE 4: REFRESH & PERSISTENCE VERIFICATION
  // =============================================================================
  console.log("\n[PHASE 4] Testing preview reload and fresh authenticated session...");
  // 1. Reload existing page
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => {
    const img = document.querySelector("img.hero-avatar, img[src*='dp.jpeg']");
    return img && img.complete && img.naturalWidth > 0;
  }, { timeout: 15000 });
  const reloadComplete = await page.locator("img.hero-avatar, img[src*='dp.jpeg']").first().evaluate((img) => img.complete && img.naturalWidth > 0);
  console.log(`- Page Reload Verification: Image loaded successfully = ${reloadComplete}`);
  if (!reloadComplete) throw new Error("Image failed to load after page reload");

  // 2. Fresh separate browser context (new cookies/session)
  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await page2.goto(fullPreviewUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page2.waitForFunction(() => {
    const img = document.querySelector("img.hero-avatar, img[src*='dp.jpeg']");
    return img && img.complete && img.naturalWidth > 0;
  }, { timeout: 15000 });
  const freshSessionComplete = await page2.locator("img.hero-avatar, img[src*='dp.jpeg']").first().evaluate((img) => img.complete && img.naturalWidth > 0);
  console.log(`- Fresh Context (Signed URL) Verification: Image loaded successfully = ${freshSessionComplete}`);
  if (!freshSessionComplete) throw new Error("Image failed to load in fresh browser context");
  await context2.close();

  await page.close();
}

await context.close();
await browser.close();

// =============================================================================
// PHASE 5: SECURITY AUDIT
// =============================================================================
console.log("\n[PHASE 5] Executing security authorization & boundary tests...");

async function safeFetch(url, opts = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(url, opts);
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

// Test A: Unauthorized preview access without token or cookie
const unauthPreviewRes = await safeFetch(`${BASE_URL}/api/coding-agent/preview/${RUN_ID}`);
console.log(`- Test A: Unauthenticated Preview Access -> HTTP ${unauthPreviewRes.status} (Expected: 403 Forbidden)`);
if (unauthPreviewRes.status !== 403) throw new Error(`Security Test A Failed: HTTP ${unauthPreviewRes.status}`);

await new Promise((r) => setTimeout(r, 200));

// Test B: Unauthorized image subresource access without token or cookie
const unauthImgRes = await safeFetch(`${BASE_URL}/api/coding-agent/preview/${RUN_ID}/images/dp.jpeg`);
console.log(`- Test B: Unauthenticated Image Access -> HTTP ${unauthImgRes.status} (Expected: 403 Forbidden)`);
if (unauthImgRes.status !== 403) throw new Error(`Security Test B Failed: HTTP ${unauthImgRes.status}`);

await new Promise((r) => setTimeout(r, 200));

// Test C: Tampered / Invalid Preview Token
const tamperedTokenUrl = `${BASE_URL}/api/coding-agent/preview/${RUN_ID}?token=tampered.invalid.token`;
const tamperedRes = await safeFetch(tamperedTokenUrl);
console.log(`- Test C: Tampered Preview Token Access -> HTTP ${tamperedRes.status} (Expected: 403 Forbidden)`);
if (tamperedRes.status !== 403) throw new Error(`Security Test C Failed: HTTP ${tamperedRes.status}`);

await new Promise((r) => setTimeout(r, 200));

// Test D: Path traversal attempt
const traversalUrl = `${BASE_URL}/api/coding-agent/preview/${RUN_ID}/../../package.json`;
const traversalRes = await safeFetch(traversalUrl, { headers: { cookie: authCookie } });
console.log(`- Test D: Path Traversal Attempt -> HTTP ${traversalRes.status} (Expected: 400 or 404 Blocked)`);
if (![400, 404].includes(traversalRes.status)) throw new Error(`Security Test D Failed: HTTP ${traversalRes.status}`);

console.log("\n================================================================================");
console.log("   ALL AUDIT PHASES COMPLETED WITH 100% SUCCESS — VERDICT: PASS   ");
console.log("================================================================================");
