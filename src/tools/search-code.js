import fs from "node:fs/promises";
import path from "node:path";
const IGNORED = new Set([
    "node_modules",
    ".git",
    "dist",
    ".next",
    ".turbo",
    "coverage",
]);
async function collectFiles(directory, root, results) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (IGNORED.has(entry.name))
            continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            await collectFiles(fullPath, root, results);
        }
        else {
            results.push(path.relative(root, fullPath));
        }
    }
}
export async function searchCode(workspace, query) {
    const files = [];
    await collectFiles(workspace.root, workspace.root, files);
    const matches = [];
    for (const file of files) {
        const absolutePath = workspace.resolve(file);
        let content;
        try {
            content = await fs.readFile(absolutePath, "utf8");
        }
        catch {
            continue;
        }
        const lines = content.split(/\r?\n/);
        lines.forEach((line, index) => {
            if (line.toLowerCase().includes(query.toLowerCase())) {
                matches.push(`${file}:${index + 1}: ${line.trim()}`);
            }
        });
        if (matches.length >= 100) {
            break;
        }
    }
    if (matches.length === 0) {
        return `No matches found for "${query}".`;
    }
    return matches.join("\n");
}
