import fs from 'node:fs';
import { Workspace } from './dist/tools/workspace.js';
import { listDirectory } from './dist/tools/list-directory.js';
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

const src = fs.readFileSync('src/agent.ts', 'utf8');
const dist = fs.readFileSync('dist/agent.js', 'utf8');
const has = (text, sub) => text.includes(sub);

// A. Explicit file task → direct tool selection wiring + guidance.
check('A.1 list_directory tool wired', has(dist, 'name: "list_directory"') && has(dist, 'case "list_directory"'), true);
check('A.2 first-action guidance shipped', has(src, '"List the files"') && has(src, 'list_directory directly'), true);

// B. Explicit browser URL → navigate first, no workspace detour.
check('B.1 navigate tool available', has(dist, 'name: "navigate"'), true);
check('B.2 navigate-direct guidance shipped', has(src, 'Explicit URL') && has(src, 'navigate directly'), true);

// C. Page-title task → navigation result reuse, no forced get_page_info.
check('C.1 title-reuse guidance shipped', has(src, 'navigate returns URL/title'), true);

// D. Known target → no repeated inspection.
check('D.1 inspect-only-if-unknown guidance shipped', has(src, 'when the selector is unknown'), true);

// E. Ambiguous website → clarification, zero browser/network tools.
check('E.1 ask-for-URL guidance shipped', has(src, 'send me the website URL'), true);
check('E.2 no-remote-fetch guidance shipped', has(src, 'Do not download code'), true);

// F. Ambiguous file → clarification or local resolution, no hallucination.
check('F.1 ambiguous-file guidance shipped', has(src, '"Edit that file."'), true);

// G. Mixed browser + workspace → create_file path present.
check('G.1 create_file tool wired', has(dist, 'name: "create_file"') && has(dist, 'case "create_file"'), true);

// H. Impossible target → truthful-conclusion escalation present.
check('H.1 conclude-truthfully escalation shipped', has(dist, 'Stop trying further variations'), true);

// I. Informational → zero-tool direct answer guidance.
check('I.1 no-tool answer guidance shipped', has(src, 'answer directly without tools'), true);

// J. Self-invocation stays blocked (functional).
check('J.1 recursive CLI blocked', isSelfInvocation('node dist/cli.js "hi"'), true);
check('J.2 legit command allowed', isSelfInvocation('npm run build'), false);

// K. Recovery prefers different strategy (escalation strings present).
check('K.1 repeat-escalation shipped', has(dist, 'Do NOT repeat the same command'), true);

// L. No artificial repeated exploration.
check('L.1 no-reread guidance shipped', has(src, 'without a new reason'), true);

// Timeout + guardrails preserved.
check('M.1 client timeout preserved', has(src, 'timeout: 180000'), true);
check('M.2 no-self-invocation guidance shipped', has(src, 'you are already the agent'), true);

// Functional: listDirectory lists the workspace root.
const workspace = new Workspace(process.cwd());
const listing = await listDirectory(workspace, '.');
check('N.1 listDirectory works', listing.includes('package.json'), true);

console.log('\nPhase8: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed > 0 ? 1 : 0;
