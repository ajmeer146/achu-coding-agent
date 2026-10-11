import { test } from "node:test";
import assert from "node:assert/strict";
import { GitWorkspace } from "../src/tools/git-workspace.js";
import { validateGitUrl, redactCredentials, validateBranchName } from "../src/tools/git-workspace.js";

test("validateGitUrl - accepts allowed hosts", () => {
  const allowedUrls = [
    "https://github.com/user/repo.git",
    "https://github.com/user/repo",
    "https://gitlab.com/user/repo.git",
    "https://bitbucket.org/user/repo",
    "https://dev.azure.com/org/project/_git/repo",
    "https://sourceforge.net/p/project/code",
    "https://codeberg.org/user/repo",
  ];

  for (const url of allowedUrls) {
    const result = validateGitUrl(url);
    assert.equal(result.valid, true, `Should accept ${url}`);
    assert.ok(result.sanitizedUrl, `Should have sanitized URL for ${url}`);
  }
});

test("validateGitUrl - rejects disallowed hosts", () => {
  const disallowedUrls = [
    "https://evil.com/user/repo",
    "https://malicious.com/repo",
    "https://internal.company.com/repo",
    "http://github.com/user/repo", // HTTP not HTTPS
    "ssh://git@github.com/user/repo", // SSH protocol
    "git://github.com/user/repo", // Git protocol
  ];

  for (const url of disallowedUrls) {
    const result = validateGitUrl(url);
    assert.equal(result.valid, false, `Should reject ${url}`);
  }
});

test("validateGitUrl - rejects malformed URLs", () => {
  const malformedUrls = [
    "not-a-url",
    "github.com/user/repo",
    "https://",
    "",
  ];

  for (const url of malformedUrls) {
    const result = validateGitUrl(url);
    assert.equal(result.valid, false, `Should reject ${url}`);
  }
});

test("redactCredentials - redacts credentials in URLs", () => {
  const urls = [
    { input: "https://user:pass@github.com/user/repo", expected: "https://%5BREDACTED%5D:%5BREDACTED%5D@github.com/user/repo" },
    { input: "https://token@github.com/user/repo", expected: "https://%5BREDACTED%5D:%5BREDACTED%5D@github.com/user/repo" },
    { input: "https://github.com/user/repo", expected: "https://github.com/user/repo" },
  ];

  for (const { input, expected } of urls) {
    const result = redactCredentials(input);
    assert.equal(result, expected, `Should redact ${input} correctly`);
  }
});

test("validateBranchName - accepts valid branch names", () => {
  const validBranches = [
    "main",
    "master",
    "feature/new-feature",
    "bugfix/fix-issue-123",
    "release/v1.0.0",
    "hotfix/urgent-fix",
    "feature_new-feature",
    "release/v1.2.3",
  ];

  for (const branch of validBranches) {
    const result = validateBranchName(branch);
    assert.equal(result.valid, true, `Should accept branch: ${branch}`);
  }
});

test("validateBranchName - rejects invalid branch names", () => {
  const invalidBranches = [
    "",
    "branch with spaces",
    "branch@special",
    "branch;rm -rf /",
    "branch`id`",
    "branch$(rm -rf /)",
    "branch|cat /etc/passwd",
    "branch&&echo hacked",
    "branch||echo hacked",
    "branch;",
    "branch|",
    "branch&",
    "branch$",
    "branch`",
    "..",
    "-branch",
    "branch..name",
    "a".repeat(256), // Too long
  ];

  for (const branch of invalidBranches) {
    const result = validateBranchName(branch);
    assert.equal(result.valid, false, `Should reject branch: ${branch}`);
  }
});

test("validateBranchName - rejects path traversal attempts", () => {
  const traversalAttempts = [
    "../",
    "..",
    "../branch",
    "branch/../other",
    "..\\..\\windows",
  ];

  for (const branch of traversalAttempts) {
    const result = validateBranchName(branch);
    assert.equal(result.valid, false, `Should reject traversal: ${branch}`);
  }
});