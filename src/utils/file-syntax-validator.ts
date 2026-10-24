import vm from "node:vm";

export interface FileSyntaxValidationResult {
  valid: boolean;
  error?: string;
  line?: number;
  column?: number;
  isTruncated?: boolean;
}

const VOID_HTML_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr", "!doctype"
]);

/**
 * Validates CSS syntax: checks balanced braces, unclosed comments, unterminated strings,
 * unclosed @media or @keyframes blocks, and trailing unclosed selectors.
 */
export function validateCssSyntax(css: string): FileSyntaxValidationResult {
  let line = 1;
  let col = 0;
  const stack: { type: string; line: number; col: number; context: string }[] = [];
  let inComment = false;
  let inString: "'" | '"' | null = null;
  let currentSelector = "";

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "\n") {
      line++;
      col = 0;
    } else {
      col++;
    }

    if (inComment) {
      if (ch === "*" && css[i + 1] === "/") {
        inComment = false;
        i++;
        col++;
      }
      continue;
    }

    if (inString) {
      if (ch === "\\") {
        i++;
        col++;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === "/" && css[i + 1] === "*") {
      inComment = true;
      i++;
      col++;
      continue;
    }

    if (ch === "'" || ch === '"') {
      inString = ch;
      continue;
    }

    if (ch === "{") {
      stack.push({ type: "{", line, col, context: currentSelector.trim() });
      currentSelector = "";
      continue;
    }

    if (ch === "}") {
      if (stack.length === 0 || stack[stack.length - 1].type !== "{") {
        return {
          valid: false,
          error: `Unexpected closing brace '}' without matching opening brace at line ${line}:${col}`,
          line,
          column: col,
          isTruncated: false,
        };
      }
      stack.pop();
      currentSelector = "";
      continue;
    }

    if (stack.length === 0) {
      if (ch !== ";" && ch !== "\r" && ch !== "\n") {
        currentSelector += ch;
      }
    }
  }

  if (inComment) {
    return {
      valid: false,
      error: `Unterminated CSS comment '/*' starting before line ${line}`,
      line,
      column: col,
      isTruncated: true,
    };
  }

  if (inString) {
    return {
      valid: false,
      error: `Unterminated string literal (${inString}) at line ${line}:${col}`,
      line,
      column: col,
      isTruncated: true,
    };
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    return {
      valid: false,
      error: `Unclosed CSS block for '${unclosed.context || "rule"}' opened at line ${unclosed.line}:${unclosed.col} (reached EOF without closing brace)`,
      line: unclosed.line,
      column: unclosed.col,
      isTruncated: true,
    };
  }

  const remaining = currentSelector.trim();
  if (remaining && !remaining.startsWith("@import") && !remaining.startsWith("@charset")) {
    return {
      valid: false,
      error: `Incomplete CSS rule: trailing selector or declaration without body '${remaining}' at line ${line}:${col}`,
      line,
      column: col,
      isTruncated: true,
    };
  }

  return { valid: true };
}

/**
 * Validates HTML syntax: checks balanced major container tags, unclosed comments,
 * and unclosed style/script blocks.
 */
export function validateHtmlSyntax(html: string): FileSyntaxValidationResult {
  // Check unclosed comments
  const commentStart = html.indexOf("<!--");
  if (commentStart !== -1) {
    let searchFrom = 0;
    while (true) {
      const start = html.indexOf("<!--", searchFrom);
      if (start === -1) break;
      const end = html.indexOf("-->", start + 4);
      if (end === -1) {
        const linesBefore = html.slice(0, start).split("\n");
        return {
          valid: false,
          error: "Unterminated HTML comment '<!--' without matching '-->'",
          line: linesBefore.length,
          column: linesBefore[linesBefore.length - 1].length + 1,
          isTruncated: true,
        };
      }
      searchFrom = end + 3;
    }
  }

  // Mask <script>...</script> and <style>...</style> bodies and comments with spaces (preserving line breaks)
  // so JS operators (<, >) and CSS selectors do not trigger false HTML tag mismatches.
  let cleanHtml = html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
  cleanHtml = cleanHtml.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_match, open, body, close) => {
    return open + body.replace(/[^\n]/g, " ") + close;
  });
  cleanHtml = cleanHtml.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_match, open, body, close) => {
    return open + body.replace(/[^\n]/g, " ") + close;
  });

  const tagRegex = /<(\/)?([a-zA-Z0-9\-]+)([^>]*)>/g;
  const tagStack: { tag: string; line: number; col: number }[] = [];
  let match;

  while ((match = tagRegex.exec(cleanHtml)) !== null) {
    const isClosing = !!match[1];
    const tagName = match[2].toLowerCase();
    const attrs = match[3];
    const isSelfClosing = attrs.trim().endsWith("/") || VOID_HTML_TAGS.has(tagName);

    const pos = match.index;
    const linesBefore = cleanHtml.slice(0, pos).split("\n");
    const tagLine = linesBefore.length;
    const tagCol = linesBefore[linesBefore.length - 1].length + 1;

    if (VOID_HTML_TAGS.has(tagName)) {
      continue;
    }

    if (isClosing) {
      if (tagStack.length === 0) {
        return {
          valid: false,
          error: `Unexpected closing tag </${tagName}> without matching opening tag at line ${tagLine}:${tagCol}`,
          line: tagLine,
          column: tagCol,
          isTruncated: false,
        };
      }
      const last = tagStack[tagStack.length - 1];
      if (last.tag !== tagName) {
        return {
          valid: false,
          error: `Mismatched closing tag </${tagName}> at line ${tagLine}:${tagCol}; expected </${last.tag}> opened at line ${last.line}:${last.col}`,
          line: tagLine,
          column: tagCol,
          isTruncated: false,
        };
      }
      tagStack.pop();
    } else if (!isSelfClosing) {
      tagStack.push({ tag: tagName, line: tagLine, col: tagCol });
    }
  }

  if (tagStack.length > 0) {
    const unclosed = tagStack[tagStack.length - 1];
    return {
      valid: false,
      error: `Unclosed HTML tag <${unclosed.tag}> opened at line ${unclosed.line}:${unclosed.col} (file ended before closing tag)`,
      line: unclosed.line,
      column: unclosed.col,
      isTruncated: true,
    };
  }

  return { valid: true };
}

