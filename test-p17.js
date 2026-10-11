// P17 Deterministic Tests - Workspace Foundation
// These tests verify the workspace layer without requiring live model execution

import fs from 'node:fs';
import path from 'node:path';
import { Workspace } from './dist/tools/workspace.js';
import { listDirectory } from './dist/tools/list-directory.js';
import { readFile } from './dist/tools/read-file.js';
import { isProtectedFile } from './dist/utils/command-guard.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`PASS: ${message}`);
    passed++;
  } else {
    console.log(`FAIL: ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    console.log(`PASS: ${message}`);
    passed++;
  } else {
    console.log(`FAIL: ${message} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ============================================================
// P17-A: Workspace starts
// ============================================================
console.log('\n=== P17-A: Workspace starts ===');
{
  const serverFile = fs.existsSync('dist/server.js');
  assert(serverFile, 'Server build output exists');
  
  const publicDir = fs.existsSync('public/index.html');
  assert(publicDir, 'Frontend HTML exists');
  
  const publicCss = fs.existsSync('public/styles.css');
  assert(publicCss, 'Frontend CSS exists');
  
  const publicJs = fs.existsSync('public/app.js');
  assert(publicJs, 'Frontend JS exists');
}

// ============================================================
// P17-B: Invalid project path rejected
// ============================================================
console.log('\n=== P17-B: Invalid project path rejected ===');
{
  const workspace = new Workspace('C:\\nonexistent\\path\\that\\does\\not\\exist');
  try {
    await workspace.list('.');
    assert(false, 'Should throw for nonexistent path');
  } catch (err) {
    assert(true, 'Nonexistent path correctly rejected');
  }
  
  // Test path traversal protection
  const workspace2 = new Workspace(process.cwd());
  try {
    await workspace2.resolve('../../../etc/passwd');
    assert(false, 'Should throw for path traversal');
  } catch (err) {
    assert(true, 'Path traversal correctly blocked');
  }
}

// ============================================================
// P17-C: Valid project selected
// ============================================================
console.log('\n=== P17-C: Valid project selected ===');
{
  const workspace = new Workspace(process.cwd());
  const files = await workspace.list('.');
  assert(files.includes('package.json'), 'Can list workspace root');
  assert(files.includes('src'), 'Can see src directory');
  
  const resolved = workspace.resolve('.');
  assert(resolved === process.cwd(), 'Resolve returns correct path');
}

// ============================================================
// P17-D: File listing works
// ============================================================
console.log('\n=== P17-D: File listing works ===');
{
  const workspace = new Workspace(process.cwd());
  const result = await listDirectory(workspace, '.');
  assert(result.includes('[FILE] package.json'), 'Lists package.json');
  assert(result.includes('[DIR] src'), 'Lists src directory');
  assert(result.includes('[DIR] public'), 'Lists public directory');
  
  // Test subdirectory listing
  const srcResult = await listDirectory(workspace, 'src');
  assert(srcResult.includes('[FILE] agent.ts'), 'Lists agent.ts in src');
  assert(srcResult.includes('[DIR] tools'), 'Lists tools directory');
}

// ============================================================
// P17-E: File reading works
// ============================================================
console.log('\n=== P17-E: File reading works ===');
{
  const workspace = new Workspace(process.cwd());
  const content = await readFile(workspace, 'package.json');
  assert(content.includes('achu-coding-agent'), 'Reads package.json correctly');
  assert(content.includes('"name"'), 'Contains name field');
  
  // Test reading TypeScript file
  const agentContent = await readFile(workspace, 'src/agent.ts');
  assert(agentContent.includes('runAgent'), 'Reads agent.ts correctly');
  assert(agentContent.length > 1000, 'Reads substantial content');
  
  // Test error on nonexistent file
  try {
    await readFile(workspace, 'nonexistent.ts');
    assert(false, 'Should throw for nonexistent file');
  } catch (err) {
    assert(true, 'Nonexistent file correctly throws');
  }
}

// ============================================================
// P17-F: Task submission reaches existing agent (structural test)
// ============================================================
console.log('\n=== P17-F: Task submission structure ===');
{
  // Verify server has the right endpoints by checking source
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('select_project'), 'Has select_project handler');
  assert(serverSource.includes('list_directory'), 'Has list_directory handler');
  assert(serverSource.includes('read_file'), 'Has read_file handler');
  assert(serverSource.includes('run_task'), 'Has run_task handler');
  assert(serverSource.includes('stop_task'), 'Has stop_task handler');
  
  // Verify agent integration
  assert(serverSource.includes('runAgent') || serverSource.includes('spawn'), 'Integrates with agent');
  assert(serverSource.includes('dist/cli.js'), 'Spawns CLI agent');
}

// ============================================================
// P17-G: Running state represented correctly
// ============================================================
console.log('\n=== P17-G: State representation ===');
{
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  const htmlSource = fs.readFileSync('public/index.html', 'utf8');
  assert(appSource.includes('RUNNING') || htmlSource.includes('RUNNING'), 'Has RUNNING state');
  assert(appSource.includes('COMPLETED') || htmlSource.includes('COMPLETED'), 'Has COMPLETED state');
  assert(appSource.includes('FAILED') || htmlSource.includes('FAILED'), 'Has FAILED state');
  assert(appSource.includes('STOPPED') || htmlSource.includes('STOPPED'), 'Has STOPPED state');
  assert(htmlSource.includes('IDLE'), 'Has IDLE state');
  assert(appSource.includes('status-badge running'), 'Running badge style');
  assert(appSource.includes('status-badge completed'), 'Completed badge style');
  assert(appSource.includes('status-badge failed'), 'Failed badge style');
  assert(appSource.includes('status-badge stopped'), 'Stopped badge style');
}

// ============================================================
// P17-H: Completed state represented correctly
// ============================================================
console.log('\n=== P17-H: Completion handling ===');
{
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  assert(appSource.includes('onTaskCompleted'), 'Has completion handler');
  assert(appSource.includes('task_completed'), 'Handles task_completed event');
  assert(appSource.includes('renderFinalResult'), 'Shows final result card');
  assert(appSource.includes('final-result-card'), 'Uses final result card layout');
}

// ============================================================
// P17-I: Failed state represented correctly
// ============================================================
console.log('\n=== P17-I: Failure handling ===');
{
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  assert(appSource.includes('onTaskFailed'), 'Has failure handler');
  assert(appSource.includes('task_failed'), 'Handles task_failed event');
  assert(appSource.includes('renderFinalResult'), 'Shows final result card for failure');
  assert(appSource.includes('final-result-card'), 'Uses final result card layout');
}

// ============================================================
// P17-J: Changed files accurately reported
// ============================================================
console.log('\n=== P17-J: Changed files tracking ===');
{
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  assert(appSource.includes('changedFiles'), 'Tracks changed files');
  assert(appSource.includes('Successfully edited'), 'Detects edits from output');
  assert(appSource.includes('Successfully created'), 'Detects creates from output');
  assert(appSource.includes('updateChangedFiles'), 'Updates changed files UI');
  assert(appSource.includes('No files changed'), 'Shows empty state');
  
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('detectChanges'), 'Detects changed files from baseline');
  assert(serverSource.includes('captureWorkspaceBaseline'), 'Captures baseline before task');
}

