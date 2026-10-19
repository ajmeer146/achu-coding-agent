import fs from "node:fs/promises";
import { Workspace } from "./workspace.js";
import { IGNORED_DIRECTORIES } from "./file-tree.js";

/**
 * Limits for exporting workspace files to a cloud session. These intentionally
 * match the cloud API payload validation (300 files, 2MB per file, 10MB total)
 * so an exported folder always fits without truncation surprises.
 */
export const DEFAULT_WORKSPACE_EXPORT_LIMITS = {
  maxFiles: 300,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
} as const;

export type WorkspaceExportLimits = {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
};

export type WorkspaceExportFile = {
  /** Workspace-relative path using forward slashes. */
  path: string;
  /** UTF-8 text content. */
  content: string;
  /** Byte length of the exported content. */
  size: number;
};

export type WorkspaceExportResult = {
  root: string;
  files: WorkspaceExportFile[];
  totalBytes: number;
  /** True when files/directories were skipped because a limit was reached. */
  truncated: boolean;
  skipped: { binary: number; tooLarge: number; ignored: number; symlink: number };
};

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "avif",
  "pdf", "zip", "tar", "gz", "tgz", "7z", "rar", "jar",
  "exe", "dll", "so", "dylib", "bin", "iso", "msi",
  "mp4", "mp3", "wav", "webm", "ogg", "mov", "avi", "flv", "mkv",
  "woff", "woff2", "ttf", "eot", "otf",
  "pyc", "class", "db", "sqlite", "sqlite3", "wasm",
]);

const SNIFF_BYTES = 8000;

function toPosix(value: string): string {
  return value.split("\\").join("/");
}

function clampLimit(requested: number | undefined, fallback: number): number {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) return fallback;
  return Math.min(Math.floor(requested), fallback);
}

function hasBinaryExtension(fileName: string): boolean {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return false;
  return BINARY_EXTENSIONS.has(fileName.slice(dot + 1).toLowerCase());
}

function looksBinary(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, SNIFF_BYTES);
  for (let i = 0; i < end; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Export text files from an authorized workspace for cloud import.
 *
 * Safety guarantees:
 * - Symbolic links are never followed (no escapes, no cycles).
 * - Ignored/generated directories (node_modules, .git, .next, ...) are skipped.
 * - Binary files (by extension or NUL sniff) are skipped.
 * - Files larger than the per-file limit are skipped.
 * - A deterministic, sorted walk stops once the file-count or total-byte cap
 *   is reached, marking the result `truncated`.
 */
export async function exportWorkspaceFiles(
  workspace: Workspace,
  options: WorkspaceExportLimits = {},
): Promise<WorkspaceExportResult> {
  const maxFiles = clampLimit(options.maxFiles, DEFAULT_WORKSPACE_EXPORT_LIMITS.maxFiles);
  const maxFileBytes = clampLimit(options.maxFileBytes, DEFAULT_WORKSPACE_EXPORT_LIMITS.maxFileBytes);
  const maxTotalBytes = clampLimit(options.maxTotalBytes, DEFAULT_WORKSPACE_EXPORT_LIMITS.maxTotalBytes);

  const skipped = { binary: 0, tooLarge: 0, ignored: 0, symlink: 0 };
  const candidates: Array<{ rel: string; size: number }> = [];

  const queue: string[] = [""];
  while (queue.length > 0) {
    const relDir = queue.shift() as string;
    let entries;
    try {
      entries = await fs.readdir(workspace.resolve(relDir || "."), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;

      if (entry.isSymbolicLink()) {
        skipped.symlink += 1;
        continue;
      }

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          skipped.ignored += 1;
          continue;
        }
        queue.push(rel);
        continue;
      }

      if (!entry.isFile()) continue;

      if (hasBinaryExtension(entry.name)) {
        skipped.binary += 1;
        continue;
      }

      let size = 0;
      try {
        const stats = await fs.stat(workspace.resolve(rel));
        if (!stats.isFile()) continue;
        size = stats.size;
      } catch {
        continue;
      }

      if (size > maxFileBytes) {
        skipped.tooLarge += 1;
        continue;
      }

      candidates.push({ rel, size });
    }
  }

  candidates.sort((a, b) => a.rel.localeCompare(b.rel));

  const files: WorkspaceExportFile[] = [];
  let totalBytes = 0;
  let truncated = false;

  for (const candidate of candidates) {
    if (files.length >= maxFiles || totalBytes + candidate.size > maxTotalBytes) {
      truncated = true;
      break;
    }
    try {
      const buffer = await fs.readFile(workspace.resolve(candidate.rel));
      if (buffer.length > maxFileBytes) {
        skipped.tooLarge += 1;
        continue;
      }
      if (looksBinary(buffer)) {
        skipped.binary += 1;
        continue;
      }
      const content = buffer.toString("utf8");
      files.push({ path: toPosix(candidate.rel), content, size: buffer.length });
      totalBytes += buffer.length;
    } catch {
      continue;
    }
  }

  return { root: workspace.getRoot(), files, totalBytes, truncated, skipped };
}
