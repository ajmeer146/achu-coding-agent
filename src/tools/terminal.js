import { spawn } from "node:child_process";
import { validateCommand } from "../utils/command-guard.js";
export async function runCommand(command, cwd) {
    const validation = validateCommand(command);
    if (!validation.allowed) {
        throw new Error(validation.reason);
    }
    return new Promise((resolve, reject) => {
        const child = spawn("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            command,
        ], {
            cwd,
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (data) => {
            stdout += data.toString();
        });
        child.stderr.on("data", (data) => {
            stderr += data.toString();
        });
        child.on("error", reject);
        child.on("close", (exitCode) => {
            resolve({
                command,
                exitCode: exitCode ?? -1,
                stdout,
                stderr,
            });
        });
    });
}
