const { extractRequestedVerification } = await import('./dist/agent.js');

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, description) {
  if (actual === expected) {
    console.log(`PASS: ${description}`);
    passed++;
  } else {
    console.log(`FAIL: ${description}`);
    console.log(`  Expected: "${expected}"`);
    console.log(`  Actual:   "${actual}"`);
    failed++;
  }
}

function assertContains(actual, expected, description) {
  if (actual && actual.includes(expected)) {
    console.log(`PASS: ${description}`);
    passed++;
  } else {
    console.log(`FAIL: ${description}`);
    console.log(`  Expected to contain: "${expected}"`);
    console.log(`  Actual:   "${actual}"`);
    failed++;
  }
}

function assertNotContains(actual, unexpected, description) {
  if (actual && !actual.includes(unexpected)) {
    console.log(`PASS: ${description}`);
    passed++;
  } else {
    console.log(`FAIL: ${description}`);
    console.log(`  Should NOT contain: "${unexpected}"`);
    console.log(`  Actual:   "${actual}"`);
    failed++;
  }
}

console.log('=== Verification Extraction Regression Tests ===\n');

// A. "npm run build and npx tsc --noEmit" → extracts two commands
{
  const task = "npm run build and npx tsc --noEmit";
  const result = extractRequestedVerification(task);
  assertContains(result, "npm run build", 'A1: Extracts npm run build');
  assertContains(result, "npx tsc --noEmit", 'A2: Extracts npx tsc --noEmit');
  assertEqual(result.split("; ").length, 2, 'A3: Returns two commands joined by semicolon');
}

// B. "Run npm test and then npm run build." → extracts two commands
{
  const task = "Run npm test and then npm run build.";
  const result = extractRequestedVerification(task);
  assertContains(result, "npm test", 'B1: Extracts npm test');
  assertContains(result, "npm run build", 'B2: Extracts npm run build');
  assertEqual(result.split("; ").length, 2, 'B3: Returns two commands joined by semicolon');
}

// C. "Run npm run build. After that open the browser..." → extracts only npm run build
{
  const task = "Run npm run build. After that open the browser and verify the page renders.";
  const result = extractRequestedVerification(task);
  assertContains(result, "npm run build", 'C1: Extracts npm run build');
  assertNotContains(result, "open the browser", 'C2: Does not include browser instruction');
  assertNotContains(result, "verify the page", 'C3: Does not include verification instruction');
  assertEqual(result.split("; ").length, 1, 'C4: Returns only one command');
}

// D. The exact real-world prompt → extracts npm run build + npx tsc --noEmit only
{
  const task = `The existing React + Vite SaaS landing page in this workspace is currently broken. Run the build and TypeScript checks to reproduce the errors. Inspect package.json and vite.config.js, identify the missing dependencies, fix the project using the appropriate npm commands, and then run npm run build and npx tsc --noEmit again. Do not just report the errors: actually fix them. Do not replace the existing SaaS UI. After build and TypeScript checks pass, start the development server from this project directory, determine the actual localhost URL, open it in the browser, verify that the existing SaaS landing page renders correctly, and fix any runtime issue you find. Finish only after build, TypeScript, and browser verification pass.`;
  const result = extractRequestedVerification(task);
  assertContains(result, "npm run build", 'D1: Extracts npm run build');
  assertContains(result, "npx tsc --noEmit", 'D2: Extracts npx tsc --noEmit');
  assertEqual(result.split("; ").length, 2, 'D3: Returns exactly two commands');
  assertNotContains(result, "again", 'D4: Does not include "again"');
  assertNotContains(result, "Do not just report", 'D5: Does not include "Do not just report"');
  assertNotContains(result, "Do not replace", 'D6: Does not include "Do not replace"');
  assertNotContains(result, "After build", 'D7: Does not include "After build"');
  assertNotContains(result, "start the development server", 'D8: Does not include "start the development server"');
  assertNotContains(result, "open it in the browser", 'D9: Does not include "open it in the browser"');
  assertNotContains(result, "verify that the existing", 'D10: Does not include browser verification instruction');
  assertNotContains(result, "fix any runtime", 'D11: Does not include "fix any runtime"');
}

