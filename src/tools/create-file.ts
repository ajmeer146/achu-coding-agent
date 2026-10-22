import { Workspace } from "./workspace.js";
import { isProtectedFile } from "../utils/command-guard.js";
import { assertFileSyntaxValid, validateFileSyntax } from "../utils/file-syntax-validator.js";

export async function createFile(
  workspace: Workspace,
  filePath: string,
  content: string,
  overwrite = false,
): Promise<string> {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\/+/, "").toLowerCase();
  const fileName = normalized.split("/").pop() || normalized;

  // Never create or modify .env files automatically
  if (fileName.startsWith(".env")) {
    throw new Error(
      `Forbidden: .env files cannot be created or modified automatically. ` +
      `Preserve existing environment configuration.`,
    );
  }

  // Validate syntax and check for truncated/incomplete code before writing
  const syntaxCheck = validateFileSyntax(filePath, content);
  if (!syntaxCheck.valid) {
    // A broken regeneration must not destroy or invalidate a healthy artifact
    // that is already on disk. When the file exists and is itself valid, the
    // file is kept and the rejected content is reported truthfully instead of
    // failing the step (which would burn every recovery attempt on an
    // artifact that is already correct).
    const keepExisting = await canKeepExistingValidArtifact(workspace, filePath, normalized);
    if (keepExisting) {
      return (
        `Kept existing ${filePath}: it is already on disk and syntactically valid. ` +
        `The supplied content was rejected (${syntaxCheck.error}) and was NOT written. ` +
        `Use edit_file to modify the file.`
      );
    }
    assertFileSyntaxValid(filePath, content);
  }

  if (normalized.endsWith("package.json")) {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("package.json must be a valid JSON object.");
      }
    } catch (err: any) {
      throw new Error(`Invalid package.json content: ${err.message}`);
    }
  } else if (isProtectedFile(filePath)) {
    throw new Error(
      `Protected file cannot be created automatically: ${filePath}. ` +
      `Configuration changes require explicit user action.`,
    );
  }

  const alreadyExists = await workspace.exists(filePath);
  if (alreadyExists && !overwrite) {
    throw new Error(
      `File already exists: ${filePath}. Use edit_file instead.`,
    );
  }

  await workspace.write(filePath, content);

  // Read back and verify write on disk
  const verified = await workspace.read(filePath);
  if (verified !== content) {
    throw new Error(`Write verification failed: Content written to ${filePath} could not be confirmed on disk.`);
  }

  if (alreadyExists) {
    return `Successfully updated ${filePath} (overwrote existing file).`;
  }
  return `Successfully created ${filePath}.`;
}

/**
 * True when the file already exists on disk, its current content is
 * syntactically valid, and the file is not a protected/config target that
 * must never be created automatically.
 */
async function canKeepExistingValidArtifact(
  workspace: Workspace,
  filePath: string,
  normalizedPath: string,
): Promise<boolean> {
  if (normalizedPath.endsWith("package.json") || isProtectedFile(filePath)) {
    return false;
  }
  if (!(await workspace.exists(filePath))) {
    return false;
  }
  const existing = await workspace.read(filePath).catch(() => null);
  if (existing === null) {
    return false;
  }
  return validateFileSyntax(filePath, existing).valid;
}
