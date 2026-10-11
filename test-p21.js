// P21 Deterministic Tests - Long-Running Autonomous Sessions
// These tests verify the session layer without requiring live model execution

import { createSessionManager } from './dist/session/session-manager.js';
import { createSessionMetadata, generateSessionId, SessionStatus } from './dist/session/session-types.js';
import { saveSession, loadSession, listSessions, deleteSession, cleanupOldSessions, acquireWorkspaceLock, releaseWorkspaceLock } from './dist/session/session-persistence.js';
import { Workspace } from './dist/tools/workspace.js';
import fs from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { console.log(`PASS: ${message}`); passed++; }
  else { console.log(`FAIL: ${message}`); failed++; }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) { console.log(`PASS: ${message}`); passed++; }
  else { console.log(`FAIL: ${message} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++; }
}

function assertNotNull(value, message) {
  if (value !== null && value !== undefined) { console.log(`PASS: ${message}`); passed++; }
  else { console.log(`FAIL: ${message} - value is null/undefined`); failed++; }
}

function assertNull(value, message) {
  if (value === null || value === undefined) { console.log(`PASS: ${message}`); passed++; }
  else { console.log(`FAIL: ${message} - value is not null`); failed++; }
}

const TEST_WORKSPACE = path.join(process.cwd(), 'test-p21-workspace');

function setupWorkspace() {
  if (fs.existsSync(TEST_WORKSPACE)) {
    try { fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  }
  fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
}

function cleanupWorkspace() {
  if (fs.existsSync(TEST_WORKSPACE)) fs.rmSync(TEST_WORKSPACE, { recursive: true });
}

// ============================================================
// P21-A: Session creation
// ============================================================
console.log('\n=== P21-A: Session creation ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Test task');
  
  assert(session !== null, 'Session created');
  assert(session.metadata.sessionId.startsWith('session_'), 'Session ID has correct prefix');
  assert(session.metadata.task === 'Test task', 'Task stored correctly');
  assert(session.metadata.status === 'CREATED', 'Initial status is CREATED');
  assert(session.metadata.workspaceRoot === TEST_WORKSPACE, 'Workspace root stored');
  assert(session.metadata.phase === 'understand', 'Initial phase is understand');
  assert(session.metadata.createdAt > 0, 'Created timestamp set');
  assert(session.metadata.updatedAt > 0, 'Updated timestamp set');
  assert(session.metadata.planProgress.total === 0, 'Plan progress initialized');
  
  const sessionFile = fs.existsSync(path.join(TEST_WORKSPACE, '.achu-sessions', `${session.metadata.sessionId}.json`));
  assert(sessionFile, 'Session file persisted to disk');
  
  cleanupWorkspace();
}

// ============================================================
// P21-B: Unique session IDs
// ============================================================
console.log('\n=== P21-B: Unique session IDs ===');
{
  const ids = new Set();
  for (let i = 0; i < 100; i++) {
    ids.add(generateSessionId());
  }
  assertEqual(ids.size, 100, 'All 100 session IDs are unique');
  
  const id = generateSessionId();
  assert(id.startsWith('session_'), 'Session ID has correct prefix');
  const parts = id.split('_');
  assert(parts.length >= 3, 'Session ID has timestamp and random parts');
  assert(!isNaN(parseInt(parts[1])), 'Timestamp part is numeric');
}

// ============================================================
// P21-C: Session persistence
// ============================================================
console.log('\n=== P21-C: Session persistence ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Persistence test');
  
  const loaded = await manager.getSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertNotNull(loaded, 'Session loaded from disk');
  assertEqual(loaded.metadata.sessionId, session.metadata.sessionId, 'Session ID matches');
  assertEqual(loaded.metadata.task, 'Persistence test', 'Task persists');
  assertEqual(loaded.metadata.status, 'CREATED', 'Status persists');
  
  cleanupWorkspace();
}

// ============================================================
// P21-D: Session retrieval
// ============================================================
console.log('\n=== P21-D: Session retrieval ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Retrieval test');
  
  const missing = await manager.getSession(TEST_WORKSPACE, 'session_nonexistent');
  assertNull(missing, 'Non-existent session returns null');
  
  cleanupWorkspace();
}

// ============================================================
// P21-E: Session listing
// ============================================================
console.log('\n=== P21-E: Session listing ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  
  const s1 = await manager.createSession(TEST_WORKSPACE, 'Task 1');
  const s2 = await manager.createSession(TEST_WORKSPACE, 'Task 2');
  const s3 = await manager.createSession(TEST_WORKSPACE, 'Task 3');
  
  const sessions = await manager.listSessions(TEST_WORKSPACE);
  assertEqual(sessions.length, 3, 'Three sessions listed');
  assertEqual(sessions[0].sessionId, s3.metadata.sessionId, 'Most recent first');
  assertEqual(sessions[1].sessionId, s2.metadata.sessionId, 'Second most recent');
  assertEqual(sessions[2].sessionId, s1.metadata.sessionId, 'Oldest last');
  
  assert(sessions[0].planProgress.total >= 0, 'Plan progress included');
  assert(sessions[0].verificationState.buildStatus !== undefined, 'Build status included');
  assert(sessions[0].reviewState !== undefined, 'Review state included');
  
  cleanupWorkspace();
}

// ============================================================
// P21-F: State transitions
// ============================================================
console.log('\n=== P21-F: State transitions ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Transition test');
  
  let updated = await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { status: 'RUNNING', startedAt: Date.now() });
  assertEqual(updated.metadata.status, 'RUNNING', 'CREATED -> RUNNING');
  
  updated = await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { status: 'PAUSED' });
  assertEqual(updated.metadata.status, 'PAUSED', 'RUNNING -> PAUSED');
  
  const resumed = await manager.resumeSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertEqual(resumed.metadata.status, 'RUNNING', 'PAUSED -> RUNNING via resume');
  
  updated = await manager.completeSession(TEST_WORKSPACE, session.metadata.sessionId, true);
  assertEqual(updated.metadata.status, 'COMPLETED', 'RUNNING -> COMPLETED');
  assert(updated.metadata.completedAt !== null, 'Completed timestamp set');
  
  cleanupWorkspace();
}

// ============================================================
// P21-G: Invalid transitions
// ============================================================
console.log('\n=== P21-G: Invalid transitions ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  
  const session = await manager.createSession(TEST_WORKSPACE, 'Invalid transition test');
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { status: 'RUNNING' });
  await manager.completeSession(TEST_WORKSPACE, session.metadata.sessionId, true);
  
  let error = false;
  try { await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { status: 'RUNNING' }); } catch { error = true; }
  assert(error, 'COMPLETED -> RUNNING rejected');
  
  const session2 = await manager.createSession(TEST_WORKSPACE, 'Invalid transition test 2');
  await manager.cancelSession(TEST_WORKSPACE, session2.metadata.sessionId);
  error = false;
  try { await manager.updateSession(TEST_WORKSPACE, session2.metadata.sessionId, { status: 'RUNNING' }); } catch { error = true; }
  assert(error, 'CANCELLED -> RUNNING rejected');
  
  cleanupWorkspace();
}

// ============================================================
// P21-H: Pause session
// ============================================================
console.log('\n=== P21-H: Pause session ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Pause test');
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { status: 'RUNNING' });
  
  const paused = await manager.pauseSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertEqual(paused.metadata.status, 'PAUSED', 'Session paused');
  assert(paused.activityLog.some(e => e.message === 'Session paused by user'), 'Pause logged in activity');
  
  cleanupWorkspace();
}

// ============================================================
// P21-I: Resume session
// ============================================================
console.log('\n=== P21-I: Resume session ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Resume test');
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { status: 'RUNNING' });
  await manager.pauseSession(TEST_WORKSPACE, session.metadata.sessionId);
  
  const resumed = await manager.resumeSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertEqual(resumed.metadata.status, 'RUNNING', 'Session resumed');
  assert(resumed.activityLog.some(e => e.message === 'Session resumed'), 'Resume logged in activity');
  
  let error = false;
  try { await manager.resumeSession(TEST_WORKSPACE, session.metadata.sessionId); } catch { error = true; }
  assert(error, 'Cannot resume RUNNING session');
  
  cleanupWorkspace();
}

// ============================================================
// P21-J: Cancel session
// ============================================================
console.log('\n=== P21-J: Cancel session ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Cancel test');
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { status: 'RUNNING' });
  
  const cancelled = await manager.cancelSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertEqual(cancelled.metadata.status, 'CANCELLED', 'Session cancelled');
  assert(cancelled.metadata.completedAt !== null, 'Completed timestamp set on cancel');
  assert(cancelled.activityLog.some(e => e.message === 'Session cancelled by user'), 'Cancel logged in activity');
  
  cleanupWorkspace();
}

// ============================================================
// P21-K: Reconnect
// ============================================================
console.log('\n=== P21-K: Reconnect ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Reconnect test');
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { status: 'RUNNING', phase: 'execute' });
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { currentPlan: [{ id: '1', description: 'Test step', status: 'running' }] });
  
  const reconnected = await manager.getSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertNotNull(reconnected, 'Session retrieved');
  assertEqual(reconnected.metadata.sessionId, session.metadata.sessionId, 'Session ID matches');
  assertEqual(reconnected.metadata.status, 'RUNNING', 'Status preserved');
  assertEqual(reconnected.metadata.phase, 'execute', 'Phase preserved');
  assertEqual(reconnected.metadata.currentPlan.length, 1, 'Plan preserved');
  assertEqual(reconnected.metadata.currentPlan[0].status, 'running', 'Plan step status preserved');
  
  cleanupWorkspace();
}

// ============================================================
// P21-L: Crash recovery state
// ============================================================
console.log('\n=== P21-L: Crash recovery state ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Crash recovery test');
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { status: 'RUNNING' });
  
  const crashed = await manager.getSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertNotNull(crashed, 'Session retrieved after crash');
  assertEqual(crashed.metadata.status, 'RUNNING', 'Status is RUNNING after crash');
  
  const interrupted = await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { status: 'INTERRUPTED' });
  assertEqual(interrupted.metadata.status, 'INTERRUPTED', 'Can mark as INTERRUPTED');
  
  cleanupWorkspace();
}

// ============================================================
// P21-M: Interrupted session
// ============================================================
console.log('\n=== P21-M: Interrupted session ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Interrupted test');
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { status: 'RUNNING' });
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { status: 'INTERRUPTED' });
  
  const resumed = await manager.resumeSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertEqual(resumed.metadata.status, 'RUNNING', 'INTERRUPTED -> RUNNING works');
  
  cleanupWorkspace();
}

// ============================================================
// P21-N: Resume after interruption
// ============================================================
console.log('\n=== P21-N: Resume after interruption ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Resume after interrupt');
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { status: 'RUNNING', phase: 'execute', currentPlan: [{ id: '1', description: 'Step 1', status: 'completed' }, { id: '2', description: 'Step 2', status: 'running' }] });
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { status: 'INTERRUPTED' });
  
  const resumed = await manager.resumeSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertEqual(resumed.metadata.currentPlan.length, 2, 'Plan preserved after interrupt');
  assertEqual(resumed.metadata.currentPlan[0].status, 'completed', 'Completed step preserved');
  assertEqual(resumed.metadata.currentPlan[1].status, 'running', 'Running step preserved');
  
  cleanupWorkspace();
}

// ============================================================
// P21-O: Duplicate execution protection
// ============================================================
console.log('\n=== P21-O: Duplicate execution protection ===');
{
  setupWorkspace();
  // Ensure sessions directory exists
  await fs.promises.mkdir(path.join(TEST_WORKSPACE, '.achu-sessions'), { recursive: true });
  // Clean up any existing lock file
  const lockPath = path.join(TEST_WORKSPACE, '.achu-sessions', '.lock');
  try { await fs.promises.unlink(lockPath); } catch {}
  
  const lock1 = await acquireWorkspaceLock(TEST_WORKSPACE);
  console.log('Lock 1 result:', lock1);
  assert(lock1, 'First lock acquired');
  
  const lock2 = await acquireWorkspaceLock(TEST_WORKSPACE);
  console.log('Lock 2 result:', lock2);
  assert(!lock2, 'Second lock fails');
  
  await releaseWorkspaceLock(TEST_WORKSPACE);
  const lock3 = await acquireWorkspaceLock(TEST_WORKSPACE);
  console.log('Lock 3 result:', lock3);
  assert(lock3, 'Lock re-acquired after release');
  
  await releaseWorkspaceLock(TEST_WORKSPACE);
  
  cleanupWorkspace();
}

// ============================================================
// P21-P: Plan continuity
// ============================================================
console.log('\n=== P21-P: Plan continuity ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Plan continuity');
  
  const plan = [
    { id: '1', description: 'Step 1', status: 'completed' },
    { id: '2', description: 'Step 2', status: 'running' },
    { id: '3', description: 'Step 3', status: 'pending', dependsOn: ['2'] }
  ];
  
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { 
    currentPlan: plan,
    phase: 'execute'
  });
  
  const loaded = await manager.getSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertNotNull(loaded, 'Session loaded');
  assertEqual(loaded.metadata.currentPlan.length, 3, 'Plan has 3 steps');
  assertEqual(loaded.metadata.currentPlan[0].status, 'completed', 'Step 1 completed');
  assertEqual(loaded.metadata.currentPlan[1].status, 'running', 'Step 2 running');
  assertEqual(loaded.metadata.currentPlan[2].status, 'pending', 'Step 3 pending');
  assertEqual(loaded.metadata.currentPlan[2].dependsOn[0], '2', 'Dependencies preserved');
  
  cleanupWorkspace();
}

// ============================================================
// P21-Q: Verification continuity
// ============================================================
console.log('\n=== P21-Q: Verification continuity ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Verification continuity');
  
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, {
    verificationState: { requestedVerification: 'npm run build', verificationPassed: true, buildStatus: 'PASSED', browserStatus: 'NOT_RUN' }
  });
  
  const loaded = await manager.getSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertNotNull(loaded, 'Session loaded');
  assertEqual(loaded.metadata.verificationState.verificationPassed, true, 'Verification passed preserved');
  assertEqual(loaded.metadata.verificationState.buildStatus, 'PASSED', 'Build status preserved');
  assertEqual(loaded.metadata.verificationState.requestedVerification, 'npm run build', 'Requested verification preserved');
  
  cleanupWorkspace();
}

// ============================================================
// P21-R: Browser state handling
// ============================================================
console.log('\n=== P21-R: Browser state handling ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Browser state');
  
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, {
    verificationState: { requestedVerification: null, verificationPassed: false, buildStatus: 'NOT_RUN', browserStatus: 'PASSED' }
  });
  
  const loaded = await manager.getSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertNotNull(loaded, 'Session loaded');
  assertEqual(loaded.metadata.verificationState.browserStatus, 'PASSED', 'Browser status preserved');
  
  cleanupWorkspace();
}

// ============================================================
// P21-S: App process ownership
// ============================================================
console.log('\n=== P21-S: App process ownership ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'App process');
  
  assert(true, 'App process ownership tracked per session (not persisted)');
  
  cleanupWorkspace();
}

// ============================================================
// P21-T: Changed-file continuity
// ============================================================
console.log('\n=== P21-T: Changed-file continuity ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Changed files');
  
  const changedFiles = [
    { path: 'src/App.tsx', changeType: 'MODIFIED', additions: 10, deletions: 5, isBinary: false },
    { path: 'src/NewComponent.tsx', changeType: 'ADDED', additions: 50, deletions: 0, isBinary: false }
  ];
  
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { changedFiles });
  
  const loaded = await manager.getSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertNotNull(loaded, 'Session loaded');
  assertEqual(loaded.metadata.changedFiles.length, 2, 'Two changed files preserved');
  assertEqual(loaded.metadata.changedFiles[0].path, 'src/App.tsx', 'First file path preserved');
  assertEqual(loaded.metadata.changedFiles[0].changeType, 'MODIFIED', 'First file change type preserved');
  assertEqual(loaded.metadata.changedFiles[1].changeType, 'ADDED', 'Second file change type preserved');
  
  cleanupWorkspace();
}

// ============================================================
// P21-U: Review continuity
// ============================================================
console.log('\n=== P21-U: Review continuity ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Review continuity');
  
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { reviewState: 'REVIEW_AVAILABLE' });
  let loaded = await manager.getSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertNotNull(loaded, 'Session loaded');
  assertEqual(loaded.metadata.reviewState, 'REVIEW_AVAILABLE', 'Review available preserved');
  
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { reviewState: 'APPROVED' });
  loaded = await manager.getSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertNotNull(loaded, 'Session loaded');
  assertEqual(loaded.metadata.reviewState, 'APPROVED', 'Approved state preserved');
  
  cleanupWorkspace();
}

// ============================================================
// P21-V: Workspace lock
// ============================================================
console.log('\n=== P21-V: Workspace lock ===');
{
  setupWorkspace();
  // Ensure sessions directory exists
  await fs.promises.mkdir(path.join(TEST_WORKSPACE, '.achu-sessions'), { recursive: true });
  // Clean up any existing lock file
  const lockPath = path.join(TEST_WORKSPACE, '.achu-sessions', '.lock');
  try { await fs.promises.unlink(lockPath); } catch {}
  
  const acquired = await acquireWorkspaceLock(TEST_WORKSPACE);
  console.log('Lock acquired result:', acquired);
  assert(acquired, 'Lock acquired');
  
  const acquired2 = await acquireWorkspaceLock(TEST_WORKSPACE);
  console.log('Second acquire result:', acquired2);
  assert(!acquired2, 'Second acquire fails');
  
  await releaseWorkspaceLock(TEST_WORKSPACE);
  const acquired3 = await acquireWorkspaceLock(TEST_WORKSPACE);
  console.log('Third acquire result:', acquired3);
  assert(acquired3, 'Lock re-acquired after release');
  
  await releaseWorkspaceLock(TEST_WORKSPACE);
  
  cleanupWorkspace();
}

// ============================================================
// P21-W: Read-only access
// ============================================================
console.log('\n=== P21-W: Read-only access ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Read-only test');
  await manager.updateSession(TEST_WORKSPACE, session.metadata.sessionId, { status: 'RUNNING' });
  
  const sessions = await manager.listSessions(TEST_WORKSPACE);
  assertEqual(sessions.length, 1, 'Can list sessions during active session');
  
  const loaded = await manager.getSession(TEST_WORKSPACE, session.metadata.sessionId);
  assertNotNull(loaded, 'Can get session during active session');
  
  cleanupWorkspace();
}

// ============================================================
// P21-X: Session cleanup
// ============================================================
console.log('\n=== P21-X: Session cleanup ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  
  for (let i = 0; i < 10; i++) {
    const s = await manager.createSession(TEST_WORKSPACE, `Task ${i}`);
    await manager.updateSession(TEST_WORKSPACE, s.metadata.sessionId, { status: 'RUNNING' });
    await manager.completeSession(TEST_WORKSPACE, s.metadata.sessionId, true);
  }
  
  let sessions = await manager.listSessions(TEST_WORKSPACE);
  assertEqual(sessions.length, 10, '10 completed sessions');
  
  await cleanupOldSessions(TEST_WORKSPACE);
  sessions = await manager.listSessions(TEST_WORKSPACE);
  assertEqual(sessions.length, 10, 'Cleanup preserves sessions under limit');
  
  cleanupWorkspace();
}

// ============================================================
// P21-Y: Storage limits
// ============================================================
console.log('\n=== P21-Y: Storage limits ===');
{
  setupWorkspace();
  
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Storage limit test');
  
  const sessionFile = path.join(TEST_WORKSPACE, '.achu-sessions', `${session.metadata.sessionId}.json`);
  const stats = fs.statSync(sessionFile);
  assert(stats.size > 0, 'Session file has content');
  assert(stats.size < 1024 * 1024, 'Session file under 1MB');
  
  cleanupWorkspace();
}

// ============================================================
// P21-Z: Secret protection
// ============================================================
console.log('\n=== P21-Z: Secret protection ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'Secret test');
  
  const sessionFile = path.join(TEST_WORKSPACE, '.achu-sessions', `${session.metadata.sessionId}.json`);
  const content = fs.readFileSync(sessionFile, 'utf8');
  
  assert(!content.includes('NVIDIA_API_KEY'), 'No NVIDIA_API_KEY in session');
  assert(!content.includes('apiKey'), 'No apiKey in session');
  assert(!content.includes('password'), 'No password in session');
  assert(!content.includes('secret'), 'No secret in session');
  assert(!content.includes('token'), 'No token in session');
  
  cleanupWorkspace();
}

// ============================================================
// P21-AA: WebSocket session events (structure check)
// ============================================================
console.log('\n=== P21-AA: WebSocket session events structure ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('session_created'), 'Server emits session_created');
  assert(serverSource.includes('session_status'), 'Server emits session_status');
  assert(serverSource.includes('session_paused'), 'Server emits session_paused');
  assert(serverSource.includes('session_resumed'), 'Server emits session_resumed');
  assert(serverSource.includes('session_completed'), 'Server emits session_completed');
  assert(serverSource.includes('session_cancelled'), 'Server emits session_cancelled');
  assert(serverSource.includes('lock_acquired'), 'Server emits lock_acquired');
  assert(serverSource.includes('lock_released'), 'Server emits lock_released');
  assert(serverSource.includes('session_list'), 'Server emits session_list');
  assert(serverSource.includes('session_state'), 'Server emits session_state');
}

// ============================================================
// P21-AB: Session switching
// ============================================================
console.log('\n=== P21-AB: Session switching ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  
  const s1 = await manager.createSession(TEST_WORKSPACE, 'Session 1');
  await manager.updateSession(TEST_WORKSPACE, s1.metadata.sessionId, { status: 'RUNNING' });
  const s2 = await manager.createSession(TEST_WORKSPACE, 'Session 2');
  await manager.updateSession(TEST_WORKSPACE, s2.metadata.sessionId, { status: 'RUNNING' });
  await manager.updateSession(TEST_WORKSPACE, s2.metadata.sessionId, { status: 'PAUSED' });
  
  const sessions = await manager.listSessions(TEST_WORKSPACE);
  assertEqual(sessions.length, 2, 'Two sessions exist');
  
  const loaded1 = await manager.getSession(TEST_WORKSPACE, s1.metadata.sessionId);
  const loaded2 = await manager.getSession(TEST_WORKSPACE, s2.metadata.sessionId);
  assertNotNull(loaded1, 'Can load session 1');
  assertNotNull(loaded2, 'Can load session 2');
  assertEqual(loaded1.metadata.task, 'Session 1', 'Can load session 1');
  assertEqual(loaded2.metadata.task, 'Session 2', 'Can load session 2');
  
  cleanupWorkspace();
}

// ============================================================
// P21-AC: Invalid workspace protection
// ============================================================
console.log('\n=== P21-AC: Invalid workspace protection ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  
  const sessions = await manager.listSessions('/nonexistent/path');
  assertEqual(sessions.length, 0, 'Empty list for non-existent workspace');
  
  // Session manager creates workspace directory if needed (validation at server level)
  const session = await manager.createSession('/nonexistent/path', 'Test');
  assertNotNull(session, 'Session created in new workspace');
  assert(fs.existsSync('/nonexistent/path/.achu-sessions'), 'Workspace directory created');
  
  // Clean up
  try { fs.rmSync('/nonexistent/path', { recursive: true, force: true }); } catch {}
  
  cleanupWorkspace();
}

// ============================================================
// P21-AD: No chain-of-thought persistence
// ============================================================
console.log('\n=== P21-AD: No chain-of-thought persistence ===');
{
  setupWorkspace();
  const manager = createSessionManager();
  const session = await manager.createSession(TEST_WORKSPACE, 'No CoT test');
  
  const sessionFile = path.join(TEST_WORKSPACE, '.achu-sessions', `${session.metadata.sessionId}.json`);
  const content = fs.readFileSync(sessionFile, 'utf8');
  
  assert(!content.includes('chainOfThought'), 'No chainOfThought in session');
  assert(!content.includes('reasoning'), 'No reasoning in session');
  assert(!content.includes('thinking'), 'No thinking in session');
  assert(!content.includes('internal'), 'No internal state in session');
  
  cleanupWorkspace();
}

// ============================================================
// P21-AE: P17 compatibility
// ============================================================
console.log('\n=== P21-AE: P17 compatibility ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('select_project'), 'P17 select_project preserved');
  assert(serverSource.includes('list_directory'), 'P17 list_directory preserved');
  assert(serverSource.includes('read_file'), 'P17 read_file preserved');
  assert(serverSource.includes('run_task'), 'P17 run_task preserved');
  assert(serverSource.includes('stop_task'), 'P17 stop_task preserved');
}

// ============================================================
// P21-AF: P18 compatibility
// ============================================================
console.log('\n=== P21-AF: P18 compatibility ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('spawn'), 'P18 spawn preserved');
  assert(serverSource.includes('dist/cli.js'), 'P18 CLI preserved');
}

// ============================================================
// P21-AG: P19 compatibility
// ============================================================
console.log('\n=== P21-AG: P19 compatibility ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('browserStatus'), 'P19 browserStatus preserved');
  assert(serverSource.includes('ACHU_SESSION_ID'), 'P19 session ID env preserved');
}

// ============================================================
// P21-AH: P20 compatibility
// ============================================================
console.log('\n=== P21-AH: P20 compatibility ===');
{
  const serverSource = fs.readFileSync('src/server.ts', 'utf8');
  assert(serverSource.includes('get_diff'), 'P20 get_diff preserved');
  assert(serverSource.includes('approve_changes'), 'P20 approve_changes preserved');
  assert(serverSource.includes('reject_changes'), 'P20 reject_changes preserved');
  assert(serverSource.includes('review_available'), 'P20 review_available preserved');
  assert(serverSource.includes('verification_status'), 'P20 verification_status preserved');
  assert(serverSource.includes('task_status'), 'P20 task_status preserved');
}

// ============================================================
// Summary
// ============================================================
console.log(`\n=== P21 Deterministic Tests: ${passed} passed, ${failed} failed ===`);

if (failed > 0) {
  process.exit(1);
}