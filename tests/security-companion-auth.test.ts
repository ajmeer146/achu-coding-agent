import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isAllowedOrigin, isKnownBrowserOrigin, COMPANION_TOKEN } from "../src/server.js";
import { buildGeneratedAppEnv, filterToGeneratedAppEnv, GENERATED_APP_ENV_ALLOWLIST } from "../src/tools/app-lifecycle.js";
import type { ChatMessage, MessageContentPart } from "../src/agent.js";

describe("Companion Security, Origin Allowlist & Secret Isolation Suite", () => {
  test("1. isAllowedOrigin strictly allows exact domain and subdomains, rejecting wildcards and substring spoofs", () => {
    // Official production origins
    assert.equal(isAllowedOrigin("https://www.workswithachu.me"), true);
    assert.equal(isAllowedOrigin("https://workswithachu.me"), true);
    assert.equal(isAllowedOrigin("https://app.workswithachu.me"), true);
    assert.equal(isAllowedOrigin("https://works-with-achu.me"), true);
    assert.equal(isAllowedOrigin("https://preview.works-with-achu.me"), true);
    assert.equal(isAllowedOrigin("http://localhost:3000"), true);
    assert.equal(isAllowedOrigin("http://127.0.0.1:3001"), true);
    assert.equal(isAllowedOrigin("http://[::1]:3000"), true);

    // *.vercel.app wildcard removal — must be BLOCKED
    assert.equal(isAllowedOrigin("https://my-preview.vercel.app"), false);
    assert.equal(isAllowedOrigin("https://evil.vercel.app"), false);

    // Substring spoof attempts — must be BLOCKED
    assert.equal(isAllowedOrigin("https://workswithachu.me.attacker.com"), false);
    assert.equal(isAllowedOrigin("https://attacker-workswithachu.me.net"), false);
    assert.equal(isAllowedOrigin("https://works-with-achu.me.phishing.io"), false);
    assert.equal(isAllowedOrigin("https://notworkswithachu.com"), false);

    // Missing or invalid origins
    assert.equal(isAllowedOrigin(""), false);
    assert.equal(isAllowedOrigin(undefined), false);
    assert.equal(isAllowedOrigin("invalid-url-string"), false);
  });

  test("2. isKnownBrowserOrigin enforces both presence and validity of browser origin", () => {
    assert.equal(isKnownBrowserOrigin(undefined), false, "Missing Origin must be rejected for sensitive endpoints");
    assert.equal(isKnownBrowserOrigin(""), false, "Empty Origin must be rejected");
    assert.equal(isKnownBrowserOrigin("https://evil.org"), false, "Untrusted browser origin must be rejected");
    assert.equal(isKnownBrowserOrigin("https://www.workswithachu.me"), true, "Valid browser origin must be accepted");
    assert.equal(isKnownBrowserOrigin("http://localhost:3000"), true, "Localhost browser origin must be accepted");
  });

  test("3. Companion pairing token is a high-entropy string", () => {
    assert.ok(COMPANION_TOKEN, "COMPANION_TOKEN must be non-empty");
    assert.ok(COMPANION_TOKEN.length >= 16, "COMPANION_TOKEN must be at least 16 characters");
  });

  test("4. Generated app environment allowlist strictly excludes platform secrets", () => {
    // Simulate an environment with sensitive platform credentials
    const dirtyEnv: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin",
      NODE_ENV: "production",
      NVIDIA_API_KEY: "nvapi-secret-key-12345",
      TRIGGER_SECRET_KEY: "tr_secret_test_67890",
      SESSION_SECRET: "session-secret-must-not-leak",
      CSRF_SECRET: "csrf-secret-must-not-leak",
      POSTGRES_PASSWORD: "super-secret-postgres-password",
      REDIS_URL: "redis://default:secret@redis.internal:6379",
      VERCEL_OIDC_TOKEN: "oidc-token-secret",
      PORT: "3000",
      HOST: "127.0.0.1",
    };

    const cleanEnv = filterToGeneratedAppEnv(dirtyEnv);

    // Allowed system variables
    assert.equal(cleanEnv.PATH, "/usr/bin:/bin");
    assert.equal(cleanEnv.NODE_ENV, "production");
    assert.equal(cleanEnv.PORT, "3000");
    assert.equal(cleanEnv.HOST, "127.0.0.1");

    // Strictly blocked platform secrets
    assert.equal(cleanEnv.NVIDIA_API_KEY, undefined, "NVIDIA_API_KEY must not be passed to generated app");
    assert.equal(cleanEnv.TRIGGER_SECRET_KEY, undefined, "TRIGGER_SECRET_KEY must not be passed to generated app");
    assert.equal(cleanEnv.SESSION_SECRET, undefined, "SESSION_SECRET must not be passed to generated app");
    assert.equal(cleanEnv.CSRF_SECRET, undefined, "CSRF_SECRET must not be passed to generated app");
    assert.equal(cleanEnv.POSTGRES_PASSWORD, undefined, "POSTGRES_PASSWORD must not be passed to generated app");
    assert.equal(cleanEnv.REDIS_URL, undefined, "REDIS_URL must not be passed to generated app");
    assert.equal(cleanEnv.VERCEL_OIDC_TOKEN, undefined, "VERCEL_OIDC_TOKEN must not be passed to generated app");
  });

  test("5. buildGeneratedAppEnv defaults to loopback HOST", () => {
    const appEnv = buildGeneratedAppEnv(4000);
    assert.equal(appEnv.PORT, "4000");
    assert.equal(appEnv.HOST, "127.0.0.1");
  });

  test("6. ChatMessage supports multimodal MessageContentPart array for vision input", () => {
    const imagePart: MessageContentPart = {
      type: "image_url",
      image_url: {
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        detail: "auto",
      },
    };
    const textPart: MessageContentPart = {
      type: "text",
      text: "Build a portfolio matching this reference image",
    };

    const userMsg: ChatMessage = {
      role: "user",
      content: [imagePart, textPart],
    };

    assert.equal(userMsg.role, "user");
    assert.ok(Array.isArray(userMsg.content));
    assert.equal(userMsg.content.length, 2);
    assert.equal(userMsg.content[0].type, "image_url");
    assert.equal(userMsg.content[1].type, "text");
  });

  test("7. Attachment pipeline: text-only remains plain string while attachments construct multipart array", () => {
    // Pure text input must stay a string without multipart overhead
    const plainText = "Create a React calculator";
    assert.equal(typeof plainText, "string");

    // Multipart attachment simulation
    const attachments = [
      {
        name: "hero.png",
        type: "image/png",
        content: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
        size: 512,
      },
      {
        name: "spec.txt",
        type: "text/plain",
        content: "Colors: #1e293b, #38bdf8",
        size: 24,
      },
    ];

    const parts: MessageContentPart[] = [];
    for (const att of attachments) {
      if (att.type.startsWith("image/") && (att.content.startsWith("data:") || att.content.startsWith("http"))) {
        parts.push({
          type: "image_url",
          image_url: { url: att.content, detail: "auto" },
        });
      } else if (att.content) {
        parts.push({
          type: "text",
          text: `[Attached Reference: ${att.name}]\n${att.content.slice(0, 10000)}`,
        });
      }
    }
    parts.push({ type: "text", text: plainText });

    assert.equal(parts.length, 3);
    assert.equal(parts[0].type, "image_url");
    assert.equal((parts[0] as any).image_url.url.startsWith("data:image/png;base64"), true);
    assert.equal(parts[1].type, "text");
    assert.equal((parts[1] as any).text.includes("Colors: #1e293b"), true);
    assert.equal(parts[2].type, "text");
    assert.equal((parts[2] as any).text, plainText);
  });
});
