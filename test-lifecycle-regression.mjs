// Focused regression tests for the execution-controller lifecycle fixes.
// Run: node test-lifecycle-regression.mjs   (after `npm run build`)
import {
  initializePlan,
  updatePlanProgress,
  isToolResultFailure,
  isToolResultSuccess,
  isPlanComplete,
  getToolTarget,
} from "./dist/agent.js";
import {
  isServerStartupCommand,
  parsePortFromScript,
  spawnAppProcess,
  detachAppProcess,
  cleanupAppOutputFile,
} from "./dist/tools/app-lifecycle.js";

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.error(`  FAIL: ${name}`); }
}

const TASK = "Build a simple modern landing page for a coffee shop called Brew House with a hero section, menu section, about section, and contact section.";
const completed = new Set();
const tc = (name, args) => ({ id: `t-${Math.random()}`, type: "function", function: { name, arguments: JSON.stringify(args) } });

const stepByTool = (plan, tool) => plan.find(s => s.toolType === tool);

// Complete the realistic prerequisite chain exactly as the E2E does,
// stopping right before the lifecycle step under test.
function completePrerequisites(stopBefore) {
  let p = initializePlan(TASK, { hasProject: false, projectType: "none", existingFiles: [], framework: null });
  const ok = (name, args, result) => { p = updatePlanProgress(p, completed, tc(name, args), result); };
  if (stopBefore !== "list_directory") ok("list_directory", { directoryPath: "." }, "Listing: .\nhello.txt");
  if (stopBefore !== "create_file") {
    ok("create_file", { path: "index.html", content: "x" }, "Successfully created index.html.");
    ok("create_file", { path: "styles.css", content: "x" }, "Successfully created styles.css.");
    ok("create_file", { path: "script.js", content: "x" }, "Successfully created script.js.");
    ok("create_file", { path: "package.json", content: "{}" }, "Successfully created package.json.");
  }
  if (stopBefore !== "run_command") ok("run_command", { command: "npm run build" }, "Exit code: 0\nSTDOUT:\nbuild ok");
  if (stopBefore !== "start_app") ok("start_app", {}, "App started and ready at http://localhost:3000");
  if (stopBefore !== "open_browser") ok("open_browser", {}, "Browser opened successfully");
  return p;
}

console.log("\n[1] A successful tool call completes only its matching plan step");
{
  const plan = initializePlan(TASK, { hasProject: false, projectType: "none", existingFiles: [], framework: null });
  const after = updatePlanProgress(plan, completed, tc("create_file", { path: "index.html", content: "x" }), "Successfully created index.html.");
  const html = after.find(s => s.target === "index.html");
  const css = after.find(s => s.target === "styles.css");
  assert(html.status === "completed", "create_file(index.html) completes the index.html step");
  assert(css.status !== "completed", "create_file(index.html) does NOT complete the styles.css step");
}

console.log("\n[2] A failed/ambiguous browser operation cannot mark browser verification successful");
{
  const p = completePrerequisites("browser_verify");
  // The failure case from the real trace: browser_verify with no session.
  const before = stepByTool(p, "browser_verify").status;
  const after = updatePlanProgress(p, completed, tc("browser_verify", {}), "Browser session not initialized. Use open_browser first.");
  assert(before !== "completed", "browser_verify step was not already completed before the call");
  assert(stepByTool(after, "browser_verify").status !== "completed",
    "ambiguous 'Browser session not initialized' result does NOT complete the browser_verify step");
  assert(isToolResultFailure("browser_verify", "Browser session not initialized. Use open_browser first.") === false,
    "'Browser session not initialized' is ambiguous (prerequisite missing), not a verify-step failure");
  assert(isToolResultSuccess("browser_verify", "Browser session not initialized. Use open_browser first.") === false,
    "'Browser session not initialized' is not success evidence");
  assert(isToolResultFailure("browser_verify", "No base URL available. Start app first.") === false,
    "'No base URL available' is ambiguous, not a verify-step failure");
  assert(isToolResultFailure("start_app", "App started but no URL detected. Output: <empty>"),
    "isToolResultFailure recognizes 'App started but no URL detected' for start_app");
  assert(isToolResultFailure("start_app", "App process exited before becoming ready (check for port conflicts or script errors). Output: EADDRINUSE"),
    "isToolResultFailure recognizes early process exit for start_app");
}

console.log("\n[3] A missing browser-verification result cannot produce an all-success final status");
{
  let p = completePrerequisites("browser_verify");
  p = updatePlanProgress(p, completed, tc("browser_verify", {}), "Browser session not initialized. Use open_browser first."); // ambiguous, ignored
  assert(isPlanComplete(p) === false,
    "plan is NOT complete when browser verification never actually passed (no false 12/12)");
  const verify = stepByTool(p, "browser_verify");
  assert(verify.status === "running", "browser_verify step stays running for a bounded retry (no failure cascade)");
}

console.log("\n[4] A healthy running app is reused instead of repeatedly starting it");
{
  assert(isToolResultSuccess("start_app", "App already running and ready at http://localhost:3000"),
    "idempotent 'App already running and ready at <url>' counts as success evidence");
  const p = completePrerequisites("start_app");
  // First successful start completes the step.
  const after1 = updatePlanProgress(p, completed, tc("start_app", {}), "App started and ready at http://localhost:3000");
  assert(stepByTool(after1, "start_app").status === "completed", "start_app step completed after first successful start");
  // A second start_app (reuse path) on an already-completed step must not regress or duplicate.
  const after2 = updatePlanProgress(after1, completed, tc("start_app", {}), "App already running and ready at http://localhost:3000");
  assert(stepByTool(after2, "start_app").status === "completed", "repeated start_app leaves the completed step completed (no restart)");
  assert(after2.filter(s => s.toolType === "start_app").length === 1, "exactly one start_app step exists in the plan");
}

