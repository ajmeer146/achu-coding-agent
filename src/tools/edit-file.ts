import { Workspace } from "./workspace.js";
import { isProtectedFile } from "../utils/command-guard.js";

export interface FileEdit {
  oldText: string;
  newText: string;
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
  } else {
    edits = editsOrOldText;
  }

  if (isProtectedFile(filePath)) {
    throw new Error(
      `Protected file cannot be modified automatically: ${filePath}. ` +
        `Configuration changes require explicit user action.`,
    );
  }

  const current = await workspace.read(filePath);

  // Normalize line endings for the original file for matching purposes
  const currentNormalized = current.replace(/\r\n/g, "\n");
  let updatedNormalized = currentNormalized;
  const successes: string[] = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    // Normalize line endings in the patch
    const oldTextNormalized = edit.oldText.replace(/\r\n/g, "\n");
    const newTextNormalized = edit.newText.replace(/\r\n/g, "\n");

    if (!updatedNormalized.includes(oldTextNormalized)) {
      throw new Error(
        `Edit ${i + 1} failed: The expected text was not found in ${filePath}. ` +
        `Please ensure you have read the latest file content and provided sufficient context.`
      );
    }

    const occurrences = updatedNormalized.split(oldTextNormalized).length - 1;

    if (occurrences !== 1) {
      throw new Error(
        `Edit ${i + 1} failed: Expected exactly one match in ${filePath}, but found ${occurrences}. ` +
        `Provide more surrounding context to uniquely identify the target region.`
      );
    }

    updatedNormalized = updatedNormalized.replace(oldTextNormalized, newTextNormalized);
    successes.push(`Applied edit ${i + 1}.`);
  }

  // Restore \r\n if the original file predominantly used them
  const isWindowsLineEndings = current.includes("\r\n");
  const finalContent = isWindowsLineEndings ? updatedNormalized.replace(/\n/g, "\r\n") : updatedNormalized;

  await workspace.write(filePath, finalContent);

  if (successes.length === 1) {
    return `Successfully edited ${filePath}.`;
  }
  return `Successfully applied ${successes.length} edits to ${filePath}.`;
}
