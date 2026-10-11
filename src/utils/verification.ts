export type VerificationState = {
  requestedCommand: string | null;
  requestedPassed: boolean;
  requestedFailed: boolean;
};

export function normalizeCommand(command: string): string {
  return command
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function isExactVerificationCommand(
  command: string,
  requestedCommand: string | null,
): boolean {
  if (!requestedCommand) return false;

  return (
    normalizeCommand(command) ===
    normalizeCommand(requestedCommand)
  );
}
