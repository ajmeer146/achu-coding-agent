const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const fsp = require('fs/promises');

const WS_URL = 'ws://localhost:3001';

// We want to run two sequential tasks in the same workspace.
const TASK_A = 'Create a simple node HTTP server (server.js) that listens on port 8080 and always returns the string "APP_A_CONTENT". Run it in the background or use a command that keeps it running.';
const TASK_B = 'Stop the previous server if necessary, then modify the server.js to listen on port 8081 and return "APP_B_CONTENT". Run the new server.';

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

function waitForAppUrl(ws, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for app_url')), timeout);
    const listener = (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'app_url') {
          clearTimeout(timer);
          ws.off('message', listener);
          resolve(msg.url);
        } else if (msg.type === 'task_failed' || msg.type === 'error') {
          clearTimeout(timer);
          ws.off('message', listener);
          reject(new Error(msg.error || msg.message));
        }
      } catch (e) {}
    };
    ws.on('message', listener);
  });
}

async function runTest() {
  console.log('=== Starting Sequential E2E Test ===');
  
  if (!process.env.OPENAI_API_KEY) {
    console.log('BLOCKER: OPENAI_API_KEY is not set. Real LLM E2E is blocked.');
    // We still report blocked, but we'll try to run the server-side regression test below this.
    return 'BLOCKED';
  }

  const ws = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS connect timeout')), 10000);
  });
  console.log('WebSocket connected');

  const wsDir = await fsp.mkdtemp(path.join(os.tmpdir(), "achu-e2e-seq-"));
  console.log(`Using temporary workspace: ${wsDir}`);

  // Select project
  ws.send(JSON.stringify({ type: 'select_project', payload: { path: wsDir } }));
  const projMsg = await waitForEvent(ws, ['project_selected', 'error']);
  if (projMsg.type === 'error') throw new Error(projMsg.message);
  console.log('Project selected');

  // Run task A
  console.log('Sending Task A...');
  ws.send(JSON.stringify({ type: 'run_task', payload: { task: TASK_A } }));
  
  let urlA;
  try {
    urlA = await waitForAppUrl(ws, 120000);
    console.log(`Task A app URL: ${urlA}`);
    const resA = await fetch(urlA);
    const textA = await resA.text();
    if (textA !== 'APP_A_CONTENT') {
      throw new Error(`Task A URL served wrong content: ${textA}`);
    }
  } catch (err) {
    console.error('Task A failed or timed out:', err.message);
    ws.close();
    return 'FAILED';
  }

  // Run task B
  console.log('Sending Task B...');
  ws.send(JSON.stringify({ type: 'run_task', payload: { task: TASK_B } }));
  
  let urlB;
  try {
    urlB = await waitForAppUrl(ws, 120000);
    console.log(`Task B app URL: ${urlB}`);
    const resB = await fetch(urlB);
    const textB = await resB.text();
    if (textB !== 'APP_B_CONTENT') {
      throw new Error(`Task B URL served wrong content: ${textB}`);
    }
    if (urlB === urlA) {
      throw new Error('Task B returned the same URL as Task A, stale server detected!');
    }
  } catch (err) {
    console.error('Task B failed or timed out:', err.message);
    ws.close();
    return 'FAILED';
  }

  ws.close();
  console.log('=== Test PASSED ===');
  return 'PASSED';
}

runTest().then(status => {
  if (status === 'BLOCKED') {
    process.exit(2);
  }
  process.exit(status === 'PASSED' ? 0 : 1);
});
