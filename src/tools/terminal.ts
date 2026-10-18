import { spawn } from "node:child_process";
import { validateCommand, normalizeUnixCommand } from "../utils/command-guard.js";

export type CommandResult = {
  command: string;
  normalizedCommand?: string;
  cwd?: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

// Default timeout for terminal commands (5 minutes)
const DEFAULT_COMMAND_TIMEOUT = 5 * 60 * 1000;

// Maximum output size to prevent memory issues (10MB)
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;

function truncateOutput(output: string, maxSize: number = MAX_OUTPUT_SIZE): string {
  if (output.length <= maxSize) {
    return output;
  }
  return output.slice(0, maxSize) + `\n...[output truncated: ${output.length} bytes total]`;
}

/**
 * Get the appropriate shell command and args for the current platform.
 * On Windows, uses PowerShell. On Linux/macOS, uses bash.
 */
function getShellCommand(command: string): { shell: string; args: string[] } {
  const isWindows = process.platform === "win32";
  
  if (isWindows) {
    const wrappedCommand = `${command}; if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE } elseif (-not $?) { exit 1 }`;
    return {
      shell: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", wrappedCommand],
    };
  } else {
    return {
      shell: "bash",
      args: ["-c", command],
    };
  }
}

/**
 * Get the appropriate kill command for the current platform.
 */
function getKillCommand(pid: number): { cmd: string; args: string[] } {
  const isWindows = process.platform === "win32";
  
  if (isWindows) {
    return { cmd: "taskkill", args: ["/pid", pid.toString(), "/t", "/f"] };
  } else {
    return { cmd: "kill", args: ["-9", pid.toString()] };
  }
}

export async function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number = DEFAULT_COMMAND_TIMEOUT,
): Promise<CommandResult> {
  const validation = validateCommand(command);

  if (!validation.allowed) {
    throw new Error(validation.reason);
  }

  const isWindows = process.platform === "win32";
  // On Windows, normalize Unix commands to PowerShell cmdlets.
  // On POSIX (Linux/macOS), commands run natively in bash without PowerShell translation.
  const { normalized, wasChanged, warning } = isWindows
    ? normalizeUnixCommand(command)
    : { normalized: command, wasChanged: false, warning: undefined };
  if (wasChanged && warning) {
    console.log(`[Command Normalization] ${warning}`);
  }

  const { shell, args } = getShellCommand(normalized);

  return new Promise((resolve, reject) => {
    const child = spawn(shell, args, {
      cwd,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    // Track if the process was killed due to timeout
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      const { cmd, args: killArgs } = getKillCommand(child.pid || 0);
      spawn(cmd, killArgs, { windowsHide: true });
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);

    child.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      process.stdout.write(chunk);
      // Prevent unbounded memory growth
      if (stdout.length > MAX_OUTPUT_SIZE) {
        stdout = stdout.slice(-MAX_OUTPUT_SIZE);
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      process.stderr.write(chunk);
      if (stderr.length > MAX_OUTPUT_SIZE) {
        stderr = stderr.slice(-MAX_OUTPUT_SIZE);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeoutId);
      if (!timedOut) {
        reject(err);
      }
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutId);
      if (!timedOut) {
        resolve({
          command,
          normalizedCommand: normalized,
          cwd,
          exitCode: exitCode ?? -1,
          stdout,
          stderr,
        });
      }
    });
  });
}
