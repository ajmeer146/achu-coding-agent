import { BrowserSession } from './browser-session.js';
import type { LaunchOptions } from 'playwright';
import { checkActionSafety } from './browser-safety.js';

/**
 * Opens the browser (initializes the session).
 * @param {BrowserSession} session - The browser session to initialize.
 * @param {LaunchOptions} [options] - Launch options for the browser.
 * @returns {Promise<{ success: true; action: 'open_browser'; message: string } | { success: false; action: 'open_browser'; error: string; recoverable: boolean } | { success: false; action: 'open_browser'; requiresConfirmation: true; error: string; recoverable: boolean }>}
 */
export async function open_browser(session: BrowserSession, options?: LaunchOptions): Promise< 
  | { success: true; action: 'open_browser'; message: string } 
  | { success: false; action: 'open_browser'; error: string; recoverable: boolean } 
  | { success: false; action: 'open_browser'; requiresConfirmation: true; error: string; recoverable: boolean } 
> {
  // Safety check for opening browser (generally safe)
  const safety = checkActionSafety('open_browser', { options });
  if (!safety.allowed) {
    return { success: false, action: 'open_browser', error: safety.reason, recoverable: true };
  }
  if (safety.requiresConfirmation) {
    return { success: false, action: 'open_browser', requiresConfirmation: true, error: safety.reason, recoverable: true };
  }

  try {
    await session.init();
    return { success: true, action: 'open_browser', message: 'Browser opened successfully' };
  } catch (err: any) {
    return { 
      success: false, 
      action: 'open_browser', 
      error: err.message ?? 'Failed to open browser', 
      recoverable: true 
    };
  }
}

/**
 * Navigates to a URL.
 * @param {BrowserSession} session - The browser session.
 * @param {string} url - The URL to navigate to.
 * @returns {Promise<{ success: true; action: 'navigate'; url: string; title: string; message: string } | { success: false; action: 'navigate'; error: string; recoverable: boolean } | { success: false; action: 'navigate'; requiresConfirmation: true; error: string; recoverable: boolean }>}
 */
export async function navigate(session: BrowserSession, url: string): Promise< 
  | { success: true; action: 'navigate'; url: string; title: string; message: string } 
  | { success: false; action: 'navigate'; error: string; recoverable: boolean } 
  | { success: false; action: 'navigate'; requiresConfirmation: true; error: string; recoverable: boolean } 
> {
  // Safety check for navigation
  const safety = checkActionSafety('navigate', { url });
  if (!safety.allowed) {
    return { success: false, action: 'navigate', error: safety.reason, recoverable: true };
  }
  if (safety.requiresConfirmation) {
    return { success: false, action: 'navigate', requiresConfirmation: true, error: safety.reason, recoverable: true };
  }

  const result = await session.navigate(url);
  if (result.success) {
    return { 
      success: true, 
      action: 'navigate', 
      url: result.url, 
      title: result.title, 
      message: `Navigated to ${url}` 
    };
  } else {
    return { 
      success: false, 
      action: 'navigate', 
      error: result.error, 
      recoverable: result.recoverable 
    };
  }
}

/**
 * Inspects the current page.
 * @param {BrowserSession} session - The browser session.
 * @returns {Promise<{ success: true; action: 'inspect_page'; info: import('./browser-session.js').PageInfo } | { success: false; action: 'inspect_page'; error: string; recoverable: boolean } | { success: false; action: 'inspect_page'; requiresConfirmation: true; error: string; recoverable: boolean }>}
 */
export async function inspect_page(session: BrowserSession): Promise< 
  | { success: true; action: 'inspect_page'; info: import('./browser-session.js').PageInfo } 
  | { success: false; action: 'inspect_page'; error: string; recoverable: boolean } 
  | { success: false; action: 'inspect_page'; requiresConfirmation: true; error: string; recoverable: boolean } 
> {
  // Safety check for inspection (generally safe)
  const safety = checkActionSafety('inspect_page', {});
  if (!safety.allowed) {
    return { success: false, action: 'inspect_page', error: safety.reason, recoverable: true };
  }
  if (safety.requiresConfirmation) {
    return { success: false, action: 'inspect_page', requiresConfirmation: true, error: safety.reason, recoverable: true };
  }

  const result = await session.inspectPage();
  if (result.success) {
    return { 
      success: true, 
      action: 'inspect_page', 
      info: result.info 
    };
  } else {
    return { 
      success: false, 
      action: 'inspect_page', 
      error: result.error, 
      recoverable: result.recoverable 
    };
  }
}

/**
 * Clicks an element.
 * @param {BrowserSession} session - The browser session.
 * @param {string} selector - CSS selector or text to match.
 * @returns {Promise<{ success: true; action: 'click'; message: string } | { success: false; action: 'click'; error: string; recoverable: boolean } | { success: false; action: 'click'; requiresConfirmation: true; error: string; recoverable: boolean }>}
 */
export async function click(session: BrowserSession, selector: string): Promise< 
  | { success: true; action: 'click'; message: string } 
  | { success: false; action: 'click'; error: string; recoverable: boolean } 
  | { success: false; action: 'click'; requiresConfirmation: true; error: string; recoverable: boolean } 
> {
  // Safety check for click
  const safety = checkActionSafety('click', { selector });
  if (!safety.allowed) {
    return { success: false, action: 'click', error: safety.reason, recoverable: true };
  }
  if (safety.requiresConfirmation) {
    return { success: false, action: 'click', requiresConfirmation: true, error: safety.reason, recoverable: true };
  }

  const result = await session.click(selector);
  if (result.success) {
    return { 
      success: true, 
      action: 'click', 
      message: result.message 
    };
  } else {
    return { 
      success: false, 
      action: 'click', 
      error: result.error, 
      recoverable: result.recoverable 
    };
  }
}

