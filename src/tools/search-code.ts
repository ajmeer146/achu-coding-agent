import fs from "node:fs/promises";
import path from "node:path";
import { Workspace } from "./workspace.js";
import { CodeIndexer } from "./indexer.js";

// Global singleton indexer for the CLI process
const globalIndexer = new CodeIndexer();

export async function searchCode(
  workspace: Workspace,
  query: string,
  searchType: "text" | "symbol" | "path" | "imports" = "text"
): Promise<string> {
  await globalIndexer.ensureIndexed(workspace.root, workspace);

  if (searchType === "symbol") {
    const results = globalIndexer.searchSymbols(query);
    if (results.length === 0) return `No symbols found matching "${query}".`;
    if (results.length > 100) return results.slice(0, 100).join("\n") + `\n... (and ${results.length - 100} more)`;
    return results.join("\n");
  }

  if (searchType === "imports") {
    const results = globalIndexer.searchImports(query);
    if (results.length === 0) return `No imports found matching "${query}".`;
    if (results.length > 100) return results.slice(0, 100).join("\n") + `\n... (and ${results.length - 100} more)`;
    return results.join("\n");
  }

  const files = globalIndexer.getFiles();

  if (searchType === "path") {
    const lowerQuery = query.toLowerCase();
    const matchedPaths = files.filter(f => f.toLowerCase().includes(lowerQuery));
    if (matchedPaths.length === 0) return `No paths found matching "${query}".`;
    if (matchedPaths.length > 100) return matchedPaths.slice(0, 100).join("\n") + `\n... (and ${matchedPaths.length - 100} more)`;
    return matchedPaths.join("\n");
  }

  // Text search
  const matches: string[] = [];

  for (const file of files) {
    const absolutePath = workspace.resolve(file);
    let content: string;
    try {
      content = await fs.readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(query.toLowerCase())) {
        matches.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });

    if (matches.length >= 100) {
      break;
    }
  }

  if (matches.length === 0) {
    return `No text matches found for "${query}".`;
  }

  return matches.join("\n");
}
