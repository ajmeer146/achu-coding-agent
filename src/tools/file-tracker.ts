import { Workspace } from "./workspace.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export type ChangeType = "ADDED" | "MODIFIED" | "DELETED";

export interface FileSnapshot {
  path: string;
  content: string | null;
  size: number;
  isBinary: boolean;
  mtime: number;
}

export interface ChangedFile {
  path: string;
  changeType: ChangeType;
  oldContent: string | null;
  newContent: string | null;
  additions: number;
  deletions: number;
  isBinary: boolean;
}

export interface TaskBaseline {
  taskId: string;
  timestamp: number;
  snapshots: Map<string, FileSnapshot>;
}

const MAX_FILE_SIZE_FOR_DIFF = 1024 * 1024;
const MAX_DIFF_LINES = 5000;
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".avif",
  ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib", ".bin",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
  ".ttf", ".otf",
  ".class", ".jar", ".pyc", ".o", ".obj",
  ".sqlite", ".db",
]);

function isLikelyBinary(filePath: string, content: Buffer): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return true;
  }
  if (content.length === 0) {
    return false;
  }
  const sampleSize = Math.min(content.length, 8192);
  let nullBytes = 0;
  for (let i = 0; i < sampleSize; i++) {
    if (content[i] === 0) {
      nullBytes++;
    }
  }
  return nullBytes / sampleSize > 0.01;
}

function isTextFile(content: Buffer): boolean {
  return !isLikelyBinary("", content);
}

async function readFileSnapshot(workspace: Workspace, relativePath: string): Promise<FileSnapshot | null> {
  try {
    const fullPath = workspace.resolve(relativePath);
    const stats = await fs.stat(fullPath);
    
    if (stats.size > MAX_FILE_SIZE_FOR_DIFF) {
      return {
        path: relativePath,
        content: null,
        size: stats.size,
        isBinary: true,
        mtime: stats.mtimeMs,
      };
    }
    
    const contentBuffer = await fs.readFile(fullPath);
    const isBinary = isLikelyBinary(relativePath, contentBuffer);
    
    return {
      path: relativePath,
      content: isBinary ? null : contentBuffer.toString("utf8"),
      size: stats.size,
      isBinary,
      mtime: stats.mtimeMs,
    };
  } catch {
    return null;
  }
}

async function captureWorkspaceBaseline(
  workspace: Workspace,
  taskId: string,
  rootPath: string = "."
): Promise<TaskBaseline> {
  const snapshots = new Map<string, FileSnapshot>();
  
  async function walk(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(workspace.resolve(dir), { withFileTypes: true });
      
      for (const entry of entries) {
        const relativePath = path.posix.join(dir, entry.name);
        
        if (shouldIgnore(relativePath)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          await walk(relativePath);
        } else if (entry.isFile()) {
          const snapshot = await readFileSnapshot(workspace, relativePath);
          if (snapshot) {
            snapshots.set(relativePath, snapshot);
          }
        }
      }
    } catch {
    }
  }
  
  await walk(rootPath);
  
  return {
    taskId,
    timestamp: Date.now(),
    snapshots,
  };
}

function shouldIgnore(relativePath: string): boolean {
  const parts = relativePath.split("/");
  for (const part of parts) {
    if (part === "node_modules" || part === ".git" || part === "dist" || part === "build" || part === ".cache" || part === "coverage") {
      return true;
    }
    if (part.startsWith(".") && part !== ".env" && part !== ".npmrc" && part !== "." && part !== "..") {
      return true;
    }
  }
  return false;
}

function computeDiff(oldContent: string | null, newContent: string | null): { additions: number; deletions: number } {
  if (oldContent === null && newContent === null) {
    return { additions: 0, deletions: 0 };
  }
  if (oldContent === null) {
    const lines = newContent!.split("\n").length;
    return { additions: lines, deletions: 0 };
  }
  if (newContent === null) {
    const lines = oldContent.split("\n").length;
    return { additions: 0, deletions: lines };
  }
  
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  
  let additions = 0;
  let deletions = 0;
  let i = 0;
  let j = 0;
  
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++;
      j++;
    } else if (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
      deletions++;
      i++;
    } else {
      additions++;
      j++;
    }
  }
  
  return { additions, deletions };
}

