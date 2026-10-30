import { BrowserSession } from "./browser-session.js";
import { PageInfo } from "./browser-session.js";
import { analyseTaskBrief } from "../tools/design-planner.js";

export type VerificationTarget = {
  type: "text" | "heading" | "button" | "input" | "select" | "section" | "link" | "route" | "interaction" | "form";
  selector?: string;
  text?: string;
  url?: string;
  inputType?: string;
  placeholder?: string;
  name?: string;
  label?: string;
  required?: boolean;
  action?: "click" | "type" | "submit";
  inputValue?: string;
  expectedTextAfter?: string;
  expectedUrlAfter?: string;
  expectedSelectorAfter?: string;
};

export type VerificationResult = {
  passed: boolean;
  target: VerificationTarget;
  actual?: string;
  error?: string;
  /** Synthetic check re-run on every attempt; never persisted as a target. */
  structural?: boolean;
};

export type BrowserVerificationSummary = {
  overallPassed: boolean;
  results: VerificationResult[];
  pageInfo?: PageInfo;
};

/**
 * Optional assertions (`required: false`) are reported as warnings but never
 * block completion. Structural checks and task-derived assertions have no
 * `required: false` marker and are therefore always required.
 */
export function computeVerificationOverallPassed(
  results: VerificationResult[],
  isDirectoryListing = false
): boolean {
  return (
    results.length > 0 &&
    !isDirectoryListing &&
    !results.some(result => !result.passed && result.target.required !== false)
  );
}

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

const HTML_TAG_NAMES = new Set([
  "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base",
  "bdi", "bdo", "blockquote", "body", "br", "button", "canvas", "caption",
  "cite", "code", "col", "colgroup", "data", "datalist", "dd", "del",
  "details", "dfn", "dialog", "div", "dl", "dt", "em", "embed", "fieldset",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5",
  "h6", "head", "header", "hgroup", "hr", "html", "i", "iframe", "img",
  "input", "ins", "kbd", "label", "legend", "li", "link", "main", "map",
  "mark", "menu", "meta", "meter", "nav", "noscript", "object", "ol",
  "optgroup", "option", "output", "p", "param", "picture", "pre", "progress",
  "q", "rp", "rt", "ruby", "s", "samp", "script", "section", "select", "slot",
  "small", "source", "span", "strong", "style", "sub", "summary", "sup",
  "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead",
  "time", "title", "tr", "track", "u", "ul", "var", "video", "wbr",
  "svg", "circle", "ellipse", "g", "line", "path", "polygon", "polyline",
  "rect", "use",
]);

/**
 * Heuristic: does this string look like a CSS selector (as opposed to a bare
 * semantic input-type word or a human label)? Bare semantic type words and
 * human labels such as "Confirm" or "Sign in" are deliberately NOT selectors.
 * A bare word is only a selector when it is a known HTML tag (e.g. "button").
 */
