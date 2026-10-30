import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  isStaticSiteWorkspace,
  detectStartCommand,
} from "../src/tools/app-lifecycle.js";
import { Workspace } from "../src/tools/workspace.js";
import { initializePlan, updatePlanProgress } from "../src/agent.js";

test("Full-Stack Server Lifecycle & Planning Regression Suite", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "achu-fs-reg-"));

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test("1. isStaticSiteWorkspace correctly distinguishes frontend app.js from backend server app.js", async () => {
    const staticDir = path.join(tmpDir, "static-site");
    fs.mkdirSync(staticDir, { recursive: true });
    fs.writeFileSync(path.join(staticDir, "index.html"), "<!DOCTYPE html><html><body><h1>Hello</h1><script src='app.js'></script></body></html>");
    fs.writeFileSync(path.join(staticDir, "app.js"), "document.addEventListener('DOMContentLoaded', () => { console.log('client ready'); });");

    // Must be classified as static site because app.js contains client code without .listen()
    assert.equal(isStaticSiteWorkspace(staticDir), true, "Frontend client app.js should remain a static site");

    // Add server.js
    const fullstackDir = path.join(tmpDir, "fullstack-site");
    fs.mkdirSync(fullstackDir, { recursive: true });
    fs.writeFileSync(path.join(fullstackDir, "index.html"), "<!DOCTYPE html><html><body><h1>API UI</h1></body></html>");
    fs.writeFileSync(path.join(fullstackDir, "server.js"), "const http = require('http'); const server = http.createServer(); server.listen(3000);");

    assert.equal(isStaticSiteWorkspace(fullstackDir), false, "Workspace with server.js must NOT be classified as static site");

    // Workspace with backend app.js having .listen()
    const backendAppDir = path.join(tmpDir, "backend-app-site");
    fs.mkdirSync(backendAppDir, { recursive: true });
    fs.writeFileSync(path.join(backendAppDir, "index.html"), "<!DOCTYPE html><html><body><h1>API UI</h1></body></html>");
    fs.writeFileSync(path.join(backendAppDir, "app.js"), "const express = require('express'); const app = express(); app.listen(3000);");

    assert.equal(isStaticSiteWorkspace(backendAppDir), false, "Workspace with backend app.js (.listen) must NOT be classified as static site");
  });

  await t.test("2. detectStartCommand falls back to node server.js when package.json lacks scripts", async () => {
    const standaloneDir = path.join(tmpDir, "standalone-server");
    fs.mkdirSync(standaloneDir, { recursive: true });
    fs.writeFileSync(path.join(standaloneDir, "server.js"), "import http from 'node:http';");
    const ws = new Workspace(standaloneDir);

    const startCmd = await detectStartCommand(ws);
    assert.equal(startCmd.command, "node server.js", "Should fallback to node server.js when server.js exists");
  });

  await t.test("3. initializePlan plans full-stack files (package.json, server.js) when backend/database requested", () => {
    const task = "Build a full-stack project hub with Node.js backend, SQLite database persistence, and client dashboard";
    const plan = initializePlan(task, {
      hasProject: false,
      projectType: "none",
      existingFiles: [],
      framework: null,
    });

    const hasServerStep = plan.some((s) => s.target === "server.js" || s.description.toLowerCase().includes("server.js"));
    const hasPkgStep = plan.some((s) => s.target === "package.json" || s.description.toLowerCase().includes("package.json"));
    const hasIndexStep = plan.some((s) => s.target === "index.html");
    const hasStartApp = plan.some((s) => s.toolType === "start_app");
    const hasBrowserVerify = plan.some((s) => s.toolType === "browser_verify");

    assert.ok(hasServerStep, "Full-stack plan must include server.js step");
    assert.ok(hasPkgStep, "Full-stack plan must include package.json step");
    assert.ok(hasIndexStep, "Full-stack plan must include index.html step");
    assert.ok(hasStartApp, "Full-stack plan must include start_app step");
    assert.ok(hasBrowserVerify, "Full-stack plan must include browser_verify step");
  });

  await t.test("4. updatePlanProgress treats app.js and script.js as equivalent client scripts", () => {
    const initialPlan = [
      { id: "1", description: "Create index.html", status: "completed" as const, toolType: "create_file", target: "index.html" },
      { id: "2", description: "Create script.js", status: "pending" as const, toolType: "create_file", target: "script.js" },
    ];

    const completedTasks = new Set<string>();
    const toolCall = {
      id: "call_1",
      type: "function" as const,
      function: {
        name: "create_file",
        arguments: JSON.stringify({ path: "app.js", content: "console.log('client');" }),
      },
    };

    const updated = updatePlanProgress(initialPlan, completedTasks, toolCall, "File created: app.js");
    const scriptStep = updated.find((s) => s.id === "2");
    assert.equal(scriptStep?.status, "completed", "Creating app.js should satisfy script.js plan step");
  });
});
