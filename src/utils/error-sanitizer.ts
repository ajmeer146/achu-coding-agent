/**
 * Sanitizes errors and logs to prevent leaking provider credentials,
 * internal model names, endpoints, and raw provider details to user-facing surfaces.
 */

const KNOWN_MODEL_PATTERNS = [
  /nvidia\/[a-zA-Z0-9_\.\-]+/gi,
  /nemotron[a-zA-Z0-9_\.\-]*/gi,
  /gpt-[a-zA-Z0-9_\.\-]+/gi,
  /claude-[a-zA-Z0-9_\.\-]+/gi,
];

const SECRET_PATTERNS = [
  /(?:nvapi|tr_prod|tr_dev|whsec|sk)_[a-zA-Z0-9_\-]{8,}/gi,
  /Bearer\s+[a-zA-Z0-9_\-\.]{8,}/gi,
];

const URL_PATTERNS = [
  /https?:\/\/[a-zA-Z0-9_\-\.]*nvidia\.com[^\s"']*/gi,
  /\b(?:integrate\.api\.nvidia\.com|ai\.api\.nvidia\.com|nvcf\.nvidia\.com)\b/gi,
];

export function sanitizeUserFacingError(error: string | undefined | null): string {
  if (!error) return "";
  let text = String(error).trim();

  // Redact secrets and tokens
  for (const pat of SECRET_PATTERNS) {
    text = text.replace(pat, "[REDACTED_SECRET]");
  }

  // Redact provider URLs
  for (const pat of URL_PATTERNS) {
    text = text.replace(pat, "[AI Service]");
  }

  // Redact model names
  for (const pat of KNOWN_MODEL_PATTERNS) {
    text = text.replace(pat, "AI model");
  }

  text = text.replace(/\[NVIDIA API\]/gi, "[AI Service]");

  // Categorize known failure classes into clean user-facing messages
  if (/timeout|timed\s*out|ERR_REQUEST_TIMEOUT/i.test(text)) {
    return "The AI service is temporarily unavailable due to a request timeout. Please try again shortly.";
  }
  if (/quota|rate\s*limit|429|QUOTA_EXHAUSTED/i.test(text)) {
    return "The AI service rate limit was reached. Please wait a moment and try again.";
  }
  if (/econnreset|enotfound|econnrefused|ehostunreach|network\s*error/i.test(text)) {
    return "The AI service connection was interrupted. Please check your network and retry.";
  }
  if (/5\d{2}\s*server\s*error|service\s*unavailable|SERVER_ERROR/i.test(text)) {
    return "The AI service is temporarily unavailable. Please try again shortly.";
  }
  if (/execution loop detected/i.test(text)) {
    return "The agent stopped because it could not recover from an execution loop.";
  }
  if (/recovery limit reached/i.test(text) || /impossible task/i.test(text)) {
    return "The agent stopped because it could not recover from an execution error.";
  }

  return text;
}
