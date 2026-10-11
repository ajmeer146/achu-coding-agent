import { isProtectedFile } from "../utils/command-guard.js";
export async function editFile(workspace, filePath, oldText, newText) {
    if (isProtectedFile(filePath)) {
        throw new Error(`Protected file cannot be modified automatically: ${filePath}. ` +
            `Configuration changes require explicit user action.`);
    }
    const current = await workspace.read(filePath);
    if (!current.includes(oldText)) {
        throw new Error(`The expected text was not found in ${filePath}. File was not changed.`);
    }
    const occurrences = current.split(oldText).length - 1;
    if (occurrences !== 1) {
        throw new Error(`Expected exactly one match in ${filePath}, but found ${occurrences}. File was not changed.`);
    }
    const updated = current.replace(oldText, newText);
    await workspace.write(filePath, updated);
    return `Successfully edited ${filePath}.`;
}
