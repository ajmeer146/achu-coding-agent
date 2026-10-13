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
  const passed = lines.some(line => 
    line.toLowerCase().includes(text.toLowerCase())
  );
  
  return {
    passed,
    target: { type: "heading" as const, text },
    actual: passed ? `Found heading with "${text}"` : `Heading "${text}" not found`,
  };
}

/**
 * Check if a button with specific text exists.
 */
export async function verifyButtonExists(
  session: BrowserSession,
  text: string
): Promise<VerificationResult> {
  const result = await session.inspectPage();
  
  if (!result.success) {
    return {
      passed: false,
      target: { type: "button" as const, text },
      error: `Failed to inspect page: ${result.error}`,
    };
  }

  const passed = result.info.buttons.some(btn => 
    btn.toLowerCase().includes(text.toLowerCase())
  );
  
  return {
    passed,
    target: { type: "button" as const, text },
    actual: passed ? `Found button "${text}"` : `Button "${text}" not found`,
  };
}

/**
 * Check if an input with specific attributes exists.
 */
export async function verifyInputExists(
  session: BrowserSession,
  attributes: { type?: string; placeholder?: string; name?: string }
): Promise<VerificationResult> {
  const result = await session.inspectPage();
  
  if (!result.success) {
    return {
      passed: false,
      target: { type: "input" as const, placeholder: attributes.placeholder ?? "", name: attributes.name ?? "", inputType: attributes.type ?? "" },
      error: `Failed to inspect page: ${result.error}`,
    };
  }

  const passed = result.info.inputs.some(input => {
    if (attributes.type && input.type !== attributes.type) return false;
    if (attributes.placeholder && !input.placeholder.toLowerCase().includes(attributes.placeholder.toLowerCase())) return false;
    if (attributes.name && !input.name.toLowerCase().includes(attributes.name.toLowerCase())) return false;
    return true;
  });
  
  const desc = Object.entries(attributes).map(([k,v]) => `${k}="${v}"`).join(", ");
  
  return {
    passed,
    target: { type: "input" as const, placeholder: attributes.placeholder ?? "", name: attributes.name ?? "", inputType: attributes.type ?? "" },
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
        if (target.selector) {
          // If specific interaction expected
          result = await verifyButtonInteraction(session, target.text!, { text: target.selector });
        } else {
          result = await verifyButtonExists(session, target.text!);
        }
        break;
      case "input":
        result = await verifyInputExists(session, {
          type: target.selector,
          placeholder: target.text,
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

  // If no specific targets were provided, verify page actually inspected and loaded cleanly
  if (targets.length === 0) {
    const loadedCleanly = Boolean(
      pageInfoResult.success &&
      pageInfo &&
      (pageInfo.title.trim().length > 0 || pageInfo.visibleText.trim().length > 0)
    );
    results.push({
      passed: loadedCleanly,
      target: { type: "text", text: "Page content" },
      actual: loadedCleanly
        ? `Page loaded cleanly: "${pageInfo?.title || 'Untitled'}"`
        : (pageInfoResult.success ? "Page appears blank or failed to render" : pageInfoResult.error),
    });
  }

  const overallPassed = results.length > 0 && results.every(r => r.passed);

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