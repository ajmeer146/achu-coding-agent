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

const PROCESS_TERMINATION_PATTERNS = [
  /\bStop-Process\b/i,
  /\btaskkill\b/i,
  /\bkill\s+-\d+/i,
  /\bkill\s+\d+/i,
  /\bkillall\b/i,
  /\bpkill\b/i,
  /\bkill-port\b/i,
  /\bnpx\s+kill-port\b/i,
  /\bGet-Process\b.*\|\s*Stop-Process\b/i,
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
  { pattern: /^curl\s+/i, replacement: "curl.exe " },
  { pattern: /^ps\s+(?:aux|-ef|-a)\b/i, replacement: "Get-Process" },
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
 * Convert Unix '||' statement separators to PowerShell '; if (-not $?) { ... }' syntax.
 * Respects single and double quotes so '||' inside strings is never touched.
 */
export function replaceLogicalOrForPowerShell(command: string): string {
  if (!command.includes("||")) return command;

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
    } else if (ch === "|" && command[i + 1] === "|" && !inDoubleQuote && !inSingleQuote) {
      parts.push(current.trim());
      current = "";
      i++; // skip next |
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());

  if (parts.length <= 1) return command;

  let result = parts[0];
  for (let i = 1; i < parts.length; i++) {
    result += `; if (-not $?) { ${parts[i]} }`;
  }
  return result;
}

/**
 * Ensures unmatched double or single quotes are balanced to avoid PowerShell parse errors.
 */
export function balanceQuotes(command: string): string {
  let doubleQuotes = 0;
  let singleQuotes = 0;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const prev = i > 0 ? command[i - 1] : "";
    if (ch === '"' && prev !== "\\" && singleQuotes % 2 === 0) doubleQuotes++;
    if (ch === "'" && prev !== "\\" && doubleQuotes % 2 === 0) singleQuotes++;
  }
  let balanced = command;
  if (doubleQuotes % 2 !== 0) balanced += '"';
  if (singleQuotes % 2 !== 0) balanced += "'";
  return balanced;
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

  // | grep [flags] <pattern> (supporting spaces in single/double quotes or unquoted tokens)
  result = result.replace(
    /\|\s*grep(?:\.exe)?\s+((?:-[a-zA-Z]+\s+)*)(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s|]+))/gi,
    (_full, flagsStr = "", dQuoted, sQuoted, unquoted) => {
      const rawPattern = dQuoted !== undefined ? dQuoted : (sQuoted !== undefined ? sQuoted : unquoted);
      const isCaseInsensitive = /i/i.test(flagsStr);
      const isNotMatch = /v/i.test(flagsStr);
      const parts = ["Select-String"];
      if (!isCaseInsensitive) parts.push("-CaseSensitive");
      if (isNotMatch) parts.push("-NotMatch");
      const escaped = (rawPattern || "").replace(/"/g, '`"');
      parts.push(`-Pattern "${escaped}"`);
      return `| ${parts.join(" ")}`;
    }
  );

  return result;
}

/**
 * Normalizes standalone Unix grep commands to PowerShell cmdlets.
 */