export function looksLikeCssSelector(value?: string | null): boolean {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s) return false;
  if (/^[#.*:>+~,\[]/.test(s)) return true;

  const tagMatch = s.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (!tagMatch) return false;
  const tag = tagMatch[0].toLowerCase();
  if (!HTML_TAG_NAMES.has(tag) || isSemanticInputType(tag)) return false;
  if (s.length === tagMatch[0].length) return true;

  return /^[\s\[#.:>+~,]/.test(s.slice(tagMatch[0].length));
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
  ariaLabel?: string;
  title?: string;
  className?: string;
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
    ariaLabel: el.getAttribute?.("aria-label") || el.getAttribute?.("aria-labelledby") || "",
    title: el.getAttribute?.("title") || "",
    className: el.className ? String(el.className) : "",
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
  const normalizedSelector = typeof selector === "string" ? selector.trim() : "";
  const selectorIsCss = normalizedSelector ? looksLikeCssSelector(normalizedSelector) : false;
  const effectiveText =
    (typeof text === "string" ? text.trim() : "") ||
    (normalizedSelector && !selectorIsCss ? normalizedSelector : "");
  const effectiveSelector = selectorIsCss ? normalizedSelector : undefined;
  const target: VerificationTarget = {
    type: "button" as const,
    text: effectiveText,
    ...(effectiveSelector ? { selector: effectiveSelector } : {}),
  };

  const matchesText = (candidate: DomElementInfo | string, expected: string): boolean => {
    const exp = expected.toLowerCase().trim();
    const btn = (typeof candidate === "string" ? candidate : candidate.text || "").toLowerCase();
    const aria = (typeof candidate === "string" ? "" : candidate.ariaLabel || "").toLowerCase();
    const title = (typeof candidate === "string" ? "" : candidate.title || "").toLowerCase();
    const cls = (typeof candidate === "string" ? "" : candidate.className || "").toLowerCase();
    const id = (typeof candidate === "string" ? "" : candidate.id || "").toLowerCase();

    // Direct content or accessible name match
    if (btn.includes(exp) || aria.includes(exp) || title.includes(exp)) return true;

    // Semantic equivalences
    if (exp === "sign in" && (btn.includes("login") || aria.includes("login") || btn.includes("sign in") || aria.includes("sign in"))) return true;
    if (exp === "login" && (btn.includes("sign in") || aria.includes("sign in") || btn.includes("login") || aria.includes("login"))) return true;
    if (exp === "cart" && (btn.includes("cart") || aria.includes("cart") || title.includes("cart") || cls.includes("cart") || id.includes("cart") || btn.includes("🛍") || btn.includes("🛒"))) return true;
    if (exp === "search" && (btn.includes("search") || aria.includes("search") || title.includes("search") || cls.includes("search") || id.includes("search") || btn.includes("🔍"))) return true;

    return false;
  };

  // Preferred path: resolve against the live DOM when Playwright access is available.
  const page = typeof (session as any).getPage === "function" ? (session as any).getPage() : null;
  if (page) {
    try {
      let candidates: DomElementInfo[] = [];
      if (effectiveSelector) {
        const tied: DomElementInfo[] = await page.$$eval(effectiveSelector, COLLECT_DOM_ELEMENTS);
        if (tied.length === 0) {
          return {
            passed: false,
            target,
            error: `Button selector "${effectiveSelector}" did not match any element. ${await collectPageButtonEvidence(page)}`,
          };
        }
        candidates = tied;
      } else {
        candidates = await page.$$eval(
          'button, [role="button"], input[type="submit"], input[type="button"], a.btn, a.button, a[class*="btn"], a[class*="button"]',
          COLLECT_DOM_ELEMENTS
        );
      }

      // Buttons matched by plain DOM selector must be actual buttons; text-matched candidates may be any element with button role.
      const match = candidates.find((c) => (effectiveText ? matchesText(c, effectiveText) : true));

      if (!match) {
        return {
          passed: false,
          target,
          error: `Button "${effectiveText}" not found. ${await collectPageButtonEvidence(page)}`,
        };
      }
      if (match.disabled) {
        return {
          passed: false,
          target,
          error: `Button "${effectiveText}" exists but is disabled; verification requires an enabled button.`,
        };
      }

      return {
        passed: true,
        target,
        actual: `Found button "${effectiveText}" (enabled)`,
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

  const passed = result.info.buttons.some(btn => matchesText(btn, effectiveText));
  if (effectiveSelector && passed) {
    // Aggregate view cannot confirm selector binding; record it but keep the text evidence.
    return {
      passed: true,
      target,
      actual: `Found button "${effectiveText}" (text match; selector "${effectiveSelector}" not DOM-verified)`,
    };
  }

  return {
    passed,
    target,
    actual: passed ? `Found button "${effectiveText}"` : `Button "${effectiveText}" not found`,
  };
}

async function collectPageButtonEvidence(page: any): Promise<string> {
  try {
    const els: DomElementInfo[] = await page.$$eval(
      'button, [role="button"], input[type="submit"], input[type="button"], a.btn, a.button, a[class*="btn"], a[class*="button"]',
      COLLECT_DOM_ELEMENTS
    );
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
export async function verifySelectExists(
  session: BrowserSession,
  criteria: { selector?: string; name?: string; label?: string; text?: string }
): Promise<VerificationResult> {
  const target: VerificationTarget = {
    type: "select",
    ...(criteria.selector ? { selector: criteria.selector } : {}),
    ...(criteria.name ? { name: criteria.name } : {}),
    ...(criteria.label ? { label: criteria.label } : {}),
    ...(criteria.text ? { text: criteria.text } : {}),
  };
  const desc = criteria.selector
    ? `selector "${criteria.selector}"`
    : criteria.name
      ? `name "${criteria.name}"`
      : criteria.label
        ? `label "${criteria.label}"`
        : criteria.text
          ? `text "${criteria.text}"`
          : "dropdown";

  const page = typeof (session as any).getPage === "function" ? (session as any).getPage() : null;
  if (!page) {
    return { passed: false, target, error: "Select verification unavailable: no browser page." };
  }

  try {
    let locator: any;
    if (criteria.selector) {
      locator = page.locator(criteria.selector);
    } else if (criteria.name) {
      locator = page.locator(`select[name*="${escapeCssAttrValue(criteria.name)}"]`);
    } else if (criteria.label) {
      const byLabel = page.getByLabel(criteria.label, { exact: false });
      if ((await byLabel.count()) > 0) {
        locator = byLabel;
      } else {
        locator = page.locator(
          `select[id*="${escapeCssAttrValue(criteria.label)}" i], select[name*="${escapeCssAttrValue(criteria.label)}" i], select[aria-label*="${escapeCssAttrValue(criteria.label)}" i], select:has(option:has-text("${escapeCssAttrValue(criteria.label)}")), label:has-text("${escapeCssAttrValue(criteria.label)}") select, *:has(> select):has-text("${escapeCssAttrValue(criteria.label)}") select`
        );
      }
    } else if (criteria.text) {
      locator = page.locator(
        `select[id*="${escapeCssAttrValue(criteria.text)}" i], select[name*="${escapeCssAttrValue(criteria.text)}" i], select[aria-label*="${escapeCssAttrValue(criteria.text)}" i], select:has(option:has-text("${escapeCssAttrValue(criteria.text)}")), label:has-text("${escapeCssAttrValue(criteria.text)}") select, *:has(> select):has-text("${escapeCssAttrValue(criteria.text)}") select`
      );
    } else {
      locator = page.locator("select");
    }

    const selects: Array<{ id: string; name: string; options: number }> = await locator.evaluateAll((elements: Element[]) =>
      elements
        .filter(element => element.tagName === "SELECT")
        .map(element => {
          const select = element as HTMLSelectElement;
          return { id: select.id, name: select.name, options: select.options.length };
        })
    );

    if (selects.length === 0) {
      return { passed: false, target, error: `Select (${desc}) not found on page.` };
    }
    const withOptions = selects.filter(select => select.options > 0);
    if (withOptions.length === 0) {
      return { passed: false, target, error: `Select (${desc}) was found but has no options.` };
    }
    return {
      passed: true,
      target,
      actual: `Found select (${desc}) with ${withOptions[0].options} option(s)`,
    };
  } catch (err: any) {
    const shortMessage = String(err?.message ?? err).split("\n")[0].trim();
    if (criteria.selector && /not a valid selector|syntaxerror/i.test(shortMessage)) {
      return {
        passed: false,
        target,
        error: `Invalid select verification criteria: "${criteria.selector}" is not a valid CSS selector. Use a selector such as #sortSelect or select[name="category"].`,
      };
    }
    return { passed: false, target, error: `Select verification failed: ${shortMessage}` };
  }
}

export async function verifySectionExists(
  session: BrowserSession,
  criteria: { selector?: string; text?: string }
): Promise<VerificationResult> {
  const target: VerificationTarget = {
    type: "section",
    ...(criteria.selector ? { selector: criteria.selector } : {}),
    ...(criteria.text ? { text: criteria.text } : {}),
  };
  const desc = criteria.selector ? `selector "${criteria.selector}"` : criteria.text ? `section "${criteria.text}"` : "";

  const page = typeof (session as any).getPage === "function" ? (session as any).getPage() : null;
  if (!page) {
    if (criteria.text) {
      return verifyTextExists(session, criteria.text);
    }
    return { passed: false, target, error: "Section verification unavailable: no browser page." };
  }

  try {
    if (!desc) {
      const containerCount = await page.locator('section, [role="region"], main > div').count();
      if (containerCount > 0) {
        return { passed: true, target, actual: "Found section container in page" };
      }
      return { passed: false, target, error: "No section or region container found in page." };
    }

    let passed = false;
    let actual = "";
    if (criteria.selector) {
      const el = await page.$(criteria.selector);
      if (el) {
        passed = true;
        actual = `Found section matching "${criteria.selector}"`;
      }
    }
    if (!passed && criteria.text) {
      const slug = criteria.text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const byId = await page.$(`section#${slug}, #${slug}, section[aria-label*="${criteria.text}" i]`);
      if (byId) {
        passed = true;
        actual = `Found section "#${slug}"`;
      } else {
        const headingMatch = await page.evaluate((titleText: string) => {
          const lower = titleText.toLowerCase();
          const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, section, div[id]"));
          return headings.some(h => (h.textContent || "").toLowerCase().includes(lower) || (h.id || "").toLowerCase().includes(lower));
        }, criteria.text);
        if (headingMatch) {
          passed = true;
          actual = `Found section content with heading/id "${criteria.text}"`;
        }
      }
    }

    if (!passed) {
      return { passed: false, target, error: `Section (${desc}) not found in page.` };
    }
    return { passed: true, target, actual };
  } catch (err: any) {
    return { passed: false, target, error: `Section verification failed: ${err?.message || err}` };
  }
}

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
      } else if (norm.inputType === "search") {
        locator = page.locator('input[type="search"], input[placeholder*="search" i], input[name*="search" i], input[id*="search" i], [role="searchbox"]');
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

      const candidates: DomElementInfo[] = await locator.evaluateAll((elements: Element[]) => {
        const results: Element[] = [];
        for (const el of elements) {
          const tag = el.tagName ? el.tagName.toLowerCase() : "";
          if (tag === "input" || tag === "textarea") {
            results.push(el);
          } else {
            // If the selector matched a container (e.g. #search div, .search-bar, form), gather nested inputs
            const inner = el.querySelectorAll('input, textarea, [role="textbox"], [role="searchbox"]');
            for (let i = 0; i < inner.length; i++) {
              results.push(inner[i]);
            }
          }
        }
        return results.map((el: any) => ({
          tag: el.tagName ? String(el.tagName).toLowerCase() : "",
          type: el.type !== undefined && el.type !== null ? String(el.type) : (el.getAttribute?.("type") || ""),
          placeholder: el.placeholder !== undefined && el.placeholder !== null ? String(el.placeholder) : (el.getAttribute?.("placeholder") || ""),
          name: el.name !== undefined && el.name !== null ? String(el.name) : (el.getAttribute?.("name") || ""),
          id: el.id !== undefined && el.id !== null ? String(el.id) : (el.getAttribute?.("id") || ""),
          text: el.textContent ? String(el.textContent).trim() : "",
          ariaLabel: el.getAttribute?.("aria-label") || el.getAttribute?.("aria-labelledby") || "",
          className: el.className ? String(el.className) : "",
          disabled: el.disabled === true || el.getAttribute?.("aria-disabled") === "true",
        }));
      });
      const matches = candidates.filter((el) => {
        const isInputLike = el.tag === "input" || (el.tag === "textarea" && !norm.inputType);
        if (!isInputLike) return false;
        if (norm.inputType) {
          const isExactType = el.type.toLowerCase() === norm.inputType;
          const isSearchSemantic = norm.inputType === "search" && (
            el.type.toLowerCase() === "search" ||
            el.placeholder.toLowerCase().includes("search") ||
            el.name.toLowerCase().includes("search") ||
            el.id.toLowerCase().includes("search") ||
            (el.ariaLabel && el.ariaLabel.toLowerCase().includes("search")) ||
            (el.className && el.className.toLowerCase().includes("search"))
          );
          if (!isExactType && !isSearchSemantic) return false;
        }
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
    if (norm.inputType) {
      const isExactType = input.type.toLowerCase() === norm.inputType;
      const isSearchSemantic = norm.inputType === "search" && (
        input.type.toLowerCase() === "search" ||
        input.placeholder.toLowerCase().includes("search") ||
        input.name.toLowerCase().includes("search")
      );
      if (!isExactType && !isSearchSemantic) return false;
    }
    if (norm.placeholder && !input.placeholder.toLowerCase().includes(norm.placeholder.toLowerCase())) return false;
    if (norm.name && !input.name.toLowerCase().includes(norm.name.toLowerCase())) return false;
    if (!norm.inputType && !norm.placeholder && !norm.name) {
      const hint = (norm.label ?? norm.text ?? "").toLowerCase();
      if (hint) {
        const fields = `${input.type} ${input.placeholder} ${input.name}`.toLowerCase();
        if (!fields.includes(hint)) return false;
      } else if (norm.selector && norm.selector.toLowerCase().includes("search")) {
        const fields = `${input.type} ${input.placeholder} ${input.name}`.toLowerCase();
        if (!fields.includes("search")) return false;
      } else {
        return false;
      }
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
  buttonTextOrSelector: string,
  expectedAfterClick?: { text?: string; url?: string; selector?: string }
): Promise<VerificationResult> {
  const isSelector = looksLikeCssSelector(buttonTextOrSelector);
  const target: VerificationTarget = {
    type: "interaction",
    text: isSelector ? undefined : buttonTextOrSelector,
    selector: isSelector ? buttonTextOrSelector : undefined,
  };

  // First verify button exists
  const buttonExists = isSelector
    ? await verifyButtonExists(session, "", buttonTextOrSelector)
    : await verifyButtonExists(session, buttonTextOrSelector);
  if (!buttonExists.passed) {
    return buttonExists;
  }

  // Click the button
  const clickResult = await session.click(buttonTextOrSelector);
  if (!clickResult.success) {
    return {
      passed: false,
      target,
      error: `Click failed: ${clickResult.error}`,
    };
  }

  // Wait a bit for any state change or animation
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
          target,
          error: `After click, expected URL to contain "${expectedAfterClick.url}", got "${inspectResult.info.url}"`,
        };
      }
    }
    if (expectedAfterClick.selector) {
      const page = session.getPage();
      if (page) {
        try {
          const el = await page.$(expectedAfterClick.selector);
          if (!el) {
            return {
              passed: false,
              target,
              error: `After click, expected element "${expectedAfterClick.selector}" to appear in the DOM`,
            };
          }
        } catch (selErr: any) {
          return {
            passed: false,
            target,
            error: `After click, query for selector "${expectedAfterClick.selector}" failed: ${selErr?.message}`,
          };
        }
      }
    }
  }

  return {
    passed: true,
    target,
    actual: `Clicked "${buttonTextOrSelector}" successfully and verified resulting state`,
  };
}

/**
 * Verify a form interaction: fills inputs, clicks submit, and checks for resulting state/feedback.
 */
export async function verifyFormInteraction(
  session: BrowserSession,
  formOptions: {
    inputs?: Array<{ selector?: string; name?: string; placeholder?: string; value: string }>;
    submitButton?: string;
    expectedFeedback?: string;
  }
): Promise<VerificationResult> {
  const submitText = formOptions.submitButton || "Submit";
  const target: VerificationTarget = {
    type: "form",
    text: submitText,
    expectedTextAfter: formOptions.expectedFeedback,
  };

  if (formOptions.inputs && formOptions.inputs.length > 0) {
    for (const inp of formOptions.inputs) {
      const sel = inp.selector || (inp.name ? `[name="${inp.name}"]` : inp.placeholder ? `[placeholder="${inp.placeholder}"]` : "input");
      const typeRes = await session.type(sel, inp.value);
      if (!typeRes.success) {
        return {
          passed: false,
          target,
          error: `Failed to fill form input "${sel}": ${typeRes.error}`,
        };
      }
    }
  }

  const clickRes = await session.click(submitText);
  if (!clickRes.success) {
    return {
      passed: false,
      target,
      error: `Form submit button click on "${submitText}" failed: ${clickRes.error}`,
    };
  }

  await new Promise(r => setTimeout(r, 600));

  if (formOptions.expectedFeedback) {
    const textRes = await verifyTextExists(session, formOptions.expectedFeedback);
    if (!textRes.passed) {
      return {
        passed: false,
        target,
        error: `After form submission, expected feedback "${formOptions.expectedFeedback}" was not displayed`,
      };
    }
  }

  return {
    passed: true,
    target,
    actual: `Form filled and submitted successfully with "${submitText}"`,
  };
}

/**
 * Run multiple verification targets and return summary.
 */
/**
 * A malformed verification target (for example one supplied by the model with
 * no "text" value) must fail that single assertion with an actionable message
 * instead of throwing and aborting the whole verification run.
 */
function invalidTargetResult(target: VerificationTarget, requirement: string): VerificationResult {
  return {
    passed: false,
    target,
    error: `Invalid verification target: "${target.type}" requires ${requirement}. Provide a valid target, or omit "targets" to derive assertions from the task and plan.`,
  };
}

export async function runVerificationSuite(
  session: BrowserSession,
  baseUrl: string,
  targets: VerificationTarget[]
): Promise<BrowserVerificationSummary> {
  const results: VerificationResult[] = [];

  for (const target of targets) {
    let result: VerificationResult;

    const text = typeof target.text === "string" ? target.text.trim() : "";
    const selector = typeof target.selector === "string" ? target.selector.trim() : "";
    const routeUrl = typeof target.url === "string" ? target.url.trim() : "";

    switch (target.type) {
      case "text":
        if (!text) {
          result = invalidTargetResult(target, 'a non-empty "text" value');
          break;
        }
        result = await verifyTextExists(session, text);
        break;
      case "heading":
        if (!text) {
          result = invalidTargetResult(target, 'a non-empty "text" value');
          break;
        }
        result = await verifyHeadingExists(session, text);
        break;
      case "button":
        if (target.expectedTextAfter || target.expectedUrlAfter || target.expectedSelectorAfter) {
          result = await verifyButtonInteraction(session, text || selector, {
            text: target.expectedTextAfter,
            url: target.expectedUrlAfter,
            selector: target.expectedSelectorAfter,
          });
        } else {
          // Existence + enabled check. A selector, when present, only binds the
          // button to a DOM element; it is never treated as post-click text.
          if (!text && !selector) {
            result = invalidTargetResult(target, 'a non-empty "text" or "selector" value');
            break;
          }
          result = await verifyButtonExists(session, text, selector || undefined);
        }
        break;
      case "interaction":
        if (!text && !selector) {
          result = invalidTargetResult(target, 'a non-empty "text" or "selector" for the interactive control');
          break;
        }
        result = await verifyButtonInteraction(session, selector || text, {
          text: target.expectedTextAfter,
          url: target.expectedUrlAfter,
          selector: target.expectedSelectorAfter,
        });
        break;
      case "form":
        result = await verifyFormInteraction(session, {
          inputs: target.inputValue ? [{ selector: target.selector, value: target.inputValue }] : [],
          submitButton: text || "Submit",
          expectedFeedback: target.expectedTextAfter,
        });
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
      case "select":
      case "dropdown" as any:
        result = await verifySelectExists(session, {
          selector: selector || undefined,
          name: target.name,
          label: target.label,
          text: target.text,
        });
        break;
      case "section":
        result = await verifySectionExists(session, {
          selector: selector || undefined,
          text: target.text,
        });
        break;
      case "link":
        if (!text) {
          result = invalidTargetResult(target, 'a non-empty "text" value');
          break;
        }
        result = await verifyLinkExists(session, text);
        break;
      case "route":
        if (!routeUrl) {
          result = invalidTargetResult(target, 'a non-empty "url" value');
          break;
        }
        result = await verifyRouteLoads(session, baseUrl, routeUrl);
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
    results.push({ structural: true,
      passed: false,
      target: { type: "text", text: "Application rendering" },
      error: `Server served a directory listing ("${pageInfo?.title}") instead of a rendered web application. Ensure an index.html file exists and the dev server is properly configured.`,
    });
  }

  // If no specific targets were provided, verify page actually inspected, styled, and loaded cleanly
  if (targets.length === 0) {
    const loadedCleanly = Boolean(
      pageInfoResult.success &&
      pageInfo &&
      !isDirectoryListing &&
      (pageInfo.title.trim().length > 0 || pageInfo.visibleText.trim().length > 0)
    );
    results.push({ structural: true,
      passed: loadedCleanly,
      target: { type: "text", text: "Page content" },
      actual: loadedCleanly
        ? `Page loaded cleanly: "${pageInfo?.title || 'Untitled'}"`
        : (isDirectoryListing ? "Page served as a directory listing" : pageInfoResult.success ? "Page appears blank or failed to render" : pageInfoResult.error),
    });

    // Visual and styling quality checks (only when styleAnalysis is available from live browser)
    if (pageInfo && pageInfo.styleAnalysis) {
      const { stylesheetCount, totalRules, fontFamily, semanticElementsCount } = pageInfo.styleAnalysis;

      // Check if stylesheet is loaded and active
      if (stylesheetCount === 0 && totalRules === 0) {
        results.push({ structural: true,
          passed: false,
          target: { type: "text", text: "CSS Stylesheet Check" },
          error: "Page is completely unstyled. No external stylesheets or active CSS rules were found. Link styles.css in index.html (<link rel=\"stylesheet\" href=\"styles.css\">) and implement modern CSS rules.",
        });
      } else if (totalRules < 8) {
        results.push({ structural: true,
          passed: false,
          target: { type: "text", text: "CSS Styling Completeness" },
          error: `Page styling is basic or minimal (only ${totalRules} CSS rule(s) found). Implement comprehensive modern styling in styles.css covering colors, layout, typography, cards, and responsive media queries.`,
        });
      }

      // Check if body is using unstyled default serif
      const isUnstyledSerif = !fontFamily || /^(times new roman|times|serif)$/i.test(fontFamily.trim().toLowerCase());
      if (isUnstyledSerif && totalRules < 20) {
        results.push({ structural: true,
          passed: false,
          target: { type: "text", text: "Typography Styling Check" },
          error: `Page is using default unstyled browser serif typography ("${fontFamily || 'none'}"). Set a modern font family in styles.css (e.g. system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif).`,
        });
      }

      // Check for semantic structural richness
      if (pageInfo.visibleText && pageInfo.visibleText.trim().split(/\s+/).length < 15 && semanticElementsCount < 2) {
        results.push({ structural: true,
          passed: false,
          target: { type: "text", text: "Page Content Completeness" },
          error: "Page content appears incomplete or bare (fewer than 15 words of text and minimal semantic layout). Implement full content sections (header, hero, sections, footer) requested by the user.",
        });
      }
    }
  }

  // Placeholder and broken visual content are a quality failure regardless of which content
  // assertions were supplied. They must be replaced with real content before
  // verification can pass.
  if (pageInfo?.qualityIssues && pageInfo.qualityIssues.length > 0) {
    const brokenImgIssues = pageInfo.qualityIssues.filter(q => q.toLowerCase().includes("broken image"));
    const placeholderIssues = pageInfo.qualityIssues.filter(q => !q.toLowerCase().includes("broken image"));

    if (brokenImgIssues.length > 0) {
      results.push({ structural: true,
        passed: false,
        target: { type: "text", text: "Image asset rendering check" },
        error: `Broken image(s) detected: ${brokenImgIssues.slice(0, 3).join("; ")} Ensure all image URLs are valid and reachable, or replace them with verified local assets or substantive inline SVG artwork, then re-run browser_verify.`,
      });
    }

    if (placeholderIssues.length > 0) {
      results.push({ structural: true,
        passed: false,
        target: { type: "text", text: "Placeholder visual quality check" },
        error: `Placeholder or low-effort visual content detected: ${placeholderIssues.slice(0, 3).join("; ")} Replace it with substantive inline SVG artwork or real product imagery, then re-run browser_verify.`,
      });
    }
  }

  // Check for fatal console errors
  if (pageInfo && pageInfo.consoleErrors && pageInfo.consoleErrors.length > 0) {
    results.push({ structural: true,
      passed: false,
      target: { type: "text", text: "Console clean check" },
      error: `Page loaded with browser console error(s): ${pageInfo.consoleErrors.slice(0, 3).join("; ")}`,
    });
  }

  // Uncaught JavaScript errors mean the page is not actually working, even if
  // the requested content is present. Failed requests are checked separately.
  const runtimeErrors = (pageInfo?.pageErrors ?? []).filter(e => !e.startsWith("Failed request:") && !e.startsWith("Failed "));
  if (runtimeErrors.length > 0) {
    results.push({ structural: true,
      passed: false,
      target: { type: "text", text: "Page runtime check" },
      error: `Page raised uncaught JavaScript error(s): ${runtimeErrors.slice(0, 3).join("; ")}. When a file:line location is shown, read that line and fix the underlying undefined value or malformed expression; otherwise inspect inline event handlers and script files for conflicting quotes. Then re-run browser_verify.`,
    });
  }

  // Check for asset loading failures (missing styles.css, script.js, images)
  if (pageInfo && Array.isArray((pageInfo as any).pageErrors) && (pageInfo as any).pageErrors.length > 0) {
    const failedAssets = ((pageInfo as any).pageErrors as string[]).filter(e => /Failed request|Failed \w+ request|404|net::ERR/i.test(e));
    if (failedAssets.length > 0) {
      results.push({ structural: true,
        passed: false,
        target: { type: "text", text: "Asset loading check" },
        error: `Required project assets failed to load: ${failedAssets.slice(0, 3).join("; ")}`,
      });
    }
  }

  const overallPassed = computeVerificationOverallPassed(results, isDirectoryListing);

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

  // Extract quoted strings as expected text (filtering out code identifiers, filenames, selectors, and HTML attributes)
  const quotedMatches = task.match(/["'`]([^"'`]+)["'`]/g);
  if (quotedMatches) {
    for (const match of quotedMatches) {
      const text = match.slice(1, -1).trim();
      // Skip filenames
      if (/\.(html?|css|js|jsx|tsx?|json|cjs|mjs|md|png|jpg|svg)$/i.test(text)) continue;
      // Skip selectors
      if (/^[#.\[]/.test(text)) continue;
      // Skip attribute/id/class/key mentions (e.g. id 'beta-btn', class 'filter-btn', key 'taskflow_tasks')
      const matchIndex = task.indexOf(match);
      if (matchIndex > 0) {
        const preceding = task.slice(Math.max(0, matchIndex - 25), matchIndex).toLowerCase();
        if (/(?:id|class|key|attribute|selector|attr|data-[a-z0-9_-]+)\s*[:=]?\s*$/i.test(preceding.trim())) {
          continue;
        }
      }
      targets.push({ type: "text", text, required: true });
    }
  }

  // Extract feedback text following "shows", "displays", "says" (e.g. 'shows Thank You after sending')
  const showsMatch = task.match(/(?:shows?|displays?|says?|renders?)\s+([A-Za-z0-9][A-Za-z0-9\s!.,'-]{1,40}?)(?:\s+(?:after|upon|when|on|once|\.|$))/i);
  if (showsMatch && showsMatch[1]) {
    const text = showsMatch[1].replace(/["'`]/g, "").trim();
    if (text.length > 1 && !/^(a|an|the|that|this)$/i.test(text)) {
      targets.push({ type: "text", text, required: true });
    }
  }

  // Helper to add target if not already present (avoid duplicates)
  const addTarget = (target: VerificationTarget) => {
    const exists = targets.some(t =>
      t.type === target.type &&
      t.text === target.text &&
      t.url === target.url &&
      t.selector === target.selector &&
      t.inputType === target.inputType
    );
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
    const buttonMatch = task.match(/button\s+(?:with\s+id\s+["'`]([^"'`]+)["'`]\s+)?(?:labeled\s+)?["'`]([^"'`]+)["'`]/i) || task.match(/button\s+["'`]([^"'`]+)["'`]/i);
    if (buttonMatch) {
      const buttonText = buttonMatch[2] || buttonMatch[1];
      const buttonId = buttonMatch[2] ? buttonMatch[1] : undefined;
      addTarget({ type: "button", text: buttonText, selector: buttonId ? `#${buttonId.replace(/^#/, "")}` : undefined, required: true });
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
      const regex = new RegExp(`(?<![-\\w])${keyword}\\s+((?:(?!${keywordPattern}|[.,;:]).)+)`, "gi");
      let match;
      while ((match = regex.exec(task)) !== null) {
        let text = match[1].trim();
        // Trim at stop word
        const stopMatch = text.match(stopWords);
        if (stopMatch && stopMatch.index !== undefined) {
          text = text.substring(0, stopMatch.index).trim();
        }
        // Filter out generic/non-concrete text and functional terms (e.g. "validation", "handling", "prevention", lifecycle actions)
        const isGenericOrFunctional = /^(a|an|the|with|and|or|to|for|that|this|my|your|our|their|validation|validations|handling|detection|prevention|feedback|requirements?|checks?|logic|rules?|formatting|styling|errors?|success|state|states|elements?|controls?|options?)$/i.test(text)
          || /^(discover|inspect|check|create|start|verify|scaffold|examine|read|edit|update|close|stop|run|execute)\b/i.test(text);
        if (text && text.length > 1 && !isGenericOrFunctional) {
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

  // Guide-derived category controls (Complete Master Website Design Guide v1.0.0):
  // assertions are chosen for the website type that was actually requested.
  // The product type comes from the canonical brief classifier, so a store
  // page inside a landing page brief does not inherit shop-only controls,
  // and a non-shop build never gets search/cart assertions it cannot satisfy.
  const productType = analyseTaskBrief(task);

  // Handle common natural-language web UI patterns
  if (/\bemail\s+(input|field)\b/i.test(task)) {
    addTarget({ type: "input", inputType: "email", selector: 'input[type="email"], #email', required: true });
  }
  if (/\bpassword\s+(input|field)\b/i.test(task)) {
    addTarget({ type: "input", inputType: "password", selector: 'input[type="password"], #password', required: true });
  }
  if (/\b(login|sign[\s-]?in)\s+(button|btn)\b/i.test(task) || /\bbutton\s+to\s+(login|sign[\s-]?in)\b/i.test(task)) {
    addTarget({ type: "button", text: "Login", required: true });
  } else if (/\b(submit|send)\s+(button|btn)\b/i.test(task)) {
    addTarget({ type: "button", text: "Submit", required: true });
  }

  // An authentication page is only verified when its login form really exists.
  // The strict control set belongs to an authentication build — a login link
  // inside a landing page must not be forced to become a full login screen.
  if (productType === "login_auth" && /\b(login|sign[\s-]?in)\s+(page|form)\b/i.test(task)) {
    addTarget({ type: "heading", text: "Login", required: true });
    addTarget({ type: "input", inputType: "email", selector: 'input[type="email"], #email', required: true });
    addTarget({ type: "input", inputType: "password", selector: 'input[type="password"], #password', required: true });
    addTarget({ type: "button", text: "Login", required: true });
  }

  if (productType === "ecommerce") {
    addTarget({
      type: "input",
      selector: 'input[type="search"], input[placeholder*="search" i], input[name*="search" i], input[id*="search" i], input[class*="search" i], input[aria-label*="search" i], [role="searchbox"], #search, .search-input, .search-bar, .search-box',
      required: true,
    });
    addTarget({ type: "button", text: "cart", required: true });
    addTarget({
      type: "section",
      selector: '#catalog, #productGrid, .catalog-section, .products-grid, .product-grid, .cards-grid, [data-section*="product" i]',
      required: true,
    });
  }

  return targets;
}

/**
 * Stable identity for a verification target, so a failure tracked from an
 * earlier attempt is matched to the same assertion in later attempts.
 */
export function signatureForTarget(target: VerificationTarget): string {
  const parts: Record<string, string> = {};
  const keys: Array<keyof VerificationTarget> = ["type", "selector", "text", "url", "inputType", "placeholder", "name", "label", "action", "expectedTextAfter"];
  for (const key of keys) {
    const value = target[key];
    if (typeof value === "string" && value.trim()) {
      parts[key] = value.trim().toLowerCase();
    }
  }
  return JSON.stringify(parts);
}

/**
 * Task-derived assertions are authoritative. A model-supplied assertion that
 * is not derived from the task is advisory unless the model explicitly marks
 * it required, so invented checks cannot force unrelated rewrites of a
 * working page.
 */
export function normalizeProvidedVerificationTargets(
  provided: VerificationTarget[],
  taskTargets: VerificationTarget[]
): VerificationTarget[] {
  const taskSignatures = new Set(taskTargets.map(signatureForTarget));
  return provided.map(target => ({
    ...target,
    required:
      target.required === undefined
        ? taskSignatures.has(signatureForTarget(target))
        : target.required,
  }));
}

/**
 * Combine this run's targets with assertions that failed in earlier attempts.
 * Verification is only complete once every earlier failure has been re-run and
 * passed, so a retry that supplies a smaller target list must never silently
 * skip an outstanding assertion.
 */
export function mergeVerificationTargets(
  targets: VerificationTarget[],
  outstanding: VerificationTarget[]
): VerificationTarget[] {
  const merged = [...targets];
  const seen = new Set(merged.map(signatureForTarget));
  for (const target of outstanding) {
    const signature = signatureForTarget(target);
    if (seen.has(signature)) continue;
    merged.push(target);
    seen.add(signature);
  }
  return merged;
}

/**
 * True when an assertion failed for deterministic criteria-construction
 * reasons (bad selector/field usage), i.e. the page is not necessarily at
 * fault and repeating file edits cannot fix it.
 */
export function isCriteriaDefectResult(result: VerificationResult): boolean {
  if (!result.error) return false;
  return /invalid\s+(?:[a-z]+\s+)?verification\s+(?:criteria|target)/i.test(result.error);
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
    // Structural checks are re-evaluated from the live page on every attempt;
    // persisting their synthetic target would turn them into a literal text
    // assertion that can never pass once the live check is fixed.
    if (result.structural) continue;
    const signature = signatureForTarget(result.target);
    // Passing clears a failure; an explicit downgrade to optional also clears
    // it because optional assertions are warnings, not outstanding blockers.
    if (result.passed || result.target.required === false) {
      failedTargets.delete(signature);
      // If an assertion of this element type passed, also clear any prior criteria defect for that type
      for (const [k, v] of [...failedTargets.entries()]) {
        if (/invalid\s+(?:[a-z]+\s+)?verification\s+(?:criteria|target)/i.test(v)) {
          try {
            const parsed = JSON.parse(k);
            if (parsed.type === result.target.type) {
              failedTargets.delete(k);
            }
          } catch {}
        }
      }
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