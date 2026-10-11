// Phase 5 scripted local browser E2E (no model, no internet).
// Requires browser-e2e/serve.cjs running on http://127.0.0.1:8099/
// Run: npx tsx browser-e2e/phase5-e2e.ts
import { BrowserSession } from '../src/browser/browser-session.js';
import {
  open_browser,
  navigate,
  inspect_page,
  click,
  type as browserType,
  screenshot,
  get_page_info,
  close_browser,
} from '../src/browser/browser-tools.js';
import { checkActionSafety } from '../src/browser/browser-safety.js';

const URL = 'http://127.0.0.1:8099/';
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
  const session = new BrowserSession();

  // TEST A — Basic navigation: open, navigate, verify URL/title.
  const opened = await open_browser(session);
  check('A.1 open_browser succeeds', opened.success === true);
  const nav = await navigate(session, URL);
  check(
    'A.2 navigate URL/title correct',
    nav.success === true &&
      (nav as { url?: string }).url === URL &&
      (nav as { title?: string }).title === 'Achu E2E Test Page',
    JSON.stringify(nav).slice(0, 200),
  );

  // TEST B — Page inspection: heading/input/button present.
  const insp = await inspect_page(session);
  const info = (insp as { success: boolean; info?: any }).success
    ? (insp as { info: any }).info
    : null;
  check('B.1 inspect succeeds', info !== null);
  check(
    'B.2 heading/input/button visible',
    !!info &&
      info.visibleText.includes('Achu Browser E2E') &&
      info.buttons.includes('Submit') &&
      info.inputs.some((i: any) => i.placeholder === 'Enter name'),
    info ? JSON.stringify(info.visibleText).slice(0, 160) : 'no info',
  );

  // TEST C — Click interaction: click Submit, verify resulting state.
  const clicked = await click(session, 'Submit');
  check('C.1 click succeeds', clicked.success === true);
  const afterClick = await inspect_page(session);
  const clickText = (afterClick as { success: boolean; info?: any }).success
    ? (afterClick as { info: any }).info.visibleText
    : '';
  check('C.2 result area updated', clickText.includes('Hello,'), JSON.stringify(clickText));

  // TEST D — Type interaction: type hello, submit, verify result.
  const typed = await browserType(session, 'Enter name', 'hello');
  check('D.1 type succeeds', typed.success === true);
  await click(session, 'Submit');
  const afterType = await inspect_page(session);
  const typeText = (afterType as { success: boolean; info?: any }).success
    ? (afterType as { info: any }).info.visibleText
    : '';
  check('D.2 typed value reflected', typeText.includes('Hello, hello!'), JSON.stringify(typeText));

  // TEST E — Screenshot: base64 exists at tool level (agent sends summary only).
  const shot = await screenshot(session);
  check(
    'E.1 screenshot returns non-empty base64',
    shot.success === true &&
      typeof (shot as { screenshot?: unknown }).screenshot === 'string' &&
      ((shot as { screenshot: string }).screenshot.length > 1000),
  );

  // TEST F — Recovery: invalid selector fails structured, then valid action works.
  const bad = await click(session, '#does-not-exist-12345');
  check(
    'F.1 invalid selector structured failure',
    bad.success === false &&
      typeof (bad as { error?: unknown }).error === 'string' &&
      (bad as { recoverable?: boolean }).recoverable === true,
    JSON.stringify(bad).slice(0, 200),
  );
  const recovered = await click(session, 'Submit');
  check('F.2 recovery action succeeds', recovered.success === true);

  // TEST G — Dynamic state: result absent before, present after interaction.
  const gourt = await navigate(session, URL);
  check('G.0 re-navigate ok', gourt.success === true);
  const before = await inspect_page(session);
  const beforeText = (before as { success: boolean; info?: any }).success
    ? (before as { info: any }).info.visibleText
    : 'UNREADABLE';
  await browserType(session, 'Enter name', 'dynamic');
  await click(session, 'Submit');
  const after = await inspect_page(session);
  const afterText = (after as { success: boolean; info?: any }).success
    ? (after as { info: any }).info.visibleText
    : 'UNREADABLE';
  check(
    'G.1 updated state observed',
    !beforeText.includes('Hello, dynamic!') && afterText.includes('Hello, dynamic!'),
    'before=' + JSON.stringify(beforeText) + ' after=' + JSON.stringify(afterText),
  );

  // Safety spot-checks (localhost allowed, file blocked).
  check(
    'S.1 localhost http allowed',
    checkActionSafety('navigate', { url: URL }).allowed === true,
  );
  check(
    'S.2 file:// blocked',
    checkActionSafety('navigate', { url: 'file://etc/passwd' }).allowed === false,
  );

  // TEST H/J — Session lifecycle: close nulls browser/page (agent field reset reviewed separately).
  const pageInfo = await get_page_info(session);
  check(
    'H.0 get_page_info works pre-close',
    pageInfo.success === true,
  );
  const closed = await close_browser(session);
  check('H.1 close succeeds', closed.success === true);
  check(
    'H.2 session fully released',
    (session as unknown as { browser: unknown; page: unknown }).browser === null &&
      (session as unknown as { browser: unknown; page: unknown }).page === null,
  );

  console.log('\nPhase5 E2E: ' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