/**
 * Types text into an input.
 * @param {BrowserSession} session - The browser session.
 * @param {string} selector - CSS selector, placeholder, or name to identify the input.
 * @param {string} text - The text to type.
 * @returns {Promise<{ success: true; action: 'type'; message: string } | { success: false; action: 'type'; error: string; recoverable: boolean } | { success: false; action: 'type'; requiresConfirmation: true; error: string; recoverable: boolean }>}
 */
export async function type(session: BrowserSession, selector: string, text: string): Promise< 
  | { success: true; action: 'type'; message: string } 
  | { success: false; action: 'type'; error: string; recoverable: boolean } 
  | { success: false; action: 'type'; requiresConfirmation: true; error: string; recoverable: boolean } 
> {
  // Safety check for type
  const safety = checkActionSafety('type', { selector, text });
  if (!safety.allowed) {
    return { success: false, action: 'type', error: safety.reason, recoverable: true };
  }
  if (safety.requiresConfirmation) {
    return { success: false, action: 'type', requiresConfirmation: true, error: safety.reason, recoverable: true };
  }

  const result = await session.type(selector, text);
  if (result.success) {
    return { 
      success: true, 
      action: 'type', 
      message: result.message 
    };
  } else {
    return { 
      success: false, 
      action: 'type', 
      error: result.error, 
      recoverable: result.recoverable 
    };
  }
}

/**
 * Takes a screenshot of the current page.
 * @param {BrowserSession} session - The browser session.
 * @returns {Promise<{ success: true; action: 'screenshot'; screenshot: string (base64) } | { success: false; action: 'screenshot'; error: string; recoverable: boolean } | { success: false; action: 'screenshot'; requiresConfirmation: true; error: string; recoverable: boolean }>}
 */
export async function screenshot(session: BrowserSession): Promise< 
  | { success: true; action: 'screenshot'; screenshot: string } 
  | { success: false; action: 'screenshot'; error: string; recoverable: boolean } 
  | { success: false; action: 'screenshot'; requiresConfirmation: true; error: string; recoverable: boolean } 
> {
  // Safety check for screenshot (generally safe)
  const safety = checkActionSafety('screenshot', {});
  if (!safety.allowed) {
    return { success: false, action: 'screenshot', error: safety.reason, recoverable: true };
  }
  if (safety.requiresConfirmation) {
    return { success: false, action: 'screenshot', requiresConfirmation: true, error: safety.reason, recoverable: true };
  }

  const result = await session.screenshot();
  if (result.success) {
    return { 
      success: true, 
      action: 'screenshot', 
      screenshot: result.screenshot 
    };
  } else {
    return { 
      success: false, 
      action: 'screenshot', 
      error: result.error, 
      recoverable: result.recoverable 
    };
  }
}

/**
 * Gets the current page information (URL and title).
 * @param {BrowserSession} session - The browser session.
 * @returns {Promise<{ success: true; action: 'get_page_info'; url: string; title: string } | { success: false; action: 'get_page_info'; error: string; recoverable: boolean } | { success: false; action: 'get_page_info'; requiresConfirmation: true; error: string; recoverable: boolean }>}
 */
export async function get_page_info(session: BrowserSession): Promise< 
  | { success: true; action: 'get_page_info'; url: string; title: string } 
  | { success: false; action: 'get_page_info'; error: string; recoverable: boolean } 
  | { success: false; action: 'get_page_info'; requiresConfirmation: true; error: string; recoverable: boolean } 
> {
  // Safety check for getting page info (generally safe)
  const safety = checkActionSafety('get_page_info', {});
  if (!safety.allowed) {
    return { success: false, action: 'get_page_info', error: safety.reason, recoverable: true };
  }
  if (safety.requiresConfirmation) {
    return { success: false, action: 'get_page_info', requiresConfirmation: true, error: safety.reason, recoverable: true };
  }

  const result = await session.getPageInfo();
  if (result.success) {
    return { 
      success: true, 
      action: 'get_page_info', 
      url: result.url, 
      title: result.title 
    };
  } else {
    return { 
      success: false, 
      action: 'get_page_info', 
      error: result.error, 
      recoverable: result.recoverable 
    };
  }
}

/**
 * Closes the browser.
 * @param {BrowserSession} session - The browser session.
 * @returns {Promise<{ success: true; action: 'close_browser'; message: string } | { success: false; action: 'close_browser'; error: string; recoverable: boolean } | { success: false; action: 'close_browser'; requiresConfirmation: true; error: string; recoverable: boolean }>}
 */
export async function close_browser(session: BrowserSession): Promise< 
  | { success: true; action: 'close_browser'; message: string } 
  | { success: false; action: 'close_browser'; error: string; recoverable: boolean } 
  | { success: false; action: 'close_browser'; requiresConfirmation: true; error: string; recoverable: boolean } 
> {
  // Safety check for closing browser (generally safe)
  const safety = checkActionSafety('close_browser', {});
  if (!safety.allowed) {
    return { success: false, action: 'close_browser', error: safety.reason, recoverable: true };
  }
  if (safety.requiresConfirmation) {
    return { success: false, action: 'close_browser', requiresConfirmation: true, error: safety.reason, recoverable: true };
  }

  try {
    await session.close();
    return { success: true, action: 'close_browser', message: 'Browser closed successfully' };
  } catch (err: any) {
    return { 
      success: false, 
      action: 'close_browser', 
      error: err.message ?? 'Failed to close browser', 
      recoverable: true 
    };
  }
}
