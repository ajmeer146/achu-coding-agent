import { Workspace } from "./workspace.js";
import { isProtectedFile } from "../utils/command-guard.js";
import { assertFileSyntaxValid } from "../utils/file-syntax-validator.js";

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
 * If all matching passes fail, find lines in the current file that share
 * significant keywords with oldText (CSS selectors, IDs, HTML tags,
 * function names). Returns up to 5 candidates with 1-based line numbers
 * to help the caller self-correct a stale oldText.
 */
function findCandidateSuggestions(currentContent: string, oldText: string): string[] {
  const lines = currentContent.split("\n");
  // Extract meaningful keywords: CSS class/id selectors, tag names, function names.
  const keywordSet = new Set<string>();
  for (const kw of oldText.matchAll(/[.#][A-Za-z0-9_-]+/g)) keywordSet.add(kw[0].slice(1));
  for (const kw of oldText.matchAll(/<([A-Za-z][A-Za-z0-9]*)\b/g)) keywordSet.add(kw[1].toLowerCase());
  for (const kw of oldText.matchAll(/(?:function|const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) keywordSet.add(kw[1]);
  // Also include capitalised word sequences (component/class names).
  for (const kw of oldText.matchAll(/\b[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]+)*\b/g)) keywordSet.add(kw[0]);
  const keywords = [...keywordSet];
  if (keywords.length === 0) return [];

  const candidates: { line: number; text: string; score: number }[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lower = line.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) score++;
    }
    if (score > 0) {
      candidates.push({ line: li + 1, text: line.trim().slice(0, 120), score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.line - b.line);
  return candidates.slice(0, 5).map((c) => `  line ${c.line}: ${c.text} (matched ${c.score} keyword${c.score === 1 ? "" : "s"})`);
}
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

  // Pass 3: Whitespace-collapsed and quote-tolerant matching
  const collapseWs = (l: string) => normalizeQuotes(l.trim().replace(/\s+/g, " "));
  const wsNormOld = trimmedOld.map(collapseWs);
  for (let i = 0; i <= currentLines.length - oldLines.length; i++) {
    let match = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (collapseWs(currentLines[i + j]) !== wsNormOld[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      matches.push({ startIndex: i, count: oldLines.length });
    }
  }

  if (matches.length === 1) return matches[0];

  // Pass 4: Stripping leading and trailing blank lines from oldLines
  let nonBlankStart = 0;
  while (nonBlankStart < oldLines.length && oldLines[nonBlankStart].trim() === "") nonBlankStart++;
  let nonBlankEnd = oldLines.length;
  while (nonBlankEnd > nonBlankStart && oldLines[nonBlankEnd - 1].trim() === "") nonBlankEnd--;

  if (nonBlankStart > 0 || nonBlankEnd < oldLines.length) {
    const strippedOld = oldLines.slice(nonBlankStart, nonBlankEnd);
    if (strippedOld.length > 0 && strippedOld.length <= currentLines.length) {
      const strippedRes = findMatchingRangeByLines(currentLines, strippedOld);
      if (strippedRes) return strippedRes;
    }
  }

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

  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\/+/, "").toLowerCase();
  const fileName = normalized.split("/").pop() || normalized;

  const isEnvTemplate = fileName.endsWith(".example") || fileName.endsWith(".sample") || fileName.endsWith(".template");
  if (fileName.startsWith(".env") && !isEnvTemplate) {
    throw new Error(
      `Forbidden: .env files cannot be modified automatically. ` +
      `Preserve existing environment configuration and secrets.`,
    );
  }

  if (!normalized.endsWith("package.json") && isProtectedFile(filePath)) {
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

    // 4. Full HTML document replacement: ONLY when oldText also targeted the whole document
    const oldTrimmed = oldText.trim().toLowerCase();
    if (
      filePath.toLowerCase().endsWith(".html") &&
      (oldTrimmed.startsWith("<!doctype") || oldTrimmed.startsWith("<html")) &&
      (newText.trim().toLowerCase().startsWith("<!doctype") || newText.trim().toLowerCase().startsWith("<html"))
    ) {
      updatedNormalized = newText;
      successes.push(`Replaced HTML document in ${filePath}.`);
      continue;
    }

    // If all attempts failed, throw informative error with current excerpt
    const excerpt = currentNormalized.slice(0, 400).trim();
    const suggestions = findCandidateSuggestions(currentNormalized, oldText);
    const suggestionBlock = suggestions.length > 0
      ? `\n\nPossible matches in current file (oldText may be stale—read the latest content first):\n${suggestions.join("\n")}`
      : "";
    throw new Error(
      `Edit ${i + 1} failed: The expected text was not found in ${filePath}.\n` +
      `Current file content begins with:\n` +
      `----------------------------------------\n` +
      `${excerpt}\n` +
      `----------------------------------------\n` +
      `Please ensure you have read the latest file content and provided sufficient context, or use oldText: "*" to update the entire file.` +
      suggestionBlock
    );
  }

  // Restore \r\n if the original file predominantly used them
  const isWindowsLineEndings = current.includes("\r\n");
  const finalContent = isWindowsLineEndings ? updatedNormalized.replace(/\n/g, "\r\n") : updatedNormalized;

  // Validate package.json if it was edited
  if (normalized.endsWith("package.json")) {
    try {
      const parsed = JSON.parse(finalContent);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("package.json must be a valid JSON object.");
      }
    } catch (err: any) {
      throw new Error(`Invalid JSON in package.json after edit: ${err.message}`);
    }
  }

  // Validate file syntax and check for truncated/incomplete code after edit
  assertFileSyntaxValid(filePath, finalContent);

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

/**
 * Classifies whether an edit failure is specifically caused by context mismatch
 * (stale oldText not found, or ambiguous multi-match), as opposed to permission,
 * missing file, or syntax validation errors.
 */
export function isEditContextMismatchError(errorMsg: string): boolean {
  if (!errorMsg || typeof errorMsg !== "string") return false;
  // Non-context mismatch errors:
  if (errorMsg.includes("Forbidden: .env") || errorMsg.includes("is an environment configuration file")) return false;
  if (errorMsg.includes("Protected file cannot be modified") || errorMsg.includes("is a protected configuration file")) return false;
  if (errorMsg.includes("File does not exist") || errorMsg.includes("ENOENT")) return false;
  if (errorMsg.includes("TRUNCATED_OR_INCOMPLETE_OUTPUT") || errorMsg.includes("SYNTAX_VALIDATION_ERROR")) return false;
  if (errorMsg.includes("Invalid JSON") || errorMsg.includes("package.json must be a valid JSON")) return false;
  if (errorMsg.includes("Write verification failed")) return false;
  if (errorMsg.includes("newText is required")) return false;
  if (errorMsg.includes("Invalid edits argument")) return false;

  // Context mismatch indicators:
  return (
    errorMsg.includes("The expected text was not found in") ||
    errorMsg.includes("Expected exactly one match in") ||
    /expected text was not found/i.test(errorMsg)
  );
}

