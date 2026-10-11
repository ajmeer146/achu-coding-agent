import { Workspace } from "./workspace.js";

export async function readFile(
  workspace: Workspace,
  filePath: string,
): Promise<string> {
  return workspace.read(filePath);
}
