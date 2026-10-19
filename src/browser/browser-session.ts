// Reference the DOM library for DOM types in the evaluate function
/// <reference lib="dom" />

import type { Browser, Page, LaunchOptions } from 'playwright';

let cachedPlaywright: any = null;
async function loadPlaywright() {
  if (cachedPlaywright) return cachedPlaywright;
  try {
    const pw = await import("playwright");
    cachedPlaywright = pw.default || pw;
    return cachedPlaywright;
  } catch {
    try {
      const pw = await import("playwright-core");
      cachedPlaywright = pw.default || pw;
      return cachedPlaywright;
    } catch {
      return null;
    }
  }
}

/**
 * BrowserSession manages a Playwright browser instance and a page.
 * It provides methods for common browser operations.
 */
export class BrowserSession {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private readonly launchOptions: LaunchOptions;
  private consoleErrors: string[] = [];
  private pageErrors: string[] = [];

  constructor(options: LaunchOptions = {}) {
    this.launchOptions = options;
  }

  /**
   * Launches the browser and creates a new page.
   * @returns {Promise<void>}
   */
  async init(): Promise<void> {
    if (this.browser === null) {
      const pw = await loadPlaywright();
      if (!pw || !pw.chromium) {
        throw new Error("Browser automation service is not available in this environment.");
      }
      const chromium = pw.chromium;
      const defaultArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process',
      ];
      const mergedArgs = Array.from(new Set([...defaultArgs, ...(this.launchOptions.args || [])]));
      const launchOptions: LaunchOptions = {
        headless: true,
        timeout: 15000,
        ...this.launchOptions,
        args: mergedArgs,
      };
      this.browser = await chromium.launch(launchOptions);
    }
    if (this.page === null && this.browser !== null) {
      this.page = await this.browser.newPage();
      // Set default timeouts for page operations
      this.page.setDefaultTimeout(30000);
      this.page.setDefaultNavigationTimeout(30000);

      // Collect console errors
      this.page.on('console', msg => {
        if (msg.type() === 'error') {
          // Limit to avoid memory leak
          if (this.consoleErrors.length < 50) {
            this.consoleErrors.push(msg.text());
          }
        }
      });

      // Collect page runtime errors
      this.page.on('pageerror', error => {
        if (this.pageErrors.length < 50) {
          this.pageErrors.push(error.message);
        }
      });

      // Collect failed network requests
      this.page.on('requestfailed', request => {
        const failure = request.failure();
        if (failure && this.pageErrors.length < 50) {
          this.pageErrors.push(`Failed request: ${request.url()} - ${failure.errorText}`);
        }
      });
    }
  }

  /**
   * Checks whether the browser automation service is available and operational.
   */
  async isAvailable(): Promise<{ available: boolean; error?: string }> {
    try {
      if (this.browser === null) {
        await Promise.race([
          this.init(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Browser launch timed out")), 10000)),
        ]);
      }
      return { available: true };
    } catch (err: any) {
      return {
        available: false,
        error: err.message ?? "Browser automation service unavailable",
      };
    }
  }

  /**
   * Navigates to the given URL.
   * @param {string} url - The URL to navigate to.
   * @returns {Promise<{ success: true; url: string; title: string; status?: number | null } | { success: false; error: string; recoverable: boolean; isConnectivityError?: boolean; status?: number | null }>}
   */
  async navigate(url: string): Promise<
    | { success: true; url: string; title: string; status?: number | null }
    | { success: false; error: string; recoverable: boolean; isConnectivityError?: boolean; status?: number | null }
  > {
    if (!this.page) {
      try {
        await this.init();
      } catch (initErr: any) {
        return { success: false, error: `Browser page not initialized: ${initErr.message}`, recoverable: true, isConnectivityError: true };
      }
    }
    if (!this.page) {
      return { success: false, error: 'Browser page not initialized.', recoverable: true, isConnectivityError: true };
    }
    try {
      this.consoleErrors = [];
      this.pageErrors = [];

      let response = null;
      try {
        response = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (err: any) {
        const msg = err.message ?? '';
        if (msg.includes('ERR_CONNECTION_REFUSED') || msg.includes('ECONNREFUSED') || msg.includes('Target closed') || msg.includes('browser has been closed')) {
          throw err;
        }
        // Fallback to load wait if domcontentloaded timed out
        response = await this.page.goto(url, { waitUntil: 'load', timeout: 15000 });
      }

      const status = response ? response.status() : null;
      const title = await this.page.title();
      return { success: true, url: this.page.url(), title, status };
    } catch (err: any) {
      const msg = err.message ?? 'Unknown error during navigation';
      const isConnRefused = msg.includes('ERR_CONNECTION_REFUSED') || msg.includes('ECONNREFUSED');
      const isTargetClosed = msg.includes('Target closed') || msg.includes('browser has been closed') || msg.includes('Session closed');
      const isTimeout = err.name === 'TimeoutError' || msg.includes('Timeout') || msg.includes('timed out');
      const isConnectivityError = isTargetClosed || msg.includes('Executable doesn\'t exist') || msg.includes('Protocol error');
      return {
        success: false,
        error: msg,
        recoverable: isTimeout || isConnRefused,
        isConnectivityError,
        status: null,
      };
    }
  }

  /**
   * Inspects the current page and returns useful information.
   * @returns {Promise<{ success: true; info: PageInfo } | { success: false; error: string; recoverable: boolean }>}
   */
  async inspectPage(): Promise<{ success: true; info: PageInfo } | { success: false; error: string; recoverable: boolean }> {
    if (!this.page) {
      return { success: false, error: 'Browser page not initialized. Call init() first.', recoverable: true };
    }
    try {
      const url = this.page.url();
      const title = await this.page.title();
      // Get visible text (we'll limit to a reasonable length)
      const visibleText = await this.page.evaluate(() => {
        // We'll use innerText as a simple approximation of visible text
        // Note: innerText excludes the text of script and style elements, but it is affected by CSS visibility.
        return document.body.innerText;
      });

      // Get interactive elements: buttons, inputs, links, selects, textareas, styles
      const evalResults = await Promise.all([
        // Buttons: button elements and elements with role="button"
        this.page.$$eval('button, [role="button"]', els => els.map(el => el.textContent?.trim() ?? '').filter(t => t.length > 0)),
        // Inputs: input elements and elements with role="textbox"
        this.page.$$eval('input, [role="textbox"]', els => {
          return els.map(el => {
            // Try to cast to HTMLInputElement for name, type, placeholder
            const input = el as HTMLInputElement;
            return {
              name: input.name ?? '',
              type: input.type ?? '',
              placeholder: input.placeholder ?? ''
            };
          });
        }),
        // Links: anchor elements with href
        this.page.$$eval('a[href]', els => els.map(el => el.textContent?.trim() ?? '').filter(t => t.length > 0)),
        // Selects: select elements
        this.page.$$eval('select', els => els.map(el => {
          const select = el as HTMLSelectElement;
          // We'll use the id or name or empty
          return select.id ?? select.name ?? '';
        })),
        // Textareas: textarea elements
        this.page.$$eval('textarea', els => els.map(el => {
          const textarea = el as HTMLTextAreaElement;
          return {
            placeholder: textarea.placeholder ?? '',
            name: textarea.name ?? ''
          };
        })),
        // Style and structural analysis
        this.page.evaluate(() => {
          let totalRules = 0;
          let stylesheetCount = document.styleSheets ? document.styleSheets.length : 0;
          try {
            for (let i = 0; i < stylesheetCount; i++) {
              try {
                const sheet = document.styleSheets[i];
                if (sheet && sheet.cssRules) {
                  totalRules += sheet.cssRules.length;
                }
              } catch {
                // cross-origin access limitation
              }
            }
          } catch {}

          let fontFamily = "";
          let backgroundColor = "";
          let color = "";
          try {
            if (document.body) {
              const cs = window.getComputedStyle(document.body);
              fontFamily = cs.fontFamily || "";
              backgroundColor = cs.backgroundColor || "";
              color = cs.color || "";
            }
          } catch {}

          const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
            .map(h => (h.textContent || '').trim())
            .filter(Boolean);

          const semanticTags = Array.from(document.querySelectorAll('header, nav, main, section, article, footer, form, .card, [class*="hero"], [class*="container"]'))
            .map(el => el.tagName.toLowerCase());

          return {
            stylesheetCount,
            totalRules,
            fontFamily,
            backgroundColor,
            color,
            headings: headings.slice(0, 15),
            semanticElementsCount: semanticTags.length,
          };
        })
      ]);

      const [buttons, inputs, links, selects, textareas, styleAnalysis] = evalResults;

      const info: PageInfo = {
        url,
        title,
        visibleText,
        buttons: buttons.slice(0, 20), // Limit to 20
        inputs: inputs.slice(0, 20),
        links: links.slice(0, 20),
        selects: selects.slice(0, 20),
        textareas: textareas.slice(0, 20),
        consoleErrors: [...this.consoleErrors],
        pageErrors: [...this.pageErrors],
        styleAnalysis,
      };

      return { success: true, info };
    } catch (err: any) {
      return {
        success: false,
        error: err.message ?? 'Unknown error during inspection',
        recoverable: true
      };
    }
  }

  /**
   * Clicks an element matching the selector or text.
   * @param {string} selector - CSS selector or text content to match.
   * @returns {Promise<{ success: true; message: string } | { success: false; error: string; recoverable: boolean }>}
   */
  async click(selector: string): Promise<{ success: true; message: string } | { success: false; error: string; recoverable: boolean }> {
    if (!this.page) {
      return { success: false, error: 'Browser page not initialized. Call init() first.', recoverable: true };
    }
    try {
      // We try to click by text first if it doesn't look like a CSS selector
      // Simple heuristic: if it contains a space or doesn't start with common CSS selectors, treat as text?
      // But Playwright can handle both. We'll let Playwright decide by trying the selector as is.
      // However, we can also try to click by text content using the text selector.
      // We'll try: first as a CSS selector, then as text if that fails.
      let clicked = false;
      try {
        await this.page.click(selector, { timeout: 5000 });
        clicked = true;
      } catch (err) {
        // Ignore and try as text
      }
      if (!clicked) {
        try {
          await this.page.click(`text=${selector}`, { timeout: 5000 });
          clicked = true;
        } catch (err) {
          // If both fail, we throw
          throw err;
        }
      }
      return { success: true, message: `Clicked on ${selector}` };
    } catch (err: any) {
      return {
        success: false,
        error: err.message ?? `Failed to click on ${selector}`,
        recoverable: true
      };
    }
  }

  /**
   * Types text into an input matching the selector or placeholder/name.
   * @param {string} selector - CSS selector, placeholder, or name to identify the input.
   * @param {string} text - The text to type.
   * @returns {Promise<{ success: true; message: string } | { success: false; error: string; recoverable: boolean }>}
   */
  async type(selector: string, text: string): Promise<{ success: true; message: string } | { success: false; error: string; recoverable: boolean }> {
    if (!this.page) {
      return { success: false, error: 'Browser page not initialized. Call init() first.', recoverable: true };
    }
    try {
      // We'll try to fill the input by selector, then by placeholder, then by name.
      // We can use the fill method which is available for input, textarea, etc.
      let filled = false;
      try {
        await this.page.fill(selector, text);
        filled = true;
      } catch (err) {
        // Ignore and try other methods
      }
      if (!filled) {
        // Try by placeholder
        try {
          await this.page.fill(`[placeholder="${selector}"]`, text);
          filled = true;
        } catch (err) {
          // Ignore
        }
      }
      if (!filled) {
        // Try by name
        try {
          await this.page.fill(`[name="${selector}"]`, text);
          filled = true;
        } catch (err) {
          // Ignore
        }
      }
      if (!filled) {
        throw new Error(`Could not find input matching ${selector}`);
      }
      return { success: true, message: `Typed into ${selector}` };
    } catch (err: any) {
      return {
        success: false,
        error: err.message ?? `Failed to type into ${selector}`,
        recoverable: true
      };
    }
  }

  /**
   * Takes a screenshot of the current page.
   * @returns {Promise<{ success: true; screenshot: string (base64) } | { success: false; error: string; recoverable: boolean }>}
   */
  async screenshot(): Promise<{ success: true; screenshot: string } | { success: false; error: string; recoverable: boolean }> {
    if (!this.page) {
      return { success: false, error: 'Browser page not initialized. Call init() first.', recoverable: true };
    }
    try {
      const screenshotBuffer = await this.page.screenshot();
      const base64 = screenshotBuffer.toString('base64');
      return { success: true, screenshot: base64 };
    } catch (err: any) {
      return {
        success: false,
        error: err.message ?? 'Failed to take screenshot',
        recoverable: true
      };
    }
  }

  /**
   * Returns the current URL and title.
   * @returns {Promise<{ success: true; url: string; title: string } | { success: false; error: string; recoverable: boolean }>}
   */
  async getPageInfo(): Promise<{ success: true; url: string; title: string } | { success: false; error: string; recoverable: boolean }> {
    if (!this.page) {
      return { success: false, error: 'Browser page not initialized. Call init() first.', recoverable: true };
    }
    try {
      const url = this.page.url();
      const title = await this.page.title();
      return { success: true, url, title };
    } catch (err: any) {
      return {
        success: false,
        error: err.message ?? 'Failed to get page info',
        recoverable: true
      };
    }
  }

  getPage(): Page | null {
    return this.page;
  }

  /**
   * Closes the browser and cleans up resources.
   * @returns {Promise<void>}
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

/**
 * Information about a page that we return from inspectPage.
 */
export interface PageInfo {
  url: string;
  title: string;
  visibleText: string;
  buttons: string[];
  inputs: Array<{ name: string; type: string; placeholder: string }>;
  links: string[];
  selects: string[];
  textareas: Array<{ placeholder: string; name: string }>;
  consoleErrors: string[];
  pageErrors: string[];
  styleAnalysis?: {
    stylesheetCount: number;
    totalRules: number;
    fontFamily: string;
    backgroundColor: string;
    color: string;
    headings: string[];
    semanticElementsCount: number;
  };
}
