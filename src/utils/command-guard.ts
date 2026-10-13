const BLOCKED_COMMAND_PATTERNS = [
  // Global package mutation
  /\bnpm\s+(install|uninstall|update)\s+-g\b/i,

  // Installing px as a workaround
  /\bnpm\s+(install|i)\s+px(?:\s|$)/i,

  // Environment / PATH / aliases
  /\bsetx\b/i,
  /\$env:/i,
  /\bSet-Item\s+env:/i,
  /\bSet-Alias\b/i,
  /\bNew-Alias\b/i,
  /\bRemove-Alias\b/i,
  /\bPATH\b.*=/i,

  // Shell functions
  /\bfunction\s+\w+\s*\{/i,

  // Script/wrapper creation APIs
  /\bSet-Content\b/i,
  /\bAdd-Content\b/i,
  /\bOut-File\b/i,

  // Script/wrapper creation through redirection
  /(?:^|[\s;&|])(?:echo|Write-Output)\b.*>\s*["'`]?.*\.(cmd|bat|ps1)\b/i,
  />\s*["'`]?.*\.(cmd|bat|ps1)\b/i,

  // Copy wrapper scripts
  /\bCopy-Item\b.*\.(cmd|bat|ps1)\b/i,
  /\bcp\b.*\.(cmd|bat|ps1)\b/i,
  /\bcopy\b.*\.(cmd|bat|ps1)\b/i,

  // Move / rename config or wrapper files
  /\bMove-Item\b/i,
  /\bRename-Item\b/i,
  /\bmove\b.*\.(json|cmd|bat|ps1)\b/i,
  /\bren\b.*\.(json|cmd|bat|ps1)\b/i,
  /\bmv\b.*\.(json|cmd|bat|ps1)\b/i,

  // Delete config or wrapper files
  /\bRemove-Item\b.*\.(json|cmd|bat|ps1)\b/i,
  /\bdel\b.*\.(json|cmd|bat|ps1)\b/i,
  /\brm\b.*\.(json|cmd|bat|ps1)\b/i,
  /\berase\b.*\.(json|cmd|bat|ps1)\b/i,

  // Direct px command
  /^\s*px(?:\.cmd|\.exe)?(?:\s|$)/i,
];

const UNIX_COMMAND_PATTERNS = [
  { pattern: /^ls\s+-la\b/i, replacement: "Get-ChildItem -Force" },
  { pattern: /^ls\b/i, replacement: "Get-ChildItem" },
  { pattern: /^head\s+(?:-n\s+|-)?(\d+)\b/i, replacement: (_match: string, n: string) => `Select-Object -First ${n}` },
  { pattern: /^tail\s+(?:-n\s+|-)?(\d+)\b/i, replacement: (_match: string, n: string) => `Select-Object -Last ${n}` },
  { pattern: /^grep\s+/i, replacement: "Select-String " },
  { pattern: /^cat\s+/i, replacement: "Get-Content " },
  { pattern: /^rm\s+-rf\s+/i, replacement: "Remove-Item -Recurse -Force " },
  { pattern: /^rm\s+/i, replacement: "Remove-Item -Force " },
  { pattern: /^cp\s+-r\s+/i, replacement: "Copy-Item -Recurse " },
  { pattern: /^cp\s+/i, replacement: "Copy-Item " },
  { pattern: /^mv\s+/i, replacement: "Move-Item " },
  { pattern: /^mkdir\s+-p\s+/i, replacement: "New-Item -ItemType Directory -Force -Path " },
  { pattern: /^mkdir\s+/i, replacement: "New-Item -ItemType Directory -Force -Path " },
  { pattern: /^touch\s+/i, replacement: "New-Item -ItemType File -Force -Path " },
  { pattern: /^which\s+/i, replacement: "Get-Command " },
  { pattern: /^pwd\b/i, replacement: "Get-Location" },
  { pattern: /^echo\s+/i, replacement: "Write-Output " },
];

/**
 * Convert Unix '&&' statement separators to PowerShell '; if ($?) { ... }' syntax.
 * Respects single and double quotes so '&&' inside strings is never touched.
 */
export function replaceLogicalAndForPowerShell(command: string): string {
  if (!command.includes("&&")) return command;

  const parts: string[] = [];
  let current = "";
  let inDoubleQuote = false;
  let inSingleQuote = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const prev = i > 0 ? command[i - 1] : "";

    if (ch === '"' && !inSingleQuote && prev !== "\\") {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
    } else if (ch === "'" && !inDoubleQuote && prev !== "\\") {
      inSingleQuote = !inSingleQuote;
      current += ch;
    } else if (ch === "&" && command[i + 1] === "&" && !inDoubleQuote && !inSingleQuote) {
      parts.push(current.trim());
      current = "";
      i++; // skip next &
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());

  if (parts.length <= 1) return command;

  let result = parts[0];
  for (let i = 1; i < parts.length; i++) {
    result += `; if ($?) { ${parts[i]} }`;
  }
  return result;
}

/**
 * Normalize Unix pipeline utilities (head, tail, grep) to PowerShell equivalents.
 */
export function normalizePipelinesForPowerShell(command: string): string {
  let result = command;

  // | head -30, | head -n 30
  result = result.replace(/\|\s*head\s+(?:-n\s+|-)?(\d+)\b/gi, "| Select-Object -First $1");
  // | head (default 10)
  result = result.replace(/\|\s*head\b/gi, "| Select-Object -First 10");

  // | tail -30, | tail -n 30
  result = result.replace(/\|\s*tail\s+(?:-n\s+|-)?(\d+)\b/gi, "| Select-Object -Last $1");
  // | tail (default 10)
  result = result.replace(/\|\s*tail\b/gi, "| Select-Object -Last 10");

  // | grep <pattern>
  result = result.replace(/\|\s*grep\s+(?:-[a-zA-Z]+\s+)?(['"]?)([^'"|\s]+)\1/gi, '| Select-String -Pattern "$2"');

  return result;
}

export function normalizeUnixCommand(command: string): { normalized: string; wasChanged: boolean; warning?: string } {
  let normalized = command.trim();
  let wasChanged = false;
  const warnings: string[] = [];

  // 1. If command uses DOS dir with switches (e.g. dir /a /s /b), wrap in cmd /c so PowerShell doesn't misinterpret / switches as parameters
  if (/^dir\s+\/[a-zA-Z]/i.test(normalized)) {
    normalized = `cmd.exe /c ${normalized}`;
    return {
      normalized,
      wasChanged: true,
      warning: `DOS dir command normalized to cmd.exe: "${normalized}"`,
    };
  }

  // 2. Chained commands with &&
  const afterAnd = replaceLogicalAndForPowerShell(normalized);
  if (afterAnd !== normalized) {
    normalized = afterAnd;
    wasChanged = true;
    warnings.push("Normalized '&&' to PowerShell conditional chaining");
  }

  // 3. Pipeline utilities
  const afterPipelines = normalizePipelinesForPowerShell(normalized);
  if (afterPipelines !== normalized) {
    normalized = afterPipelines;
    wasChanged = true;
    warnings.push("Normalized pipeline utilities (head/tail/grep) to PowerShell cmdlets");
  }

  // 4. Prefix commands (ls, cat, rm, etc.)
  for (const { pattern, replacement } of UNIX_COMMAND_PATTERNS) {
    if (pattern.test(normalized)) {
      if (typeof replacement === "function") {
        const match = normalized.match(pattern);
        if (match) {
          const newCmd = replacement(normalized, match[1]);
          normalized = newCmd;
          wasChanged = true;
          warnings.push(`Normalized command prefix to "${newCmd}"`);
        }
      } else {
        normalized = normalized.replace(pattern, replacement);
        wasChanged = true;
        warnings.push(`Normalized command prefix to "${replacement}"`);
      }
      break;
    }
  }

  return {
    normalized,
    wasChanged,
    warning: warnings.length > 0 ? warnings.join("; ") : undefined,
  };
}

const BLOCKED_CONFIG_FILES = new Set([
  "tsconfig.json",
  "package.json",
  "package-lock.json",
  ".env",
  ".env.local",
  ".env.production",
  ".npmrc",
]);

const PROTECTED_CONFIG_NAMES = [
  "tsconfig.json",
  "package.json",
  "package-lock.json",
  ".npmrc",
  ".env",
  ".env.local",
  ".env.production",
];

function containsProtectedRedirection(
  command: string,
): boolean {
  const lower = command.toLowerCase();

  if (!lower.includes(">")) {
    return false;
  }

  return PROTECTED_CONFIG_NAMES.some(
    (name) =>
      lower.includes(name.toLowerCase()),
  );
}

export function validateCommand(
  command: string,
): {
  allowed: boolean;
  reason?: string;
} {
  const normalized = command.trim();

  if (
    containsProtectedRedirection(
      normalized,
    )
  ) {
    return {
      allowed: false,
      reason:
        "Blocked protected configuration-file overwrite through shell redirection.",
    };
  }

  for (
    const pattern of BLOCKED_COMMAND_PATTERNS
  ) {
    if (pattern.test(normalized)) {
      return {
        allowed: false,
        reason:
          "Blocked unsafe environment/configuration mutation or command-wrapper workaround.",
      };
    }
  }

  // Phase 7: Structured validation for risky operations
  // Split command into sub-commands by PowerShell pipeline/statement separators
  const subCommands = normalized.split(/(?:;|\||&&|\|\||\n)/);
  for (const sub of subCommands) {
    const trimmedSub = sub.trim();
    if (!trimmedSub) continue;

    // Tokenize by spaces, respecting simple quotes (naive approach for basic security)
    const tokens = trimmedSub.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    const firstToken = tokens[0];
    if (!firstToken) continue;
    const exe = firstToken.toLowerCase().replace(/^["']|["']$/g, '');

    // Block destructive commands
    const destructiveCommands = ['rm', 'rmdir', 'del', 'erase', 'remove-item', 'format'];
    if (destructiveCommands.includes(exe)) {
      // Allow only if targeting node_modules or dist/build folders, or explicitly allowed
      const isSafeTarget = tokens.some(t => t.includes('node_modules') || t.includes('dist') || t.includes('build'));
      if (!isSafeTarget) {
        return {
          allowed: false,
          reason: `Destructive command '${exe}' is blocked unless targeting safe directories (node_modules, dist, build). Use 'edit_file' to empty files instead.`
        };
      }
    }

    // Block credential access
    const credCommands = ['get-credential', 'aws', 'gcloud', 'az', 'docker', 'kubectl'];
    if (credCommands.includes(exe)) {
      return {
        allowed: false,
        reason: `Command '${exe}' accessing credentials or external systems is blocked.`
      };
    }

    // Block system configuration
    const sysConfigCommands = ['set-itemproperty', 'new-itemproperty', 'reg', 'netsh', 'icacls', 'takeown', 'sc'];
    if (sysConfigCommands.includes(exe)) {
      return {
        allowed: false,
        reason: `System configuration command '${exe}' is blocked.`
      };
    }

    // Block commands trying to escape workspace (cd .., etc)
    if (exe === 'cd' || exe === 'set-location' || exe === 'pushd') {
      if (tokens.some(t => t.includes('..') || t.startsWith('/') || t.startsWith('\\') || /^[a-z]:/i.test(t))) {
        return {
          allowed: false,
          reason: `Changing directory outside the current workspace is blocked.`
        };
      }
    }
  }

  return {
    allowed: true,
  };
}

export function isProtectedFile(
  filePath: string,
): boolean {
  const normalized = filePath
    .replaceAll("\\", "/")
    .toLowerCase()
    .replace(/^\.\/+/, "");

  return BLOCKED_CONFIG_FILES.has(
    normalized,
  );
}