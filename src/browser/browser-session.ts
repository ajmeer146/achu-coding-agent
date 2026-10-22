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
          this.pageErrors.push(`${error.name || "Error"}: ${error.message}`);
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
        // Buttons: button elements, elements with role="button", and button-styled CTA anchors
        this.page.$$eval(
          'button, [role="button"], input[type="submit"], input[type="button"], a.btn, a.button, a[class*="btn"], a[class*="button"]',
          els => els.map(el => el.textContent?.trim() ?? '').filter(t => t.length > 0)
        ),
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
        }),
        // Placeholder and low-effort visual content detection
        this.page.evaluate(() => {
          const issues: string[] = [];
          const bodyText = (document.body?.innerText || "").toLowerCase();
          for (const phrase of ["lorem ipsum", "your image here", "image placeholder", "placeholder image"]) {
            if (bodyText.includes(phrase)) issues.push(`Placeholder text "${phrase}" is visible.`);
          }
          for (const img of Array.from(document.querySelectorAll("img"))) {
            const src = (img.getAttribute("src") || "").toLowerCase();
            const alt = (img.getAttribute("alt") || "").toLowerCase();
            if (/placeholder|placehold\.co|dummyimage|lorempixel/.test(src) || /placeholder/.test(alt)) {
              issues.push(`Image uses a placeholder source or alt text: ${src || alt || "(empty)"}`);
            }
          }
          for (const svg of Array.from(document.querySelectorAll("svg"))) {
            const rect = svg.getBoundingClientRect();
            if (rect.width < 160 || rect.height < 120) continue;
            const text = (svg.textContent || "").trim();
            if (!text || text.length > 2) continue;
            const hasIllustration = Boolean(svg.querySelector("path, image, use, polygon, polyline, line"));
            if (!hasIllustration) issues.push(`Large inline SVG contains only "${text}" and no illustration paths; it is a placeholder graphic.`);
          }
          return Array.from(new Set(issues)).slice(0, 5);
        })
      ]);

      const [buttons, inputs, links, selects, textareas, styleAnalysis, qualityIssues] = evalResults;

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
        qualityIssues,
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
   * Sets the browser viewport dimensions across mobile, tablet, laptop, and desktop.
   */
  async setViewport(viewport: "desktop" | "mobile" | "tablet" | "laptop" | "small_mobile" | "wide_desktop" | { width: number; height: number }): Promise<void> {
    if (!this.page) throw new Error("Browser page not initialized. Call init() first.");
    if (viewport === "small_mobile") {
      await this.page.setViewportSize({ width: 320, height: 568 });
    } else if (viewport === "mobile") {
      await this.page.setViewportSize({ width: 375, height: 667 });
    } else if (viewport === "tablet") {
      await this.page.setViewportSize({ width: 768, height: 1024 });
    } else if (viewport === "laptop") {
      await this.page.setViewportSize({ width: 1280, height: 800 });
    } else if (viewport === "desktop") {
      await this.page.setViewportSize({ width: 1440, height: 900 });
    } else if (viewport === "wide_desktop") {
      await this.page.setViewportSize({ width: 1920, height: 1080 });
    } else {
      await this.page.setViewportSize(viewport);
    }
  }

  /**
   * Takes a screenshot of the current page.
   * @param {Object} [options]
   * @param {"desktop"|"mobile"|"tablet"|"laptop"|"small_mobile"|"wide_desktop"|{width:number, height:number}} [options.viewport]
   * @returns {Promise<{ success: true; screenshot: string (base64) } | { success: false; error: string; recoverable: boolean }>}
   */
  async screenshot(options?: { viewport?: "desktop" | "mobile" | "tablet" | "laptop" | "small_mobile" | "wide_desktop" | { width: number; height: number } }): Promise<{ success: true; screenshot: string } | { success: false; error: string; recoverable: boolean }> {
    if (!this.page) {
      return { success: false, error: 'Browser page not initialized. Call init() first.', recoverable: true };
    }
    try {
      if (options?.viewport) {
        await this.setViewport(options.viewport);
      }
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
   * Runs measurable layout checks against the current page at the requested
   * viewport. These checks are DOM-measurement based only; they do not attempt
   * to interpret screenshot pixels.
   * @param viewport Preset or explicit {width, height}.
   */
  async analyzeLayout(viewport: "desktop" | "mobile" | "tablet" | "laptop" | "small_mobile" | "wide_desktop" | { width: number; height: number } = "desktop"): Promise<
    | { success: true; analysis: LayoutAnalysis }
    | { success: false; error: string; recoverable: boolean }
  > {
    if (!this.page) {
      return { success: false, error: 'Browser page not initialized. Call init() first.', recoverable: true };
    }
    try {
      await this.setViewport(viewport);
      await this.page.evaluate(() => window.scrollTo(0, 0));
      // Resolve an explicit viewport name for the layout script + report.
      const vpName = typeof viewport === "string" ? viewport : `${viewport.width}x${viewport.height}`;
      const resolvedDimensions = typeof viewport === "string"
        ? (viewport === "small_mobile" ? { width: 320, height: 568 }
          : viewport === "mobile" ? { width: 375, height: 667 }
          : viewport === "tablet" ? { width: 768, height: 1024 }
          : viewport === "laptop" ? { width: 1280, height: 800 }
          : viewport === "wide_desktop" ? { width: 1920, height: 1080 }
          : { width: 1440, height: 900 })
        : viewport;
      const layoutScript = `
(function () {
  var vp = ${JSON.stringify(vpName)};
  var vpWidth = ${resolvedDimensions.width};
  var vpHeight = ${resolvedDimensions.height};
  var defects = [];
  var seen = {};
  function push(severity, type, message) {
    var key = type + "|" + message;
    if (seen[key] || defects.length >= 16) return;
    seen[key] = true;
    defects.push({ severity: severity, type: type, message: message });
  }
  function describe(el) {
    var tag = el.tagName.toLowerCase();
    var id = el.id ? "#" + el.id : "";
    var classes = el.classList ? Array.prototype.slice.call(el.classList, 0, 2) : [];
    var cls = classes.length > 0 ? "." + classes.join(".") : "";
    var text = (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 40);
    return tag + id + cls + (text ? ' ("' + text + '")' : "");
  }
  function isVisible(el) {
    var rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity || "1") > 0.05;
  }
  // A control inside a closed off-canvas panel (drawer/modal moved out with a
  // transform), an aria-hidden or inert subtree, or a zero-opacity ancestor is
  // intentionally out of view. It is not a layout defect, so it must not be
  // reported as one. An ancestor that is merely POSITIONED off-screen (no
  // transform) is treated as a genuine defect, not an intentional hide.
  function isHiddenByAncestor(el) {
    var p = el.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      var pcs = window.getComputedStyle(p);
      if (pcs.display === "none" || pcs.visibility === "hidden") return true;
      if (parseFloat(pcs.opacity || "1") <= 0.05) return true;
      if (p.getAttribute && p.getAttribute("aria-hidden") === "true") return true;
      if (p.hasAttribute && p.hasAttribute("inert")) return true;
      var pr = p.getBoundingClientRect();
      var transformed = pcs.transform && pcs.transform !== "none" && pcs.transform !== "matrix(1, 0, 0, 1, 0, 0)";
      if (transformed && pr.width >= 1 && pr.height >= 1 && (pr.left >= vpWidth - 1 || pr.right <= 1)) return true;
      p = p.parentElement;
    }
    return false;
  }
  // A control inside a horizontally scrollable strip stays reachable by
  // scrolling that container, so it is not a clipped/unreachable defect.
  function isReachableByScroll(el) {
    var p = el.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      var pcs = window.getComputedStyle(p);
      if ((pcs.overflowX === "auto" || pcs.overflowX === "scroll") && p.scrollWidth > p.clientWidth + 1) return true;
      p = p.parentElement;
    }
    return false;
  }
  function contentRect(el) {
    var r = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    var pl = parseFloat(cs.paddingLeft) || 0;
    var pr = parseFloat(cs.paddingRight) || 0;
    var pt = parseFloat(cs.paddingTop) || 0;
    var pb = parseFloat(cs.paddingBottom) || 0;
    var bl = parseFloat(cs.borderLeftWidth) || 0;
    var br = parseFloat(cs.borderRightWidth) || 0;
    var bt = parseFloat(cs.borderTopWidth) || 0;
    var bb = parseFloat(cs.borderBottomWidth) || 0;
    return {
      left: r.left + pl + bl,
      right: r.right - pr - br,
      top: r.top + pt + bt,
      bottom: r.bottom - pb - bb,
      width: Math.max(0, r.width - pl - pr - bl - br),
      height: Math.max(0, r.height - pt - pb - bt - bb)
    };
  }
  var root = document.documentElement;
  var width = root.clientWidth;
  var height = root.clientHeight;
  var overflowPx = Math.max(0, Math.round(root.scrollWidth - width));
  if (overflowPx > 1) {
    var offenders = Array.prototype.slice.call(document.body.querySelectorAll("*"))
      .filter(isVisible)
      .map(function (el) { return { el: el, rect: el.getBoundingClientRect() }; })
      .filter(function (entry) { return entry.rect.right > width + 2 && entry.rect.width > 8; })
      .slice(0, 3)
      .map(function (entry) { return describe(entry.el); });
    push("critical", "horizontal_overflow", "Page content is " + overflowPx + "px wider than the " + width + "px viewport (horizontal scrolling is required)." + (offenders.length > 0 ? " Widest offenders: " + offenders.join(", ") + "." : ""));
  }
  var controls = Array.prototype.slice.call(document.querySelectorAll("a[href], button, input, select, textarea, [role='button']"));
  for (var i = 0; i < controls.length; i++) {
    var el = controls[i];
    if (!isVisible(el)) continue;
    var rect = el.getBoundingClientRect();
    var intentionallyHidden = isHiddenByAncestor(el);
    var scrollReachable = !intentionallyHidden && isReachableByScroll(el);
    if (!intentionallyHidden && !scrollReachable) {
      if (rect.right > width + 2 && rect.left < width) {
        push("critical", "clipped_interactive", "Interactive element " + describe(el) + " is clipped at the right edge of the " + width + "px viewport (extends " + Math.round(rect.right - width) + "px off-screen).");
      } else if (rect.left >= width + 2) {
        push("warning", "offscreen_interactive", "Interactive element " + describe(el) + " is positioned entirely off-screen to the right.");
      }
    }
    if (vp === "mobile" && !intentionallyHidden && ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].indexOf(el.tagName) !== -1) {
      if (rect.width < 28 || rect.height < 28) {
        push("warning", "small_touch_target", "Touch target " + describe(el) + " is " + Math.round(rect.width) + "x" + Math.round(rect.height) + "px; the recommended minimum is 44x44px (28x28px hard floor).");
      }
    }
  }
  // Fixed-position elements must not extend beyond the viewport edges.
  var fixedEls = Array.prototype.slice.call(document.querySelectorAll("*"));
  for (var f = 0; f < fixedEls.length; f++) {
    var fel = fixedEls[f];
    if (!isVisible(fel)) continue;
    var fcs = window.getComputedStyle(fel);
    if (fcs.position !== "fixed" && fcs.position !== "sticky") continue;
    var frect = fel.getBoundingClientRect();
    if (frect.right > width + 2 || frect.left < -2 || frect.bottom > height + 2 || frect.top < -2) {
      push("warning", "fixed_outside_viewport", 'Fixed/sticky element ' + describe(fel) + " extends beyond the " + width + "x" + height + " viewport (rect: " + Math.round(frect.left) + "," + Math.round(frect.top) + "-" + Math.round(frect.right) + "," + Math.round(frect.bottom) + ").");
    }
  }
  var textSelector = "nav a, aside a, aside span, .sidebar *, .nav-link, .nav-links a, header a, button, .btn, .logo";
  var textCandidates = Array.prototype.slice.call(document.querySelectorAll(textSelector));
  for (var j = 0; j < textCandidates.length; j++) {
    var tel = textCandidates[j];
    if (!isVisible(tel) || tel.children.length > 0) continue;
    var text = (tel.textContent || "").replace(/\\s+/g, " ").trim();
    if (!text) continue;
    var tcs = window.getComputedStyle(tel);
    if (tcs.display === "inline" || tcs.overflowX !== "visible") continue;
    if (tel.clientWidth > 0 && tel.scrollWidth > tel.clientWidth + 4) {
      var inNav = Boolean(tel.closest("nav, aside, header, .sidebar, .nav-links, .navbar, .nav-container"));
      push(inNav ? "critical" : "warning", "text_overflow", 'Text "' + text.slice(0, 40) + '" in ' + describe(tel) + " overflows its " + tel.clientWidth + "px container by " + (tel.scrollWidth - tel.clientWidth) + "px" + (inNav ? " and can overlap adjacent content" : "") + ".");
    }
  }
  // Images and SVGs with fixed pixel widths that exceed their container or the
  // viewport can cause horizontal overflow. Flag img/svg elements whose width
  // attribute or computed width is a fixed pixel value larger than the viewport
  // and that lack max-width: 100%.
  var mediaEls = Array.prototype.slice.call(document.querySelectorAll("img, svg"));
  for (var m = 0; m < mediaEls.length; m++) {
    var mel = mediaEls[m];
    if (!isVisible(mel)) continue;
    var mcs = window.getComputedStyle(mel);
    var mrect = mel.getBoundingClientRect();
    var hasMaxWidth100 = /(^|\\s)100%(?:\\s|$)/.test(mcs.maxWidth || "");
    var widthAttr = mel.getAttribute ? mel.getAttribute("width") : null;
    var fixedPxWidth = widthAttr ? parseFloat(widthAttr) : 0;
    // Also consider computed style width (e.g. from CSS class) when it is a fixed px value
    var computedWidthStr = mcs.width || "";
    var computedPxWidth = /^\\d+(?:\\.\\d+)?px$/.test(computedWidthStr) ? parseFloat(computedWidthStr) : 0;
    var effectiveFixedWidth = Math.max(fixedPxWidth, computedPxWidth);
    if (mrect.width > 8 && mrect.width > vpWidth && !hasMaxWidth100 && effectiveFixedWidth > 0) {
      push("warning", "media_fixed_width", 'Media element ' + describe(mel) + " has a fixed width of " + effectiveFixedWidth + "px exceeding the " + vpWidth + "px viewport without max-width: 100%; add responsive sizing.");
    }
  }
  var navElements = Array.prototype.slice.call(document.querySelectorAll("nav, aside, [role='navigation'], .sidebar, .navbar, .nav-container"));
  var mainElements = Array.prototype.slice.call(document.querySelectorAll("main, [role='main'], .main-content, .content"));
  for (var n = 0; n < navElements.length; n++) {
    var nav = navElements[n];
    if (!isVisible(nav)) continue;
    var navRect = nav.getBoundingClientRect();
    if (navRect.width * navRect.height < 1) continue;
    for (var m2 = 0; m2 < mainElements.length; m2++) {
      var main = mainElements[m2];
      if (!isVisible(main) || nav.contains(main) || main.contains(nav)) continue;
      var mainRect = contentRect(main);
      var overlapWidth = Math.min(navRect.right, mainRect.right) - Math.max(navRect.left, mainRect.left);
      var overlapHeight = Math.min(navRect.bottom, mainRect.bottom) - Math.max(navRect.top, mainRect.top);
      if (overlapWidth <= 2 || overlapHeight <= 2) continue;
      var widthRatio = overlapWidth / navRect.width;
      var heightRatio = overlapHeight / Math.max(1, mainRect.height);
      if (widthRatio >= 0.2 && heightRatio >= 0.2) {
        push("critical", "navigation_overlap", "Navigation/sidebar " + describe(nav) + " overlaps " + describe(main) + " by " + Math.round(overlapWidth) + "x" + Math.round(overlapHeight) + "px.");
      }
    }
  }
  return { viewport: vp, width: width, height: height, horizontalOverflow: overflowPx > 1, overflowPx: overflowPx, defects: defects };
})()
`;
      const analysis = await this.page.evaluate(layoutScript) as LayoutAnalysis;

      return { success: true, analysis };
    } catch (err: any) {
      return {
        success: false,
        error: err.message ?? 'Failed to analyze page layout',
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
 * A measurable layout defect found through DOM geometry and computed styles.
 * Severity "critical" means the page is visibly broken or unusable at that
 * viewport; "warning" means a quality concern.
 */
export interface LayoutDefect {
  severity: "critical" | "warning";
  type:
    | "horizontal_overflow"
    | "clipped_interactive"
    | "offscreen_interactive"
    | "small_touch_target"
    | "text_overflow"
    | "navigation_overlap";
  message: string;
}

export interface LayoutAnalysis {
  viewport: "desktop" | "mobile";
  width: number;
  height: number;
  horizontalOverflow: boolean;
  overflowPx: number;
  defects: LayoutDefect[];
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
  qualityIssues?: string[];
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
