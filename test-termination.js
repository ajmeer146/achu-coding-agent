import { shouldFinishOnTextResponse, reconcilePlanForNoFixNeeded, fileEditFingerprint } from './dist/agent.js';

function makeState(overrides = {}) {
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
    ...overrides,
  };
}

function pendingPlan(ids) {
  return ids.map((id) => ({ id, description: id, status: 'pending' }));
}

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

// A. list files -> tool executed -> agent stops
{
  const state = makeState({
    phase: 'execute',
    currentPlan: pendingPlan(['understand-task', 'inspect-workspace', 'execute-task']),
    completedTasks: new Set(['list_directory:{}']),
    stepsTaken: new Map([['list_directory:{}', 1]]),
  });
  check(
    'A. list files tool executed -> finish on text answer',
    shouldFinishOnTextResponse(state, true),
    true,
  );
}

// B. read-only task (read_file) -> agent stops
{
  const state = makeState({
    phase: 'execute',
    currentPlan: pendingPlan(['understand-task', 'inspect-workspace']),
    completedTasks: new Set(['read_file:{"path":"package.json"}']),
    stepsTaken: new Map([['read_file:{"path":"package.json"}', 1]]),
  });
  check(
    'B. read-only task with answer -> finish',
    shouldFinishOnTextResponse(state, true),
    true,
  );
}

// C. create file -> creation completes and agent stops
{
  const state = makeState({
    phase: 'execute',
    currentPlan: pendingPlan(['understand-task', 'execute-task', 'verify-completion']),
    completedTasks: new Set(['create_file:{"path":"notes.txt"}']),
    stepsTaken: new Map([['create_file:{"path":"notes.txt"}', 1]]),
  });
  check(
    'C. create file completed, no verification -> finish',
    shouldFinishOnTextResponse(state, true),
    true,
  );
}

// D. task requiring build/test -> agent continues until verification completes
{
  const state = makeState({
    phase: 'execute',
    requestedVerification: 'npx tsc --noEmit',
    verificationPassed: false,
    currentPlan: pendingPlan(['understand-task', 'implement-core', 'test-functionality']),
    completedTasks: new Set(['edit_file:{"path":"src/a.ts"}']),
    stepsTaken: new Map([['edit_file:{"path":"src/a.ts"}', 1]]),
  });
  check(
    'D. verification requested -> do NOT finish early',
    shouldFinishOnTextResponse(state, true),
    false,
  );
}

// E. failed command -> recovery still works (do not finish)
{
  const state = makeState({
    phase: 'recover',
    recoveryAttempts: 1,
    lastError: {
      command: 'run_command',
      exitCode: 1,
      stdout: '',
      stderr: 'error TS2304',
      errorMessage: 'Command failed with exit code 1',
    },
    currentPlan: [
      { id: 'understand-task', description: 'u', status: 'completed' },
      { id: 'execute-task', description: 'e', status: 'failed' },
    ],
    completedTasks: new Set(),
    stepsTaken: new Map([['run_command:{"command":"npx tsc"}', 1]]),
    repeatedFailures: new Map([['run_command:1:Command failed', 1]]),
  });
  check(
    'E. failed step in recover phase -> do NOT finish',
    shouldFinishOnTextResponse(state, true),
    false,
  );
}

// F. empty model content -> do not finish (need real answer)
{
  const state = makeState({
    phase: 'execute',
    currentPlan: pendingPlan(['understand-task']),
    completedTasks: new Set(['list_directory:{}']),
    stepsTaken: new Map([['list_directory:{}', 1]]),
  });
  check(
    'F. no answer content -> do NOT finish',
    shouldFinishOnTextResponse(state, false),
    false,
  );
}

// G. stop signal set -> do not finish via this path
{
  const state = makeState({
    phase: 'execute',
    stopReason: 'Stopped safely: something',
    currentPlan: pendingPlan(['understand-task']),
    completedTasks: new Set(['list_directory:{}']),
    stepsTaken: new Map([['list_directory:{}', 1]]),
  });
  check(
    'G. stopReason set -> do NOT finish via fast path',
    shouldFinishOnTextResponse(state, true),
    false,
  );
}

// H. trivial greeting with no tool work -> existing flow handles it
{
  const state = makeState({
    phase: 'understand',
    currentPlan: pendingPlan(['understand-task', 'respond-directly']),
    completedTasks: new Set(),
    stepsTaken: new Map(),
  });
  check(
    'H. no tool work done -> do NOT finish via fast path',
    shouldFinishOnTextResponse(state, true),
    false,
  );
}

