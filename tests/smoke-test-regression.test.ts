import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { GitWorkspace } from "../src/tools/git-workspace.js";
import { createFile } from "../src/tools/create-file.js";
import { Workspace } from "../src/tools/workspace.js";

function runGitCommand(cwd, args, allowNonZero = false) {
  return new Promise(function(resolve, reject) {
    const child = spawn("git", args, { cwd: cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0 || allowNonZero) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`git ${args[0]} failed (code ${code}): ${stderr || stdout}`));
      }
    });
    child.on("error", reject);
  });
}

function makeTempDir(label) {
  return fs.mkdtemp(path.join(os.tmpdir(), "achu-" + label + "-")).then(function(dir) {
    return fs.realpath(dir);
  });
}

function cleanup(...dirs) {
  return Promise.all(dirs.map(function(dir) {
    return fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(function() {});
  }));
}

function createTestRepo(label) {
  return new Promise(async (resolve, reject) => {
    try {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-test-repo-" + label + "-"));
      await runGitCommand(dir, ["init"]);
      // Configure to allow pushing to checked-out branch (for file:// remotes)
      await runGitCommand(dir, ["config", "receive.denyCurrentBranch", "updateInstead"]);
      await fs.writeFile(path.join(dir, "README.md"), "# Test Repo\n");
      await runGitCommand(dir, ["add", "-A"]);
      await runGitCommand(dir, ["commit", "-m", "Initial commit"]);
      await runGitCommand(dir, ["config", "user.email", "test@example.com"]);
      await runGitCommand(dir, ["config", "user.name", "Test User"]);
      await runGitCommand(dir, ["branch", "-M", "main"]);
      const realPath = await fs.realpath(dir);
      const url = "file://" + realPath;
      resolve({ url, dir });
    } catch (e) {
      reject(e);
    }
  });
}

test("GitWorkspace - smoke test file creation is detected by commitAndPush", async () => {
  const repo = await createTestRepo("smoke-regression");
  const ws = new GitWorkspace(repo.url, { branch: "main", pushEnabled: true });
  
  try {
    await ws.init();
    const root = ws.getRoot();
    console.log(`[Test] GitWorkspace root: ${root}`);
    
    // Verify .git exists at root
    const gitDir = path.join(root, ".git");
    const gitExists = await fs.stat(gitDir).then(() => true).catch(() => false);
    console.log(`[Test] .git exists at root: ${gitExists}`);
    
    // List files before creation
    const filesBefore = await fs.readdir(root);
    console.log(`[Test] Files before: ${JSON.stringify(filesBefore)}`);
    
    // Create smoke-test file using the same API the agent uses (create_file tool -> workspace.write)
    // The agent uses createFile which calls workspace.write
    const testFileName = "smoke-test-output-20261011.txt";
    const testContent = "SMOKE_TEST_OUTPUT: Test run completed successfully\n";
    
    await ws.write(testFileName, testContent);
    console.log(`[Test] Created file: ${testFileName}`);
    
    // Verify file exists
    const fileExists = await ws.exists(testFileName);
    console.log(`[Test] File exists after write: ${fileExists}`);
    
    const fileContent = await ws.read(testFileName);
    console.log(`[Test] File content: ${fileContent}`);
    
    // List files after creation
    const filesAfter = await fs.readdir(root);
    console.log(`[Test] Files after: ${JSON.stringify(filesAfter)}`);
    
    // Check git status before commitAndPush
    const statusBefore = await runGitCommand(root, ["status", "--porcelain"]);
    console.log(`[Test] git status --porcelain before commitAndPush: "${statusBefore.stdout.trim()}"`);
    
    // Check if file is ignored (check-ignore returns 0 if ignored, 1 if not ignored)
    const ignoredCheck = await runGitCommand(root, ["check-ignore", testFileName], true);
    const isIgnored = ignoredCheck.code === 0;
    console.log(`[Test] git check-ignore ${testFileName}: ${isIgnored ? "IGNORED" : "NOT IGNORED"} (code: ${ignoredCheck.code})`);
    
    // Check ignored files
    const ignoredFiles = await runGitCommand(root, ["ls-files", "--others", "--ignored", "--exclude-standard"]);
    console.log(`[Test] Ignored files: "${ignoredFiles.stdout.trim()}"`);
    
    // Now call commitAndPush - this should detect the change
    const result = await ws.commitAndPush("chore: smoke test");
    console.log(`[Test] commitAndPush result: ${JSON.stringify(result)}`);
    
    // Verify the commit happened
    assert.equal(result.committed, true, "Expected commit to happen but got no changes to commit");
    assert.equal(result.pushed, true, "Expected push to happen");
    
    // Verify the commit exists
    const logResult = await runGitCommand(root, ["log", "--oneline", "-1"]);
    console.log(`[Test] Latest commit: ${logResult.stdout.trim()}`);
    assert.ok(logResult.stdout.includes("smoke test"), "Commit message should contain 'smoke test'");
    
  } finally {
    await ws.cleanup();
    await cleanup(repo.dir);
  }
});

