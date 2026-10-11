import path from "node:path";
import fs from "node:fs/promises";
export class Workspace {
    root;
    constructor(root = process.cwd()) {
        this.root = root;
    }
    resolve(relativePath) {
        const target = path.resolve(this.root, relativePath);
        if (target !== this.root && !target.startsWith(this.root + path.sep)) {
            throw new Error(`Path outside workspace is not allowed: ${relativePath}`);
        }
        return target;
    }
    async read(relativePath) {
        return fs.readFile(this.resolve(relativePath), "utf8");
    }
    async write(relativePath, content) {
        const target = this.resolve(relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, "utf8");
    }
    async list(relativePath = ".") {
        return fs.readdir(this.resolve(relativePath));
    }
    async exists(relativePath) {
        try {
            await fs.access(this.resolve(relativePath));
            return true;
        }
        catch {
            return false;
        }
    }
}