export function normalizeGrepCommand(cmd: string): { normalized: string; warning: string } | null {
  const match = cmd.match(/^grep(?:\.exe)?\b(?:\s+(.*))?$/i);
  if (!match) return null;
  const rawArgs = match[1] ? match[1].trim() : "";
  if (!rawArgs) {
    return { normalized: "Select-String", warning: "Normalized bare 'grep' to 'Select-String'" };
  }

  // Parse arguments respecting single and double quotes
  const tokens: string[] = [];
  let cur = "";
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const ch = rawArgs[i];
    const prev = i > 0 ? rawArgs[i - 1] : "";
    if (ch === '"' && !inSingle && prev !== "\\") {
      inDouble = !inDouble;
      cur += ch;
    } else if (ch === "'" && !inDouble && prev !== "\\") {
      inSingle = !inSingle;
      cur += ch;
    } else if (/\s/.test(ch) && !inDouble && !inSingle) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);

  let isRecursive = false;
  let isCaseInsensitive = false;
  let isNotMatch = false;
  let pattern: string | null = null;
  const paths: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("-") && token.length > 1 && pattern === null) {
      if (/r/i.test(token)) isRecursive = true;
      if (/i/i.test(token)) isCaseInsensitive = true;
      if (/v/i.test(token)) isNotMatch = true;
      if (token === "-e" && i + 1 < tokens.length) {
        pattern = cleanPathArg(tokens[++i]);
      }
    } else if (pattern === null) {
      pattern = cleanPathArg(token);
    } else {
      paths.push(cleanPathArg(token));
    }
  }

  if (pattern === null) {
    return { normalized: "Select-String", warning: "Normalized 'grep' to 'Select-String'" };
  }

  const flags: string[] = [];
  if (!isCaseInsensitive) flags.push("-CaseSensitive");
  if (isNotMatch) flags.push("-NotMatch");
  const flagStr = flags.length > 0 ? ` ${flags.join(" ")}` : "";
  const escapedPattern = pattern.replace(/"/g, '`"');

  if (isRecursive) {
    const targetPath = paths.length > 0 && paths[0] !== "." ? paths[0] : "";
    const pathPart = targetPath ? ` -Path "${targetPath}"` : "";
    const converted = `$res = @(Get-ChildItem${pathPart} -Recurse -File | Select-String${flagStr} -Pattern "${escapedPattern}"); if ($res.Count -gt 0) { $res } else { exit 1 }`;
    return { normalized: converted, warning: `Normalized recursive grep to "${converted}"` };
  }

  if (paths.length > 0) {
    const targetPath = paths[0];
    const pathFlag = targetPath.includes("*") || targetPath.includes("?")
      ? `-Path "${targetPath}"`
      : `-LiteralPath "${targetPath}"`;
    const converted = `$res = @(Select-String${flagStr} -Pattern "${escapedPattern}" ${pathFlag}); if ($res.Count -gt 0) { $res } else { exit 1 }`;
    return { normalized: converted, warning: `Normalized grep with path to "${converted}"` };
  }

  const converted = `Select-String${flagStr} -Pattern "${escapedPattern}"`;
  return { normalized: converted, warning: `Normalized grep to "${converted}"` };
}

/**
 * Normalizes Unix find commands to PowerShell Get-ChildItem.
 */
export function normalizeFindCommand(cmd: string): { normalized: string; warning: string } | null {
  const match = cmd.match(/^find\s+([^\s]+)(?:\s+(?:-name|-iname)\s+["']?([^"']+)["']?)?(?:\s+-type\s+[fd])?$/i);
  if (!match) return null;
  const targetDir = cleanPathArg(match[1]);
  const filterPattern = match[2] ? match[2].trim() : "*";
  const pathPart = targetDir === "." ? "" : ` -Path "${targetDir}"`;
  const converted = `Get-ChildItem${pathPart} -Recurse -Filter "${filterPattern}"`;
  return { normalized: converted, warning: `Normalized find to "${converted}"` };
}

