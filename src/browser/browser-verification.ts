import { BrowserSession } from "./browser-session.js";
import { PageInfo } from "./browser-session.js";

export type VerificationTarget = {
  type: "text" | "heading" | "button" | "input" | "link" | "route";
  selector?: string;
  text?: string;
  url?: string;
  inputType?: string;
  placeholder?: string;
  name?: string;
  label?: string;
  required?: boolean;
};

export type VerificationResult = {
  passed: boolean;
  target: VerificationTarget;
  actual?: string;
  error?: string;
};

export type BrowserVerificationSummary = {
  overallPassed: boolean;
  results: VerificationResult[];
  pageInfo?: PageInfo;
};

/**
 * Semantic HTML input types. These are values for the `type` attribute of an
 * <input> element — they are NEVER CSS selectors and must never be wrapped
 * inside a selector such as `input[type='email']` when they already are one.
 */
export const SEMANTIC_INPUT_TYPES = new Set([
  "email", "password", "text", "submit", "search", "tel", "url", "number",
  "checkbox", "radio", "date", "time", "datetime-local", "month", "week",
  "file", "color", "range",
]);

export function isSemanticInputType(value?: string | null): boolean {
  if (typeof value !== "string") return false;
  return SEMANTIC_INPUT_TYPES.has(value.trim().toLowerCase());
}

/**
 * Heuristic: does this string look like a CSS selector (as opposed to a bare
 * semantic input-type word or a human label)? Bare semantic type words are
 * deliberately NOT selectors.
 */
