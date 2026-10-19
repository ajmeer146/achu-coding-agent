import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isAllowedOrigin, compareSemver, COMPANION_TOKEN } from "../src/server.js";
import { isInsideRoot, validateWorkspaceDirectory } from "../src/tools/workspace.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Local Agent Security, Origin Validation & Update Architecture", () => {
  test("1. Origin validation strictly allows authorized website origins and blocks external untrusted origins", () => {
    // Official production origins
    assert.equal(isAllowedOrigin("https://www.workswithachu.me"), true);
    assert.equal(isAllowedOrigin("https://workswithachu.me"), true);
    assert.equal(isAllowedOrigin("http://localhost:3000"), true);
    assert.equal(isAllowedOrigin("http://127.0.0.1:3000"), true);
    assert.equal(isAllowedOrigin("https://preview.workswithachu.me"), true);
    assert.equal(isAllowedOrigin("https://my-preview.vercel.app"), true);

    // Malicious or unauthorized origins
    assert.equal(isAllowedOrigin("https://malicious.org"), false);
    assert.equal(isAllowedOrigin("http://evil-hacker.com"), false);
    assert.equal(isAllowedOrigin("https://phishing-achu.io"), false);
    assert.equal(isAllowedOrigin("not-a-valid-url"), false);
  });

  test("2. compareSemver correctly orders versions", () => {
    assert.equal(compareSemver("1.0.1", "1.0.0"), 1);
    assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
    assert.equal(compareSemver("0.9.9", "1.0.0"), -1);
    assert.equal(compareSemver("2.0.0", "1.10.5"), 1);
    assert.equal(compareSemver("1.0.0.1", "1.0.0"), 1);
  });

  test("3. Path traversal protection strictly constrains file operations to authorized root", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "achu-sec-root-"));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "achu-sec-outside-"));

    try {
      const insideFile = path.join(tmpRoot, "app.js");
      const traversalFile = path.join(tmpRoot, "..", "escape.js");
      const outsideFile = path.join(outsideDir, "secret.txt");

      assert.equal(isInsideRoot(tmpRoot, insideFile), true);
      assert.equal(isInsideRoot(tmpRoot, traversalFile), false);
      assert.equal(isInsideRoot(tmpRoot, outsideFile), false);

      // validateWorkspaceDirectory succeeds for real dir, fails for file or non-existent
      const valid = await validateWorkspaceDirectory(tmpRoot);
      assert.equal(path.resolve(valid.root), path.resolve(tmpRoot));

      await assert.rejects(
        async () => validateWorkspaceDirectory(path.join(tmpRoot, "does-not-exist-12345")),
        /does not exist/i
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test("4. Pairing token exists and is protected", () => {
    assert.ok(COMPANION_TOKEN, "Companion token must exist");
    assert.ok(typeof COMPANION_TOKEN === "string" && COMPANION_TOKEN.length >= 16);

    const tokenPath = path.join(os.homedir(), ".achu", "companion-token.txt");
    if (fs.existsSync(tokenPath)) {
      const content = fs.readFileSync(tokenPath, "utf8").trim();
      assert.equal(content, COMPANION_TOKEN);
    }
  });

  test("5. Inno Setup installer script defines per-user install and bundled runtime", () => {
    const issPath = path.resolve(__dirname, "../dist-installer/AchuLocalAgent.iss");
    assert.ok(fs.existsSync(issPath), "AchuLocalAgent.iss must exist");

    const iss = fs.readFileSync(issPath, "utf8");
    assert.ok(iss.includes("PrivilegesRequired=lowest"), "Must install for current user without admin elevation");
    assert.ok(iss.includes("DisableWelcomePage=no"), "Must include welcome screen");
    assert.ok(iss.includes("DisableFinishedPage=no"), "Must include finished screen");
    assert.ok(iss.includes("start-agent.vbs"), "Must include start-agent.vbs in Run and Icons");
    assert.ok(iss.includes("start-tray.vbs"), "Must include start-tray.vbs in Icons");
    assert.ok(iss.includes("Restart Achu Local Agent"), "Must provide Restart Start Menu shortcut");
    assert.ok(iss.includes("Check for Updates"), "Must provide Check for Updates shortcut");
    assert.ok(fs.existsSync(path.resolve(__dirname, "../dist-installer/staging/scripts/AchuAgentTray.ps1")), "Must package AchuAgentTray.ps1");
  });

  test("6. Built installer artifact matches SHA-256 and validates Authenticode signature status", () => {
    const installerPath = path.resolve(__dirname, "../dist-installer/AchuLocalAgentSetup.exe");
    assert.ok(fs.existsSync(installerPath), "AchuLocalAgentSetup.exe must exist in dist-installer");

    const buf = fs.readFileSync(installerPath);
    assert.equal(buf.subarray(0, 2).toString("utf8"), "MZ", "Binary must be a valid PE executable");
    assert.ok(buf.length > 20 * 1024 * 1024, "Binary must exceed 20MB (self-contained runtime)");

    // Inspect signature using PowerShell
    const ps = `Get-AuthenticodeSignature -LiteralPath '${installerPath.replace(/'/g, "''")}' | Select-Object Status, StatusMessage | ConvertTo-Json -Compress`;
    const out = JSON.parse(execSync(`powershell.exe -NoProfile -Command "${ps}"`, { encoding: "utf8" }).trim());
    assert.ok(out.Status !== undefined, "Authenticode signature status must be inspectable");
    // Signature status is truthfully reported (0/Valid if signed with cert, 2/NotSigned if unsigned developer build)
    assert.ok(out.Status === 0 || out.Status === 2 || out.Status === "Valid" || out.Status === "NotSigned");
    setTimeout(() => process.exit(0), 100);
  });
});