// I. no fix needed: verification passes, no edits made, only edit steps pending
{
  const state = makeState({
    phase: 'execute',
    requestedVerification: 'npm test',
    verificationPassed: true,
    currentPlan: [
      { id: '1', description: 'Inspect relevant source files to understand the task', status: 'completed', toolType: 'read_file' },
      { id: '2', description: 'Identify and read all target files', status: 'completed', toolType: 'read_file' },
      { id: '3', description: 'Make the necessary code changes', status: 'pending', toolType: 'edit_file' },
      { id: '4', description: 'Run the requested verification command', status: 'completed', toolType: 'run_verification' },
    ],
    completedTasks: new Set(['read_file:{"path":"calculator.ts"}', 'read_file:{"path":"math-utils.ts"}', 'run_verification:npm test']),
    stepsTaken: new Map([
      ['read_file:{"path":"calculator.ts"}', 1],
      ['read_file:{"path":"math-utils.ts"}', 1],
      ['run_verification:npm test', 1],
    ]),
  });
  check(
    'I. no fix needed: verification passes, no edits, only edit steps pending -> finish',
    shouldFinishOnTextResponse(state, true),
    true,
  );
}

// J. no fix needed but verification NOT passed -> do NOT finish
{
  const state = makeState({
    phase: 'execute',
    requestedVerification: 'npm test',
    verificationPassed: false,
    currentPlan: [
      { id: '1', description: 'Inspect relevant source files to understand the task', status: 'completed', toolType: 'read_file' },
      { id: '2', description: 'Identify and read all target files', status: 'completed', toolType: 'read_file' },
      { id: '3', description: 'Make the necessary code changes', status: 'pending', toolType: 'edit_file' },
      { id: '4', description: 'Run the requested verification command', status: 'pending', toolType: 'run_verification' },
    ],
    completedTasks: new Set(['read_file:{"path":"calculator.ts"}', 'read_file:{"path":"math-utils.ts"}']),
    stepsTaken: new Map([
      ['read_file:{"path":"calculator.ts"}', 1],
      ['read_file:{"path":"math-utils.ts"}', 1],
    ]),
  });
  check(
    'J. no fix needed but verification not passed -> do NOT finish',
    shouldFinishOnTextResponse(state, true),
    false,
  );
}

// K. edits WERE made, verification passes, edit step pending -> do NOT finish (edit actually needed)
{
  const state = makeState({
    phase: 'execute',
    requestedVerification: 'npm test',
    verificationPassed: true,
    currentPlan: [
      { id: '1', description: 'Inspect relevant source files to understand the task', status: 'completed', toolType: 'read_file' },
      { id: '2', description: 'Identify and read all target files', status: 'completed', toolType: 'read_file' },
      { id: '3', description: 'Make the necessary code changes', status: 'pending', toolType: 'edit_file' },
      { id: '4', description: 'Run the requested verification command', status: 'completed', toolType: 'run_verification' },
    ],
    completedTasks: new Set(['read_file:{"path":"calculator.ts"}', 'read_file:{"path":"math-utils.ts"}', 'edit_file:{"path":"calculator.ts"}', 'run_verification:npm test']),
    stepsTaken: new Map([
      ['read_file:{"path":"calculator.ts"}', 1],
      ['read_file:{"path":"math-utils.ts"}', 1],
      ['edit_file:{"path":"calculator.ts"}', 1],
      ['run_verification:npm test', 1],
    ]),
  });
  check(
    'K. edits made, verification passes, edit step pending -> do NOT finish (edit step still required)',
    shouldFinishOnTextResponse(state, true),
    false,
  );
}

// L. no verification requested, no edits, inspection done, edit step pending -> finish (read-only-ish)
{
  const state = makeState({
    phase: 'execute',
    requestedVerification: null,
    verificationPassed: false,
    currentPlan: [
      { id: '1', description: 'Inspect relevant source files to understand the task', status: 'completed', toolType: 'read_file' },
      { id: '2', description: 'Identify and read all target files', status: 'completed', toolType: 'read_file' },
      { id: '3', description: 'Make the necessary code changes', status: 'pending', toolType: 'edit_file' },
    ],
    completedTasks: new Set(['read_file:{"path":"calculator.ts"}', 'read_file:{"path":"math-utils.ts"}']),
    stepsTaken: new Map([
      ['read_file:{"path":"calculator.ts"}', 1],
      ['read_file:{"path":"math-utils.ts"}', 1],
    ]),
  });
  check(
    'L. no verification requested, no edits, inspection done, edit step pending -> finish',
    shouldFinishOnTextResponse(state, true),
    true,
  );
}

