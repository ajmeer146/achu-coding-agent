// P20 Deterministic Tests - Agent Workspace UX / Diff / Approval
// These tests verify the workspace UX layer without requiring live model execution

import { captureWorkspaceBaseline, detectChanges, generateDiffForDisplay, generateUnifiedDiff, MAX_FILE_SIZE_FOR_DIFF, MAX_DIFF_LINES } from './dist/tools/file-tracker.js';
import { Workspace } from './dist/tools/workspace.js';
import fs from 'node:fs';
import path from 'node:path';

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

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS: ${message}`);
    passed++;
  } else {
    console.log(`FAIL: ${message} - expected ${e}, got ${a}`);
    failed++;
  }
}

// ============================================================
// Test fixture setup
// ============================================================
const FIXTURE_DIR = path.join(process.cwd(), 'test-p20-fixture');

function setupFixture() {
  if (fs.existsSync(FIXTURE_DIR)) {
    fs.rmSync(FIXTURE_DIR, { recursive: true });
  }
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.mkdirSync(path.join(FIXTURE_DIR, 'src'), { recursive: true });
  fs.mkdirSync(path.join(FIXTURE_DIR, 'src', 'components'), { recursive: true });
}

function cleanupFixture() {
  if (fs.existsSync(FIXTURE_DIR)) {
    fs.rmSync(FIXTURE_DIR, { recursive: true });
  }
}

// ============================================================
// P20-A: Changed-file baseline capture
// ============================================================
console.log('\n=== P20-A: Changed-file baseline capture ===');
{
  setupFixture();
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'app.ts'), 'export const app = "test";\n');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'utils.ts'), 'export const util = 123;\n');
  
  const workspace = new Workspace(FIXTURE_DIR);
  const baseline = await captureWorkspaceBaseline(workspace, 'test-task-1');
  
  assert(baseline.taskId === 'test-task-1', 'Baseline has correct taskId');
  assert(baseline.snapshots.size === 2, 'Baseline captures 2 files');
  assert(baseline.snapshots.has('src/app.ts'), 'Baseline includes app.ts');
  assert(baseline.snapshots.has('src/utils.ts'), 'Baseline includes utils.ts');
  assert(baseline.snapshots.get('src/app.ts')?.content?.includes('export const app'), 'Baseline captures file content');
  assert(baseline.snapshots.get('src/app.ts')?.size > 0, 'Baseline captures file size');
  assert(baseline.snapshots.get('src/app.ts')?.mtime > 0, 'Baseline captures mtime');
  assert(baseline.snapshots.get('src/app.ts')?.isBinary === false, 'Baseline detects text file');
  
  cleanupFixture();
}

// ============================================================
// P20-B: Added file detection
// ============================================================
console.log('\n=== P20-B: Added file detection ===');
{
  setupFixture();
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'app.ts'), 'export const app = "test";\n');
  
  const workspace = new Workspace(FIXTURE_DIR);
  const baseline = await captureWorkspaceBaseline(workspace, 'test-task-2');
  
  // Add a new file
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'components', 'Button.tsx'), 'export const Button = () => <button>Click</button>;\n');
  
  const changes = await detectChanges(workspace, baseline);
  
  const addedFile = changes.find(f => f.path === 'src/components/Button.tsx');
  assert(addedFile !== undefined, 'Detects added file');
  assertEqual(addedFile?.changeType, 'ADDED', 'Added file has correct changeType');
  assertEqual(addedFile?.oldContent, null, 'Added file has no old content');
  assert(addedFile?.newContent?.includes('Button'), 'Added file has new content');
  assert(addedFile?.additions > 0, 'Added file has additions count');
  assertEqual(addedFile?.deletions, 0, 'Added file has zero deletions');
  assertEqual(addedFile?.isBinary, false, 'Added file detected as text');
  
  cleanupFixture();
}

// ============================================================
// P20-C: Modified file detection
// ============================================================
console.log('\n=== P20-C: Modified file detection ===');
{
  setupFixture();
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'app.ts'), 'export const app = "test";\n');
  
  const workspace = new Workspace(FIXTURE_DIR);
  const baseline = await captureWorkspaceBaseline(workspace, 'test-task-3');
  
  // Modify the file
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'app.ts'), 'export const app = "modified";\nexport const version = 2;\n');
  
  const changes = await detectChanges(workspace, baseline);
  
  const modifiedFile = changes.find(f => f.path === 'src/app.ts');
  assert(modifiedFile !== undefined, 'Detects modified file');
  assertEqual(modifiedFile?.changeType, 'MODIFIED', 'Modified file has correct changeType');
  assert(modifiedFile?.oldContent?.includes('test'), 'Modified file has old content');
  assert(modifiedFile?.newContent?.includes('modified'), 'Modified file has new content');
  assert(modifiedFile?.newContent?.includes('version'), 'Modified file has new content line');
  assert(modifiedFile?.additions > 0, 'Modified file has additions');
  assert(modifiedFile?.deletions > 0, 'Modified file has deletions');
  assertEqual(modifiedFile?.isBinary, false, 'Modified file detected as text');
  
  cleanupFixture();
}

// ============================================================
// P20-D: Deleted file detection
// ============================================================
console.log('\n=== P20-D: Deleted file detection ===');
{
  setupFixture();
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'app.ts'), 'export const app = "test";\n');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'utils.ts'), 'export const util = 123;\n');
  
  const workspace = new Workspace(FIXTURE_DIR);
  const baseline = await captureWorkspaceBaseline(workspace, 'test-task-4');
  
  // Delete a file
  fs.rmSync(path.join(FIXTURE_DIR, 'src', 'utils.ts'));
  
  const changes = await detectChanges(workspace, baseline);
  
  const deletedFile = changes.find(f => f.path === 'src/utils.ts');
  assert(deletedFile !== undefined, 'Detects deleted file');
  assertEqual(deletedFile?.changeType, 'DELETED', 'Deleted file has correct changeType');
  assert(deletedFile?.oldContent?.includes('util'), 'Deleted file has old content');
  assertEqual(deletedFile?.newContent, null, 'Deleted file has no new content');
  assertEqual(deletedFile?.additions, 0, 'Deleted file has zero additions');
  assert(deletedFile?.deletions > 0, 'Deleted file has deletions count');
  assertEqual(deletedFile?.isBinary, false, 'Deleted file detected as text');
  
  cleanupFixture();
}

// ============================================================
// P20-E: Unchanged file detection (should NOT appear in changes)
// ============================================================
console.log('\n=== P20-E: Unchanged file detection ===');
{
  setupFixture();
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'app.ts'), 'export const app = "test";\n');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'utils.ts'), 'export const util = 123;\n');
  
  const workspace = new Workspace(FIXTURE_DIR);
  const baseline = await captureWorkspaceBaseline(workspace, 'test-task-5');
  
  // Don't change anything
  const changes = await detectChanges(workspace, baseline);
  
  assertEqual(changes.length, 0, 'No changes reported for unchanged files');
  
  cleanupFixture();
}

// ============================================================
// P20-F: Text diff generation
// ============================================================
console.log('\n=== P20-F: Text diff generation ===');
{
  const oldContent = 'line 1\nline 2\nline 3\nline 4';
  const newContent = 'line 1\nline 2 modified\nline 3\nline 5';
  
  const diff = generateDiffForDisplay(oldContent, newContent, 'test.txt');
  
  assert(diff.lines.length > 0, 'Generates diff lines');
  const hasAdd = diff.lines.some(l => l.type === 'add');
  const hasRemove = diff.lines.some(l => l.type === 'remove');
  const hasContext = diff.lines.some(l => l.type === 'context');
  assert(hasAdd, 'Diff shows additions');
  assert(hasRemove, 'Diff shows removals');
  assert(hasContext, 'Diff shows context lines');
  assert(diff.lines.some(l => l.content.includes('line 2 modified')), 'Diff shows modified line as add');
  assert(diff.lines.some(l => l.content === 'line 2'), 'Diff shows removed line');
  assertEqual(diff.truncated, false, 'Small diff not truncated');
  
  // Test unified diff format
  const unified = generateUnifiedDiff(oldContent, newContent, 'test.txt');
  assert(unified.includes('--- a/test.txt'), 'Unified diff has old file header');
  assert(unified.includes('+++ b/test.txt'), 'Unified diff has new file header');
  assert(unified.includes('-line 2'), 'Unified diff shows removal');
  assert(unified.includes('+line 2 modified'), 'Unified diff shows addition');
}

// ============================================================
// P20-G: Binary file handling
// ============================================================
console.log('\n=== P20-G: Binary file handling ===');
{
  setupFixture();
  // Create a binary file (PNG header)
  const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  fs.writeFileSync(path.join(FIXTURE_DIR, 'image.png'), pngHeader);
  
  const workspace = new Workspace(FIXTURE_DIR);
  const baseline = await captureWorkspaceBaseline(workspace, 'test-task-6');
  
  // Verify binary file was captured in baseline
  assert(baseline.snapshots.has('image.png'), 'Binary file captured in baseline');
  assertEqual(baseline.snapshots.get('image.png')?.isBinary, true, 'Baseline detects binary file');
  
  // Modify binary file - change size to ensure detection
  fs.writeFileSync(path.join(FIXTURE_DIR, 'image.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
  
  // Small delay to ensure mtime changes
  await new Promise(r => setTimeout(r, 10));
  
  // Debug: check what files are in the fixture
  const fixtureFiles = fs.readdirSync(FIXTURE_DIR);
  console.log(`  Fixture files: ${fixtureFiles.join(', ')}`);
  
  // Debug: manually walk the fixture
  const entries = fs.readdirSync(FIXTURE_DIR, { withFileTypes: true });
  console.log(`  Entries: ${entries.map(e => e.name + (e.isDirectory() ? '/' : '')).join(', ')}`);
  
  const changes = await detectChanges(workspace, baseline);
  
  console.log(`  Detected changes: ${changes.map(c => c.path).join(', ')}`);
  
  const binaryFile = changes.find(f => f.path === 'image.png');
  assert(binaryFile !== undefined, 'Detects binary file change');
  assertEqual(binaryFile?.isBinary, true, 'Binary file marked as binary');
  assertEqual(binaryFile?.oldContent, null, 'Binary file has no old content (text)');
  assertEqual(binaryFile?.newContent, null, 'Binary file has no new content (text)');
  
  // Test diff display for binary
  const diff = generateDiffForDisplay(null, null, 'image.png');
  assert(diff.lines[0].content === 'No changes', 'Binary diff shows placeholder');
  
  cleanupFixture();
}

// ============================================================
// P20-H: Large diff limit
// ============================================================
console.log('\n=== P20-H: Large diff limit ===');
{
  // Create a large file with many lines
  const largeOld = Array(6000).fill(0).map((_, i) => `line ${i}`).join('\n');
  const largeNew = Array(6000).fill(0).map((_, i) => i === 100 ? `modified line ${i}` : `line ${i}`).join('\n');
  
  const diff = generateDiffForDisplay(largeOld, largeNew, 'large.txt');
  
  assert(diff.lines.length <= MAX_DIFF_LINES, `Diff limited to ${MAX_DIFF_LINES} lines`);
  assertEqual(diff.truncated, true, 'Large diff marked as truncated');
}

// ============================================================
// P20-I: Workspace path protection
// ============================================================
console.log('\n=== P20-I: Workspace path protection ===');
{
  setupFixture();
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'app.ts'), 'export const app = "test";\n');
  
  const workspace = new Workspace(FIXTURE_DIR);
  
  // Test that resolve blocks path traversal
  try {
    workspace.resolve('../../etc/passwd');
    assert(false, 'Should throw for path traversal');
  } catch (err) {
    assert(true, 'Path traversal blocked by Workspace.resolve');
  }
  
  // Test that captureBaseline only captures within workspace
  const baseline = await captureWorkspaceBaseline(workspace, 'test-task-7');
  assert(baseline.snapshots.size === 1, 'Baseline only captures workspace files');
  assert(!Array.from(baseline.snapshots.keys()).some(p => p.startsWith('..')), 'No paths outside workspace');
  
  cleanupFixture();
}

// ============================================================
// P20-J: Changed-file API (server-side)
// ============================================================
console.log('\n=== P20-J: Changed-file API structure ===');
{
  // Verify the server has the get_diff endpoint
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('get_diff'), 'Server has get_diff handler');
  assert(serverSource.includes('generateDiffForDisplay'), 'Server uses diff generation');
  assert(serverSource.includes('ChangedFile'), 'Server imports ChangedFile type');
  assert(serverSource.includes('captureWorkspaceBaseline'), 'Server captures baseline');
  assert(serverSource.includes('detectChanges'), 'Server detects changes');
  assert(serverSource.includes('review_available'), 'Server emits review_available event');
  assert(serverSource.includes('approval_changed'), 'Server emits approval_changed event');
  assert(serverSource.includes('verification_status'), 'Server emits verification_status event');
  assert(serverSource.includes('task_status'), 'Server emits task_status event');
}

// ============================================================
// P20-K: Diff API (server-side)
// ============================================================
console.log('\n=== P20-K: Diff API structure ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('case "get_diff"'), 'Server handles get_diff message');
  assert(serverSource.includes('new Workspace'), 'Diff API validates path via Workspace');
  assert(serverSource.includes('isBinary'), 'Diff API handles binary files');
  assert(serverSource.includes('diff_result'), 'Diff API emits diff_result event');
  assert(serverSource.includes('truncated'), 'Diff API handles truncation');
}

// ============================================================
// P20-L: Task status events
// ============================================================
console.log('\n=== P20-L: Task status events ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('task_status'), 'Server emits task_status');
  assert(serverSource.includes('RUNNING'), 'Server sends RUNNING status');
  assert(serverSource.includes('COMPLETED'), 'Server sends COMPLETED status');
  assert(serverSource.includes('FAILED'), 'Server sends FAILED status');
  
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  assert(appSource.includes('onTaskStatus'), 'Frontend handles task_status');
  assert(appSource.includes('status-badge'), 'Frontend updates status badge');
  assert(appSource.includes('RUNNING'), 'Frontend handles RUNNING');
  assert(appSource.includes('COMPLETED'), 'Frontend handles COMPLETED');
  assert(appSource.includes('FAILED'), 'Frontend handles FAILED');
  assert(appSource.includes('STOPPED'), 'Frontend handles STOPPED');
}

// ============================================================
// P20-M: Verification status events
// ============================================================
console.log('\n=== P20-M: Verification status events ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('verification_status'), 'Server emits verification_status');
  assert(serverSource.includes('verification:'), 'Server tracks verification status');
  assert(serverSource.includes('buildStatus'), 'Server tracks build status');
  assert(serverSource.includes('browserStatus'), 'Server tracks browser status');
  
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  assert(appSource.includes('onVerificationStatus'), 'Frontend handles verification_status');
  assert(appSource.includes('verification-badge'), 'Frontend has verification badge');
  assert(appSource.includes('verificationDetails'), 'Frontend shows verification details');
  assert(appSource.includes('Build'), 'Frontend shows build status');
  assert(appSource.includes('Browser'), 'Frontend shows browser status');
}

// ============================================================
// P20-N: Review state creation
// ============================================================
console.log('\n=== P20-N: Review state creation ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('reviewState'), 'Server tracks reviewState');
  assert(serverSource.includes('REVIEW_AVAILABLE'), 'Server has REVIEW_AVAILABLE state');
  assert(serverSource.includes('NOT_REQUIRED'), 'Server has NOT_REQUIRED state');
  assert(serverSource.includes('review_available'), 'Server emits review_available');
  
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  assert(appSource.includes('onReviewAvailable'), 'Frontend handles review_available');
  assert(appSource.includes('reviewPanel'), 'Frontend has review panel');
  assert(appSource.includes('reviewState'), 'Frontend tracks review state');
  assert(appSource.includes('REVIEW AVAILABLE'), 'Frontend shows REVIEW AVAILABLE');
}

// ============================================================
// P20-O: Approve state
// ============================================================
console.log('\n=== P20-O: Approve state ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('approve_changes'), 'Server handles approve_changes');
  assert(serverSource.includes('APPROVED'), 'Server has APPROVED state');
  assert(serverSource.includes('approval_changed'), 'Server emits approval_changed');
  
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  assert(appSource.includes('approveChanges'), 'Frontend has approveChanges');
  assert(appSource.includes('approve-btn'), 'Frontend has approve button');
  assert(appSource.includes('APPROVED'), 'Frontend shows APPROVED state');
  assert(appSource.includes('approval_changed'), 'Frontend handles approval_changed');
}

// ============================================================
// P20-P: Reject state
// ============================================================
console.log('\n=== P20-P: Reject state ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('reject_changes'), 'Server handles reject_changes');
  assert(serverSource.includes('REJECTED'), 'Server has REJECTED state');
  
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  assert(appSource.includes('rejectChanges'), 'Frontend has rejectChanges');
  assert(appSource.includes('reject-btn'), 'Frontend has reject button');
  assert(appSource.includes('REJECTED'), 'Frontend shows REJECTED state');
}

// ============================================================
// P20-Q: No automatic approval
// ============================================================
console.log('\n=== P20-Q: No automatic approval ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  // Server should NOT auto-approve
  const approveHandler = serverSource.substring(serverSource.indexOf('case "approve_changes"'));
  assert(approveHandler.includes('client.reviewState !== "REVIEW_AVAILABLE"'), 'Approve only works when review available');
  assert(approveHandler.includes('client.reviewState = "APPROVED"'), 'Approve sets state correctly');
  // No auto-approval logic should exist
  assert(!serverSource.includes('autoApprove') && !serverSource.includes('auto-approve'), 'No auto-approval logic');
}

// ============================================================
// P20-R: No automatic rollback
// ============================================================
console.log('\n=== P20-R: No automatic rollback ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  const rejectHandler = serverSource.substring(serverSource.indexOf('case "reject_changes"'));
  assert(rejectHandler.includes('client.reviewState = "REJECTED"'), 'Reject sets state correctly');
  // No rollback logic should exist
  assert(!rejectHandler.includes('rollback') && !rejectHandler.includes('revert'), 'No rollback logic in reject handler');
  assert(!rejectHandler.includes('delete') && !rejectHandler.includes('remove'), 'No file deletion in reject');
}

// ============================================================
// P20-S: Task isolation
// ============================================================
console.log('\n=== P20-S: Task isolation ===');
{
  setupFixture();
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'app.ts'), 'export const app = "test";\n');
  
  const workspace = new Workspace(FIXTURE_DIR);
  
  // Task 1 baseline
  const baseline1 = await captureWorkspaceBaseline(workspace, 'task-1');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'app.ts'), 'export const app = "task1";\n');
  const changes1 = await detectChanges(workspace, baseline1);
  assertEqual(changes1.length, 1, 'Task 1 detects 1 change');
  assertEqual(changes1[0].path, 'src/app.ts', 'Task 1 change is app.ts');
  
  // Task 2 baseline (after task 1 changes)
  const baseline2 = await captureWorkspaceBaseline(workspace, 'task-2');
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'utils.ts'), 'export const util = "task2";\n');
  const changes2 = await detectChanges(workspace, baseline2);
  assertEqual(changes2.length, 1, 'Task 2 detects 1 change');
  assertEqual(changes2[0].path, 'src/utils.ts', 'Task 2 change is utils.ts (not app.ts)');
  
  cleanupFixture();
}

// ============================================================
// P20-T: Diff refresh after additional edits
// ============================================================
console.log('\n=== P20-T: Diff refresh after additional edits ===');
{
  setupFixture();
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'app.ts'), 'line 1\nline 2\nline 3\n');
  
  const workspace = new Workspace(FIXTURE_DIR);
  const baseline = await captureWorkspaceBaseline(workspace, 'test-task-8');
  
  // First edit
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'app.ts'), 'line 1\nline 2 modified\nline 3\n');
  let changes = await detectChanges(workspace, baseline);
  const firstDiff = generateDiffForDisplay(changes[0].oldContent, changes[0].newContent, 'src/app.ts');
  assert(firstDiff.lines.some(l => l.content.includes('line 2 modified')), 'First diff shows first edit');
  assert(firstDiff.lines.some(l => l.content === 'line 2'), 'First diff shows removed line');
  
  // Second edit (simulating agent fixing again)
  fs.writeFileSync(path.join(FIXTURE_DIR, 'src', 'app.ts'), 'line 1\nline 2 fixed\nline 3\nline 4 added\n');
  changes = await detectChanges(workspace, baseline);
  const secondDiff = generateDiffForDisplay(changes[0].oldContent, changes[0].newContent, 'src/app.ts');
  assert(secondDiff.lines.some(l => l.content.includes('line 2 fixed')), 'Second diff shows final state');
  assert(secondDiff.lines.some(l => l.content === 'line 2'), 'Second diff shows original removed');
  assert(secondDiff.lines.some(l => l.content.includes('line 4 added')), 'Second diff shows new addition');
  // Should NOT show "line 2 modified" from intermediate state
  assert(!secondDiff.lines.some(l => l.content.includes('line 2 modified')), 'Diff does not show intermediate state');
  
  cleanupFixture();
}

// ============================================================
// P20-U: Final result data
// ============================================================
console.log('\n=== P20-U: Final result data ===');
{
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  assert(appSource.includes('renderFinalResult'), 'Frontend has renderFinalResult');
  assert(appSource.includes('Task Status'), 'Final result shows task status');
  assert(appSource.includes('Changed Files'), 'Final result shows changed files');
  assert(appSource.includes('Verification'), 'Final result shows verification');
  assert(appSource.includes('Review'), 'Final result shows review state');
  assert(appSource.includes('final-result-card'), 'Final result uses card layout');
}

// ============================================================
// P20-V: P17 workspace compatibility
// ============================================================
console.log('\n=== P20-V: P17 workspace compatibility ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('select_project'), 'Still has select_project');
  assert(serverSource.includes('list_directory'), 'Still has list_directory');
  assert(serverSource.includes('read_file'), 'Still has read_file');
  assert(serverSource.includes('run_task'), 'Still has run_task');
  assert(serverSource.includes('stop_task'), 'Still has stop_task');
  assert(serverSource.includes('detectChanges'), 'Still detects changed files from baseline');
  
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  assert(appSource.includes('selectProject'), 'Frontend has project selection');
  assert(appSource.includes('renderFileTree'), 'Frontend has file tree');
  assert(appSource.includes('showFileContent'), 'Frontend has file viewer');
  assert(appSource.includes('activityLog'), 'Frontend has activity log');
  assert(appSource.includes('terminalOutput'), 'Frontend has terminal');
  assert(appSource.includes('taskHistory'), 'Frontend has task history');
}

// ============================================================
// P20-W: P18 compatibility
// ============================================================
console.log('\n=== P20-W: P18 compatibility ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  // P18 app-building should still work
  assert(serverSource.includes('spawn'), 'Still spawns agent process');
  assert(serverSource.includes('dist/cli.js'), 'Still uses CLI agent');
  
  const agentSource = fs.readFileSync('src/agent.ts', 'utf8');
  assert(agentSource.includes('initializePlan'), 'Agent still has planning');
  assert(agentSource.includes('isAppBuildingTask'), 'Agent still detects app tasks');
  assert(agentSource.includes('start_app'), 'Agent still has app lifecycle');
}

// ============================================================
// P20-X: P19 compatibility
// ============================================================
console.log('\n=== P20-X: P19 compatibility ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('browserStatus'), 'Tracks browser status for P19');
  
  const agentSource = fs.readFileSync('src/agent.ts', 'utf8');
  assert(agentSource.includes('browser_verify'), 'Agent still has browser verification');
  assert(agentSource.includes('browserVerificationPassed'), 'Agent tracks browser verification');
  assert(agentSource.includes('appProcess'), 'Agent tracks app process');
  assert(agentSource.includes('start_app'), 'Agent has start_app');
  assert(agentSource.includes('open_browser'), 'Agent has open_browser');
  assert(agentSource.includes('close_browser'), 'Agent has close_browser');
  assert(agentSource.includes('stop_app'), 'Agent has stop_app');
}

// ============================================================
// P20-Y: No chain-of-thought exposure
// ============================================================
console.log('\n=== P20-Y: No chain-of-thought exposure ===');
{
  const appSource = fs.readFileSync('public/app.js', 'utf8');
  // Should not expose reasoning/thinking/internal model state
  assert(!appSource.includes('chainOfThought') && !appSource.includes('reasoning'), 'No chain of thought exposure');
  assert(!appSource.includes('thinking') && !appSource.includes('internal'), 'No internal state exposure');
  assert(!appSource.includes('model.') && !appSource.includes('llm.'), 'No model internals exposure');
  
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(!serverSource.includes('chainOfThought') && !serverSource.includes('reasoning'), 'Server no chain of thought');
}

// ============================================================
// P20-Z: Safety guard preservation
// ============================================================
console.log('\n=== P20-Z: Safety guard preservation ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('new Workspace'), 'Uses Workspace for path validation');
  
  // Command guard
  const { validateCommand } = await import('./dist/utils/command-guard.js');
  assertEqual(validateCommand('setx VAR value').allowed, false, 'Blocks setx');
  assertEqual(validateCommand('npm run build').allowed, true, 'Allows npm run build');
  
  // Protected files
  const { isProtectedFile } = await import('./dist/utils/command-guard.js');
  assertEqual(isProtectedFile('tsconfig.json'), true, 'Protects tsconfig.json');
  assertEqual(isProtectedFile('package.json'), true, 'Protects package.json');
  assertEqual(isProtectedFile('.env'), true, 'Protects .env');
  assertEqual(isProtectedFile('src/App.tsx'), false, 'Allows source files');
  
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
// Summary
// ============================================================
console.log(`\n=== P20 Deterministic Tests: ${passed} passed, ${failed} failed ===`);

if (failed > 0) {
  process.exit(1);
}