const WebSocket = require('ws');

const WS_URL = 'ws://localhost:3001';
const TASK = 'Create a new file called ui-proof.txt with exactly this content:\n\nUI WebSocket execution works.\n\nDo not modify any other file.';

function waitForEvent(ws, eventTypes, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${eventTypes.join(' or ')}`));
    }, timeout);
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (eventTypes.includes(msg.type)) {
          clearTimeout(timer);
          resolve(msg);
        }
      } catch (e) {
        // ignore parse errors
      }
    });
  });
}

async function runTest() {
  console.log('=== Starting Integration Test ===');
  const ws = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS connect timeout')), 10000);
  });
  console.log('WebSocket connected');

  // Select project
  ws.send(JSON.stringify({ type: 'select_project', payload: { path: 'C:\\\\Users\\\\Achu146\\\\achu-antigravity-test\\\\saas-landing' } }));
  const projMsg = await waitForEvent(ws, ['project_selected', 'error']);
  if (projMsg.type === 'error') throw new Error(projMsg.message);
  console.log('Project selected');

  // Run task
  ws.send(JSON.stringify({ type: 'run_task', payload: { task: TASK } }));
  console.log('Task sent, waiting for completion...');
  const result = await waitForEvent(ws, ['task_completed', 'task_failed'], 300000);
  if (result.type === 'task_failed') throw new Error(`Task failed: ${result.error}`);
  console.log('Task completed successfully');
  console.log('Result:', JSON.stringify(result, null, 2));

  ws.close();
  console.log('=== Test PASSED ===');
}

runTest().catch(err => {
  console.error('=== Test FAILED ===');
  console.error(err);
  process.exit(1);
});