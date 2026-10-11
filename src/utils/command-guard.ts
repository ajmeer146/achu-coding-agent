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
  { pattern: /^ls\s+-la\b/, replacement: 'Get-ChildItem -Force' },
  { pattern: /^ls\b/, replacement: 'Get-ChildItem' },
  { pattern: /^head\s+-(\d+)\b/, replacement: (_match: string, n: string) => `Select-Object -First ${n}` },
  { pattern: /^tail\s+-(\d+)\b/, replacement: (_match: string, n: string) => `Select-Object -Last ${n}` },
  { pattern: /^grep\s+/, replacement: 'Select-String' },
  { pattern: /^cat\s+/, replacement: 'Get-Content' },
  { pattern: /^rm\s+/, replacement: 'Remove-Item' },
  { pattern: /^cp\s+/, replacement: 'Copy-Item' },
  { pattern: /^mv\s+/, replacement: 'Move-Item' },
  { pattern: /^mkdir\s+/, replacement: 'New-Item -ItemType Directory' },
  { pattern: /^touch\s+/, replacement: 'New-Item -ItemType File' },
  { pattern: /^which\s+/, replacement: 'Get-Command' },
  { pattern: /^pwd\b/, replacement: 'Get-Location' },
  { pattern: /^echo\s+/, replacement: 'Write-Output' },
];

export function normalizeUnixCommand(command: string): { normalized: string; wasChanged: boolean; warning?: string } {
  const trimmed = command.trim();
  
  for (const { pattern, replacement } of UNIX_COMMAND_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      if (typeof replacement === 'function') {
        // match[1], match[2], etc. are the capture groups
        const newCmd = replacement(trimmed, match[1]);
        return { 
          normalized: newCmd, 
          wasChanged: true,
          warning: `Unix command "${match[0]}" normalized to PowerShell: "${newCmd}"`
        };
      }
      return { 
        normalized: trimmed.replace(pattern, replacement), 
        wasChanged: true,
        warning: `Unix command "${match[0]}" normalized to PowerShell: "${replacement}"`
      };
    }
  }
  
  return { normalized: command, wasChanged: false };
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