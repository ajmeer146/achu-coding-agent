// Phase 6 scripted mixed-task E2E (no model, no internet).
// Requires browser-e2e/serve.cjs running on http://127.0.0.1:8099/
// Run: npx tsx browser-e2e/phase6-e2e.ts
// Covers TEST A–F component paths; TEST G/H are model-only (live runs).
import { BrowserSession } from '../src/browser/browser-session.js';
import {
  open_browser,
  navigate,
  inspect_page,
  click,
  type as browserType,
  get_page_info,
  close_browser,
} from '../src/browser/browser-tools.js';
import { Workspace } from '../src/tools/workspace.js';
import { readFile } from '../src/tools/read-file.js';
import { createFile } from '../src/tools/create-file.js';
import * as fs from 'node:fs/promises';

const URL = 'http://127.0.0.1:8099/';
const TMP = 'browser-e2e/tmp-result.txt';
let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    console.log('PASS: ' + name);
    passed++;
  } else {
    console.log('FAIL: ' + name + (extra ? ' - ' + extra : ''));
    failed++;
  }
}

async function main() {
  const workspace = new Workspace(process.cwd());
  const session = new BrowserSession();

  // TEST A — open + navigate + get_page_info + answer data present.
  check('A.1 open ok', (await open_browser(session)).success === true);
  check('A.2 navigate ok', (await navigate(session, URL)).success === true);
  const info = await get_page_info(session);
  check(
    'A.3 title/url answerable',
    info.success === true &&
      (info as { title?: string }).title === 'Achu E2E Test Page' &&
      (info as { url?: string }).url === URL,
    JSON.stringify(info).slice(0, 160),
  );

  // TEST B — navigate + inspect + controls enumerated.
  const insp = await inspect_page(session);
  const b = (insp as { success: boolean; info?: any }).success
    ? (insp as { info: any }).info
    : null;
  check(
    'B.1 controls available',
    !!b &&
      b.buttons.includes('Submit') &&
      b.inputs.some((i: any) => i.placeholder === 'Enter name'),
  );

  // TEST C — navigate + type + click + observe/verify result.
  await navigate(session, URL);
  check('C.1 type ok', (await browserType(session, 'Enter name', 'hello')).success === true);
  check('C.2 click ok', (await click(session, 'Submit')).success === true);
  const after = await inspect_page(session);
  const afterText = (after as { success: boolean; info?: any }).success
    ? (after as { info: any }).info.visibleText
    : '';
  check('C.3 result verified', afterText.includes('Hello, hello!'), JSON.stringify(afterText));

  // TEST D — invalid selector fails, inspect/adapt, valid click succeeds.
  const bad = await click(session, '#nope-invalid-1');
  check(
    'D.1 structured failure',
    bad.success === false && (bad as { recoverable?: boolean }).recoverable === true,
  );
  const recheck = await inspect_page(session);
  const buttons: string[] = (recheck as { success: boolean; info?: any }).success
    ? (recheck as { info: any }).info.buttons
    : [];
  check('D.2 adapt via inspect', buttons.includes('Submit'));
  check('D.3 correct click succeeds', (await click(session, 'Submit')).success === true);

  // TEST E — browser read + workspace file creation + read-back.
  await navigate(session, URL);
  const einsp = await inspect_page(session);
  const etext = (einsp as { success: boolean; info?: any }).success
    ? (einsp as { info: any }).info.visibleText
    : '';
  let created = '';
  try {
    created = await createFile(workspace, TMP, etext);
  } catch (e) {
    created = 'ERROR: ' + (e instanceof Error ? e.message : String(e));
  }
  check('E.1 result saved to file', created.startsWith('Successfully created'));
  const back = await readFile(workspace, TMP);
  check('E.2 file content matches', back.includes('Achu Browser E2E'), JSON.stringify(back).slice(0, 120));

  // TEST F — browser inspection vs project file; edit only if required.
  const projectHtml = await readFile(workspace, 'browser-e2e/test-page.html');
  const needsEdit =
    !projectHtml.includes('id="submitBtn"') || !projectHtml.includes('id="nameInput"');
  check('F.1 no edit required (ids present)', needsEdit === false);
  if (!needsEdit) {
    console.log('PASS: F.2 correctly skipped edit');
    passed++;
  }

  // Cleanup: close browser + remove temp file.
  check('H.1 close_browser ok', (await close_browser(session)).success === true);
  check(
    'H.2 session released',
    (session as unknown as { browser: unknown; page: unknown }).browser === null,
  );
  await fs.rm(workspace.resolve(TMP), { force: true });
  check('E.3 temp file removed', !(await workspace.exists(TMP)));

  console.log('\nPhase6 E2E: ' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