test("GitWorkspace - smoke test file created via createFile tool is detected", async () => {
  const repo = await createTestRepo("smoke-regression-createfile");
  const ws = new GitWorkspace(repo.url, { branch: "main", pushEnabled: true });
  
  try {
    await ws.init();
    const root = ws.getRoot();
    console.log(`[Test] GitWorkspace root: ${root}`);
    
    // Create file using createFile (the tool the agent actually uses)
    const testFileName = "smoke-test-output-20261011.txt";
    const testContent = "SMOKE_TEST_OUTPUT: Test run completed successfully\n";
    
    // createFile uses workspace.write internally, but also does protected file checks
    const result = await createFile(ws, testFileName, testContent);
    console.log(`[Test] createFile result: ${result}`);
    
    // Verify file exists
    const fileExists = await ws.exists(testFileName);
    console.log(`[Test] File exists after createFile: ${fileExists}`);
    
    // Check git status
    const statusBefore = await runGitCommand(root, ["status", "--porcelain"]);
    console.log(`[Test] git status --porcelain before commitAndPush: "${statusBefore.stdout.trim()}"`);
    
    // Check ignored files
    const ignoredFiles = await runGitCommand(root, ["ls-files", "--others", "--ignored", "--exclude-standard"]);
    console.log(`[Test] Ignored files: "${ignoredFiles.stdout.trim()}"`);
    
    // Call commitAndPush
    const pushResult = await ws.commitAndPush("chore: smoke test via createFile");
    console.log(`[Test] commitAndPush result: ${JSON.stringify(pushResult)}`);
    
    assert.equal(pushResult.committed, true, "Expected commit to happen but got no changes to commit");
    assert.equal(pushResult.pushed, true, "Expected push to happen");
    
  } finally {
    await ws.cleanup();
    await cleanup(repo.dir);
  }
});

test("GitWorkspace - .gitignore in cloned repo does not ignore smoke-test file", async () => {
  const repo = await createTestRepo("smoke-regression-gitignore");
  
  // Add a .gitignore that might match smoke-test files
  const gitignorePath = path.join(repo.dir, ".gitignore");
  await fs.writeFile(gitignorePath, "*.log\n*.tmp\noutput/\n");
  await runGitCommand(repo.dir, ["add", ".gitignore"]);
  await runGitCommand(repo.dir, ["commit", "-m", "Add gitignore"]);
  
  const ws = new GitWorkspace(repo.url, { branch: "main", pushEnabled: true });
  
  try {
    await ws.init();
    const root = ws.getRoot();
    console.log(`[Test] GitWorkspace root: ${root}`);
    
    // Check .gitignore was cloned
    const gitignoreContent = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    console.log(`[Test] Cloned .gitignore content: ${gitignoreContent.trim()}`);
    
    // Create smoke-test file
    const testFileName = "smoke-test-output-20261011.txt";
    const testContent = "SMOKE_TEST_OUTPUT: Test run completed successfully\n";
    await ws.write(testFileName, testContent);
    
    // Check git status
    const statusBefore = await runGitCommand(root, ["status", "--porcelain"]);
    console.log(`[Test] git status --porcelain: "${statusBefore.stdout.trim()}"`);
    
    // Check ignored files
    const ignoredFiles = await runGitCommand(root, ["ls-files", "--others", "--ignored", "--exclude-standard"]);
    console.log(`[Test] Ignored files: "${ignoredFiles.stdout.trim()}"`);
    
    // Check if our specific file is ignored (check-ignore returns 0 if ignored, 1 if not ignored)
    const checkIgnore = await runGitCommand(root, ["check-ignore", "-v", testFileName], true);
    const isIgnored = checkIgnore.code === 0;
    console.log(`[Test] git check-ignore -v ${testFileName}: ${isIgnored ? "IGNORED" : "NOT IGNORED"} (code: ${checkIgnore.code})`);
    
    // Call commitAndPush
    const pushResult = await ws.commitAndPush("chore: smoke test with gitignore");
    console.log(`[Test] commitAndPush result: ${JSON.stringify(pushResult)}`);
    
    // This should still commit because smoke-test-output-20261011.txt doesn't match *.log, *.tmp, or output/
    assert.equal(pushResult.committed, true, "Expected commit to happen - smoke test file should not be ignored by default .gitignore");
    
  } finally {
    await ws.cleanup();
    await cleanup(repo.dir);
  }
});

