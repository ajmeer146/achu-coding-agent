import { Workspace } from "./workspace.js";
import { isProtectedFile } from "../utils/command-guard.js";

export async function createFile(
  workspace: Workspace,
  filePath: string,
  content: string,
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
    // Scaffolding a brand-new project manifest is allowed (createFile refuses
    // to overwrite below). Other protected config files stay blocked.
    if (normalized !== "package.json") {
      throw new Error(
        `Protected file cannot be created automatically: ${filePath}. ` +
        `Configuration changes require explicit user action.`,
      );
    }
  }

  if (await workspace.exists(filePath)) {
    throw new Error(
      `File already exists: ${filePath}. Use edit_file instead.`,
    );
  }

  await workspace.write(filePath, content);

  return `Successfully created ${filePath}.`;
}