console.log('\nTermination: ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed > 0 ? 1 : 0;

// M. reconcilePlanForNoFixNeeded: marks redundant inspection steps completed
{
  const plan = [
    { id: '1', description: 'Search for relevant files related to the bug', status: 'completed', toolType: 'search_code' },
    { id: '2', description: 'List directory to find the target file', status: 'completed', toolType: 'list_directory' },
    { id: '3', description: 'Read the target file to understand current implementation', status: 'completed', toolType: 'read_file' },
    { id: '4', description: 'Identify test file location and structure', status: 'completed', toolType: 'search_code' },
    { id: '5', description: 'Run the test suite', status: 'completed', toolType: 'run_verification' },
    { id: '6', description: 'Inspect relevant source files to understand the task', status: 'pending', toolType: 'read_file' },
    { id: '7', description: 'Identify and read all target files', status: 'pending', toolType: 'read_file' },
  ];
  
  const state = {
    verificationPassed: true,
    requestedVerification: 'npm test',
    phase: 'execute',
    verificationIsStrong: true,
    stepsTaken: new Map([
      ['search_code:{}', 1],
      ['list_directory:{}', 1],
      ['read_file:{"path":"calculator.ts"}', 1],
      ['search_code:{}', 2],
      ['run_verification:npm test', 1],
    ]),
    completedTasks: new Set(['search_code:{}', 'list_directory:{}', 'read_file:{"path":"calculator.ts"}', 'run_verification:npm test']),
    lastVerification: { command: 'npm test', exitCode: 0, stdout: '', stderr: '' },
    currentPlan: plan,
  };
  
  const reconciled = reconcilePlanForNoFixNeeded(plan, state);
  const pendingInspection = reconciled.filter(s => s.status === 'pending' && s.toolType === 'read_file' && (s.description.includes('Inspect') || s.description.includes('Identify')));
  check(
    'M. reconcilePlanForNoFixNeeded: marks redundant inspection steps completed',
    pendingInspection.length,
    0,
  );
}

// N. reconcilePlanForNoFixNeeded: does NOT mark steps when edits were made
{
  const plan = [
    { id: '1', description: 'Read the target file', status: 'completed', toolType: 'read_file' },
    { id: '2', description: 'Inspect relevant source files', status: 'pending', toolType: 'read_file' },
    { id: '3', description: 'Make the necessary code changes', status: 'pending', toolType: 'edit_file' },
    { id: '4', description: 'Run verification', status: 'completed', toolType: 'run_verification' },
  ];
  
  const state = {
    verificationPassed: true,
    requestedVerification: 'npm test',
    stepsTaken: new Map([
      ['read_file:{"path":"calculator.ts"}', 1],
      ['edit_file:{"path":"calculator.ts"}', 1],
      ['run_verification:npm test', 1],
    ]),
    completedTasks: new Set(['read_file:{"path":"calculator.ts"}', 'edit_file:{"path":"calculator.ts"}', 'run_verification:npm test']),
  };
  
  const reconciled = reconcilePlanForNoFixNeeded(plan, state);
  const pendingInspection = reconciled.find(s => s.id === '2');
  check(
    'N. reconcilePlanForNoFixNeeded: does NOT mark steps when edits were made',
    pendingInspection?.status,
    'pending',
  );
}

// O. reconcilePlanForNoFixNeeded: does NOT mark steps when verification not passed
{
  const plan = [
    { id: '1', description: 'Read the target file', status: 'completed', toolType: 'read_file' },
    { id: '2', description: 'Inspect relevant source files', status: 'pending', toolType: 'read_file' },
    { id: '3', description: 'Run verification', status: 'pending', toolType: 'run_verification' },
  ];
  
  const state = {
    verificationPassed: false,
    requestedVerification: 'npm test',
    stepsTaken: new Map([
      ['read_file:{"path":"calculator.ts"}', 1],
    ]),
    completedTasks: new Set(['read_file:{"path":"calculator.ts"}']),
  };
  
  const reconciled = reconcilePlanForNoFixNeeded(plan, state);
  const pendingInspection = reconciled.find(s => s.id === '2');
  check(
    'O. reconcilePlanForNoFixNeeded: does NOT mark steps when verification not passed',
    pendingInspection?.status,
    'pending',
  );
}

// P. reconcilePlanForNoFixNeeded: does NOT mark non-inspection steps
{
  const plan = [
    { id: '1', description: 'Read the target file', status: 'completed', toolType: 'read_file' },
    { id: '2', description: 'Make the necessary code changes', status: 'pending', toolType: 'edit_file' },
    { id: '3', description: 'Run verification', status: 'completed', toolType: 'run_verification' },
  ];
  
  const state = {
    verificationPassed: true,
    requestedVerification: 'npm test',
    stepsTaken: new Map([
      ['read_file:{"path":"calculator.ts"}', 1],
      ['run_verification:npm test', 1],
    ]),
    completedTasks: new Set(['read_file:{"path":"calculator.ts"}', 'run_verification:npm test']),
  };
  
  const reconciled = reconcilePlanForNoFixNeeded(plan, state);
  const pendingEdit = reconciled.find(s => s.id === '2');
  check(
    'P. reconcilePlanForNoFixNeeded: does NOT mark edit steps',
    pendingEdit?.status,
    'pending',
  );
}

console.log('\nTermination (reconciliation): ' + passed + ' passed, ' + failed + ' failed');
