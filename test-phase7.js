import OpenAI from 'openai';
import http from 'node:http';
import { isSelfInvocation } from './dist/agent.js';

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  if (actual === expected) {
    console.log('PASS:\t' + name);
    passed++;
  } else {
    console.log('FAIL:\t' + name + ' - expected ' + expected + ', got ' + actual);
    failed++;
  }
}

// Self-invocation guard: recursive agent execution must be blocked.
const blocked = [
  'node dist/cli.js "Open my website"',
  'node dist/cli.js "Open my website" 2>&1',
  'node --input-type=module dist/cli.js "x"',
  'npx tsx src/cli.ts "Open my website"',
  'tsx src/cli.ts "hi"',
  'achu-agent do something',
  'npm run dev',
  'cd C:\\proj && npm run dev',
];
for (const cmd of blocked) {
  check('blocks recursive: ' + cmd, isSelfInvocation(cmd), true);
}

// Legitimate commands must keep working.
const allowed = [
  'npm run build',
  'npm test',
  'node script.js',
  'node dist/worker.js',
  'dir',
  'Get-ChildItem',
  'npx tsc --noEmit',
  'node --input-type=module script.mjs',
  'echo hello',
];
for (const cmd of allowed) {
  check('allows legitimate: ' + cmd, isSelfInvocation(cmd), false);
}

// API stall harness: a server that accepts but never responds must
// produce a bounded rejection when the client timeout is configured,
// instead of hanging forever. Uses the same OpenAI client options
// shape as the agent (timeout + maxRetries preserved).
async function timeoutHarness() {
  const server = http.createServer(() => {
    // Intentionally never respond: simulates a stalled API.
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const client = new OpenAI({
    apiKey: 'phase7-harness',
    baseURL: 'http://127.0.0.1:' + port + '/v1',
    timeout: 5000,
    maxRetries: 0,
  });
  const start = Date.now();
  let outcome = 'hung';
  const watchdog = new Promise((resolve) => setTimeout(() => resolve('watchdog'), 25000));
  const attempt = (async () => {
    try {
      await client.chat.completions.create({
        model: 'harness-model',
        messages: [{ role: 'user', content: 'hi' }],
      });
      return 'unexpected-success';
    } catch (e) {
      return 'rejected:' + (e && e.name ? e.name : String(e)).slice(0, 80);
    }
  })();
  outcome = await Promise.race([attempt, watchdog]);
  const elapsed = Date.now() - start;
  server.close();
  check('stall rejects instead of hanging', outcome !== 'hung' && outcome !== 'watchdog', true);
  check('stall bounded (~5s timeout)', elapsed >= 4000 && elapsed < 25000, true);
  console.log('INFO:\tstall outcome=' + outcome + ' elapsed=' + elapsed + 'ms');
}

await timeoutHarness();

console.log('\nPhase7: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed > 0 ? 1 : 0;