export async function detectChanges(
  workspace: Workspace,
  baseline: TaskBaseline
): Promise<ChangedFile[]> {
  const changes: ChangedFile[] = [];
  const currentSnapshots = new Map<string, FileSnapshot>();
  
  async function walk(dir: string): Promise<void> {
    try {
      const resolvedDir = workspace.resolve(dir);
      const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const relativePath = path.posix.join(dir, entry.name);
        
        if (shouldIgnore(relativePath)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          await walk(relativePath);
        } else if (entry.isFile()) {
          const snapshot = await readFileSnapshot(workspace, relativePath);
          if (snapshot) {
            currentSnapshots.set(relativePath, snapshot);
          }
        }
      }
    } catch {
    }
  }
  
  await walk(".");
  
  const allPaths = new Set([...baseline.snapshots.keys(), ...currentSnapshots.keys()]);
  
  for (const relativePath of allPaths) {
    const oldSnapshot = baseline.snapshots.get(relativePath);
    const newSnapshot = currentSnapshots.get(relativePath);
    
    if (!oldSnapshot && newSnapshot) {
      changes.push({
        path: relativePath,
        changeType: "ADDED",
        oldContent: null,
        newContent: newSnapshot.content,
        additions: newSnapshot.content ? newSnapshot.content.split("\n").length : 0,
        deletions: 0,
        isBinary: newSnapshot.isBinary,
      });
    } else if (oldSnapshot && !newSnapshot) {
      changes.push({
        path: relativePath,
        changeType: "DELETED",
        oldContent: oldSnapshot.content,
        newContent: null,
        additions: 0,
        deletions: oldSnapshot.content ? oldSnapshot.content.split("\n").length : 0,
        isBinary: oldSnapshot.isBinary,
      });
    } else if (oldSnapshot && newSnapshot) {
      const contentChanged = oldSnapshot.content !== newSnapshot.content;
      const metaChanged = oldSnapshot.mtime !== newSnapshot.mtime || oldSnapshot.size !== newSnapshot.size;
      
      // For binary files, content is always null, so check metadata
      // For text files, check content or metadata
      if (contentChanged || (oldSnapshot.isBinary && newSnapshot.isBinary && metaChanged)) {
        const { additions, deletions } = computeDiff(oldSnapshot.content, newSnapshot.content);
        if (additions > 0 || deletions > 0 || (oldSnapshot.isBinary && newSnapshot.isBinary && metaChanged)) {
          changes.push({
            path: relativePath,
            changeType: "MODIFIED",
            oldContent: oldSnapshot.content,
            newContent: newSnapshot.content,
            additions,
            deletions,
            isBinary: oldSnapshot.isBinary || newSnapshot.isBinary,
          });
        }
      }
    }
  }
  
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export function generateUnifiedDiff(
  oldContent: string | null,
  newContent: string | null,
  filePath: string
): string {
  if (oldContent === null && newContent === null) {
    return "No changes";
  }
  
  if (oldContent === null) {
    const lines = newContent!.split("\n");
    let diff = `--- /dev/null\n+++ b/${filePath}\n`;
    for (let i = 0; i < lines.length; i++) {
      diff += `+${lines[i]}\n`;
    }
    return diff;
  }
  
  if (newContent === null) {
    const lines = oldContent.split("\n");
    let diff = `--- a/${filePath}\n+++ /dev/null\n`;
    for (let i = 0; i < lines.length; i++) {
      diff += `-${lines[i]}\n`;
    }
    return diff;
  }
  
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  
  let diff = `--- a/${filePath}\n+++ b/${filePath}\n`;
  
  let i = 0;
  let j = 0;
  
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++;
      j++;
    } else {
      const contextStart = Math.max(0, i - 3);
      const contextEnd = Math.min(oldLines.length, i + 3);
      
      let hunkOldStart = contextStart + 1;
      let hunkOldLines = contextEnd - contextStart;
      let hunkNewStart = Math.max(0, j - 3) + 1;
      let hunkNewLines = 0;
      
      let hunk = `@@ -${hunkOldStart},${hunkOldLines} +${hunkNewStart}`;
      
      const hunkLines: string[] = [];
      let k = contextStart;
      let l = Math.max(0, j - 3);
      
      while (k < oldLines.length || l < newLines.length) {
        if (k < oldLines.length && l < newLines.length && oldLines[k] === newLines[l]) {
          hunkLines.push(` ${oldLines[k]}`);
          k++;
          l++;
        } else if (k < oldLines.length && (l >= newLines.length || oldLines[k] !== newLines[l])) {
          hunkLines.push(`-${oldLines[k]}`);
          k++;
          hunkNewLines--;
        } else {
          hunkLines.push(`+${newLines[l]}`);
          l++;
          hunkNewLines++;
        }
        
        if (hunkLines.length > 20) break;
      }
      
      hunk += `,${hunkNewLines + (k - contextStart)} @@`;
      diff += hunk + "\n";
      diff += hunkLines.join("\n") + "\n";
      
      if (k >= oldLines.length && l >= newLines.length) break;
      
      i = k;
      j = l;
    }
  }
  
  return diff;
}

export function generateDiffForDisplay(
  oldContent: string | null,
  newContent: string | null,
  filePath: string
): { lines: Array<{ type: "context" | "add" | "remove"; content: string; oldLineNum?: number; newLineNum?: number }>; truncated: boolean } {
  if (oldContent === null && newContent === null) {
    return { lines: [{ type: "context", content: "No changes" }], truncated: false };
  }
  
  if (oldContent === null) {
    const lines = newContent!.split("\n");
    const displayLines = lines.slice(0, MAX_DIFF_LINES).map((line, idx) => ({
      type: "add" as const,
      content: line,
      newLineNum: idx + 1,
    }));
    return { lines: displayLines, truncated: lines.length > MAX_DIFF_LINES };
  }
  
  if (newContent === null) {
    const lines = oldContent.split("\n");
    const displayLines = lines.slice(0, MAX_DIFF_LINES).map((line, idx) => ({
      type: "remove" as const,
      content: line,
      oldLineNum: idx + 1,
    }));
    return { lines: displayLines, truncated: lines.length > MAX_DIFF_LINES };
  }
  
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  
  const result: Array<{ type: "context" | "add" | "remove"; content: string; oldLineNum?: number; newLineNum?: number }> = [];
  let oldLineNum = 0;
  let newLineNum = 0;
  let i = 0;
  let j = 0;
  
  while ((i < oldLines.length || j < newLines.length) && result.length < MAX_DIFF_LINES) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      result.push({
        type: "context",
        content: oldLines[i],
        oldLineNum: ++oldLineNum,
        newLineNum: ++newLineNum,
      });
      i++;
      j++;
    } else if (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
      result.push({
        type: "remove",
        content: oldLines[i],
        oldLineNum: ++oldLineNum,
      });
      i++;
    } else {
      result.push({
        type: "add",
        content: newLines[j],
        newLineNum: ++newLineNum,
      });
      j++;
    }
  }
  
  const truncated = i < oldLines.length || j < newLines.length;
  
  return { lines: result, truncated };
}

export { captureWorkspaceBaseline, MAX_FILE_SIZE_FOR_DIFF, MAX_DIFF_LINES };