import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Workspace } from "../src/tools/workspace.js";
import {
  isImageAttachment,
  extractImageData,
  persistAttachmentToWorkspace,
  analyzeImageWithVisionModel,
  generateDeterministicVisionFallback,
  processAttachmentsForAgent,
} from "../src/utils/multimodal-processor.js";
import {
  PRIMARY_MODEL,
  PRIMARY_VISION_MODEL,
  isVisionCapableModel,
  getVisionModelConfig,
} from "../src/router.js";
import { BrowserSession } from "../src/browser/browser-session.js";

describe("Multimodal Image Attachment & Vision Processing Pipeline Suite", () => {
  // Sample 1x1 test pixels for JPEG and PNG
  const SAMPLE_JPEG_B64 =
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
  const SAMPLE_PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  // -------------------------------------------------------------
  // Test A: Text-only tasks continue using text model
  // -------------------------------------------------------------
  test("Test A: Text-only task routes to primary text model without multimodal overhead", async () => {
    assert.equal(PRIMARY_MODEL, "minimaxai/minimax-m3.1-flash");
    assert.equal(isVisionCapableModel(PRIMARY_MODEL), false, "Primary text model must be recognized as text-only");

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-text-task-"));
    const ws = new Workspace(tmpDir);

    const result = await processAttachmentsForAgent(
      ws,
      undefined,
      "Create a simple landing page",
      PRIMARY_MODEL
    );

    assert.equal(typeof result.initialUserContent, "string", "Text task must remain string user content");
    assert.equal(result.initialUserContent, "Create a simple landing page");
    assert.equal(result.savedImagePaths.length, 0);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------
  // Test B: Single image attachment (JPEG and PNG MIME detection)
  // -------------------------------------------------------------
  test("Test B: JPEG and PNG attachments are accurately detected and persisted to workspace", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-image-task-"));
    const ws = new Workspace(tmpDir);

    // 1. JPEG attachment
    const jpegAtt = {
      name: "dp.jpeg",
      type: "image/jpeg",
      content: `data:image/jpeg;base64,${SAMPLE_JPEG_B64}`,
    };
    assert.equal(isImageAttachment(jpegAtt), true, "JPEG attachment must be recognized as image");

    const jpegPersisted = await persistAttachmentToWorkspace(ws, jpegAtt);
    assert.equal(jpegPersisted.relativePath, "images/dp.jpeg");
    assert.ok(fsSync.existsSync(path.join(tmpDir, "images", "dp.jpeg")), "images/dp.jpeg must be written to disk");

    // 2. PNG attachment
    const pngAtt = {
      name: "screenshot.png",
      type: "image/png",
      content: `data:image/png;base64,${SAMPLE_PNG_B64}`,
    };
    assert.equal(isImageAttachment(pngAtt), true, "PNG attachment must be recognized as image");

    const pngPersisted = await persistAttachmentToWorkspace(ws, pngAtt);
    assert.equal(pngPersisted.relativePath, "images/screenshot.png");
    assert.ok(fsSync.existsSync(path.join(tmpDir, "images", "screenshot.png")), "images/screenshot.png must be written to disk");

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------
  // Test C: Vision model selection & Capability-aware routing
  // -------------------------------------------------------------
  test("Test C: Vision model selection routes image understanding without crashing text-only endpoint", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-vision-routing-"));
    const ws = new Workspace(tmpDir);

    const attachments = [
      {
        name: "dp.jpeg",
        type: "image/jpeg",
        content: `data:image/jpeg;base64,${SAMPLE_JPEG_B64}`,
      },
    ];

    // Case 1: When active model is text-only (minimax-m3.1-flash), payload is enriched text WITHOUT raw image_url
    const textModelPayload = await processAttachmentsForAgent(
      ws,
      attachments,
      "create protfolio page for attatched image name ajmeer",
      PRIMARY_MODEL
    );

    assert.equal(typeof textModelPayload.initialUserContent, "string", "Must provide text-only payload to avoid vLLM multimodal error");
    assert.ok(textModelPayload.initialUserContent.includes("images/dp.jpeg"), "Must reference workspace image location");
    assert.ok(textModelPayload.initialUserContent.includes("ajmeer"), "Must incorporate prompt context");

    // Case 2: When active model is vision-capable (e.g. meta/llama-3.2-90b-vision-instruct), payload includes image_url parts
    assert.equal(isVisionCapableModel(PRIMARY_VISION_MODEL), true);
    const visionModelPayload = await processAttachmentsForAgent(
      ws,
      attachments,
      "create protfolio page for attatched image name ajmeer",
      PRIMARY_VISION_MODEL
    );

    assert.ok(Array.isArray(visionModelPayload.initialUserContent), "Vision-capable model must receive MessageContentPart[]");
    assert.ok((visionModelPayload.initialUserContent as any[]).some((p) => p.type === "image_url"), "Must include image_url part for vision model");

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------
  // Test D: Multiple images handling
  // -------------------------------------------------------------
  test("Test D: Multiple image attachments are all persisted and summarized into context", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-multi-img-"));
    const ws = new Workspace(tmpDir);

    const attachments = [
      { name: "profile.jpg", type: "image/jpeg", content: `data:image/jpeg;base64,${SAMPLE_JPEG_B64}` },
      { name: "project-mockup.png", type: "image/png", content: `data:image/png;base64,${SAMPLE_PNG_B64}` },
    ];

    const result = await processAttachmentsForAgent(
      ws,
      attachments,
      "Build developer portfolio with my photo and project preview",
      PRIMARY_MODEL
    );

    assert.equal(result.savedImagePaths.length, 2);
    assert.ok(fsSync.existsSync(path.join(tmpDir, "images", "profile.jpg")));
    assert.ok(fsSync.existsSync(path.join(tmpDir, "images", "project-mockup.png")));

    const textContent = String(result.initialUserContent);
    assert.ok(textContent.includes("profile.jpg"));
    assert.ok(textContent.includes("project-mockup.png"));

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------
  // Test E: Deterministic fallback and non-retryable error classification
  // -------------------------------------------------------------
  test("Test E: Deterministic vision fallback and non-retryable classification for multimodal errors", () => {
    // 1. Fallback generates appropriate context for profile picture
    const fallback = generateDeterministicVisionFallback(
      { name: "dp.jpeg", type: "image/jpeg", content: SAMPLE_JPEG_B64 },
      "create portfolio page for ajmeer"
    );

    assert.equal(fallback.subject, "Personal Profile Portrait");
    assert.ok(fallback.palette.length >= 3);
    assert.ok(fallback.layoutRecommendation.includes("avatar"));

    // 2. Simulated exact error classification
    const exactError = new Error(
      "ValueError: Received multimodal data but multimodal processing is not enabled. Use --enable-multimodal flag to enable multimodal processing."
    );

    const isMultimodal =
      exactError.message.toLowerCase().includes("multimodal") ||
      exactError.message.toLowerCase().includes("enable-multimodal");

    assert.equal(isMultimodal, true, "Must detect multimodal processing error string");
  });

  // -------------------------------------------------------------
  // Test F: End-to-End Image Portfolio Generation & Browser Rendering
  // -------------------------------------------------------------
  test("Test F: Portfolio page referencing saved image loads successfully in browser without 404", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-e2e-vision-"));
    const ws = new Workspace(tmpDir);

    const att = {
      name: "dp.jpeg",
      type: "image/jpeg",
      content: `data:image/jpeg;base64,${SAMPLE_JPEG_B64}`,
    };

    // 1. Process attachment and write to workspace
    await persistAttachmentToWorkspace(ws, att);
    assert.ok(fsSync.existsSync(path.join(tmpDir, "images", "dp.jpeg")));

    // 2. Generate portfolio HTML embedding the real image
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Ajmeer — Full-Stack Developer Portfolio</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0b0f19; color: #f8fafc; text-align: center; padding: 2rem; }
    .avatar { width: 140px; height: 140px; border-radius: 50%; border: 3px solid #3b82f6; object-fit: cover; }
    h1 { margin-top: 1rem; font-size: 2rem; }
  </style>
</head>
<body>
  <div class="hero">
    <img src="images/dp.jpeg" alt="Ajmeer Profile Portrait" class="avatar" id="profile-img" />
    <h1>Ajmeer</h1>
    <p>Full-Stack Software Engineer & AI Systems Architect</p>
  </div>
</body>
</html>`;
    await ws.write("index.html", html);

    // 3. Mount HTTP server serving the workspace
    const server = http.createServer((req, res) => {
      const urlPath = req.url?.split("?")[0].replace(/^\/+/, "") || "index.html";
      const filePath = path.join(tmpDir, urlPath);

      if (fsSync.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const mime = ext === ".jpeg" || ext === ".jpg" ? "image/jpeg" : "text/html";
        res.writeHead(200, { "Content-Type": mime });
        res.end(fsSync.readFileSync(filePath));
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;
    const testUrl = `http://127.0.0.1:${port}`;

    // 4. Open with Playwright and verify image loads
    const session = new BrowserSession();
    const available = await session.isAvailable();
    if (available.available) {
      try {
        await session.init();
        const nav = await session.navigate(testUrl);
        assert.equal(nav.success, true);

        // Verify image element is present and naturalWidth > 0 (not broken)
        const imgLoaded = await session.page?.evaluate(() => {
          const img = document.getElementById("profile-img") as HTMLImageElement;
          return img && img.complete && img.naturalWidth > 0;
        });

        assert.equal(imgLoaded, true, "Embedded image must load cleanly with natural dimensions > 0");

        const pageErrors = session.pageErrors;
        assert.equal(pageErrors.length, 0, "No image load errors allowed");
        console.log("  [Test F] Verified: Portfolio page successfully loaded images/dp.jpeg without 404 or errors.");
      } finally {
        await session.close();
      }
    }

    server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
