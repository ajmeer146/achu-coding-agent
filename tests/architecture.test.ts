import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { Workspace } from "../src/tools/workspace.js";
import { parseArchitecture, formatArchitectureSummary } from "../src/tools/architecture-parser.js";

async function makeTempDir(label: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `achu-${label}-`));
  return fs.realpath(dir);
}

test("Architecture parser detects Node.js and TypeScript project", async () => {
  const dir = await makeTempDir("arch-node");
  
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
    name: "test-node",
    dependencies: { "express": "^4.17.1" },
    devDependencies: { "typescript": "^4.5.4" },
    scripts: { "build": "tsc", "start": "node dist/index.js" }
  }));
  
  await fs.mkdir(path.join(dir, "src"));
  await fs.writeFile(path.join(dir, "src", "index.ts"), `
    import express from 'express';
    import { Router } from './router.js';
    const app = express();
  `);

  const ws = new Workspace(dir);
  const arch = await parseArchitecture(ws);

  assert.equal(arch.projectType, "node");
  assert.equal(arch.hasTypeScript, true);
  assert.equal(arch.framework, "node");
  assert.equal(arch.packageScripts["build"], "tsc");
  assert.equal(arch.packageScripts["start"], "node dist/index.js");
  
  assert.equal(arch.entryPoints.length, 1);
  assert.equal(arch.entryPoints[0].path, "src/index.ts");
  assert.ok(arch.entryPoints[0].imports.includes("express"));
  assert.ok(arch.entryPoints[0].imports.includes("./router.js"));
  
  const summary = formatArchitectureSummary(arch);
  assert.ok(summary.includes("TypeScript: Yes"));
  assert.ok(summary.includes("- src/index.ts"));
  assert.ok(summary.includes("Imports: express, ./router.js"));
  
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("Architecture parser detects React and Vite", async () => {
  const dir = await makeTempDir("arch-react");
  
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
    name: "test-react",
    dependencies: { "react": "^18.0.0", "react-dom": "^18.0.0" },
    devDependencies: { "vite": "^4.0.0" },
  }));
  
  await fs.writeFile(path.join(dir, "vite.config.js"), `
    import { defineConfig } from 'vite';
    export default defineConfig({});
  `);
  
  await fs.mkdir(path.join(dir, "src"));
  await fs.writeFile(path.join(dir, "src", "main.jsx"), `
    import React from 'react';
    import ReactDOM from 'react-dom/client';
    import App from './App.jsx';
  `);

  const ws = new Workspace(dir);
  const arch = await parseArchitecture(ws);

  assert.equal(arch.projectType, "vite");
  assert.equal(arch.framework, "vite");
  
  assert.equal(arch.entryPoints.length, 1);
  assert.equal(arch.entryPoints[0].path, "src/main.jsx");
  assert.ok(arch.entryPoints[0].imports.includes("react"));
  assert.ok(arch.entryPoints[0].imports.includes("./App.jsx"));
  
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("Architecture parser ignores generated directories", async () => {
  const dir = await makeTempDir("arch-ignore");
  
  await fs.writeFile(path.join(dir, "index.html"), "<html></html>");
  
  await fs.mkdir(path.join(dir, "node_modules"));
  await fs.writeFile(path.join(dir, "node_modules", "test.js"), "console.log('test')");
  
  await fs.mkdir(path.join(dir, "dist"));
  await fs.writeFile(path.join(dir, "dist", "bundle.js"), "console.log('bundle')");

  const ws = new Workspace(dir);
  const arch = await parseArchitecture(ws);

  assert.equal(arch.projectType, "static");
  
  const summary = formatArchitectureSummary(arch);
  assert.ok(!summary.includes("node_modules/"));
  assert.ok(!summary.includes("dist/"));
  
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