console.log("\n[5] An existing browser session is reused rather than reopened indefinitely");
{
  const p = completePrerequisites("open_browser");
  const after1 = updatePlanProgress(p, completed, tc("open_browser", {}), "Browser opened successfully");
  assert(stepByTool(after1, "open_browser").status === "completed", "open_browser completed on first open");
  const after2 = updatePlanProgress(after1, completed, tc("open_browser", {}), "Browser already open.");
  assert(stepByTool(after2, "open_browser").status === "completed", "open_browser stays completed on repeated open (session reuse)");
  assert(isToolResultSuccess("open_browser", "Browser already open.") === false,
    "'Browser already open.' is not new success evidence (no infinite reopen reward)");
}

console.log("\n[6] Repeated equivalent lifecycle actions terminate safely (loop-fingerprint normalization)");
{
  const t = (cmd) => getToolTarget(tc("run_command", { command: cmd }));
  assert(t("npx serve . -l 3000") === "server_startup", "'npx serve . -l 3000' fingerprints as server_startup");
  assert(t("npx http-server -p 3000") === "server_startup", "'npx http-server -p 3000' fingerprints as the SAME server_startup");
  assert(t("npx serve . -l 3000 &") === "server_startup", "background variant fingerprints as the SAME server_startup");
  assert(t("npm run dev") === "server_startup", "'npm run dev' fingerprints as server_startup");
  assert(t("npm run build") === "npm", "'npm run build' keeps its own fingerprint (not a server start)");
}

console.log("\n[7] A genuine lifecycle failure is not silently converted into success");
{
  const p = completePrerequisites("start_app");
  const after = updatePlanProgress(p, completed, tc("start_app", {}), "App process exited before becoming ready (check for port conflicts or script errors). Output: Error: listen EADDRINUSE");
  const start = stepByTool(after, "start_app");
  assert(start.status === "failed", "real start_app failure marks the step failed, not completed");
  assert(isToolResultSuccess("start_app", "App process exited before becoming ready (check for port conflicts). Output: x") === false,
    "early-exit is not success evidence");
  // And a browser_verify failure with prerequisites complete marks the step failed:
  const q = completePrerequisites("browser_verify");
  const afterQ = updatePlanProgress(q, completed, tc("browser_verify", {}), "Browser verification failed (attempt 1/3) at http://localhost:3000:\n[+] text: 'Brew House' not found");
  assert(stepByTool(afterQ, "browser_verify").status === "failed", "recognized browser-verification failure marks the step failed");
  assert(isPlanComplete(afterQ) === false, "failed verification keeps the plan incomplete");
}

console.log("\n[8] Normal non-server shell commands continue to work (start-anchored guard)");
{
  assert(isServerStartupCommand("npx serve . -l 3000") === true, "'npx serve . -l 3000' is blocked from run_command");
  assert(isServerStartupCommand("npm run dev") === true, "'npm run dev' is blocked from run_command");
  assert(isServerStartupCommand("npm run build") === false, "'npm run build' is still allowed");
  assert(isServerStartupCommand('npm pkg set scripts.dev="npx serve . -l 3000"') === false,
    "'npm pkg set scripts.dev=...' (mentions server cmd, does not start one) is still allowed");
  assert(isServerStartupCommand("npm install") === false, "'npm install' is still allowed");
  assert(parsePortFromScript("npx serve . -l 3000") === 3000, "port parsed from '-l 3000'");
  assert(parsePortFromScript("npx http-server -p 8080") === 8080, "port parsed from '-p 8080'");
  assert(parsePortFromScript("vite") === 5173, "vite default port 5173");
  assert(parsePortFromScript("next dev") === 3000, "next default port 3000");
}

console.log("\n[Extra] Strict ordering: browser_verify cannot complete before open_browser");
{
  const plan = initializePlan(TASK, { hasProject: false, projectType: "none", existingFiles: [], framework: null });
  let p = updatePlanProgress(plan, completed, tc("start_app", {}), "App started and ready at http://localhost:3000");
  // browser_verify called while open_browser step is still pending -> must NOT complete verify step
  p = updatePlanProgress(p, completed, tc("browser_verify", {}), "Browser verification passed at http://localhost:3000:\n[+] text: 'Brew House'");
  assert(stepByTool(p, "browser_verify").status !== "completed",
    "out-of-order browser_verify cannot complete the verify step while open_browser is pending");
  assert(stepByTool(p, "open_browser").status !== "completed", "open_browser step untouched by the out-of-order verify call");
}

console.log("\n[9] Detached app process holds NO parent-side pipe handles (root-cause regression)");
{
  // Regression for the CLI-hang root cause: parent-side pipes on the child kept
  // the event loop alive after the task finished. The child must be spawned
  // detached with ignored stdio so the parent holds no handle at all.
  const appInfo = spawnAppProcess('node -e "process.exit(0)"', process.cwd());
  assert(appInfo.process.stdout === null,
    "spawned app child has NO parent stdout pipe (parent holds no handle)");
  assert(appInfo.process.stderr === null,
    "spawned app child has NO parent stderr pipe (parent holds no handle)");
  assert(Number.isInteger(appInfo.pid) && appInfo.pid > 0,
    "spawned app child exposes a real positive pid");
  assert(appInfo.process.listenerCount("exit") === 0 && appInfo.process.listenerCount("close") === 0,
    "no lingering exit/close listeners are registered on the app child");
  detachAppProcess(appInfo);
  cleanupAppOutputFile(appInfo);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
