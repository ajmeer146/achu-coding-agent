import { Workspace } from "./workspace.js";

export async function listDirectory(
  workspace: Workspace,
  directoryPath = ".",
): Promise<string> {
  const entries = await workspace.listDetailed(directoryPath);

  if (entries.length === 0) {
    return `${directoryPath}: <empty>`;
  }

  return entries
    .sort((a, b) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name);
      }

      return a.type === "directory" ? -1 : 1;
    })
    .map((entry) => {
      const prefix =
        entry.type === "directory"
          ? "[DIR] "
          : entry.type === "file"
            ? "[FILE] "
            : "[OTHER] ";

      return `${prefix}${entry.name}`;
    })
    .join("\n");
}
