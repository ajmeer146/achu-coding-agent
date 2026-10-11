// Detached-process exit verification (uses the REAL compiled lifecycle code).
//
// Proves two independent properties:
//   1. PARENT EXIT    : this process returns control to the shell promptly
//                       after spawning a detached app child (no parent-side
//                       pipe/handle keeps the Node event loop alive).
//   2. CHILD SURVIVAL : the detached child keeps running and its HTTP server
//                       stays reachable after the parent has exited.
//
// The child writes its bound URL to a handshake file (the child script is
// owned by this test), so the evidence does not depend on the platform-
// specific stdout capture. The child is bounded: it self-terminates after
// CHILD_LIFETIME_MS so it can never orphan indefinitely.
//
// Output contract (parsed by test-detached-exit.ps1):
//   CHILD_PID=<int>
//   CHILD_URL=<http://localhost:PORT>
//   PARENT_EXIT
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnAppProcess, detachAppProcess } from "./dist/tools/app-lifecycle.js";

const CHILD_LIFETIME_MS = 30000;
const runId = `${process.pid}-${Date.now()}`;
const childScriptPath = path.join(os.tmpdir(), `achu-detached-child-${runId}.cjs`);
const urlFilePath = path.join(os.tmpdir(), `achu-detached-url-${runId}.txt`);

fs.writeFileSync(
  childScriptPath,
  [
    "const http = require('http');",
    "const fs = require('fs');",
    `const urlFile = ${JSON.stringify(urlFilePath)};`,
    "const server = http.createServer((req, res) => { res.writeHead(200); res.end('achu-child-ok'); });",
    "server.listen(0, '127.0.0.1', () => {",
    "  const url = 'http://localhost:' + server.address().port;",
    "  fs.writeFileSync(urlFile, url);",
    "});",
    `setTimeout(() => { process.exit(0); }, ${CHILD_LIFETIME_MS});`,
  ].join("\n"),
  "utf8"
);

// Spawn exactly the way the agent's start_app tool does.
const appInfo = spawnAppProcess(`node "${childScriptPath}"`, os.tmpdir());

// Bounded wait for the child to publish its URL via the handshake file.
let url = null;
const deadline = Date.now() + 10000;
while (Date.now() < deadline) {
  try {
    const raw = fs.readFileSync(urlFilePath, "utf8").trim();
    if (/^http:\/\/localhost:\d+$/.test(raw)) { url = raw; break; }
  } catch { /* not written yet */ }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

// Detach (idempotent): release any parent-side handle and unref the child.
detachAppProcess(appInfo);

console.log(`CHILD_PID=${appInfo.pid}`);
console.log(`CHILD_URL=${url ?? ""}`);
console.log("PARENT_EXIT");
// No further pending handles/timers: if the design is correct, Node exits here.
