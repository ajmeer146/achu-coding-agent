import path from "node:path";
import fs from "node:fs/promises";

export type DirectoryEntry = {
  name: string;
  path: string;
};

export type BrowseResult = {
  /** Current directory being browsed, or null when listing drive roots. */
  path: string | null;
  /** Parent directory, or null at a filesystem root. */
  parent: string | null;
  /** Selectable child directories for the current location. */
  directories: DirectoryEntry[];
};

/**
 * Read-only directory browser used for safe, backend-driven folder selection.
 * A web page cannot read arbitrary local folders, so the local Node server
 * lists directories on the user's behalf. This never writes or reads file
 * contents — only directory names.
 */
export async function browseDirectory(target?: string): Promise<BrowseResult> {
  const trimmed = (target || "").trim();

  if (trimmed.length === 0) {
    if (process.platform === "win32") {
      const drives = await listWindowsDrives();
      return {
        path: null,
        parent: null,
        directories: drives.map((drive) => ({ name: drive, path: drive })),
      };
    }
    return listChildren("/");
  }

  return listChildren(path.resolve(trimmed));
}

async function listChildren(dirPath: string): Promise<BrowseResult> {
  let stats;
  try {
    stats = await fs.stat(dirPath);
  } catch {
    throw new Error(`Directory does not exist or is not accessible: ${dirPath}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Not a directory: ${dirPath}`);
  }

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read directory: ${dirPath} (${msg})`);
  }

  const directories: DirectoryEntry[] = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const parentPath = path.dirname(dirPath);

  return {
    path: dirPath,
    parent: parentPath === dirPath ? null : parentPath,
    directories,
  };
}

async function listWindowsDrives(): Promise<string[]> {
  const drives: string[] = [];
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  await Promise.all(
    letters.map(async (letter) => {
      const drive = `${letter}:\\`;
      try {
        await fs.access(drive);
        drives.push(drive);
      } catch {
        // Drive not present.
      }
    }),
  );
  return drives.sort();
}
