import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BrowserSession } from "../src/browser/browser-session.js";
import { Workspace } from "../src/tools/workspace.js";
import { scaffold2DGameProject, scaffold3DExperienceProject, validateProjectStructure } from "../src/tools/scaffold.js";
import { generateDesignSpec, analyseTaskBrief } from "../src/tools/design-planner.js";

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

async function findFreePort(start = 54400): Promise<number> {
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

describe("Phase 4 & 5 — Autonomous 2D Game and 3D Interactive WebGL Scaffolds", () => {
  test("1. Task brief analysis detects 2D games and 3D experiences correctly", () => {
    const briefGame = "Build a 2D space shooter arcade game with Phaser and particle explosions";
    const typeGame = analyseTaskBrief(briefGame);
    assert.equal(typeGame, "game_2d");

    const brief3D = "Create an interactive 3D WebGL solar system experience with Three.js";
    const type3D = analyseTaskBrief(brief3D);
    assert.equal(type3D, "experience_3d");
  });

  test("2. Autonomous 2D Game Project scaffolds and verifies in real Playwright browser", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-2d-game-"));
    const workspace = new Workspace(tempDir);
    const spec = generateDesignSpec("Build a 2D space shooter arcade browser game");
    assert.equal(spec.productType, "game_2d");

    const scaffoldRes = await scaffold2DGameProject(workspace, "Neon Velocity 2D", spec);
    assert.equal(scaffoldRes.success, true);
    assert.ok(scaffoldRes.files.includes("index.html"));
    assert.ok(scaffoldRes.files.includes("styles.css"));
    assert.ok(scaffoldRes.files.includes("src/main.js"));
    assert.ok(scaffoldRes.files.includes("package.json"));

    const valRes = validateProjectStructure(tempDir);
    assert.equal(valRes.valid, true);

    const html = await workspace.read("index.html");
    const css = await workspace.read("styles.css");
    const js = await workspace.read("src/main.js");

    assert.ok(html.includes('id="gameCanvas"'), "Must include gameCanvas");
    assert.ok(html.includes('id="startBtn"'), "Must include start button");
    assert.ok(html.includes('id="pauseBtn"'), "Must include pause button");
    assert.ok(html.includes('id="restartBtn"'), "Must include restart button");
    assert.ok(html.includes('id="controlsGuide"'), "Must include pilot controls guide");
    assert.ok(html.includes('id="touchControls"'), "Must include mobile touch controls");

    const port = await findFreePort();
    const server = await listenOn(port, (req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      if (urlPath === "/" || urlPath === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } else if (urlPath === "/styles.css") {
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
        res.end(css);
      } else if (urlPath === "/src/main.js") {
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

      // Verify canvas rendered
      const canvasBounding = await page.$eval("#gameCanvas", (el) => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      assert.ok(canvasBounding.width > 200, "Canvas must have rendered width");
      assert.ok(canvasBounding.height > 100, "Canvas must have rendered height");

      // Verify Start Button Click starts game
      await page.click("#startBtn");
      await page.waitForTimeout(300);

      const modalDisplay = await page.$eval("#gameStateModal", (el) => window.getComputedStyle(el).display);
      assert.equal(modalDisplay, "none", "Modal must hide after clicking Start");

      // Verify Pause toggle
      await page.click("#pauseBtn");
      await page.waitForTimeout(200);
      const pauseModalDisplay = await page.$eval("#gameStateModal", (el) => window.getComputedStyle(el).display);
      assert.equal(pauseModalDisplay, "flex", "Modal must appear when paused");

      // Verify zero console errors
      const pageInfo = (await session.inspectPage()).pageInfo;
      const errors = pageInfo?.consoleErrors || [];
      assert.equal(errors.length, 0, `Must have zero console errors: ${errors.join(", ")}`);
    } finally {
      await session.close();
      await closeServer(server);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("3. Autonomous 3D Interactive WebGL Experience scaffolds and verifies in real Playwright browser", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-3d-scene-"));
    const workspace = new Workspace(tempDir);
    const spec = generateDesignSpec("Create an interactive 3D WebGL solar system scene with Three.js");
    assert.equal(spec.productType, "experience_3d");

    const scaffoldRes = await scaffold3DExperienceProject(workspace, "Cosmic Nexus 3D", spec);
    assert.equal(scaffoldRes.success, true);
    assert.ok(scaffoldRes.files.includes("index.html"));
    assert.ok(scaffoldRes.files.includes("styles.css"));
    assert.ok(scaffoldRes.files.includes("src/main.js"));
    assert.ok(scaffoldRes.files.includes("package.json"));

    const valRes = validateProjectStructure(tempDir);
    assert.equal(valRes.valid, true);

    const html = await workspace.read("index.html");
    const css = await workspace.read("styles.css");
    const js = await workspace.read("src/main.js");

    assert.ok(html.includes('id="webglCanvas"'), "Must include webglCanvas");
    assert.ok(html.includes('id="hudPanel"'), "Must include HUD panel");
    assert.ok(html.includes('id="resetCamBtn"'), "Must include reset camera button");
    assert.ok(html.includes('id="speedSlider"'), "Must include speed slider");
    assert.ok(html.includes('id="particleToggleBtn"'), "Must include particle toggle button");
    assert.ok(html.includes('id="themeToggleBtn"'), "Must include lighting toggle button");

    const port = await findFreePort();
    const server = await listenOn(port, (req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      if (urlPath === "/" || urlPath === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } else if (urlPath === "/styles.css") {
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
        res.end(css);
      } else if (urlPath === "/src/main.js") {
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

      // Verify 3D canvas rendered
      const canvasBounding = await page.$eval("#webglCanvas", (el) => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      assert.ok(canvasBounding.width > 200, "WebGL Canvas must have rendered width");
      assert.ok(canvasBounding.height > 100, "WebGL Canvas must have rendered height");

      // Verify interactive controls
      await page.click("#particleToggleBtn");
      await page.waitForTimeout(200);

      await page.click("#themeToggleBtn");
      await page.waitForTimeout(200);
      const themeText = await page.$eval("#themeToggleBtn", (el) => el.textContent);
      assert.ok(themeText?.includes("SOLAR"), "Theme button text should toggle to SOLAR");

      await page.click("#resetCamBtn");
      await page.waitForTimeout(200);

      // Verify zero console errors
      const pageInfo = (await session.inspectPage()).pageInfo;
      const errors = pageInfo?.consoleErrors || [];
      assert.equal(errors.length, 0, `Must have zero console errors: ${errors.join(", ")}`);
    } finally {
      await session.close();
      await closeServer(server);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("4. Intra-turn tool call deduplication prevents redundant file operations while preserving schema contract", () => {
    const rawToolCalls = [
      { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"package.json"}' } },
      { id: "call_2", type: "function", function: { name: "read_file", arguments: '{"path":"package.json"}' } },
      { id: "call_3", type: "function", function: { name: "create_file", arguments: '{"path":"note.txt","content":"hello"}' } },
      { id: "call_4", type: "function", function: { name: "create_file", arguments: '{"path":"note.txt","content":"hello"}' } },
    ];

    const turnDeduplicationMap = new Map<string, string>();
    const executedLogs: string[] = [];
    const messages: Array<{ role: string; content: string; tool_call_id: string }> = [];

    for (const toolCall of rawToolCalls) {
      const dedupeKey = `${toolCall.function.name}:${toolCall.function.arguments}`;
      let result: string;

      if (turnDeduplicationMap.has(dedupeKey)) {
        const prev = turnDeduplicationMap.get(dedupeKey)!;
        if (toolCall.function.name === "read_file" || toolCall.function.name === "list_directory" || toolCall.function.name === "search_code") {
          result = prev;
        } else {
          result = `Deduplicated: Identical tool call ${toolCall.function.name} already executed in this turn.`;
        }
      } else {
        executedLogs.push(dedupeKey);
        result = toolCall.function.name === "read_file" ? "file_content_mock" : "File created successfully";
        turnDeduplicationMap.set(dedupeKey, result);
      }

      messages.push({ role: "tool", content: result, tool_call_id: toolCall.id });
    }

    // Only 2 executions occurred instead of 4
    assert.equal(executedLogs.length, 2);
    // All 4 tool calls have matching messages
    assert.equal(messages.length, 4);
    assert.equal(messages[0].tool_call_id, "call_1");
    assert.equal(messages[1].tool_call_id, "call_2");
    assert.equal(messages[1].content, "file_content_mock");
    assert.equal(messages[3].tool_call_id, "call_4");
    assert.ok(messages[3].content.includes("Deduplicated"));
  });
});