// ============================================================
// P17-K: Read-only task reports no mutation
// ============================================================
console.log('\n=== P17-K: Read-only mutation detection ===');
{
  // The agent's isUnrequestedFileMutation handles this - test it still works
  const { isUnrequestedFileMutation } = await import('./dist/agent.js');
  
  assertEqual(isUnrequestedFileMutation('Read calculator.ts and explain the bug', 'calculator.ts'), false, 'Read-only task allows reading target file');
  assertEqual(isUnrequestedFileMutation('List all files in the project', 'src/agent.ts'), true, 'Read-only task blocks unrelated file mutation');
  assertEqual(isUnrequestedFileMutation('Explain how the authentication works', 'src/auth.ts'), true, 'Explain task blocks mutation');
}

// ============================================================
// P17-L: STOP does not bypass cleanup
// ============================================================
console.log('\n=== P17-L: Stop behavior ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('SIGINT'), 'Sends SIGINT on stop');
  assert(serverSource.includes('client.agentProcess = null'), 'Clears process reference');
  
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  assert(appSource.includes('stop_task'), 'Sends stop_task message');
  assert(appSource.includes('onTaskStopped'), 'Handles task_stopped event');
  assert(appSource.includes('STOPPED'), 'Shows STOPPED state');
}

// ============================================================
// P17-M: NVIDIA configuration error shown safely
// ============================================================
console.log('\n=== P17-M: NVIDIA configuration ===');
{
  const routerSource = fs.readFileSync('src/router.ts', 'utf8');
  assert(routerSource.includes('NVIDIA_API_KEY'), 'Checks for NVIDIA_API_KEY');
  assert(routerSource.includes('not configured'), 'Shows configuration error');
  
  // Test that missing key throws
  const originalKey = process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.ACHU_AGENT_API_KEY;
  
  try {
    const { getModelConfig } = await import('./dist/router.js');
    getModelConfig();
    assert(false, 'Should throw when API key missing');
  } catch (err) {
    assert(err.message.includes('not configured'), 'Throws configuration error');
  }
  
  if (originalKey) process.env.NVIDIA_API_KEY = originalKey;
}

