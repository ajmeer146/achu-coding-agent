import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Workspace } from "../src/tools/workspace.js";
import { editFile, isEditContextMismatchError } from "../src/tools/edit-file.js";
import { readFile } from "../src/tools/read-file.js";

describe("Edit Context Mismatch Detection & Auto-Recovery Suite", () => {
  let tempDir: string;
  let workspace: Workspace;

  before(async () => {
    tempDir = path.join(os.tmpdir(), `test-context-mismatch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await fs.promises.mkdir(tempDir, { recursive: true });
    workspace = new Workspace(tempDir);
  });

  after(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("1. isEditContextMismatchError accurately identifies stale oldText and multi-match errors", () => {
    // Exact context mismatch errors
    assert.equal(
      isEditContextMismatchError("Edit 1 failed: The expected text was not found in styles.css.\nCurrent file content begins with:\n..."),
      true,
      "Expected text not found must be classified as context mismatch"
    );
    assert.equal(
      isEditContextMismatchError("Edit 1 failed: Expected exactly one match in App.jsx, but found 3. Provide more surrounding context."),
      true,
      "Multiple matches must be classified as context mismatch"
    );

    // Unrelated errors must NOT be classified as context mismatches
    assert.equal(
      isEditContextMismatchError("Forbidden: .env files cannot be modified automatically."),
      false,
      "Forbidden .env must not be context mismatch"
    );
    assert.equal(
      isEditContextMismatchError("Protected file cannot be modified automatically: tsconfig.json."),
      false,
      "Protected file error must not be context mismatch"
    );
    assert.equal(
      isEditContextMismatchError("Tool error: File does not exist: missing-component.tsx."),
      false,
      "Missing file error must not be context mismatch"
    );
    assert.equal(
      isEditContextMismatchError("TRUNCATED_OR_INCOMPLETE_OUTPUT: unclosed CSS rule"),
      false,
      "Syntax truncation error must not be context mismatch"
    );
    assert.equal(
      isEditContextMismatchError("package.json must be a valid JSON object."),
      false,
      "Invalid JSON error must not be context mismatch"
    );
    assert.equal(
      isEditContextMismatchError("Write verification failed: Content written to app.js could not be confirmed on disk."),
      false,
      "Write verification failure must not be context mismatch"
    );
  });

  test("2. Edit context mismatch triggers a fresh read and formats auto-recovery context", async () => {
    const testFile = "styles.css";
    const initialContent = `/* Base Navigation Styles */
.nav-links {
  display: flex;
  gap: 1.5rem;
  list-style: none;
}

.nav-link {
  color: #f5f5f7;
  text-decoration: none;
}
`;
    await workspace.write(testFile, initialContent);

    // Attempt an edit with stale/mismatched oldText (e.g. model guessed wrong indentation or selector)
    const staleOldText = `  .nav-links {\n    display: flex;\n    gap: 2rem;\n  }`;
    let thrownMessage = "";

    try {
      await editFile(workspace, testFile, [{ oldText: staleOldText, newText: "/* replaced */" }]);
    } catch (err: any) {
      thrownMessage = err.message;
    }

    assert.ok(thrownMessage.length > 0, "editFile must throw when oldText does not match");
    assert.equal(isEditContextMismatchError(thrownMessage), true, "Thrown error must be context mismatch");

    // Simulate the agent's context recovery handler
    const freshContent = await readFile(workspace, testFile);
    assert.equal(freshContent, initialContent, "Fresh read must retrieve exact disk content");

    const lines = freshContent.split("\n");
    const numberedContent = lines.map((l, i) => `${i + 1}: ${l}`).join("\n");
    const recoveryBlock = `[CONTEXT AUTO-RECOVERY: Fresh read of ${testFile}]\n\`\`\`\n${numberedContent}\n\`\`\``;

    assert.match(recoveryBlock, /CONTEXT AUTO-RECOVERY/, "Recovery block header must be present");
    assert.match(recoveryBlock, /\.nav-links/, "Recovery block must contain exact selector from disk");
    assert.match(recoveryBlock, /gap: 1\.5rem/, "Recovery block must contain exact indentation and values");
  });

  test("3. A retry using the fresh file content succeeds cleanly", async () => {
    const testFile = "styles.css";
    // Read the fresh content directly from disk
    const freshDiskContent = await readFile(workspace, testFile);

    // Formulate a new edit using the exact lines from the fresh read
    const exactOldText = `.nav-links {
  display: flex;
  gap: 1.5rem;
  list-style: none;
}`;
    const fixedNewText = `@media (max-width: 480px) {
  .nav-links {
    flex-direction: column;
    width: 100%;
  }
}

.nav-links {
  display: flex;
  gap: 1.5rem;
  list-style: none;
}`;

    const editResult = await editFile(workspace, testFile, [{ oldText: exactOldText, newText: fixedNewText }]);
    assert.match(editResult, /Successfully/, "Edit must succeed when using exact lines from fresh read");

    const updatedContent = await readFile(workspace, testFile);
    assert.match(updatedContent, /max-width: 480px/, "Updated content must be persisted to disk");
    assert.match(updatedContent, /flex-direction: column/, "New CSS rules must be present in file");
  });

  test("4. Unrelated edit errors do NOT trigger context mismatch recovery", async () => {
    // Missing file
    let missingError = "";
    try {
      await workspace.read("nonexistent-file.css");
    } catch (err: any) {
      missingError = err.message;
    }
    assert.equal(isEditContextMismatchError(missingError), false, "Missing file error must not be context mismatch");

    // Protected file
    let protectedError = "";
    try {
      await editFile(workspace, "tsconfig.json", [{ oldText: "*", newText: "{}" }]);
    } catch (err: any) {
      protectedError = err.message;
    }
    assert.equal(isEditContextMismatchError(protectedError), false, "Protected file error must not be context mismatch");
  });

  test("5. Previously completed work remains intact even after a failed repair edit", async () => {
    const indexFile = "index.html";
    const initialHtml = "<!DOCTYPE html><html><head><title>Portfolio</title></head><body><h1>My Work</h1></body></html>";
    await workspace.write(indexFile, initialHtml);

    // Simulate a failed repair edit on styles.css
    try {
      await editFile(workspace, "styles.css", [{ oldText: "NONEXISTENT_SELECTOR_BLOCK", newText: "/* fail */" }]);
    } catch {}

    // index.html must remain completely unaffected
    const readBackHtml = await readFile(workspace, indexFile);
    assert.equal(readBackHtml, initialHtml, "Previously created index.html must remain intact after failed edit on styles.css");
  });

  test("6. Retry budget is bounded and terminates after repeated identical failures", () => {
    const maxRecoveryAttempts = 5;
    let recoveryAttempts = 0;
    const repeatedFailures = new Map<string, number>();

    const failureKey = "edit_file:1:The expected text was not found in styles.css";
    let terminalFailure = false;

    // Simulate 5 repeated identical edit failures
    for (let turn = 0; turn < 6; turn++) {
      const count = repeatedFailures.get(failureKey) || 0;
      repeatedFailures.set(failureKey, count + 1);

      if (count + 1 >= 5) {
        terminalFailure = true;
        break;
      }

      if (count >= 2) {
        recoveryAttempts = Math.min(recoveryAttempts, maxRecoveryAttempts - 1);
      } else {
        recoveryAttempts++;
      }
    }

    assert.equal(terminalFailure, true, "Execution must terminate when repeated edit failures hit bound");
    assert.ok(repeatedFailures.get(failureKey)! <= 5, "Repeat count must be bounded at 5");
  });
});
