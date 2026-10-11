import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { Workspace } from "./workspace.js";
import { isInsideRoot } from "./workspace.js";

const IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  "coverage",
]);

const MAX_FILE_SIZE = 500 * 1024; // 500 KB
const MAX_INDEX_SIZE = 5000; // max files

interface FileIndex {
  mtime: number;
  symbols: Map<string, { type: "function" | "class" | "export", line: number }>;
  imports: Map<string, number>; // imported path -> line number
}

/**
 * Validates that a file path is contained within the workspace root.
 * Uses the same logic as Workspace.resolve() for consistency.
 */
function assertPathContained(workspace: Workspace, target: string, original: string): void {
  if (!isInsideRoot(workspace.root, target)) {
    throw new Error(`Path outside workspace is not allowed: ${original}`);
  }
  workspace.assertNoSymlinkEscape(target, original);
}

/**
 * Collects files while enforcing workspace boundaries and symlink protection.
 */
async function collectFiles(
  dir: string,
  root: string,
  results: string[],
  workspace: Workspace | null
): Promise<void> {
  if (results.length >= MAX_INDEX_SIZE) return;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      
      // Validate path containment for each entry
      if (workspace) {
        try {
          assertPathContained(workspace, fullPath, path.relative(root, fullPath));
        } catch {
          // Skip entries that escape the workspace
          continue;
        }
      }
      
      if (entry.isDirectory()) {
        await collectFiles(fullPath, root, results, workspace);
      } else {
        results.push(path.relative(root, fullPath));
      }
    }
  } catch {
    // Ignore permissions/missing
  }
}

export class CodeIndexer {
  private files = new Map<string, FileIndex>();
  private lastIndexTime = 0;

  async ensureIndexed(root: string, workspace?: Workspace): Promise<void> {
    const now = Date.now();
    // Re-index at most once every 2 seconds
    if (now - this.lastIndexTime < 2000) return;
    this.lastIndexTime = now;

    const toIndex: string[] = [];
    await collectFiles(root, root, toIndex, workspace ?? null);

    if (toIndex.length > MAX_INDEX_SIZE) {
      toIndex.length = MAX_INDEX_SIZE;
    }

    // Keep track of what we still have
    const validPaths = new Set(toIndex);
    for (const key of this.files.keys()) {
      if (!validPaths.has(key)) {
        this.files.delete(key);
      }
    }

    for (const relPath of toIndex) {
      let absPath: string;
      if (workspace) {
        // Use workspace.resolve for path validation and symlink protection
        try {
          absPath = workspace.resolve(relPath);
        } catch {
          // Path outside workspace - skip
          this.files.delete(relPath);
          continue;
        }
      } else {
        absPath = path.join(root, relPath);
      }
      
      try {
        const fileStat = await fs.stat(absPath);
        if (fileStat.size > MAX_FILE_SIZE) continue;

        const current = this.files.get(relPath);
        if (current && current.mtime === fileStat.mtimeMs) {
          continue; // Up to date
        }

        const ext = path.extname(relPath).toLowerCase();
        const isSource = [".ts", ".js", ".tsx", ".jsx", ".vue", ".svelte", ".py", ".java", ".go", ".rs", ".c", ".cpp", ".cs"].includes(ext);

        if (!isSource) {
          this.files.set(relPath, { mtime: fileStat.mtimeMs, symbols: new Map(), imports: new Map() });
          continue;
        }

        const content = await fs.readFile(absPath, "utf8");
        this.parse(relPath, content, fileStat.mtimeMs);
      } catch (e) {
        this.files.delete(relPath);
      }
    }
  }

  private parse(relPath: string, content: string, mtime: number) {
    const lines = content.split(/\r?\n/);
    const symbols = new Map<string, { type: "function" | "class" | "export", line: number }>();
    const imports = new Map<string, number>();

    const fnDeclRegex = /^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*\(/;
    const arrowFnRegex = /^(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$][0-9a-zA-Z_$]*)\s*=>/;
    const classRegex = /^(?:export\s+)?class\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/;
    const exportRegex = /^export\s+(?:const|let|var)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/;
    const importRegex = /^import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/;
    const requireRegex = /require\(['"]([^'"]+)['"]\)/;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      let match;
      if ((match = fnDeclRegex.exec(trimmed)) || (match = arrowFnRegex.exec(trimmed))) {
        symbols.set(match[1], { type: "function", line: index + 1 });
      } else if ((match = classRegex.exec(trimmed))) {
        symbols.set(match[1], { type: "class", line: index + 1 });
      } else if ((match = exportRegex.exec(trimmed))) {
        symbols.set(match[1], { type: "export", line: index + 1 });
      }
      
      if ((match = importRegex.exec(trimmed)) || (match = requireRegex.exec(trimmed))) {
        imports.set(match[1], index + 1);
      }
    });

    this.files.set(relPath, { mtime, symbols, imports });
  }

  getFiles(): string[] {
    return Array.from(this.files.keys());
  }

  searchSymbols(query: string): string[] {
    const results: string[] = [];
    const lowerQuery = query.toLowerCase();
    for (const [relPath, index] of this.files.entries()) {
      for (const [sym, info] of index.symbols.entries()) {
        if (sym.toLowerCase().includes(lowerQuery)) {
          results.push(`${relPath}:${info.line}: [${info.type}] ${sym}`);
        }
      }
    }
    return results;
  }

  searchImports(query: string): string[] {
    const results: string[] = [];
    const lowerQuery = query.toLowerCase();
    for (const [relPath, index] of this.files.entries()) {
      for (const [imp, line] of index.imports.entries()) {
        if (imp.toLowerCase().includes(lowerQuery)) {
          results.push(`${relPath}:${line}: import "${imp}"`);
        }
      }
    }
    return results;
  }
}