// ============================================================
// P17-N: Existing safety guards remain active
// ============================================================
console.log('\n=== P17-N: Safety guards intact ===');
{
  // Command guard
  const { validateCommand } = await import('./dist/utils/command-guard.js');
  assertEqual(validateCommand('setx VAR value').allowed, false, 'Blocks setx');
  assertEqual(validateCommand('npm run build').allowed, true, 'Allows npm run build');
  
  // Protected files
  assertEqual(isProtectedFile('tsconfig.json'), true, 'Protects tsconfig.json');
  assertEqual(isProtectedFile('package.json'), true, 'Protects package.json');
  assertEqual(isProtectedFile('.env'), true, 'Protects .env');
  assertEqual(isProtectedFile('src/agent.ts'), false, 'Allows source files');
  
  // Self-invocation guard
  const { isSelfInvocation } = await import('./dist/agent.js');
  assertEqual(isSelfInvocation('node dist/cli.js "test"'), true, 'Blocks self-invocation');
  assertEqual(isSelfInvocation('npm run build'), false, 'Allows legitimate commands');
  
  // Mutation guard
  const { isUnrequestedFileMutation } = await import('./dist/agent.js');
  assertEqual(isUnrequestedFileMutation('Click the Buy button', 'browser-e2e/test-page.html'), true, 'Blocks fixture mutation');
  assertEqual(isUnrequestedFileMutation('Fix calculator.ts', 'calculator.ts'), false, 'Allows requested mutation');
}

// ============================================================
// P17-O: Activity events work
// ============================================================
console.log('\n=== P17-O: Activity events ===');
{
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  assert(appSource.includes('addActivity'), 'Has activity logging');
  assert(appSource.includes('agent_output'), 'Handles agent output events');
  assert(appSource.includes('activity-entry'), 'Renders activity entries');
  assert(appSource.includes("'tool'"), 'Shows tool activity');
  assert(appSource.includes("'success'"), 'Shows success activity');
  assert(appSource.includes("'error'"), 'Shows error activity');
}

// ============================================================
// P17-P: Terminal activity works
// ============================================================
console.log('\n=== P17-P: Terminal output ===');
{
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  assert(appSource.includes('terminalOutput'), 'Has terminal output element');
  assert(appSource.includes('terminalBuffer'), 'Buffers terminal output');
  assert(appSource.includes('STDOUT:') || appSource.includes('stdout'), 'Shows stdout');
}

// ============================================================
// P17-Q: Final result accuracy
// ============================================================
console.log('\n=== P17-Q: Final result ===');
{
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  assert(appSource.includes('final-result'), 'Has final result display');
  assert(appSource.includes('task_completed'), 'Handles completion');
  assert(appSource.includes('task_failed'), 'Handles failure');
  assert(appSource.includes('onTaskCompleted'), 'Completion handler');
  assert(appSource.includes('onTaskFailed'), 'Failure handler');
}

// ============================================================
// P17-R: Task history for session
// ============================================================
console.log('\n=== P17-R: Task history ===');
{
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  assert(appSource.includes('taskHistory'), 'Maintains task history');
  assert(appSource.includes('addToHistory'), 'Adds to history');
  assert(appSource.includes('renderHistory'), 'Renders history');
  assert(appSource.includes('task-history'), 'Has history UI element');
}

// ============================================================
// P17-S: Project selection validates path
// ============================================================
console.log('\n=== P17-S: Project selection validation ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('workspace.list'), 'Validates by listing');
  assert(serverSource.includes('catch'), 'Catches validation errors');
  assert(serverSource.includes('Invalid project path'), 'Shows validation error');
}

// ============================================================
// P17-T: File explorer respects boundaries
// ============================================================
console.log('\n=== P17-T: File explorer boundaries ===');
{
  const workspace = new Workspace(process.cwd());
  
  // Test path traversal blocked
  try {
    await workspace.resolve('../../windows/system32');
    assert(false, 'Path traversal should be blocked');
  } catch (err) {
    assert(true, 'Path traversal blocked by Workspace.resolve');
  }
  
  // Test listDirectory respects workspace
  try {
    await listDirectory(workspace, '../../');
    assert(false, 'List directory should be blocked');
  } catch (err) {
    assert(true, 'List directory blocked for parent traversal');
  }
  
  // Test readFile respects workspace
  try {
    await readFile(workspace, '../../package.json');
    assert(false, 'Read file should be blocked');
  } catch (err) {
    assert(true, 'Read file blocked for parent traversal');
  }
}

// ============================================================
// Summary
// ============================================================
console.log(`\n=== P17 Deterministic Tests: ${passed} passed, ${failed} failed ===`);

if (failed > 0) {
  process.exit(1);
}