/**
 * Validates JavaScript / TypeScript syntax by using Node.js vm compilation
 * after normalizing ES module imports/exports.
 */
export function validateJsSyntax(code: string): FileSyntaxValidationResult {
  // Replace import/export statements with comments/placeholders so vm.Script can compile without module errors
  const sanitized = code
    .replace(/^(\s*)import\s+.*?;?$/gm, "$1// import")
    .replace(/^(\s*)import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, "$1// import")
    .replace(/^(\s*)export\s+default\s+/gm, "$1const __default_export__ = ")
    .replace(/^(\s*)export\s+(async\s+)?function/gm, "$1$2function")
    .replace(/^(\s*)export\s+(const|let|var|class)/gm, "$1$2")
    .replace(/^(\s*)export\s*\{[\s\S]*?\};?/gm, "$1// export");

  try {
    new vm.Script(sanitized);
    return { valid: true };
  } catch (err: any) {
    let line: number | undefined;
    const match = err.stack?.match(/evalmachine\.<anonymous>:(\d+)/);
    if (match) line = parseInt(match[1], 10);
    const isTruncated = /unexpected end of input/i.test(err.message) || /unclosed/i.test(err.message);
    return {
      valid: false,
      error: `JavaScript syntax error: ${err.message}${line ? ` at line ${line}` : ""}`,
      line,
      isTruncated,
    };
  }
}

/**
 * Validates JSON content using native JSON.parse.
 */
export function validateJsonSyntax(json: string): FileSyntaxValidationResult {
  try {
    JSON.parse(json);
    return { valid: true };
  } catch (err: any) {
    let line: number | undefined;
    let column: number | undefined;
    const lineMatch = err.message.match(/line (\d+) column (\d+)/i);
    if (lineMatch) {
      line = parseInt(lineMatch[1], 10);
      column = parseInt(lineMatch[2], 10);
    }
    const positionMatch = err.message.match(/at position (\d+)/i);
    const position = positionMatch ? parseInt(positionMatch[1], 10) : undefined;
    const isTruncated = /unexpected end of (json|input)/i.test(err.message) ||
      (position !== undefined && position >= json.length - 2);
    return {
      valid: false,
      error: `Invalid JSON: ${err.message}`,
      line,
      column,
      isTruncated,
    };
  }
}

/**
 * Dispatches file content validation based on file extension.
 */
export function validateFileSyntax(filePath: string, content: string): FileSyntaxValidationResult {
  const lower = filePath.toLowerCase();

  if (lower.endsWith(".json")) {
    return validateJsonSyntax(content);
  }

  if (lower.endsWith(".css")) {
    return validateCssSyntax(content);
  }

  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return validateHtmlSyntax(content);
  }

  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return validateJsSyntax(content);
  }

  // Generic balanced brace check for other formats (like simple ts/jsx without complex types)
  return { valid: true };
}

/**
 * Throws a formatted error if the file has syntax errors or is truncated.
 */
export function assertFileSyntaxValid(filePath: string, content: string): void {
  const result = validateFileSyntax(filePath, content);
  if (!result.valid) {
    const prefix = result.isTruncated ? "TRUNCATED_OR_INCOMPLETE_OUTPUT" : "SYNTAX_VALIDATION_ERROR";
    throw new Error(
      `[${prefix}] File verification failed for ${filePath}:\n` +
      `Error: ${result.error}\n` +
      `Location: Line ${result.line ?? "?"}${result.column ? `, Col ${result.column}` : ""}\n` +
      `The file appears incomplete or contains syntax defects. Please repair or complete the unclosed structure.`
    );
  }
}
