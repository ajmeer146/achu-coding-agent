import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import { Workspace } from "../src/tools/workspace.js";
import { searchCode } from "../src/tools/search-code.js";
import { CodeIndexer } from "../src/tools/indexer.js";

test("searchCode - incremental indexing and targeted search", async () => {
  const root = path.join(process.cwd(), "test-workspace-search");
  await fs.mkdir(root, { recursive: true });

  try {
    const ws = new Workspace(root);
    await ws.write("index.ts", `
      import { util } from "./util";
      export class Main {
        run() {}
      }
      export const config = {};
      export async function start() {}
    `);
    
    await ws.write("util.ts", `
      export function util() { return 1; }
    `);

    // Give it a small delay for mtime resolution
    await new Promise(r => setTimeout(r, 100));

    // Test text search
    const textRes = await searchCode(ws, "run()", "text");
    assert(textRes.includes("index.ts"), "Should find text in index.ts");

    // Test symbol search
    const symRes1 = await searchCode(ws, "Main", "symbol");
    assert(symRes1.includes("index.ts") && symRes1.includes("[class]"), "Should find class Main");

    const symRes2 = await searchCode(ws, "start", "symbol");
    assert(symRes2.includes("index.ts") && symRes2.includes("[function]"), "Should find function start");

    const symRes3 = await searchCode(ws, "util", "symbol");
    assert(symRes3.includes("util.ts") && symRes3.includes("[function]"), "Should find function util in util.ts");

    // Test export const
    const symRes4 = await searchCode(ws, "config", "symbol");
    assert(symRes4.includes("index.ts") && symRes4.includes("[export]"), "Should find exported const config");

    // Test imports search
    const impRes = await searchCode(ws, "./util", "imports");
    assert(impRes.includes("index.ts") && impRes.includes("import"), "Should find import in index.ts");

    // Test path search
    const pathRes = await searchCode(ws, "util.ts", "path");
    assert(pathRes.includes("util.ts"), "Should find path");

  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
