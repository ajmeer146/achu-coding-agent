import { Workspace } from "./workspace.js";
import { isProtectedFile } from "../utils/command-guard.js";

export async function createFile(
  workspace: Workspace,
  filePath: string,
  content: string,
  overwrite = false,
): Promise<string> {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\/+/, "").toLowerCase();

  if (isProtectedFile(filePath)) {
    const alreadyExists = await workspace.exists(filePath);
    if (alreadyExists) {
      throw new Error(
        `Protected file cannot be created automatically: ${filePath}. ` +
          `Configuration changes require explicit user action.`,
      );
    }
    // Scaffolding a brand-new project manifest is allowed
    if (normalized !== "package.json") {
      throw new Error(
        `Protected file cannot be created automatically: ${filePath}. ` +
          `Configuration changes require explicit user action.`,
      );
    }
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
