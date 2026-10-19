import fs from "node:fs/promises";
import { Workspace } from "./workspace.js";

export type FileTreeNode = {
  name: string;
  /** Workspace-relative path using forward slashes for stable UI rendering. */
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
  /** True when the directory's children were cut off by a limit. */
  truncated?: boolean;
};

/**
 * Directories that are large, generated, or not part of the user's source and
 * therefore excluded from the file tree to keep it responsive.
 */
export const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".achu",
  ".achu-sessions",
  ".cache",
  ".next",
  ".nuxt",
  ".turbo",
  ".parcel-cache",
  "coverage",
  ".nyc_output",
]);

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ENTRIES = 2500;

export type FileTreeOptions = {
  maxDepth?: number;
  maxEntries?: number;
};

function toPosix(value: string): string {
  return value.split("\\").join("/");
}

/**
 * Build a bounded directory tree for the active workspace. Bounds (depth and
 * total entry count) guarantee the operation terminates on very large trees.
 * Symbolic links are skipped so a link cannot pull in content from outside the
 * workspace or create a cycle.
 */
export async function buildFileTree(
  workspace: Workspace,
  relativePath = ".",
  options: FileTreeOptions = {},
): Promise<FileTreeNode[]> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  const counter = { count: 0 };
  return readLevel(workspace, relativePath, 0, maxDepth, maxEntries, counter);
}

async function readLevel(
  workspace: Workspace,
  relativePath: string,
  depth: number,
  maxDepth: number,
  maxEntries: number,
  counter: { count: number },
): Promise<FileTreeNode[]> {
  const target = workspace.resolve(relativePath);

  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileTreeNode[] = [];

  const sorted = entries.slice().sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1;
    const bDir = b.isDirectory() ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    if (counter.count >= maxEntries) {
      nodes.push({ name: "…", path: "", type: "file", truncated: true });
      break;
    }

    // Never traverse symlinks: they can escape the workspace or form cycles.
    if (entry.isSymbolicLink()) continue;

    const childRelative = relativePath === "." ? entry.name : `${relativePath}/${entry.name}`;
    const posixPath = toPosix(childRelative);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      counter.count += 1;
      const node: FileTreeNode = { name: entry.name, path: posixPath, type: "directory" };
      if (depth + 1 < maxDepth) {
        node.children = await readLevel(
          workspace,
          childRelative,
          depth + 1,
          maxDepth,
          maxEntries,
          counter,
        );
        if (node.children.length === 0) {
          node.children = [];
        }
      } else {
        node.children = [];
        node.truncated = true;
      }
      nodes.push(node);
    } else if (entry.isFile()) {
      counter.count += 1;
      nodes.push({ name: entry.name, path: posixPath, type: "file" });
    }
  }

  return nodes;
}
