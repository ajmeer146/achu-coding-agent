const WebSocket = require('ws');

const WS_URL = 'ws://localhost:3001';
const TASK = `Create a simple web app here.
1. Create a package.json with a 'start' script: "npx serve -p 3000 ."
2. Create an index.html that shows the text "End-to-End Acceptance Test". It must also contain a script tag that throws a console error: console.error('Intentional Bug');
3. Start the application and verify it in the browser.
4. IMPORTANT: If you detect a console error during verification, you MUST edit index.html to remove the error, and then run browser verification again until it passes with no errors.
Do not finish the task until browser verification is completely clean.`;

function waitForEvent(ws, eventTypes, timeout = 600000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${eventTypes.join(' or ')}`));
    }, timeout);
    
    function listener(data) {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'agent_output') {
          process.stdout.write(msg.content || '');
        } else if (msg.type === 'task_status' || msg.type === 'session_status') {
          console.log(`\n[Status] ${msg.type}: ${msg.status || ''}`);
        } else if (msg.type === 'app_url') {
          console.log(`\n[AppURL] ${msg.url}`);
        } else if (msg.type === 'verification_status') {
          console.log(`\n[Verification] ${JSON.stringify(msg)}`);
        } else if (msg.type === 'review_available') {
          console.log(`\n[Review] Changed files: ${msg.changedFiles?.length}`);
        }
        
        if (eventTypes.includes(msg.type)) {
          clearTimeout(timer);
          ws.removeListener('message', listener);
          resolve(msg);
        }
      } catch (e) {
        // ignore parse errors
      }
    }
    
    ws.on('message', listener);
  });
}

async function runTest() {
  console.log('=== Starting E2E Acceptance Test ===');
  const ws = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS connect timeout')), 10000);
  });
  console.log('WebSocket connected');

  // Select project
  const workspacePath = require('path').resolve(__dirname, 'test-workspace-e2e');
  ws.send(JSON.stringify({ type: 'select_project', payload: { path: workspacePath } }));
  const projMsg = await waitForEvent(ws, ['project_selected', 'error']);
  if (projMsg.type === 'error') throw new Error(projMsg.message);
  console.log('Project selected:', workspacePath);

  // Run task
  ws.send(JSON.stringify({ type: 'run_task', payload: { task: TASK } }));
  console.log('Task sent, waiting for completion (up to 10 minutes)...');
  
  const result = await waitForEvent(ws, ['task_completed', 'task_failed']);
  if (result.type === 'task_failed') {
    throw new Error(`Task failed: ${result.error || JSON.stringify(result)}`);
  }
  
  console.log('\nTask completed successfully');
  console.log('Agent Output:', result.output);
  
  ws.close();
  console.log('=== Test PASSED ===');
}

runTest().catch(err => {
  console.error('\n=== Test FAILED ===');
  console.error(err);
  process.exit(1);
});
