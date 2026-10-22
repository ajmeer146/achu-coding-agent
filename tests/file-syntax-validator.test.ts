import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../src/tools/workspace.js";
import { createFile } from "../src/tools/create-file.js";
import { editFile } from "../src/tools/edit-file.js";
import {
  validateCssSyntax,
  validateHtmlSyntax,
  validateJsSyntax,
  validateJsonSyntax,
  validateFileSyntax,
  assertFileSyntaxValid,
} from "../src/utils/file-syntax-validator.js";

async function makeTempDir(label: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `achu-${label}-`));
  return fs.realpath(dir);
}

async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

describe("Phase 13.2 — File syntax & truncation detection", () => {
  test("1. Valid CSS passes; unclosed rule is detected as truncated", () => {
    assert.equal(validateCssSyntax("body { color: red; }\n.card { padding: 1rem; }").valid, true);

    const truncated = validateCssSyntax("body { color: red; }\n.card { padding: 1rem;");
    assert.equal(truncated.valid, false);
    assert.equal(truncated.isTruncated, true);
    assert.match(truncated.error ?? "", /Unclosed CSS block/);
    assert.equal(truncated.line, 2, "Error line should point at the unclosed rule");
  });

  test("2. CSS structural errors report precise failure context", () => {
    const unexpectedBrace = validateCssSyntax("body { color: red; }}\n");
    assert.equal(unexpectedBrace.valid, false);
    assert.equal(unexpectedBrace.isTruncated, false);
    assert.match(unexpectedBrace.error ?? "", /Unexpected closing brace/);

    const unterminatedComment = validateCssSyntax("/* never closed\nbody { color: red; }\n");
    assert.equal(unterminatedComment.valid, false);
    assert.equal(unterminatedComment.isTruncated, true);
    assert.match(unterminatedComment.error ?? "", /Unterminated CSS comment/);

    const unterminatedString = validateCssSyntax('.a { content: "oops; }\n');
    assert.equal(unterminatedString.valid, false);
    assert.equal(unterminatedString.isTruncated, true);

    const trailingSelector = validateCssSyntax("body { color: red; }\n.footer\n");
    assert.equal(trailingSelector.valid, false);
    assert.equal(trailingSelector.isTruncated, true);
    assert.match(trailingSelector.error ?? "", /Incomplete CSS rule/);
  });

  test("3. Valid HTML passes; unclosed tag is detected as truncated", () => {
    assert.equal(
      validateHtmlSyntax("<!DOCTYPE html><html><head><title>x</title></head><body><p>hi</p></body></html>").valid,
      true
    );

    const truncated = validateHtmlSyntax("<!DOCTYPE html><html><head><title>x</title></head><body><p>hi</p>");
    assert.equal(truncated.valid, false);
    assert.equal(truncated.isTruncated, true);
    assert.match(truncated.error ?? "", /Unclosed HTML tag/);

    const mismatched = validateHtmlSyntax("<html><body><div><span></div></span></body></html>");
    assert.equal(mismatched.valid, false);
    assert.equal(mismatched.isTruncated, false);
    assert.match(mismatched.error ?? "", /Mismatched closing tag/);

    const comment = validateHtmlSyntax("<html><body><!-- unfinished</body></html>");
    assert.equal(comment.valid, false);
    assert.equal(comment.isTruncated, true);
    assert.match(comment.error ?? "", /Unterminated HTML comment/);
  });

  test("4. Valid JS passes; truncated/unclosed JS is detected", () => {
    assert.equal(validateJsSyntax("const a = 1;\nfunction f() { return a; }\nf();").valid, true);

    const truncated = validateJsSyntax("function f() {\n  const a = 1;\n");
    assert.equal(truncated.valid, false);
    assert.equal(truncated.isTruncated, true);

    const broken = validateJsSyntax("const a = ;");
    assert.equal(broken.valid, false);
    assert.match(broken.error ?? "", /JavaScript syntax error/);
  });

  test("5. JSON validation flags truncated payloads", () => {
    assert.equal(validateJsonSyntax('{"name": "app", "version": "1.0.0"}').valid, true);

    const truncated = validateJsonSyntax('{"name": "app", "scripts": {');
    assert.equal(truncated.valid, false);
    assert.equal(truncated.isTruncated, true);
  });

  test("6. validateFileSyntax dispatches by extension", () => {
    assert.equal(validateFileSyntax("styles.css", "a { color: red; }").valid, true);
    assert.equal(validateFileSyntax("index.html", "<p>hi</p>").valid, true);
    assert.equal(validateFileSyntax("script.js", "let x = 1;").valid, true);
    assert.equal(validateFileSyntax("package.json", '{"a":1}').valid, true);
    assert.equal(validateFileSyntax("notes.txt", "anything goes").valid, true);
  });

  test("7. assertFileSyntaxValid throws prefixed errors for truncated output", () => {
    assert.throws(
      () => assertFileSyntaxValid("styles.css", ".hero { color: red;\n"),
      /\[TRUNCATED_OR_INCOMPLETE_OUTPUT\]/
    );
    assert.throws(
      () => assertFileSyntaxValid("index.html", "<html><body><span></div></body></html>"),
      /\[SYNTAX_VALIDATION_ERROR\]/
    );
  });

  test("8. createFile rejects truncated content and does not persist it", async () => {
    const dir = await makeTempDir("syntax-create");
    const ws = new Workspace(dir);
    try {
      await assert.rejects(
        createFile(ws, "styles.css", ".a { color: red; }\n.b { padding: 1rem;"),
        /\[TRUNCATED_OR_INCOMPLETE_OUTPUT\]/
      );

      const exists = await fs
        .stat(path.join(dir, "styles.css"))
        .then(() => true)
        .catch(() => false);
      assert.equal(exists, false, "Truncated CSS must not be written to disk");

      await createFile(ws, "styles.css", ".a { color: red; }\n.b { padding: 1rem; }\n");
      const content = await fs.readFile(path.join(dir, "styles.css"), "utf8");
      assert.match(content, /\.b \{ padding: 1rem; \}/);
    } finally {
      await cleanup(dir);
    }
  });

  test("9. editFile rejects an edit that leaves unclosed syntax and keeps the original file intact", async () => {
    const dir = await makeTempDir("syntax-edit");
    const ws = new Workspace(dir);
    try {
      const original = ".a { color: red; }\n";
      await ws.write("styles.css", original);

      await assert.rejects(
        editFile(ws, "styles.css", [{ oldText: ".a { color: red; }", newText: ".a { color: blue; " }]),
        /\[TRUNCATED_OR_INCOMPLETE_OUTPUT\]/
      );

      const content = await ws.read("styles.css");
      assert.equal(content, original, "Rejected edit must not modify the file");

      await editFile(ws, "styles.css", [{ oldText: ".a { color: red; }", newText: ".a { color: blue; }" }]);
      const updated = await ws.read("styles.css");
      assert.match(updated, /\.a \{ color: blue; \}/);
    } finally {
      await cleanup(dir);
    }
  });

  test("10. A broken regeneration keeps an existing valid file instead of failing the step", async () => {
    const dir = await makeTempDir("syntax-regeneration");
    const ws = new Workspace(dir);
    try {
      const validJs = "function init() {\n  return true;\n}\n";
      await createFile(ws, "script.js", validJs, true);

      // A regeneration with an unclosed block must not be written, and must not
      // destroy the healthy artifact that is already on disk.
      const result = await createFile(ws, "script.js", "function init() {\n  return true;\n", true);

      assert.match(result, /Kept existing script\.js/);
      assert.match(result, /NOT written/);
      const content = await ws.read("script.js");
      assert.equal(content, validJs, "The valid file on disk must be preserved unchanged");
    } finally {
      await cleanup(dir);
    }
  });

  test("11. A broken regeneration is still rejected when no valid file exists", async () => {
    const dir = await makeTempDir("syntax-regeneration-missing");
    const ws = new Workspace(dir);
    try {
      await assert.rejects(
        createFile(ws, "script.js", "function init() {\n  return true;\n", true),
        /\[SYNTAX_VALIDATION_ERROR\]|\[TRUNCATED_OR_INCOMPLETE_OUTPUT\]/
      );
      const exists = await fs
        .stat(path.join(dir, "script.js"))
        .then(() => true)
        .catch(() => false);
      assert.equal(exists, false, "No file may be written when the content is invalid");
    } finally {
      await cleanup(dir);
    }
  });
});