test("GitWorkspace - smoke test file matching .gitignore pattern IS committed (fix for ignore issue)", async () => {
  const repo = await createTestRepo("smoke-regression-ignored");
  
  // Add a .gitignore that matches the smoke-test file pattern
  const gitignorePath = path.join(repo.dir, ".gitignore");
  await fs.writeFile(gitignorePath, "smoke-test-output*.txt\n*.output.txt\n");
  await runGitCommand(repo.dir, ["add", ".gitignore"]);
  await runGitCommand(repo.dir, ["commit", "-m", "Add gitignore matching smoke test"]);
  
  const ws = new GitWorkspace(repo.url, { branch: "main", pushEnabled: true });
  
  try {
    await ws.init();
    const root = ws.getRoot();
    console.log(`[Test] GitWorkspace root: ${root}`);
    
    // Check .gitignore was cloned
    const gitignoreContent = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    console.log(`[Test] Cloned .gitignore content: ${gitignoreContent.trim()}`);
    
    // Create smoke-test file that matches the ignore pattern
    const testFileName = "smoke-test-output-20261011.txt";
    const testContent = "SMOKE_TEST_OUTPUT: Test run completed successfully\n";
    await ws.write(testFileName, testContent);
    
    // Check git status - empty before fix because file is ignored
    const statusBefore = await runGitCommand(root, ["status", "--porcelain"]);
    console.log(`[Test] git status --porcelain (empty before force-add): "${statusBefore.stdout.trim()}"`);
    
    // Check ignored files - should list our file
    const ignoredFiles = await runGitCommand(root, ["ls-files", "--others", "--ignored", "--exclude-standard"]);
    console.log(`[Test] Ignored files: "${ignoredFiles.stdout.trim()}"`);
    
    // Verify file is ignored by git
    const checkIgnore = await runGitCommand(root, ["check-ignore", testFileName], true);
    const isIgnored = checkIgnore.code === 0;
    console.log(`[Test] git check-ignore ${testFileName}: ${isIgnored ? "IGNORED" : "NOT IGNORED"} (code: ${checkIgnore.code})`);
    
    // Call commitAndPush - NOW IT SHOULD COMMIT because the fix force-adds agent-written files
    const pushResult = await ws.commitAndPush("chore: smoke test ignored but force-added");
    console.log(`[Test] commitAndPush result: ${JSON.stringify(pushResult)}`);
    
    // FIX: File written by agent should be committed even if .gitignore excludes it
    assert.equal(pushResult.committed, true, "Agent-written file should be committed even if .gitignore matches");
    assert.equal(pushResult.pushed, true, "Push should succeed");
    
    // Verify the commit exists
    const logResult = await runGitCommand(root, ["log", "--oneline", "-1"]);
    console.log(`[Test] Latest commit: ${logResult.stdout.trim()}`);
    assert.ok(logResult.stdout.includes("smoke test"), "Commit message should contain 'smoke test'");
    
  } finally {
    await ws.cleanup();
    await cleanup(repo.dir);
  }
});

test("GitWorkspace - force add ignored file and commit", async () => {
  const repo = await createTestRepo("smoke-regression-force");
  
  // Add a .gitignore that matches the smoke-test file pattern
  const gitignorePath = path.join(repo.dir, ".gitignore");
  await fs.writeFile(gitignorePath, "smoke-test-output*.txt\n");
  await runGitCommand(repo.dir, ["add", ".gitignore"]);
  await runGitCommand(repo.dir, ["commit", "-m", "Add gitignore matching smoke test"]);
  
  const ws = new GitWorkspace(repo.url, { branch: "main", pushEnabled: true });
  
  try {
    await ws.init();
    const root = ws.getRoot();
    console.log(`[Test] GitWorkspace root: ${root}`);
    
    // Create smoke-test file that matches the ignore pattern
    const testFileName = "smoke-test-output-20261011.txt";
    const testContent = "SMOKE_TEST_OUTPUT: Test run completed successfully\n";
    await ws.write(testFileName, testContent);
    
    // Verify file is ignored before force add
    const checkIgnoreBefore = await runGitCommand(root, ["check-ignore", testFileName], true);
    console.log(`[Test] git check-ignore before force add: ${checkIgnoreBefore.code === 0 ? "IGNORED" : "NOT IGNORED"}`);
    
    // Force add the ignored file
    await runGitCommand(root, ["add", "-f", testFileName]);
    
    // Check git status - should now show the file
    const statusBefore = await runGitCommand(root, ["status", "--porcelain"]);
    console.log(`[Test] git status --porcelain after force add: "${statusBefore.stdout.trim()}"`);
    
    // Call commitAndPush - should now commit
    const pushResult = await ws.commitAndPush("chore: smoke test force added");
    console.log(`[Test] commitAndPush result: ${JSON.stringify(pushResult)}`);
    
    assert.equal(pushResult.committed, true, "Expected commit after force add");
    assert.equal(pushResult.pushed, true, "Expected push after force add");
    
  } finally {
    await ws.cleanup();
    await cleanup(repo.dir);
  }
});