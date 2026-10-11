export function normalizeCommand(command) {
    return command
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}
export function isExactVerificationCommand(command, requestedCommand) {
    if (!requestedCommand)
        return false;
    return (normalizeCommand(command) ===
        normalizeCommand(requestedCommand));
}