export function looksLikeCssSelector(value?: string | null): boolean {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s) return false;
  if (/^[#.\[]/.test(s)) return true;
  if (/^[a-zA-Z][a-zA-Z0-9-]*\s*[\[#.:>+~*\s]/.test(s)) return true;
  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(s)) return !isSemanticInputType(s);
  return false;
}

export type InputCriteria = {
  /** CSS selector (e.g. "#email", `input[type="email"]`). */
  selector?: string;
  /** Semantic input type (email, password, text, submit, ...). */
  inputType?: string;
  /** Legacy alias for inputType; a CSS selector placed here is re-interpreted as a selector. */
  type?: string;
  placeholder?: string;
  name?: string;
  label?: string;
  /** Generic text hint; resolved as accessible label, then placeholder, then name. */
  text?: string;
};

export type NormalizedInputCriteria = {
  selector?: string;
  inputType?: string;
  placeholder?: string;
  name?: string;
  label?: string;
  text?: string;
  /** Deterministic criteria-construction defect (e.g. a semantic type in the selector field). */
  problem?: string;
};

function cleanCriterionValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^(undefined|null|nan)$/i.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Normalize input-verification criteria, keeping selector, semantic input
 * type, label, placeholder and name strictly separated. Never rewrites a CSS
 * selector into a type value and never builds `input[type='input[type=...]']`.
 */
export function normalizeInputCriteria(raw: InputCriteria): NormalizedInputCriteria {
  const norm: NormalizedInputCriteria = {};
  norm.placeholder = cleanCriterionValue(raw.placeholder);
  norm.name = cleanCriterionValue(raw.name);
  norm.label = cleanCriterionValue(raw.label);
  norm.text = cleanCriterionValue(raw.text);

  // Semantic input type may only come from the inputType field (or the legacy
  // `type` alias). A full CSS selector placed in those fields is treated as a
  // selector — never wrapped in another type selector.
  const rawInputType = cleanCriterionValue(raw.inputType);
  if (rawInputType) {
    if (isSemanticInputType(rawInputType)) {
      norm.inputType = rawInputType.trim().toLowerCase();
    } else if (looksLikeCssSelector(rawInputType)) {
      norm.selector = rawInputType;
    } else {
      norm.problem = `Unsupported input type "${rawInputType}". Use a semantic type (email/password/text/submit) in inputType, or a CSS selector in selector.`;
    }
  }

  const rawSelector = cleanCriterionValue(raw.selector);
  if (rawSelector && !norm.selector) {
    if (isSemanticInputType(rawSelector)) {
      norm.problem = `"${rawSelector}" is a semantic input type, not a CSS selector. Put it in the inputType field, or provide a real selector (e.g. #email, input[type="email"]).`;
    } else if (looksLikeCssSelector(rawSelector)) {
      // Preserve the exact selector string (single or double quotes intact).
      norm.selector = rawSelector;
    } else {
      norm.problem = `"${rawSelector}" is not a valid CSS selector. Use a selector (e.g. #email, input[type="email"]), or use the label/placeholder/name/inputType fields.`;
    }
  }

  const legacyType = cleanCriterionValue(raw.type);
  if (legacyType) {
    if (isSemanticInputType(legacyType)) {
      if (!norm.inputType) norm.inputType = legacyType.trim().toLowerCase();
    } else if (looksLikeCssSelector(legacyType) && !norm.selector) {
      norm.selector = legacyType;
    }
  }

  return norm;
}

function escapeCssAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Build a CSS locator from normalized criteria. Returns the selector untouched
 * when one is provided; otherwise composes `input[type="..."]` plus optional
 * placeholder/name attribute filters. Returns null when no locator can be
 * derived. Never emits the literal "undefined".
 */
export function buildInputSelector(criteria: Pick<NormalizedInputCriteria, "selector" | "inputType" | "placeholder" | "name">): string | null {
  if (criteria.selector) return criteria.selector;
  const parts: string[] = [];
  if (criteria.inputType) parts.push(`[type="${escapeCssAttrValue(criteria.inputType)}"]`);
  if (criteria.placeholder) parts.push(`[placeholder*="${escapeCssAttrValue(criteria.placeholder)}"]`);
  if (criteria.name) parts.push(`[name*="${escapeCssAttrValue(criteria.name)}"]`);
  if (parts.length === 0) return null;
  return `input${parts.join("")}`;
}

function describeInputCriteria(norm: NormalizedInputCriteria): string {
  const parts: string[] = [];
  if (norm.selector) parts.push(`selector="${norm.selector}"`);
  if (norm.inputType) parts.push(`type="${norm.inputType}"`);
  if (norm.label) parts.push(`label="${norm.label}"`);
  if (norm.placeholder) parts.push(`placeholder="${norm.placeholder}"`);
  if (norm.name) parts.push(`name="${norm.name}"`);
  if (parts.length === 0 && norm.text) parts.push(`text="${norm.text}"`);
  return parts.join(", ");
}

type DomElementInfo = {
  tag: string;
  type: string;
  placeholder: string;
  name: string;
  id: string;
  text: string;
  disabled: boolean;
};

const COLLECT_DOM_ELEMENTS = (els: any[]): DomElementInfo[] =>
  els.map((el: any) => ({
    tag: el.tagName ? String(el.tagName).toLowerCase() : "",
    type: el.type !== undefined && el.type !== null ? String(el.type) : "",
    placeholder: el.placeholder !== undefined && el.placeholder !== null ? String(el.placeholder) : "",
    name: el.name !== undefined && el.name !== null ? String(el.name) : "",
    id: el.id !== undefined && el.id !== null ? String(el.id) : "",
    text: el.textContent ? String(el.textContent).trim() : "",
    disabled: el.disabled === true || el.getAttribute?.("aria-disabled") === "true",
  }));

async function collectPageInputEvidence(page: any): Promise<string> {
  try {
    const els: DomElementInfo[] = await page.$$eval('input, textarea, [role="textbox"]', COLLECT_DOM_ELEMENTS);
    if (els.length === 0) return "Page has no <input>/<textarea> elements.";
    const described = els.slice(0, 5).map((el) => {
      const attrs = [`<${el.tag}`, `type="${el.type}"`];
      if (el.name) attrs.push(`name="${el.name}"`);
      if (el.placeholder) attrs.push(`placeholder="${el.placeholder}"`);
      attrs.push(">");
      return attrs.join(" ");
    });
    return `Page inputs: ${described.join(", ")}`;
  } catch {
    return "Page input evidence unavailable.";
  }
}

/**
 * Check if page contains specific text.
 */
export async function verifyTextExists(
  session: BrowserSession,
  text: string
): Promise<VerificationResult> {
  const result = await session.inspectPage();
  
  if (!result.success) {
    return {
      passed: false,
      target: { type: "text" as const, text },
      error: `Failed to inspect page: ${result.error}`,
    };
  }

  const passed = result.info.visibleText.toLowerCase().includes(text.toLowerCase());
  
  return {
    passed,
    target: { type: "text" as const, text },
    actual: passed ? `Found "${text}"` : `Text "${text}" not found in page`,
  };
}

/**
 * Check if page contains a heading with specific text.
 */
export async function verifyHeadingExists(
  session: BrowserSession,
  text: string
): Promise<VerificationResult> {
  const result = await session.inspectPage();
  
  if (!result.success) {
    return {
      passed: false,
      target: { type: "heading" as const, text },
      error: `Failed to inspect page: ${result.error}`,
    };
  }

  // Check visible text for heading-like content
  const lines = result.info.visibleText.split("\n");
  const title = result.info.title || "";
  const words = text.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
  const passed =
    lines.some(line => line.toLowerCase().includes(text.toLowerCase())) ||
    title.toLowerCase().includes(text.toLowerCase()) ||
    (words.length > 0 && words.some((w: string) => lines.some(line => line.toLowerCase().includes(w))));
  
  return {
    passed,
    target: { type: "heading" as const, text },
    actual: passed ? `Found heading with "${text}"` : `Heading "${text}" not found`,
  };
}

/**
 * Check if a button with specific text exists and is enabled.
 * Optionally resolve a CSS selector; the element at the selector must be a
 * button (or role=button) matching the expected text when text is provided.
 */
export async function verifyButtonExists(
  session: BrowserSession,
  text: string,
  selector?: string
): Promise<VerificationResult> {
  const target: VerificationTarget = { type: "button" as const, text, ...(selector ? { selector } : {}) };

  const matchesText = (btnText: string, expected: string): boolean => {
    const btn = btnText.toLowerCase();
    const exp = expected.toLowerCase();
    return btn.includes(exp)
      || (exp === "sign in" && (btn.includes("login") || btn.includes("sign in")))
      || (exp === "login" && (btn.includes("sign in") || btn.includes("login")));
  };

  // Preferred path: resolve against the live DOM when Playwright access is available.
  const page = typeof (session as any).getPage === "function" ? (session as any).getPage() : null;
  if (page) {
    try {
      let candidates: DomElementInfo[] = [];
      if (selector) {
        const tied: DomElementInfo[] = await page.$$eval(selector, COLLECT_DOM_ELEMENTS);
        if (tied.length === 0) {
          return {
            passed: false,
            target,
            error: `Button selector "${selector}" did not match any element. ${await collectPageButtonEvidence(page)}`,
          };
        }
        candidates = tied;
      } else {
        candidates = await page.$$eval('button, [role="button"], input[type="submit"], input[type="button"]', COLLECT_DOM_ELEMENTS);
      }

      // Buttons matched by plain DOM selector must be actual buttons; text-matched candidates may be any element with button role.
      const match = candidates.find((c) => (text ? matchesText(c.text, text) : true));

      if (!match) {
        return {
          passed: false,
          target,
          error: `Button "${text}" not found. ${await collectPageButtonEvidence(page)}`,
        };
      }
      if (match.disabled) {
        return {
          passed: false,
          target,
          error: `Button "${text}" exists but is disabled; verification requires an enabled button.`,
        };
      }

      return {
        passed: true,
        target,
        actual: `Found button "${text}" (enabled)`,
      };
    } catch (err: any) {
      return {
        passed: false,
        target,
        error: `Button DOM verification failed: ${err?.message ?? err}`,
      };
    }
  }

  // Fallback: aggregate page inspection (used by session doubles in tests).
  const result = await session.inspectPage();

  if (!result.success) {
    return {
      passed: false,
      target,
      error: `Failed to inspect page: ${result.error}`,
    };
  }

  const passed = result.info.buttons.some(btn => matchesText(btn, text));
  if (selector && passed) {
    // Aggregate view cannot confirm selector binding; record it but keep the text evidence.
    return {
      passed: true,
      target,
      actual: `Found button "${text}" (text match; selector "${selector}" not DOM-verified)`,
    };
  }

  return {
    passed,
    target,
    actual: passed ? `Found button "${text}"` : `Button "${text}" not found`,
  };
}

async function collectPageButtonEvidence(page: any): Promise<string> {
  try {
    const els: DomElementInfo[] = await page.$$eval('button, [role="button"], input[type="submit"], input[type="button"]', COLLECT_DOM_ELEMENTS);
    if (els.length === 0) return "Page has no <button> elements.";
    const described = els.slice(0, 5).map((el) => `"${el.text || "(no text)"}"${el.disabled ? " (disabled)" : ""}`);
    return `Page buttons: ${described.join(", ")}`;
  } catch {
    return "Page button evidence unavailable.";
  }
}

/**
 * Check if an input matching the given criteria exists.
 * Criteria fields are strictly separated: selector (CSS), inputType (semantic
 * type), label, placeholder, name. Resolution prefers the live DOM; a mock
 * session providing only inspectPage() still works (aggregate fallback).
 */
export async function verifyInputExists(
  session: BrowserSession,
  attributes: InputCriteria
): Promise<VerificationResult> {
  const norm = normalizeInputCriteria(attributes);
  const target: VerificationTarget = {
    type: "input" as const,
    ...(norm.selector ? { selector: norm.selector } : {}),
    ...(norm.inputType ? { inputType: norm.inputType } : {}),
    ...(norm.placeholder ? { placeholder: norm.placeholder } : {}),
    ...(norm.name ? { name: norm.name } : {}),
    ...(norm.label ? { label: norm.label } : {}),
    ...(norm.text ? { text: norm.text } : {}),
  };
  const desc = describeInputCriteria(norm);

  if (norm.problem) {
    return {
      passed: false,
      target,
      error: `Invalid input verification criteria: ${norm.problem}`,
    };
  }

  const page = typeof (session as any).getPage === "function" ? (session as any).getPage() : null;
  if (page) {
    try {
      let locator: any = null;
      if (norm.selector) {
        locator = page.locator(norm.selector);
      } else if (norm.label) {
        locator = page.getByLabel(norm.label, { exact: false });
      } else if (norm.text) {
        const byLabel = page.getByLabel(norm.text, { exact: false });
        if ((await byLabel.count()) > 0) {
          locator = byLabel;
        } else {
          const escaped = escapeCssAttrValue(norm.text);
          locator = page.locator(`input[placeholder*="${escaped}"], input[name*="${escaped}"]`);
        }
      } else {
        const built = buildInputSelector(norm);
        if (!built) {
          return {
            passed: false,
            target,
            error: "Invalid input verification criteria: no selector, inputType, label, placeholder, name or text was provided.",
          };
        }
        locator = page.locator(built);
      }

      const candidates: DomElementInfo[] = await locator.evaluateAll(COLLECT_DOM_ELEMENTS);
      const matches = candidates.filter((el) => {
        const isInputLike = el.tag === "input" || (el.tag === "textarea" && !norm.inputType);
        if (!isInputLike) return false;
        if (norm.inputType && el.type.toLowerCase() !== norm.inputType) return false;
        if (norm.placeholder && !el.placeholder.toLowerCase().includes(norm.placeholder.toLowerCase())) return false;
        if (norm.name && !el.name.toLowerCase().includes(norm.name.toLowerCase())) return false;
        return true;
      });

      if (matches.length > 0) {
        return {
          passed: true,
          target,
          actual: `Found input (${desc})`,
        };
      }

      const nonInputAtSelector = norm.selector && candidates.length > 0
        ? ` The selector "${norm.selector}" matched ${candidates.length} element(s), but none is a matching <input> (${candidates.map(c => c.tag).join(", ")}).`
        : "";
      return {
        passed: false,
        target,
        error: `Input (${desc}) not found.${nonInputAtSelector} ${await collectPageInputEvidence(page)}`,
      };
    } catch (err: any) {
      const message = String(err?.message ?? err);
      const shortMessage = message.split("\n")[0].trim();
      if (norm.selector && /not a valid selector|syntaxerror/i.test(message)) {
        return {
          passed: false,
          target,
          error: `Invalid input verification criteria: selector "${norm.selector}" is not a valid CSS selector (${shortMessage}). ${await collectPageInputEvidence(page)}`,
        };
      }
      return {
        passed: false,
        target,
        error: `Input DOM verification failed: ${shortMessage}`,
      };
    }
  }

  // Fallback: aggregate page inspection (used by session doubles in tests).
  const result = await session.inspectPage();

  if (!result.success) {
    return {
      passed: false,
      target,
      error: `Failed to inspect page: ${result.error}`,
    };
  }

  const passed = result.info.inputs.some(input => {
    if (norm.inputType && input.type !== norm.inputType) return false;
    if (norm.placeholder && !input.placeholder.toLowerCase().includes(norm.placeholder.toLowerCase())) return false;
    if (norm.name && !input.name.toLowerCase().includes(norm.name.toLowerCase())) return false;
    if (!norm.inputType && !norm.placeholder && !norm.name) {
      const hint = (norm.label ?? norm.text ?? "").toLowerCase();
      if (!hint) return false;
      const fields = `${input.type} ${input.placeholder} ${input.name}`.toLowerCase();
      return fields.includes(hint);
    }
    return true;
  });

  return {
    passed,
    target,
    actual: passed ? `Found input (${desc})` : `Input (${desc}) not found`,
  };
}

/**
 * Check if a link with specific text exists.
 */
export async function verifyLinkExists(
  session: BrowserSession,
  text: string
): Promise<VerificationResult> {
  const result = await session.inspectPage();
  
  if (!result.success) {
    return {
      passed: false,
      target: { type: "link" as const, text },
      error: `Failed to inspect page: ${result.error}`,
    };
  }

  const passed = result.info.links.some(link => 
    link.toLowerCase().includes(text.toLowerCase())
  );
  
  return {
    passed,
    target: { type: "link" as const, text },
    actual: passed ? `Found link "${text}"` : `Link "${text}" not found`,
  };
}

/**
 * Navigate to a route and verify it loads.
 */
export async function verifyRouteLoads(
  session: BrowserSession,
  baseUrl: string,
  route: string
): Promise<VerificationResult> {
  const url = route.startsWith("http") ? route : `${baseUrl.replace(/\/$/, "")}${route.startsWith("/") ? "" : "/"}${route}`;
  
  const navResult = await session.navigate(url);
  
  if (!navResult.success) {
    return {
      passed: false,
      target: { type: "route" as const, url: route },
      error: `Navigation failed: ${navResult.error}`,
    };
  }

  // Inspect to verify page loaded
  const inspectResult = await session.inspectPage();
  
  if (!inspectResult.success) {
    return {
      passed: false,
      target: { type: "route" as const, url: route },
      error: `Page inspection failed: ${inspectResult.error}`,
    };
  }

  // Check that we're on the right page (URL matches)
  const currentUrl = inspectResult.info.url;
  const expectedPath = route.startsWith("/") ? route : `/${route}`;
  const pathMatches = currentUrl.includes(expectedPath) || currentUrl.endsWith(expectedPath);
  
  return {
    passed: pathMatches,
    target: { type: "route" as const, url: route },
    actual: pathMatches ? `Route ${route} loaded successfully` : `Route mismatch: expected ${expectedPath}, got ${currentUrl}`,
  };
}

/**
 * Verify a button exists and click it, then verify resulting state.
 */
export async function verifyButtonInteraction(
  session: BrowserSession,
  buttonText: string,
  expectedAfterClick?: { text?: string; url?: string }
): Promise<VerificationResult> {
  // First verify button exists
  const buttonExists = await verifyButtonExists(session, buttonText);
  if (!buttonExists.passed) {
    return buttonExists;
  }

  // Click the button
  const clickResult = await session.click(buttonText);
  if (!clickResult.success) {
    return {
      passed: false,
      target: { type: "button" as const, text: buttonText },
      error: `Click failed: ${clickResult.error}`,
    };
  }

  // Wait a bit for any state change
  await new Promise(resolve => setTimeout(resolve, 500));

  // If expected result specified, verify it
  if (expectedAfterClick) {
    if (expectedAfterClick.text) {
      const textResult = await verifyTextExists(session, expectedAfterClick.text);
      if (!textResult.passed) return textResult;
    }
    if (expectedAfterClick.url) {
      const inspectResult = await session.inspectPage();
      if (inspectResult.success && !inspectResult.info.url.includes(expectedAfterClick.url)) {
        return {
          passed: false,
          target: { type: "button" as const, text: buttonText },
          error: `After click, expected URL to contain "${expectedAfterClick.url}", got "${inspectResult.info.url}"`,
        };
      }
    }
  }

  return {
    passed: true,
    target: { type: "button" as const, text: buttonText },
    actual: `Clicked "${buttonText}" successfully`,
  };
}

/**
 * Run multiple verification targets and return summary.
 */
export async function runVerificationSuite(
  session: BrowserSession,
  baseUrl: string,
  targets: VerificationTarget[]
): Promise<BrowserVerificationSummary> {
  const results: VerificationResult[] = [];
  
  for (const target of targets) {
    let result: VerificationResult;
    
    switch (target.type) {
      case "text":
        result = await verifyTextExists(session, target.text!);
        break;
      case "heading":
        result = await verifyHeadingExists(session, target.text!);
        break;
      case "button":
        // Existence + enabled check. A selector, when present, only binds the
        // button to a DOM element; it is never treated as post-click text.
        result = await verifyButtonExists(session, target.text!, target.selector);
        break;
      case "input":
        result = await verifyInputExists(session, {
          selector: target.selector,
          inputType: target.inputType,
          placeholder: target.placeholder,
          name: target.name,
          label: target.label,
          text: target.text,
        });
        break;
      case "link":
        result = await verifyLinkExists(session, target.text!);
        break;
      case "route":
        result = await verifyRouteLoads(session, baseUrl, target.url!);
        break;
      default:
        result = {
          passed: false,
          target,
          error: `Unknown verification target type: ${target.type}`,
        };
    }
    
    results.push(result);
  }

  // Get final page info
  const pageInfoResult = await session.inspectPage();
  const pageInfo = pageInfoResult.success ? pageInfoResult.info : undefined;

  // Check if page rendered as a directory listing instead of the application
  const isDirectoryListing = Boolean(
    pageInfo &&
    (pageInfo.title.includes("Files within ") ||
     pageInfo.title.toLowerCase().includes("directory listing") ||
     pageInfo.title.toLowerCase().startsWith("index of") ||
     pageInfo.visibleText.includes("Files within ") ||
     pageInfo.visibleText.toLowerCase().includes("directory listing for") ||
     pageInfo.visibleText.toLowerCase().includes("directory listing"))
  );

  if (isDirectoryListing) {
    results.push({
      passed: false,
      target: { type: "text", text: "Application rendering" },
      error: `Server served a directory listing ("${pageInfo?.title}") instead of a rendered web application. Ensure an index.html file exists and the dev server is properly configured.`,
    });
  }

  // If no specific targets were provided, verify page actually inspected and loaded cleanly
  if (targets.length === 0) {
    const loadedCleanly = Boolean(
      pageInfoResult.success &&
      pageInfo &&
      !isDirectoryListing &&
      (pageInfo.title.trim().length > 0 || pageInfo.visibleText.trim().length > 0)
    );
    results.push({
      passed: loadedCleanly,
      target: { type: "text", text: "Page content" },
      actual: loadedCleanly
        ? `Page loaded cleanly: "${pageInfo?.title || 'Untitled'}"`
        : (isDirectoryListing ? "Page served as a directory listing" : pageInfoResult.success ? "Page appears blank or failed to render" : pageInfoResult.error),
    });
  }

  // Check for fatal console errors
  if (pageInfo && pageInfo.consoleErrors && pageInfo.consoleErrors.length > 0) {
    results.push({
      passed: false,
      target: { type: "text", text: "Console clean check" },
      error: `Page loaded with browser console error(s): ${pageInfo.consoleErrors.slice(0, 3).join("; ")}`,
    });
  }

  // Check for asset loading failures (missing styles.css, script.js, images)
  if (pageInfo && Array.isArray((pageInfo as any).pageErrors) && (pageInfo as any).pageErrors.length > 0) {
    const failedAssets = ((pageInfo as any).pageErrors as string[]).filter(e => /Failed request|404|net::ERR/i.test(e));
    if (failedAssets.length > 0) {
      results.push({
        passed: false,
        target: { type: "text", text: "Asset loading check" },
        error: `Required project assets failed to load: ${failedAssets.slice(0, 3).join("; ")}`,
      });
    }
  }

  const overallPassed = results.length > 0 && !isDirectoryListing && results.every(r => r.passed);

  return {
    overallPassed,
    results,
    pageInfo,
  };
}

/**
 * Generate verification targets from task description.
 * Parses natural language to extract expected elements.
 */
export function generateVerificationTargetsFromTask(task: string): VerificationTarget[] {
  const targets: VerificationTarget[] = [];
  const lowerTask = task.toLowerCase();

  // Extract quoted strings as expected text
  const quotedMatches = task.match(/["'`]([^"'`]+)["'`]/g);
  if (quotedMatches) {
    for (const match of quotedMatches) {
      const text = match.slice(1, -1);
      targets.push({ type: "text", text, required: true });
    }
  }

  // Helper to add target if not already present (avoid duplicates)
  const addTarget = (target: VerificationTarget) => {
    const exists = targets.some(t => t.type === target.type && t.text === target.text && t.url === target.url);
    if (!exists) targets.push(target);
  };

  // Look for specific element mentions with QUOTED text (existing behavior)
  if (lowerTask.includes("heading") || lowerTask.includes("title")) {
    const headingMatch = task.match(/(?:heading|title)\s+["'`]([^"'`]+)["'`]/i);
    if (headingMatch) {
      addTarget({ type: "heading", text: headingMatch[1], required: true });
    }
  }

  if (lowerTask.includes("button")) {
    const buttonMatch = task.match(/button\s+["'`]([^"'`]+)["'`]/i);
    if (buttonMatch) {
      addTarget({ type: "button", text: buttonMatch[1], required: true });
    }
  }

  if (lowerTask.includes("input") || lowerTask.includes("field")) {
    const inputMatch = task.match(/(?:input|field)\s+["'`]([^"'`]+)["'`]/i);
    if (inputMatch) {
      addTarget({ type: "input", text: inputMatch[1], required: true });
    }
  }

  if (lowerTask.includes("link")) {
    const linkMatch = task.match(/link\s+["'`]([^"'`]+)["'`]/i);
    if (linkMatch) {
      addTarget({ type: "link", text: linkMatch[1], required: true });
    }
  }

  // NEW: Handle unquoted natural-language patterns like "heading Hello Achu", "button Submit", etc.
  // Match: element-type followed by text (until next element keyword, punctuation, or stop word)
  const unquotedPatterns = [
    { type: "heading" as const, keywords: ["heading", "title"] },
    { type: "button" as const, keywords: ["button"] },
    { type: "input" as const, keywords: ["input", "field"] },
    { type: "link" as const, keywords: ["link"] },
  ];

  // Stop words that indicate end of element description
  const stopWords = /\b(that|which|with|and|or|to|for|the|a|an|on|in|at|by|from|into|onto|upon|then|when|if|so|but|as|is|was|were|be|been|being|have|has|had|do|does|did|will|would|should|could|may|might|must|can|shall)\b/i;

  // Element keywords that can end a capture (excluding the one we're currently matching)
  // "page" and "route" are too generic and often appear after target text
  const allElementKeywords = ["heading", "title", "button", "input", "field", "link"];

  for (const { type, keywords } of unquotedPatterns) {
    for (const keyword of keywords) {
      // Pattern: keyword followed by text (capture words until stop word, punctuation, or OTHER element keyword)
      // e.g., "heading Hello Achu" -> captures "Hello Achu"
      // e.g., "button Submit now" -> captures "Submit"
      // Exclude current keyword from stop keywords to allow "heading My Title"
      const otherKeywords = allElementKeywords.filter(k => k !== keyword && k !== (keyword === "heading" ? "title" : keyword === "title" ? "heading" : ""));
      const keywordPattern = otherKeywords.map(k => `\\b${k}\\b`).join("|");
      const regex = new RegExp(`${keyword}\\s+((?:(?!${keywordPattern}|[.,;:]).)+)`, "gi");
      let match;
      while ((match = regex.exec(task)) !== null) {
        let text = match[1].trim();
        // Trim at stop word
        const stopMatch = text.match(stopWords);
        if (stopMatch && stopMatch.index !== undefined) {
          text = text.substring(0, stopMatch.index).trim();
        }
        // Filter out generic/non-concrete text
        if (text && text.length > 1 && !/^(a|an|the|with|and|or|to|for|that|this|my|your|our|their)$/i.test(text)) {
          // Only add if text doesn't contain quoted strings (already handled)
          if (!/["'`]/.test(text)) {
            addTarget({ type, text, required: true });
          }
        }
      }
    }
  }

  // NEW: Handle quoted text BEFORE keyword pattern (e.g., '"Get Started" button', '"Welcome" heading')
  // This complements the existing quoted text extraction which only creates "text" targets
  const quotedBeforePatterns = [
    { type: "heading" as const, keywords: ["heading", "title"] },
    { type: "button" as const, keywords: ["button"] },
    { type: "input" as const, keywords: ["input", "field"] },
    { type: "link" as const, keywords: ["link"] },
  ];

  for (const { type, keywords } of quotedBeforePatterns) {
    for (const keyword of keywords) {
      // Pattern: quoted text followed by keyword
      // e.g., '"Get Started" button' -> captures "Get Started" as button
      // e.g., '"Welcome" heading' -> captures "Welcome" as heading
      const regex = new RegExp(`["'\`]([^"'\`]+)["'\`]\\s+${keyword}`, "gi");
      let match;
      while ((match = regex.exec(task)) !== null) {
        const text = match[1].trim();
        if (text && text.length > 1) {
          addTarget({ type, text, required: true });
        }
      }
    }
  }

  if (lowerTask.includes("/about") || lowerTask.includes("/contact") || lowerTask.includes("route") || lowerTask.includes("page")) {
    const routeMatches = task.match(/\/(about|contact|home|dashboard|pricing|features?|blog|login|signup|register)/gi);
    if (routeMatches) {
      for (const route of routeMatches) {
        addTarget({ type: "route", url: route.toLowerCase(), required: true });
      }
    }
  }

  return targets;
}

/**
 * Stable identity for a verification target, so a failure tracked from an
 * earlier attempt is matched to the same assertion in later attempts.
 */
export function signatureForTarget(target: VerificationTarget): string {
  const parts: Record<string, string> = {};
  const keys: Array<keyof VerificationTarget> = ["type", "selector", "text", "url", "inputType", "placeholder", "name", "label"];
  for (const key of keys) {
    const value = target[key];
    if (typeof value === "string" && value.trim()) {
      parts[key] = value.trim().toLowerCase();
    }
  }
  return JSON.stringify(parts);
}

/**
 * True when an assertion failed for deterministic criteria-construction
 * reasons (bad selector/field usage), i.e. the page is not necessarily at
 * fault and repeating file edits cannot fix it.
 */
export function isCriteriaDefectResult(result: VerificationResult): boolean {
  return Boolean(result.error && result.error.includes("Invalid input verification criteria:"));
}

export type VerificationOutcome = {
  /** True only if every assertion in this summary passed AND no earlier assertion is still outstanding. */
  overallPassed: boolean;
  /** Attempts in this summary that did not pass. */
  failedThisAttempt: VerificationResult[];
  /** Human-readable descriptions of assertions still failed from earlier attempts. */
  outstandingFailures: string[];
};

/**
 * Update the persistent failures map for a completed verification summary.
 * A failure recorded in an earlier attempt is only cleared when a later
 * summary re-runs the SAME assertion and it passes — so a later, smaller
 * run can never silently overwrite an earlier failure with a pass.
 */
export function applyVerificationOutcome(
  failedTargets: Map<string, string>,
  summary: BrowserVerificationSummary
): VerificationOutcome {
  const failedThisAttempt: VerificationResult[] = [];

  for (const result of summary.results) {
    const signature = signatureForTarget(result.target);
    if (result.passed) {
      failedTargets.delete(signature);
    } else {
      const label = result.error || result.actual || `Assertion failed: ${JSON.stringify(result.target)}`;
      failedTargets.set(signature, label);
      failedThisAttempt.push(result);
    }
  }

  return {
    overallPassed: summary.overallPassed && failedTargets.size === 0 && failedThisAttempt.length === 0,
    failedThisAttempt,
    outstandingFailures: Array.from(failedTargets.values()),
  };
}