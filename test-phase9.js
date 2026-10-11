import fs from 'node:fs';
import { isUnrequestedFileMutation, isSelfInvocation } from './dist/agent.js';
import { checkActionSafety } from './dist/browser/browser-safety.js';

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

const src = fs.readFileSync('src/agent.ts', 'utf8');
const dist = fs.readFileSync('dist/agent.js', 'utf8');
const has = (text, sub) => text.includes(sub);

// A. Missing website URL → clarification guidance, first response.
check('A.1 ask-first guidance shipped', has(src, 'ask in your FIRST response'), true);
check('A.2 ask-for-URL guidance shipped', has(src, 'send me the website URL'), true);

// B. Explicit website URL → navigation allowed (functional safety check).
check('B.1 explicit localhost URL allowed', checkActionSafety('navigate', { url: 'http://127.0.0.1:8099/' }).allowed, true);

// C. Missing file → clarification guidance, no hallucination.
check('C.1 ambiguous-file guidance shipped', has(src, '"Edit that file."'), true);

// D. Explicit coding task → mutation allowed (intent-scoped, not blanket).
check('D.1 fix-task allows .ts edit', isUnrequestedFileMutation('Fix calculator.ts so add() returns a+b.', 'calculator.ts'), false);
check('D.2 add-task allows .html edit', isUnrequestedFileMutation('Add a Buy button to browser-e2e/test-page.html.', 'browser-e2e/test-page.html'), false);
check('D.3 save-task allows .txt create', isUnrequestedFileMutation('Open the page and save the message to result.txt.', 'result.txt'), false);

// E. Read-only task → no mutation authority (guidance + guard for fixtures).
check('E.1 read-only guidance shipped', has(src, 'Read-only requests (read, tell, explain, list) never authorize modification'), true);
check('E.2 read-task blocks .html edit', isUnrequestedFileMutation('Tell me the page title.', 'browser-e2e/test-page.html'), true);

// F. Impossible browser target → fixture edit blocked.
check('F.1 click-task blocks .html edit', isUnrequestedFileMutation('Click the Buy button.', 'browser-e2e/test-page.html'), true);
check('F.2 backslash path also blocked', isUnrequestedFileMutation('Click the Buy button.', 'browser-e2e\\test-page.html'), true);

// G. Intent-scoped (not blanket): same file, requested edit allowed.
check('G.1 requested edit allowed on same file', isUnrequestedFileMutation('Add a Buy button to the test page.', 'browser-e2e/test-page.html'), false);

// H. Successful verification reuse guidance shipped.
check('H.1 no-repeat-verification guidance shipped', has(src, 'do not run it again; report the passing result'), true);
check('H.2 conclude-truthfully escalation shipped', has(dist, 'Stop trying further variations'), true);

// I. Stale-observation guidance shipped.
check('I.1 staleness guidance shipped', has(src, 'earlier reads of that file are stale'), true);

// J. Informational → zero-tool guidance shipped.
check('J.1 no-tool answer guidance shipped', has(src, 'answer directly without tools'), true);

// K. Windows command preference guidance shipped.
check('K.1 powershell preference shipped', has(src, 'Windows PowerShell 5.1'), true);
check('K.2 unix-avoidance shipped', has(src, "<<'EOF' heredocs"), true);

// L. Self-invocation stays blocked (functional).
check('L.1 recursive CLI blocked', isSelfInvocation('node dist/cli.js "hi"'), true);
check('L.2 legit command allowed', isSelfInvocation('npm run build'), false);

// M. Timeout stays bounded (config preserved).
check('M.1 client timeout preserved', has(src, 'timeout: 180000'), true);

// N. Goal-integrity guidance shipped.
check('N.1 goal-fixed guidance shipped', has(src, 'The requested goal stays fixed'), true);
check('N.2 no-manufacture guidance shipped', has(src, 'Never change the environment to manufacture success'), true);

console.log('\nPhase9: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed > 0 ? 1 : 0;
