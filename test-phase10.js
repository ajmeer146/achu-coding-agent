import fs from 'node:fs';
import {
  getCachedVerification,
  rememberVerification,
  fileEditFingerprint,
  isUnrequestedFileMutation,
  isSelfInvocation,
} from './dist/agent.js';

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

function makeState() {
  return {
    requestedVerification: null,
    lastVerification: null,
    verificationPassed: false,
    stopReason: null,
    commandHistory: [],
    stepsTaken: new Map(),
    completedTasks: new Set(),
    currentPlan: [],
    phase: 'execute',
    recoveryAttempts: 0,
    lastError: null,
    repeatedFailures: new Map(),
    browserSession: null,
    verificationMemory: new Map(),
  };
}

const src = fs.readFileSync('src/agent.ts', 'utf8');
const dist = fs.readFileSync('dist/agent.js', 'utf8');
const has = (text, sub) => text.includes(sub);

// A. Explicit file task → direct tools (defs + guidance present).
check('A.1 read_file tool wired', has(dist, 'name: "read_file"'), true);
check('A.2 direct-tool guidance shipped', has(src, 'read_file / edit_file / create_file directly'), true);

// B. Navigation title reuse guidance shipped.
check('B.1 navigate-direct guidance shipped', has(src, 'navigate directly'), true);
check('B.2 title-reuse guidance shipped', has(src, 'navigate returns URL/title'), true);

// C. Click-result reuse guidance shipped.
check('C.1 click-reuse guidance shipped', has(src, 'needs no immediate inspect'), true);

// D. Successful edit + verification remembered.
{
  const s = makeState();
  check('D.0 nothing cached initially', getCachedVerification(s, 'npx tsc --noEmit'), null);
  rememberVerification(s, 'npx tsc --noEmit');
  const hit = getCachedVerification(s, 'npx tsc --noEmit');
  check('D.1 verified command remembered', typeof hit === 'string' && hit.includes('remembered'), true);
  check('D.2 different command not cached', getCachedVerification(s, 'npm test'), null);
}

// E. Duplicate verification → cached, not re-executed.
{
  const s = makeState();
  rememberVerification(s, 'npx tsc --noEmit');
  const first = getCachedVerification(s, 'npx tsc --noEmit');
  const second = getCachedVerification(s, 'npx tsc --noEmit');
  check('E.1 repeat returns same cache', first !== null && first === second, true);
}

// F. State-change invalidation: edit/create stales the evidence.
{
  const s = makeState();
  rememberVerification(s, 'npx tsc --noEmit');
  s.stepsTaken.set('edit_file:{"path":"a.ts"}', 1);
  check('F.1 edit invalidates cache', getCachedVerification(s, 'npx tsc --noEmit'), null);
}
{
  const s = makeState();
  rememberVerification(s, 'npx tsc --noEmit');
  s.stepsTaken.set('create_file:{"path":"b.txt"}', 1);
  check('F.2 create invalidates cache', getCachedVerification(s, 'npx tsc --noEmit'), null);
}
check('F.3 fingerprint counts edits', fileEditFingerprint(makeState()), 0);

// G. Unrelated state change preserves evidence.
{
  const s = makeState();
  rememberVerification(s, 'npx tsc --noEmit');
  s.stepsTaken.set('read_file:{"path":"a.ts"}', 2);
  s.stepsTaken.set('run_command:{"command":"dir"}', 1);
  s.stepsTaken.set('inspect_page:{}', 1);
  check('G.1 unrelated tools preserve cache', getCachedVerification(s, 'npx tsc --noEmit') !== null, true);
}

// H. Missing URL → clarification guidance shipped.
check('H.1 ask-for-URL guidance shipped', has(src, 'send me the website URL'), true);

// I. Missing file → clarification guidance shipped.
check('I.1 ambiguous-file guidance shipped', has(src, '"Edit that file."'), true);

// J. Impossible goal → truthful-conclusion escalation shipped.
check('J.1 conclude-truthfully escalation shipped', has(dist, 'Stop trying further variations'), true);

// K. Manufacturing guard intact (functional).
check('K.1 click-task blocks fixture edit', isUnrequestedFileMutation('Click the Buy button.', 'browser-e2e/test-page.html'), true);

// L. Requested mutation allowed (functional).
check('L.1 fix-task allows edit', isUnrequestedFileMutation('Fix calculator.ts.', 'calculator.ts'), false);

// M. Informational fast path guidance shipped.
check('M.1 no-tool answer guidance shipped', has(src, 'answer directly without tools'), true);

// N. Windows preference guidance shipped.
check('N.1 powershell guidance shipped', has(src, 'Windows PowerShell 5.1'), true);

// O. Self-invocation guard intact (functional).
check('O.1 recursive CLI blocked', isSelfInvocation('node dist/cli.js "hi"'), true);

// P. Timeout preserved.
check('P.1 client timeout preserved', has(src, 'timeout: 180000'), true);

// Q. State field + init present.
check('Q.1 verificationMemory init shipped', has(src, 'verificationMemory: new Map()'), true);

console.log('\nPhase10: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed > 0 ? 1 : 0;
