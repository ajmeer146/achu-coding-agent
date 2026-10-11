// Real-world P20 validation test
// Runs the actual NVIDIA agent against the existing-react-app fixture

import WebSocket from 'ws';

const FIXTURE_PATH = 'C:\\Users\\Achu146\\achu-p18-test\\existing-react-app';
const WS_URL = 'ws://localhost:3002';

const TASK = 'Add an About section to the existing application. Build the project and verify it. Then show me the changed files for review.';

let ws = null;
let taskId = null;
let reviewState = 'NOT_REQUIRED';
let changedFiles = [];
let verificationStatus = 'NOT_REQUESTED';
let buildStatus = 'NOT_RUN';
let browserStatus = 'NOT_RUN';
let finalOutput = '';
let waitHandlers = {};

function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);
    ws.on('open', () => {
      console.log('Connected to workspace server');
      resolve();
    });
    ws.on('error', reject);
    ws.on('close', () => console.log('Disconnected'));
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(msg);
      } catch (e) {
        console.error('Parse error:', e);
      }
    });
  });
}

function send(type, payload = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

function handleMessage(msg) {
  const { type, ...data } = msg;
  
  // Check for waiting handlers
  if (waitHandlers[type]) {
    clearTimeout(waitHandlers[type].timer);
    waitHandlers[type].resolve(data);
    delete waitHandlers[type];
  }
  
  switch (type) {
    case 'connected':
      console.log('[SERVER]', data.message);
      break;
    case 'project_selected':
      console.log('[PROJECT_SELECTED]', data.path);
      break;
    case 'task_started':
      taskId = data.taskId;
      console.log('[TASK_STARTED]', data.taskId, data.task);
      break;
    case 'task_status':
      console.log('[TASK_STATUS]', data.status);
      break;
    case 'agent_output':
      if (data.stream === 'stderr') {
        process.stderr.write(data.content);
      } else if (data.content.includes('Successfully') || data.content.includes('VERIFICATION') || data.content.includes('Build') || data.content.includes('Browser')) {
        process.stdout.write(data.content);
      }
      finalOutput += data.content;
      break;
    case 'review_available':
      reviewState = 'REVIEW_AVAILABLE';
      changedFiles = data.changedFiles;
      console.log('\n[REVIEW_AVAILABLE]');
      console.log('  Changed files:', changedFiles.map(f => `${f.changeType} ${f.path}`).join(', '));
      break;
    case 'verification_status':
      verificationStatus = data.verification;
      buildStatus = data.build;
      browserStatus = data.browser;
      console.log('[VERIFICATION_STATUS]', { verification: verificationStatus, build: buildStatus, browser: browserStatus });
      break;
    case 'diff_result':
      if (data.error) {
        console.log('[DIFF_ERROR]', data.path, data.error);
      } else if (data.isBinary) {
        console.log('[DIFF_BINARY]', data.path, data.message);
      } else {
        console.log('[DIFF_RESULT]', data.path, data.changeType, `${data.diff.length} lines`);
      }
      break;
    case 'approval_changed':
      reviewState = data.state;
      console.log('[APPROVAL_CHANGED]', data.state);
      break;
    case 'task_completed':
      console.log('\n[TASK_COMPLETED]');
      console.log('  Output length:', data.output.length);
      break;
    case 'task_failed':
      console.log('\n[TASK_FAILED]', data.error);
      console.log('  Output:', data.output.substring(0, 500));
      break;
    case 'error':
      console.log('[ERROR]', data.message);
      break;
    default:
      console.log('[UNKNOWN]', type, data);
  }
}

function waitForEvent(eventType, timeout) {
  return new Promise((resolve) => {
    waitHandlers[eventType] = { 
      resolve, 
      timer: setTimeout(() => {
        delete waitHandlers[eventType];
        resolve(null);
      }, timeout) 
    };
  });
}

async function runTest() {
  console.log('=== P20 REAL-WORLD VALIDATION ===\n');
  
  try {
    await connect();
    
    console.log('\n1. Selecting project...');
    send('select_project', { path: FIXTURE_PATH });
    const projectResult = await waitForEvent('project_selected', 10000);
    if (!projectResult) {
      console.log('FAIL: Project selection timeout');
      return false;
    }
    
    console.log('\n2. Running task...');
    send('run_task', { task: TASK });
    console.log('   Waiting for task completion (this may take 2-3 minutes)...');
    const completed = await waitForEvent('task_completed', 180000);
    
    if (!completed) {
      const failed = await waitForEvent('task_failed', 5000);
      if (failed) {
        console.log('TASK FAILED');
        return false;
      }
      console.log('TASK TIMEOUT');
      return false;
    }
    
    // 4. Verify results
    console.log('\n3. Verifying results...');
    
    const checks = {
      'Agent modified files': changedFiles.length > 0,
      'Build/verification ran': buildStatus !== 'NOT_RUN' || verificationStatus !== 'NOT_REQUESTED',
      'Changed files detected': changedFiles.length > 0,
      'Review state available': reviewState === 'REVIEW_AVAILABLE',
      'No auto-approval': reviewState !== 'APPROVED',
    };
    
    let allPassed = true;
    for (const [check, passed] of Object.entries(checks)) {
      const status = passed ? 'PASS' : 'FAIL';
      console.log(`  ${status}: ${check}`);
      if (!passed) allPassed = false;
    }
    
    if (allPassed) {
      // Test diff viewer
      console.log('\n4. Testing diff viewer...');
      for (const file of changedFiles) {
        send('get_diff', { path: file.path });
        const diffResult = await waitForEvent('diff_result', 5000);
        if (!diffResult || diffResult.error) {
          console.log(`  FAIL: Diff for ${file.path} failed`);
          allPassed = false;
        }
      }
      console.log('  PASS: Diff viewer works');
      
      // Test APPROVE
      console.log('\n5. Testing APPROVE...');
      send('approve_changes', {});
      const approveResult = await waitForEvent('approval_changed', 5000);
      if (reviewState === 'APPROVED') {
        console.log('  PASS: Approve works, state = APPROVED');
      } else {
        console.log('  FAIL: Approve did not work, state =', reviewState);
        allPassed = false;
      }
    }
    
    return allPassed;
    
  } catch (err) {
    console.error('TEST ERROR:', err);
    return false;
  } finally {
    if (ws) ws.close();
  }
}

runTest().then(result => {
  console.log('\n=== RESULT:', result ? 'PASS' : 'FAIL', '===');
  process.exit(result ? 0 : 1);
}).catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});