function cleanPathArg(arg: string): string {
  const trimmed = arg.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function splitCommandClauses(command: string): Array<{ text: string; connector?: "&&" | "||" | ";" }> {
  const clauses: Array<{ text: string; connector?: "&&" | "||" | ";" }> = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const prev = i > 0 ? command[i - 1] : "";

    if (ch === '"' && !inSingle && prev !== "\\") {
      inDouble = !inDouble;
      current += ch;
    } else if (ch === "'" && !inDouble && prev !== "\\") {
      inSingle = !inSingle;
      current += ch;
    } else if (!inDouble && !inSingle && ch === "&" && command[i + 1] === "&") {
      clauses.push({ text: current.trim(), connector: "&&" });
      current = "";
      i++;
    } else if (!inDouble && !inSingle && ch === "|" && command[i + 1] === "|") {
      clauses.push({ text: current.trim(), connector: "||" });
      current = "";
      i++;
    } else if (!inDouble && !inSingle && ch === ";") {
      clauses.push({ text: current.trim(), connector: ";" });
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0 || clauses.length === 0) {
    clauses.push({ text: current.trim(), connector: undefined });
  }
  return clauses;
}

export function normalizeSingleCommand(cmd: string): { normalized: string; warnings: string[] } {
  let normalized = cmd.trim();
  const warnings: string[] = [];

  // Null redirection
  if (/2>\/dev\/null/i.test(normalized)) {
    normalized = normalized.replace(/2>\/dev\/null/gi, "2>$null");
    warnings.push("Normalized '2>/dev/null' to '2>$null'");
  }
  if (/>\/dev\/null/i.test(normalized)) {
    normalized = normalized.replace(/>\/dev\/null/gi, ">$null");
    warnings.push("Normalized '>/dev/null' to '>$null'");
  }

  // DOS dir with switches
  const dirMatch = normalized.match(/^dir((?:\s+\/[a-zA-Z0-9\-_/]+)+)(?:\s+(.*))?$/i);
  if (dirMatch) {
    const switches = dirMatch[1].trim();
    const rawPath = dirMatch[2] ? dirMatch[2].trim() : "";
    if (rawPath) {
      const cleanPath = cleanPathArg(rawPath);
      const isBare = /\/b\b/i.test(switches);
      const isForce = /\/a\b/i.test(switches);
      const isRecurse = /\/s\b/i.test(switches);
      const parts = ["Get-ChildItem"];
      if (isForce) parts.push("-Force");
      if (isRecurse) parts.push("-Recurse");
      if (isBare) parts.push("-Name");
      parts.push(`-LiteralPath "${cleanPath}"`);
      const converted = parts.join(" ");
      warnings.push(`Normalized DOS dir with path to "${converted}"`);
      return { normalized: converted, warnings };
    } else {
      const wrapped = `cmd.exe /c ${normalized}`;
      warnings.push(`DOS dir command normalized to cmd.exe: "${wrapped}"`);
      return { normalized: wrapped, warnings };
    }
  }

  // Pipeline utilities (head, tail, grep)
  const afterPipelines = normalizePipelinesForPowerShell(normalized);
  if (afterPipelines !== normalized) {
    normalized = afterPipelines;
    warnings.push("Normalized pipeline utilities (head/tail/grep) to PowerShell cmdlets");
  }

  // Standalone grep
  const grepMatch = normalizeGrepCommand(normalized);
  if (grepMatch) {
    warnings.push(grepMatch.warning);
    return { normalized: grepMatch.normalized, warnings };
  }

  // Standalone find
  const findMatch = normalizeFindCommand(normalized);
  if (findMatch) {
    warnings.push(findMatch.warning);
    return { normalized: findMatch.normalized, warnings };
  }

  // test -f or test -d
  const testMatch = normalized.match(/^test\s+-[fd]\s+(.*)$/i);
  if (testMatch && testMatch[1]) {
    const cleanPath = cleanPathArg(testMatch[1]);
    const converted = `Test-Path -LiteralPath "${cleanPath}"`;
    warnings.push(`Normalized test to "${converted}"`);
    return { normalized: converted, warnings };
  }

  // ls -la with optional path
  const lsLaMatch = normalized.match(/^ls\s+-la(?:\s+(.*))?$/i);
  if (lsLaMatch) {
    const rawPath = lsLaMatch[1] ? lsLaMatch[1].trim() : "";
    if (rawPath) {
      const cleanPath = cleanPathArg(rawPath);
      const converted = `Get-ChildItem -Force -LiteralPath "${cleanPath}"`;
      warnings.push(`Normalized command prefix to "${converted}"`);
      return { normalized: converted, warnings };
    }
    warnings.push(`Normalized command prefix to "Get-ChildItem -Force"`);
    return { normalized: "Get-ChildItem -Force", warnings };
  }

  // ls with optional path (and optional -l or -a)
  const lsMatch = normalized.match(/^ls(?:\s+-(?:l|a|al|la))?(?:\s+(.*))?$/i);
  if (lsMatch && !normalized.toLowerCase().startsWith("lsof")) {
    const hasForce = normalized.toLowerCase().includes("-a");
    const rawPath = lsMatch[1] ? lsMatch[1].trim() : "";
    const forceFlag = hasForce ? " -Force" : "";
    if (rawPath) {
      const cleanPath = cleanPathArg(rawPath);
      const converted = `Get-ChildItem${forceFlag} -LiteralPath "${cleanPath}"`;
      warnings.push(`Normalized command prefix to "${converted}"`);
      return { normalized: converted, warnings };
    }
    const converted = `Get-ChildItem${forceFlag}`;
    warnings.push(`Normalized command prefix to "${converted}"`);
    return { normalized: converted, warnings };
  }

  // pwd
  if (/^pwd\b/i.test(normalized)) {
    warnings.push(`Normalized command prefix to "Get-Location"`);
    return { normalized: normalized.replace(/^pwd\b/i, "Get-Location"), warnings };
  }

  // curl -> curl.exe
  if (/^curl\s+/i.test(normalized)) {
    warnings.push(`Normalized command prefix to "curl.exe "`);
    return { normalized: normalized.replace(/^curl\s+/i, "curl.exe "), warnings };
  }

  // ps aux -> Get-Process
  if (/^ps\s+(?:aux|-ef|-a)\b/i.test(normalized)) {
    warnings.push(`Normalized command prefix to "Get-Process"`);
    return { normalized: normalized.replace(/^ps\s+(?:aux|-ef|-a)\b/i, "Get-Process"), warnings };
  }

  // cat with path
  const catMatch = normalized.match(/^cat\s+(.*)$/i);
  if (catMatch && catMatch[1]) {
    const cleanPath = cleanPathArg(catMatch[1]);
    const converted = `Get-Content -LiteralPath "${cleanPath}"`;
    warnings.push(`Normalized command prefix to "${converted}"`);
    return { normalized: converted, warnings };
  }

  // cd with path: preserve paths with spaces safely
  const cdMatch = normalized.match(/^cd\s+(.*)$/i);
  if (cdMatch && cdMatch[1]) {
    const cleanPath = cleanPathArg(cdMatch[1]);
    const converted = `Set-Location -LiteralPath "${cleanPath}"`;
    warnings.push(`Normalized cd path to "${converted}"`);
    return { normalized: converted, warnings };
  }

  // mkdir -p / mkdir
  const mkdirMatch = normalized.match(/^mkdir\s+(?:-p\s+)?(.*)$/i);
  if (mkdirMatch && mkdirMatch[1]) {
    const cleanPath = cleanPathArg(mkdirMatch[1]);
    const converted = `New-Item -ItemType Directory -Force -Path "${cleanPath}"`;
    warnings.push(`Normalized command prefix to "${converted}"`);
    return { normalized: converted, warnings };
  }

  // touch
  const touchMatch = normalized.match(/^touch\s+(.*)$/i);
  if (touchMatch && touchMatch[1]) {
    const cleanPath = cleanPathArg(touchMatch[1]);
    const converted = `New-Item -ItemType File -Force -Path "${cleanPath}"`;
    warnings.push(`Normalized command prefix to "${converted}"`);
    return { normalized: converted, warnings };
  }

  // rm -rf / rm
  const rmRfMatch = normalized.match(/^rm\s+-rf\s+(.*)$/i);
  if (rmRfMatch && rmRfMatch[1]) {
    const cleanPath = cleanPathArg(rmRfMatch[1]);
    const converted = `Remove-Item -Recurse -Force -LiteralPath "${cleanPath}"`;
    warnings.push(`Normalized command prefix to "${converted}"`);
    return { normalized: converted, warnings };
  }
  const rmMatch = normalized.match(/^rm\s+(.*)$/i);
  if (rmMatch && rmMatch[1]) {
    const cleanPath = cleanPathArg(rmMatch[1]);
    const converted = `Remove-Item -Force -LiteralPath "${cleanPath}"`;
    warnings.push(`Normalized command prefix to "${converted}"`);
    return { normalized: converted, warnings };
  }

  // which
  if (/^which\s+/i.test(normalized)) {
    warnings.push(`Normalized command prefix to "Get-Command "`);
    return { normalized: normalized.replace(/^which\s+/i, "Get-Command "), warnings };
  }

  // echo
  if (/^echo\s+/i.test(normalized)) {
    warnings.push(`Normalized command prefix to "Write-Output "`);
    return { normalized: normalized.replace(/^echo\s+/i, "Write-Output "), warnings };
  }

  return { normalized, warnings };
}

export function normalizeUnixCommand(command: string): { normalized: string; wasChanged: boolean; warning?: string } {
  let normalized = command.trim();
  let wasChanged = false;
  const warnings: string[] = [];

  // 1. Balance unclosed quotes if present to prevent PowerShell syntax crashes
  const balanced = balanceQuotes(normalized);
  if (balanced !== normalized) {
    normalized = balanced;
    wasChanged = true;
    warnings.push("Balanced unclosed quotes for safe shell parsing");
  }

  // 2. Split compound commands into individual statements respecting quotes
  const clauses = splitCommandClauses(normalized);
  if (clauses.length <= 1 && !clauses[0]?.connector) {
    const singleResult = normalizeSingleCommand(clauses[0] ? clauses[0].text : normalized);
    warnings.push(...singleResult.warnings);
    const finalCmd = singleResult.normalized;
    return {
      normalized: finalCmd,
      wasChanged: wasChanged || finalCmd !== command.trim(),
      warning: warnings.length > 0 ? warnings.join("; ") : undefined,
    };
  }

  const normalizedClauses = clauses.map((c) => {
    const single = normalizeSingleCommand(c.text);
    warnings.push(...single.warnings);
    return {
      text: single.normalized,
      connector: c.connector,
    };
  });

  let result = normalizedClauses[0].text;
  for (let i = 0; i < normalizedClauses.length - 1; i++) {
    const conn = normalizedClauses[i].connector;
    const nextText = normalizedClauses[i + 1].text;
    if (conn === "&&") {
      result += `; if ($?) { ${nextText} }`;
      warnings.push("Normalized '&&' to PowerShell conditional chaining");
    } else if (conn === "||") {
      result += `; if (-not $?) { ${nextText} }`;
      warnings.push("Normalized '||' to PowerShell conditional chaining");
    } else {
      result += `; ${nextText}`;
    }
  }

  return {
    normalized: result,
    wasChanged: wasChanged || result !== command.trim(),
    warning: warnings.length > 0 ? warnings.join("; ") : undefined,
  };
}

const BLOCKED_CONFIG_FILES = new Set([
  "tsconfig.json",
  ".env",
  ".env.local",
  ".env.production",
  ".npmrc",
]);

const PROTECTED_CONFIG_NAMES = [
  "tsconfig.json",
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

  if (/\b(?:touch|echo|set-content|add-content|out-file)\b.*\.env/i.test(normalized) || />\s*.*\.env/i.test(normalized)) {
    return {
      allowed: false,
      reason: "Modifying or creating .env files is blocked. Environment configuration and secrets must be preserved.",
    };
  }

  if (/\bnpm\s+(?:install|i|add)\s+(?:--save-dev\s+|--save\s+|-D\s+)?(?:-g\s+)?serve\b/i.test(normalized)) {
    return {
      allowed: false,
      reason: "Installing 'serve' packages is not permitted. The application development server launcher manages static serving automatically without package changes.",
    };
  }

  if (/\b(?:apt-get|apt|sudo|apk|yum|dnf|pacman)\b/i.test(normalized) || /\bnpx\s+playwright\s+install\b/i.test(normalized)) {
    return {
      allowed: false,
      reason: "System package installation ('apt-get', 'sudo', 'playwright install') is not permitted in this sandbox. The runtime and browser environment are pre-configured. If browser automation is unavailable, proceed with application development and verify using server responses.",
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

  for (const pattern of PROCESS_TERMINATION_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        allowed: false,
        reason:
          "Direct process termination is blocked. Use the 'stop_app' tool to manage application processes, or let the agent allocate an available port.",
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

    // Block process termination
    const killCommands = ['stop-process', 'taskkill', 'kill', 'pkill', 'killall'];
    if (killCommands.includes(exe)) {
      return {
        allowed: false,
        reason: `Direct process termination command '${exe}' is blocked. Use the 'stop_app' tool to manage application processes, or let the agent allocate an available port.`
      };
    }

    // Block commands trying to escape workspace (cd .., etc)
    if (exe === 'cd' || exe === 'set-location' || exe === 'pushd') {
      const args = tokens.slice(1);
      if (args.some(t => t.includes('..') || t === '/' || t === '\\' || /^[a-z]:\\?$/i.test(t))) {
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

  const fileName = normalized.split("/").pop() || normalized;
  if (fileName.startsWith(".env") || fileName === ".npmrc" || fileName === "tsconfig.json") {
    return true;
  }

  return BLOCKED_CONFIG_FILES.has(
    normalized,
  );
}