// E. Natural-language constraints must never become shell commands
{
  const task = "Fix the bug and run npm test. Do not modify tsconfig.json. Do not change the verification command. Never edit package.json.";
  const result = extractRequestedVerification(task);
  assertContains(result, "npm test", 'E1: Extracts npm test');
  assertNotContains(result, "Do not modify", 'E2: Does not include "Do not modify"');
  assertNotContains(result, "Never edit", 'E3: Does not include "Never edit"');
  assertNotContains(result, "tsconfig.json", 'E4: Does not include tsconfig.json as command');
  assertNotContains(result, "package.json", 'E5: Does not include package.json as command');
}

// F. Browser verification remains a separate tool/phase (not extracted as shell command)
{
  const task = "Run npm run build and then verify in browser that the page loads.";
  const result = extractRequestedVerification(task);
  assertContains(result, "npm run build", 'F1: Extracts npm run build');
  assertNotContains(result, "verify in browser", 'F2: Does not include browser verification as shell command');
  assertNotContains(result, "page loads", 'F3: Does not include "page loads"');
}

// G. Existing exact verification command behavior still works
{
  const task1 = "Add the page and run npm run build";
  assertEqual(extractRequestedVerification(task1), "npm run build", 'G1: Detects "run npm run build"');

  const task2 = "Fix the app and verify with \"npm run build\"";
  assertEqual(extractRequestedVerification(task2), "npm run build", 'G2: Detects "verify with" quoted');

  const task3 = "Build it using `npm run build`";
  assertEqual(extractRequestedVerification(task3), "npm run build", 'G3: Detects backtick quoted');

  const task4 = "Add a page to the app";
  assertEqual(extractRequestedVerification(task4), null, 'G4: No command when not requested');

  const task5 = "Run `npm test`";
  assertEqual(extractRequestedVerification(task5), "npm test", 'G5: Detects backtick npm test');

  const task6 = "Verify with 'npx tsc --noEmit'";
  assertEqual(extractRequestedVerification(task6), "npx tsc --noEmit", 'G6: Detects quoted tsc --noEmit');
}

// H. Multiple commands in various formats
{
  const task = "Run npm run build; npx tsc --noEmit";
  const result = extractRequestedVerification(task);
  assertContains(result, "npm run build", 'H1: Handles semicolon-separated commands');
  assertContains(result, "npx tsc --noEmit", 'H2: Extracts both commands');
}

{
  const task = "Run npm run build, then npx tsc --noEmit";
  const result = extractRequestedVerification(task);
  assertContains(result, "npm run build", 'H3: Handles "then" separator');
  assertContains(result, "npx tsc --noEmit", 'H4: Extracts both commands with then');
}

{
  const task = "Execute npm test and npm run build";
  const result = extractRequestedVerification(task);
  assertContains(result, "npm test", 'H5: Handles "execute" keyword');
  assertContains(result, "npm run build", 'H6: Extracts both commands with execute');
}

// I. Commands with flags
{
  const task = "Run npx tsc --noEmit --strict and npm test -- --coverage";
  const result = extractRequestedVerification(task);
  assertContains(result, "npx tsc --noEmit --strict", 'I1: Preserves tsc flags');
  assertContains(result, "npm test -- --coverage", 'I2: Preserves npm test flags');
}

// J. Only explicit commands, not natural language
{
  const task = "Build the project and run the tests";
  const result = extractRequestedVerification(task);
  assertEqual(result, null, 'J1: "Build the project" is not an explicit command');
}

{
  const task = "Run the build and TypeScript checks";
  const result = extractRequestedVerification(task);
  assertEqual(result, null, 'J2: "Run the build and TypeScript checks" is natural language');
}

{
  const task = "Run build and verify";
  const result = extractRequestedVerification(task);
  assertEqual(result, null, 'J3: "Run build and verify" is too vague');
}

// K. Order preservation
{
  const task = "Run npx tsc --noEmit and then npm run build";
  const result = extractRequestedVerification(task);
  const commands = result.split("; ");
  assertEqual(commands[0], "npx tsc --noEmit", 'K1: First command is npx tsc --noEmit');
  assertEqual(commands[1], "npm run build", 'K2: Second command is npm run build');
}

console.log(`\n=== Verification Extraction Tests: ${passed} passed, ${failed} failed ===`);

if (failed > 0) {
  process.exit(1);
}