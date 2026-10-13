import { Workspace } from "./workspace.js";
import { isProtectedFile } from "../utils/command-guard.js";

export interface FileEdit {
  oldText?: string;
  newText: string;
}

function normalizeLineEndings(str: string): string {
  return str.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeQuotes(str: string): string {
  return str.replace(/["'`]/g, '"');
}

/**
 * Replaces one exact occurrence of target in source using index slicing.
 * Never uses String.prototype.replace(string, string) to avoid `$` pattern substitution bugs.
 */
function safeReplaceOnce(source: string, target: string, replacement: string): string {
  const index = source.indexOf(target);
  if (index === -1) return source;
  return source.slice(0, index) + replacement + source.slice(index + target.length);
}

/**
 * Finds matching line range when exact string match fails due to indentation or trailing spaces.
 */
function findMatchingRangeByLines(
  currentLines: string[],
  oldLines: string[]
): { startIndex: number; count: number } | null {
  if (oldLines.length === 0 || oldLines.length > currentLines.length) return null;

  const trimmedOld = oldLines.map((l) => l.trim());
  const matches: { startIndex: number; count: number }[] = [];

  // Pass 1: Trimmed line matching
  for (let i = 0; i <= currentLines.length - oldLines.length; i++) {
    let match = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (currentLines[i + j].trim() !== trimmedOld[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      matches.push({ startIndex: i, count: oldLines.length });
    }
  }

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return null;

  // Pass 2: Quote-tolerant trimmed line matching
  const quoteNormOld = trimmedOld.map(normalizeQuotes);
  for (let i = 0; i <= currentLines.length - oldLines.length; i++) {
    let match = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (normalizeQuotes(currentLines[i + j].trim()) !== quoteNormOld[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      matches.push({ startIndex: i, count: oldLines.length });
    }
  }

  if (matches.length === 1) return matches[0];

  return null;
}

export async function editFile(
  workspace: Workspace,
  filePath: string,
  editsOrOldText: FileEdit[] | string,
  newText?: string,
): Promise<string> {
  let edits: FileEdit[];
  if (typeof editsOrOldText === "string") {
    if (newText === undefined) throw new Error("newText is required when oldText is passed as string");
    edits = [{ oldText: editsOrOldText, newText }];
  } else if (Array.isArray(editsOrOldText)) {
    edits = editsOrOldText;
  } else if (typeof editsOrOldText === "object" && editsOrOldText !== null) {
    edits = [editsOrOldText];
  } else {
    throw new Error("Invalid edits argument provided to editFile");
  }

  if (isProtectedFile(filePath)) {
    throw new Error(
      `Protected file cannot be modified automatically: ${filePath}. ` +
        `Configuration changes require explicit user action.`,
    );
  }

  const current = await workspace.read(filePath);

  // Normalize line endings for the original file for matching purposes
  const currentNormalized = normalizeLineEndings(current);
  let updatedNormalized = currentNormalized;
  const successes: string[] = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const oldText = edit.oldText !== undefined ? normalizeLineEndings(edit.oldText) : "";
    const newText = normalizeLineEndings(edit.newText ?? "");

    // 1. Explicit full file replacement mode:
    const isExplicitFullReplacement =
      oldText === "*" ||
      oldText === "[ALL]" ||
      oldText === "[WHOLE_FILE]" ||
      (oldText === "" && edits.length === 1 && newText.length > 0);

    if (isExplicitFullReplacement) {
      updatedNormalized = newText;
      successes.push(`Replaced entire content of ${filePath}.`);
      continue;
    }

    // 2. Exact match
    if (updatedNormalized.includes(oldText)) {
      const occurrences = updatedNormalized.split(oldText).length - 1;

      if (occurrences > 1) {
        throw new Error(
          `Edit ${i + 1} failed: Expected exactly one match in ${filePath}, but found ${occurrences}. ` +
          `Provide more surrounding context to uniquely identify the target region.`
        );
      }

      updatedNormalized = safeReplaceOnce(updatedNormalized, oldText, newText);
      successes.push(`Applied edit ${i + 1}.`);
      continue;
    }

    // 3. Fallback: if oldText matches entire file content (accounting for trailing newline)
    if (oldText.trim() === updatedNormalized.trim() && oldText.length > 20) {
      updatedNormalized = newText;
      successes.push(`Replaced entire content of ${filePath}.`);
      continue;
    }

    // 4. Trimmed / indentation-tolerant line matching
    const currentLines = updatedNormalized.split("\n");
    const oldLines = oldText.split("\n");
    const lineMatch = findMatchingRangeByLines(currentLines, oldLines);

    if (lineMatch) {
      const newLines = newText.split("\n");
      currentLines.splice(lineMatch.startIndex, lineMatch.count, ...newLines);
      updatedNormalized = currentLines.join("\n");
      successes.push(`Applied edit ${i + 1} (indentation-tolerant match).`);
      continue;
    }

    // 4. Component body match for React/JS components:
    // If replacing the main export/component and both contain export default function
    const oldTrimmed = oldText.trim();
    if (
      oldTrimmed.includes("export default") &&
      updatedNormalized.includes("export default") &&
      newText.includes("export default")
    ) {
      updatedNormalized = newText;
      successes.push(`Updated main component in ${filePath}.`);
      continue;
    }

    // 5. Full HTML document replacement:
    if (
      filePath.toLowerCase().endsWith(".html") &&
      (newText.trim().startsWith("<!DOCTYPE html") || newText.trim().startsWith("<html"))
    ) {
      updatedNormalized = newText;
      successes.push(`Replaced HTML document in ${filePath}.`);
      continue;
    }

    // If all attempts failed, throw informative error with current excerpt
    const excerpt = currentNormalized.slice(0, 400).trim();
    throw new Error(
      `Edit ${i + 1} failed: The expected text was not found in ${filePath}.\n` +
      `Current file content begins with:\n` +
      `----------------------------------------\n` +
      `${excerpt}\n` +
      `----------------------------------------\n` +
      `Please ensure you have read the latest file content and provided sufficient context, or use oldText: "*" to update the entire file.`
    );
  }

  // Restore \r\n if the original file predominantly used them
  const isWindowsLineEndings = current.includes("\r\n");
  const finalContent = isWindowsLineEndings ? updatedNormalized.replace(/\n/g, "\r\n") : updatedNormalized;

  await workspace.write(filePath, finalContent);

  // Read back and verify the write succeeded on disk
  const verified = await workspace.read(filePath);
  if (normalizeLineEndings(verified) !== updatedNormalized) {
    throw new Error(`Write verification failed: Content written to ${filePath} could not be confirmed on disk.`);
  }

  if (successes.length === 1) {
    return `Successfully edited ${filePath}.`;
  }
  return `Successfully applied ${successes.length} edits to ${filePath}.`;
}
