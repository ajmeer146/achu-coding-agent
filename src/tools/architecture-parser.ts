import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Workspace } from "./workspace.js";

export interface ProjectArchitecture {
  projectType: string;
  hasTypeScript: boolean;
  framework: string | null;
  packageScripts: Record<string, string>;
  dependencies: string[];
  devDependencies: string[];
  fileTreeSummary: string;
  entryPoints: Array<{ path: string; imports: string[] }>;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  "coverage",
]);

/**
 * Extracts import and require statements from JS/TS content.
 */
function extractImports(content: string): string[] {
  const imports: string[] = [];
  
  // Basic regex for imports and requires
  // matches: import ... from 'x', import 'x', require('x')
  const importRegex = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/gs;
  const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
  
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    if (match[1]) imports.push(match[1]);
  }
  while ((match = requireRegex.exec(content)) !== null) {
    if (match[1]) imports.push(match[1]);
  }
  
  return [...new Set(imports)];
}

async function getTreeSummary(workspace: Workspace, dir = ".", depth = 0, maxDepth = 2): Promise<string> {
  if (depth > maxDepth) return "  ".repeat(depth) + "...\n";
  
  let summary = "";
  try {
    const entries = await workspace.listDetailed(dir);
    
    // Sort directories first, then files
    entries.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === "directory" ? -1 : 1;
    });

    for (const entry of entries) {
      if (entry.type === "directory" && IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      
      const indent = "  ".repeat(depth);
      summary += `${indent}${entry.name}${entry.type === "directory" ? "/" : ""}\n`;
      
      if (entry.type === "directory") {
        summary += await getTreeSummary(workspace, path.posix.join(dir, entry.name), depth + 1, maxDepth);
      }
    }
  } catch {
    // Ignore errors for unreadable dirs
  }
  return summary;
}

export async function parseArchitecture(workspace: Workspace): Promise<ProjectArchitecture> {
  let projectType = "unknown";
  let hasTypeScript = false;
  let framework: string | null = null;
  let packageScripts: Record<string, string> = {};
  let dependencies: string[] = [];
  let devDependencies: string[] = [];
  
  const entryPoints: Array<{ path: string; imports: string[] }> = [];

  // Check package.json
  const hasPackageJson = await workspace.exists("package.json");
  if (hasPackageJson) {
    try {
      const content = await workspace.read("package.json");
      const pkg = JSON.parse(content);
      
      packageScripts = pkg.scripts || {};
      dependencies = Object.keys(pkg.dependencies || {});
      devDependencies = Object.keys(pkg.devDependencies || {});
      
      const allDeps = [...dependencies, ...devDependencies];
      
      if (allDeps.includes("typescript")) hasTypeScript = true;
      if (allDeps.includes("next")) { framework = "nextjs"; projectType = "nextjs"; }
      else if (allDeps.includes("vite")) { framework = "vite"; projectType = "vite"; }
      else if (allDeps.includes("react") || allDeps.includes("@vitejs/plugin-react")) { framework = "react"; projectType = "react"; }
      else if (allDeps.includes("vue")) { framework = "vue"; projectType = "vue"; }
      else if (allDeps.includes("svelte")) { framework = "svelte"; projectType = "svelte"; }
      else if (allDeps.includes("astro")) { framework = "astro"; projectType = "astro"; }
      else if (allDeps.includes("nuxt")) { framework = "nuxt"; projectType = "nuxt"; }
      else if (allDeps.includes("solidjs")) { framework = "solid"; projectType = "solid"; }
      else if (allDeps.length > 0) { framework = "node"; projectType = "node"; }
    } catch {
      // Ignore parse errors
    }
  }

  // Check tsconfig
  if (!hasTypeScript && await workspace.exists("tsconfig.json")) {
    hasTypeScript = true;
  }

  // Fallback detection
  if (projectType === "unknown") {
    if (await workspace.exists("next.config.js") || await workspace.exists("next.config.ts")) { framework = "nextjs"; projectType = "nextjs"; }
    else if (await workspace.exists("vite.config.js") || await workspace.exists("vite.config.ts")) { framework = "vite"; projectType = "vite"; }
    else if (await workspace.exists("index.html")) { projectType = "static"; }
  }

  // Find entry points
  const potentialEntries = [
    "src/index.tsx", "src/index.ts", "src/index.jsx", "src/index.js",
    "src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js",
    "src/app.tsx", "src/app.ts", "src/app.jsx", "src/app.js",
    "index.tsx", "index.ts", "index.jsx", "index.js",
    "pages/_app.tsx", "pages/_app.js",
    "app/layout.tsx", "app/layout.js",
    "app/page.tsx", "app/page.js"
  ];

  for (const entry of potentialEntries) {
    if (await workspace.exists(entry)) {
      try {
        const content = await workspace.read(entry);
        const imports = extractImports(content);
        entryPoints.push({ path: entry, imports });
      } catch {
        // Ignore read errors
      }
    }
  }

  const fileTreeSummary = await getTreeSummary(workspace);

  return {
    projectType,
    hasTypeScript,
    framework,
    packageScripts,
    dependencies,
    devDependencies,
    fileTreeSummary,
    entryPoints
  };
}

export function formatArchitectureSummary(arch: ProjectArchitecture): string {
  let output = `Project Type: ${arch.projectType}\n`;
  output += `Framework: ${arch.framework || "None detected"}\n`;
  output += `TypeScript: ${arch.hasTypeScript ? "Yes" : "No"}\n\n`;

  if (Object.keys(arch.packageScripts).length > 0) {
    output += `Scripts:\n`;
    for (const [name, cmd] of Object.entries(arch.packageScripts)) {
      output += `- ${name}: ${cmd}\n`;
    }
    output += `\n`;
  }

  if (arch.entryPoints.length > 0) {
    output += `Key Entry Points & Imports:\n`;
    for (const ep of arch.entryPoints) {
      output += `- ${ep.path}\n`;
      if (ep.imports.length > 0) {
        output += `  Imports: ${ep.imports.slice(0, 8).join(", ")}${ep.imports.length > 8 ? "..." : ""}\n`;
      }
    }
    output += `\n`;
  }

  output += `Workspace Structure (top levels):\n${arch.fileTreeSummary}\n`;
  return output.trim();
}
