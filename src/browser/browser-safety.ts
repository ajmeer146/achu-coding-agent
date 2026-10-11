/**
 * Browser safety rules and checks.
 */

/**
 * Checks if a given browser action is safe to perform.
 * @param {string} action - The action being performed (e.g., 'navigate', 'click', 'type').
 * @param {any} params - The parameters for the action.
 * @returns {{ allowed: boolean; requiresConfirmation: boolean; reason: string }}
 */
export function checkActionSafety(action: string, params: any): { allowed: boolean; requiresConfirmation: boolean; reason: string } {
  // Default: allow and no confirmation required
  let allowed = true;
  let requiresConfirmation = false;
  let reason = '';

  // Define unsafe actions and patterns
  switch (action) {
    case 'navigate':
      const url = params.url as string;
      if (url) {
        const normalized =
          url.trim().toLowerCase();
        // Normal web browsing and local development
        // use HTTP(S), including localhost test servers.
        const isHttp =
          normalized.startsWith('http://') ||
          normalized.startsWith('https://');
        if (!isHttp) {
          // Filesystem targets, bare host:port strings,
          // and other non-HTTP(S) protocols stay blocked.
          allowed = false;
          requiresConfirmation = false;
          reason = `Navigation to non-HTTP(S) URL is blocked for safety.`;
          break;
        }
        
        // Restrict to local preview origins by default (e.g. localhost, 127.0.0.1)
        // Block arbitrary external navigation to prevent SSRF and external scanning
        try {
          const parsed = new URL(normalized);
          const hostname = parsed.hostname;
          if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]') {
            allowed = false;
            requiresConfirmation = false;
            reason = `Navigation to external origin (${hostname}) is blocked. Only local preview origins are permitted.`;
            break;
          }
        } catch {
          allowed = false;
          requiresConfirmation = false;
          reason = `Invalid URL format for navigation.`;
          break;
        }
      }
      break;

    case 'click':
      // We could check if the click is on a known dangerous button (e.g., 'delete account', 'submit payment')
      // Without seeing the page, we cannot know. We'll rely on the agent to avoid dangerous clicks.
      // For now, we allow.
      break;

    case 'type':
      // We could check if the typing is into a password field and the text is long (like a credit card)?
      // Again, without the page context, we cannot know.
      break;

    default:
      // For other actions, we allow by default.
      break;
  }

  return { allowed, requiresConfirmation, reason };
}



