const BLOCKED_COMMAND_PATTERNS = [
    // Global package/environment mutation
    /\bnpm\s+(install|uninstall|update)\s+-g\b/i,
    // Installing the px workaround
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
    // Command-wrapper / script creation
    /\bSet-Content\b.*\.(cmd|bat|ps1)\b/i,
    /\bAdd-Content\b.*\.(cmd|bat|ps1)\b/i,
    /\bCopy-Item\b.*\.(cmd|bat|ps1)\b/i,
    /\bcp\b.*\.(cmd|bat|ps1)\b/i,
    // Moving / renaming configuration or command files
    /\bMove-Item\b/i,
    /\bRename-Item\b/i,
    /\bmove\b.*\.(json|cmd|bat|ps1)\b/i,
    /\bren\b.*\.(json|cmd|bat|ps1)\b/i,
    /\bmv\b.*\.(json|cmd|bat|ps1)\b/i,
    // Direct deletion
    /\bRemove-Item\b.*\.(cmd|bat|ps1|json)\b/i,
    /\bdel\b.*\.(cmd|bat|ps1|json)\b/i,
    // Explicit px command
    /^\s*px(?:\.cmd|\.exe)?(?:\s|$)/i,
];
const BLOCKED_CONFIG_FILES = new Set([
    "tsconfig.json",
    "package.json",
    "package-lock.json",
    ".env",
    ".env.local",
    ".env.production",
    ".npmrc",
]);
const PROTECTED_CONFIG_PATTERN = /(?:^|[\\/\s"'`])(?:tsconfig\.json|package\.json|package-lock\.json|\.npmrc|\.env(?:\.[A-Za-z0-9_-]+)?)(?:$|[\s"'`\\/])/i;
function containsProtectedRedirection(command) {
    const redirectionPattern = /(?:>|>>)\s*["'`]?([^"'`\s|;&]+)["'`]?/gi;
    for (const match of command.matchAll(redirectionPattern)) {
        const target = match[1];
        if (!target) {
            continue;
        }
        if (PROTECTED_CONFIG_PATTERN.test(target)) {
            return true;
        }
    }
    return false;
}
export function validateCommand(command) {
    const normalized = command.trim();
    if (containsProtectedRedirection(normalized)) {
        return {
            allowed: false,
            reason: "Blocked protected configuration-file overwrite through shell redirection.",
        };
    }
    for (const pattern of BLOCKED_COMMAND_PATTERNS) {
        if (pattern.test(normalized)) {
            return {
                allowed: false,
                reason: "Blocked unsafe environment/configuration mutation or command-wrapper workaround.",
            };
        }
    }
    return {
        allowed: true,
    };
}
export function isProtectedFile(filePath) {
    const normalized = filePath
        .replaceAll("\\", "/")
        .toLowerCase()
        .replace(/^\.\/+/, "");
    return BLOCKED_CONFIG_FILES.has(normalized);
}
