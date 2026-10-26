# Autonomous Platform Deep Inspection Report

**Date:** 2026-10-26  
**Repositories:**  
- Agent engine: `C:\Users\Achu146\achu-coding-agent` (HEAD `c67855c`, version `1.0.3`)  
- Web application: `C:\Users\Achu146\OneDrive\Desktop\works-with-achu-v2` (HEAD `e2746f6`, Next.js `16.4.2`)  

**Scope:** Read-only inspection, static analysis, targeted tests, and production build verification. No implementation, deployment, provisioning, migration, destructive Git action, or secret disclosure was performed.  

**Status vocabulary:** `VERIFIED WORKING`, `PARTIALLY WORKING`, `MISSING`, `REGRESSED`, `BLOCKED`, `UNVERIFIED`.

**Overall verdict:** The local autonomous coding agent is substantially functional. The cloud execution path is functional only as an ephemeral Trigger.dev code-generation job. Persistent cloud workspaces are scaffolded but not operational end-to-end. The platform is **not production-safe** for untrusted autonomous execution because the local companion and the workspace-runtime sidecar expose command execution without an effective trust boundary, generated applications inherit broad secrets, and the preview surface permits same-origin artifact execution.

---

## 1. Executive Summary

### What works
- The local companion is running at `127.0.0.1:3001` with health/version reporting.
- The local agent loop, file editing, terminal execution, retries, model failover, step bounds, snapshots, and DOM-based browser verification are implemented.
- Cloud tasks can be dispatched through Trigger.dev and persisted as task records and text artifacts.
- Static previews are served with HMAC-signed preview tokens and CSP headers.
- The web production build succeeds, and both repositories pass TypeScript type checking.
- Persistent workspace storage, ownership checks, schema, and local/Railway adapters exist as components.

### What does not work, or is unsafe
- **P0 — Companion trust boundary:** Any page hosted on any `*.vercel.app` origin can reach the loopback companion, obtain its token, authorize an arbitrary local directory, and invoke the agent. Several companion endpoints accept a missing token header, the WebSocket is origin-only, and the update endpoint launches PowerShell without CSRF protection.
- **P0 — Workspace-runtime sidecar:** The container sidecar has no authentication, enables CORS `*`, exposes arbitrary command execution and `/api/shutdown`, and runs as root. A public Railway domain would expose remote code execution.
- **P1 — Secret exposure:** The companion loads both engine and web environment files and passes the full process environment to generated applications. Cloud workers likewise pass worker secrets to generated apps. Local static apps bind `0.0.0.0`.
- **P1 — Preview sandbox:** Generated artifacts run in a same-origin iframe with both `allow-scripts` and `allow-same-origin`; CSP permits inline/eval scripts. A generated or prompt-injected artifact can access the application origin and session.
- **P1 — Persistent runtime:** Persistent workspace APIs exist, but task execution and the UI do not use `remote-workspace-agent.ts`; Railway credentials are absent; readiness, domain creation, file provisioning, and cleanup are incomplete.
- **P1 — Multimodal gap:** MiniMax M3.1 Flash supports images per NVIDIA documentation, but the engine’s message type is string-only, screenshots are never sent to the model, and UI attachments never reach the task payload.
- **P2 — Test/code drift:** One selected web regression test fails because the test expects session keys and payload symbols that the client no longer contains.

### Highest-severity blockers
| Priority | Blocker | Area |
|---|---|---|
| P0 | Companion token/authorization/update/WebSocket bypass | Local security |
| P0 | Unauthenticated workspace-runtime RCE and root container | Cloud runtime |
| P1 | Full environment inheritance by generated/local apps | Secret isolation |
| P1 | Same-origin preview sandbox escape | Preview security |
| P1 | Persistent cloud runtime not wired or provisioned | Product capability |
| P1 | No end-to-end vision or attachment pipeline | Agent capability |

**Production readiness:** `BLOCKED` until the P0 trust-boundary defects are fixed. The local agent is usable only on a trusted machine with a strict, user-controlled origin policy.

---

## 2. Verified Architecture

```text
User browser
  |
  |-- Local mode: HTTP/WS -> 127.0.0.1:3001 companion
  |     companion -> child agent process -> local workspace
  |     local dev server / Playwright -> local preview
  |
  |-- Cloud mode: HTTPS -> Next.js on Vercel -> Trigger.dev worker
  |     worker -> ephemeral /tmp workspace or Git clone
  |     worker -> agent loop -> text artifacts -> PostgreSQL
  |     preview route -> static artifact serving
  |
  |-- Persistent workspace (scaffolded)
        Next.js workspace APIs -> persistent store -> runtime adapter
        Railway adapter -> workspace-runtime container (not wired to tasks/UI)
```

### Trust boundaries
1. **Browser to local companion:** The browser is the source of local file and command authority. Origin checks and a pairing token are the only barriers.
2. **Browser to Vercel web app:** Session cookie, CSRF double-submit cookie, and profile-completion checks protect task APIs.
3. **Web app to Trigger.dev:** Trigger secret key authorizes dispatch; the worker environment contains model credentials.
4. **Web app to Railway sidecar:** Persistent workspace APIs can provision a runtime, but no live Railway credentials were present.
5. **Generated app to platform:** Generated code is untrusted but currently inherits powerful environment variables and, in preview, shares the web origin.

**Status:** Architecture is `PARTIALLY WORKING`. The components exist, but the trust boundaries are not strong enough for multi-tenant or hostile-input operation.

---

## 3. Request-to-Execution Flows

### 3.1 Local mode
1. Client checks `GET /api/companion/status` and retrieves the pairing token from `GET /api/companion/token`.
2. Client calls `POST /api/companion/authorize-workspace` with a directory.
3. Client opens a WebSocket and/or calls `POST /api/companion/tasks`.
4. `src/server.ts` validates the workspace, captures a baseline, and spawns the CLI agent.
5. The agent edits files, runs commands, starts an app server, and optionally runs Playwright verification.
6. Status, output, file changes, and app URL stream back over WebSocket.

**Status:** `VERIFIED WORKING` for trusted local use. **Security status:** `REGRESSED`/unsafe because authorization, update, and WebSocket paths bypass the token under common conditions.

### 3.2 Cloud mode
1. Client submits `POST /api/coding-agent/tasks` with `mode: "cloud"`.
2. Route requires a completed profile and CSRF validation; applies a 5-requests/minute in-memory limit and 5-minute idempotency window.
3. Route validates the task, file count/size, and paths; optionally restores prior artifacts.
4. Route creates a task row and dispatches `coding-agent-run` through Trigger.dev.
5. Trigger worker runs the same agent loop in an ephemeral container, optionally clones Git, builds, and scans text artifacts.
6. Web status route polls Trigger, persists results, and returns a signed preview URL.
7. Preview route serves static `index.html`/`dist/index.html` with CSP and a rewritten base path.

**Status:** `PARTIALLY WORKING`. Dispatch and static artifact preview exist; full-stack/SSR preview, persistent cloud containers, and live runtime previews do not work. Cloud persistence is `BLOCKED` in the inspected environment because `DATABASE_URL` is absent.

### 3.3 Persistent workspace mode
1. `/api/workspaces` and `/api/workspaces/[workspaceId]` can create/read/stop/delete runtime records through `getWorkspaceRuntimeAdapter`.
2. `remote-workspace-agent.ts` exposes `getOrCreateWorkspace` and related helpers, but neither the coding-agent task route nor the client imports it.
3. The Railway adapter can provision a service only when credentials are configured; no live credentials were present.
4. No task path populates files, starts a dev server, or exposes the workspace in the coding-agent UI.
5. `workspace-preview` can proxy to a runtime, but the UI does not use it.

**Status:** `MISSING` end-to-end. Components and authenticated APIs exist; the product workflow is not connected.

### 3.4 Preview flow
- Local mode uses the dev-server URL reported by `ensureAppServer`.
- Cloud mode uses `/api/coding-agent/preview/[taskId]?token=...`, which serves text artifacts from the database.
- A `<base href>` is injected for relative assets, but it does not carry the preview token.
- Preview relies on the session cookie for asset authorization after the initial HTML request.

**Status:** `PARTIALLY WORKING`. Static single-page apps can render; SSR frameworks, full-stack apps, binary assets, and deep SPA routes are not reliably supported.

---

## 4. Source and API Inventory

### Engine
| File | Role |
|---|---|
| `src/server.ts` | Express/WebSocket companion, origin policy, token issuance, task lifecycle, update endpoint, local env loading |
| `src/cli.ts` | CLI entrypoint and agent process runner |
| `src/agent.ts` | Main loop, tool definitions, retries, failover, snapshots, verification, result status |
| `src/router.ts` | Primary/fallback model configuration |
| `src/trigger/agent-task.ts` | Trigger cloud task, ephemeral/Git workspace, artifact scan |
| `src/tools/app-lifecycle.ts` | Start commands, readiness, generated-app environment, static fallback |
| `src/tools/terminal.ts` | Shell execution and command-guard integration |
| `src/utils/command-guard.ts` | Pattern-based command/file restrictions |
| `src/tools/git-workspace.ts` | Temporary Git clone, identity, commit/push |
| `src/tools/workspace.ts` | Path confinement and workspace operations |
| `src/tools/directory-browser.ts` | Directory listing used by companion browse endpoint |
| `src/tools/snapshot.ts` | Baseline snapshots and rollback |
| `src/browser/browser-session.ts` | Playwright session and screenshot capture (base64 only) |
| `src/browser/browser-tools.ts` | Browser tool handlers including screenshot |
| `src/browser/browser-verification.ts` | DOM/interaction verification |
| `src/quality/website-design-guide.ts` | Design principles and quality evaluation |
| `trigger.config.ts` | Trigger project, 1800-second max duration, Playwright Chromium, NVIDIA env sync |

### Web
| File/Route | Role |
|---|---|
| `app/workspace/coding-agent/AchuCodingAgentClient.tsx` | Agent UI, payload construction, attachments, history, preview iframe |
| `app/api/coding-agent/tasks/route.ts` | POST/GET tasks, auth, CSRF, rate limit, idempotency, validation, dispatch |
| `app/api/coding-agent/tasks/[taskId]/route.ts` | Status/preview/cancel/delete; local companion loopback polling |
| `app/api/coding-agent/preview/[taskId]` | Static preview entry and files |
| `app/api/workspaces` | Authenticated persistent workspace API |
| `app/api/workspace-preview/[workspaceId]/[...path]` | Authenticated proxy to runtime; forwards cookies |
| `app/lib/preview-server.ts` | Artifact resolution, base injection, CSP |
| `app/lib/preview-token.ts` | HMAC preview token creation/verification |
| `app/lib/remote-workspace-agent.ts` | Persistent workspace orchestration; not imported by tasks/UI |
| `app/lib/persistent-workspace-store.ts` | Postgres/JSON persistent workspace store |
| `app/lib/pgstore-workspaces.ts` | PostgreSQL workspace implementation |
| `app/lib/adapters/railway-adapter.ts` | Railway provisioning/lifecycle |
| `app/lib/adapters/local-workspace-adapter.ts` | Local runtime adapter |
| `app/lib/coding-agent-store.ts` / `app/lib/pgstore.ts` | Task persistence |
| `app/lib/csrf.ts` | Double-submit CSRF handling |
| `app/lib/guard.ts` | Session/profile gate; guest bypass |
| `db/migrations/*.sql` | Task, workspace, preview-token, runtime-link schema |

**Status:** Inventory is complete enough to trace all primary flows. No route was found that exposes a complete persistent-workspace task workflow.

---

## 5. Primary Model and Fallback Analysis

### Current configuration
- Primary: `minimaxai/minimax-m3.1-flash`
- Fallback: `nvidia/nemotron-3.5-lightning-30b-a3b`
- Gateway: `https://integrate.api.nvidia.com/v1`
- Credential key: `NVIDIA_API_KEY` (present in engine and web env files)
- Request settings observed: temperature `0`, streaming enabled in the retry wrapper, no `max_tokens` observed.
- Retry budget: 3 attempts, 120-second request timeout.
- Agent bound: 30 steps by default, configurable within 1–50; recovery attempts 0–5.

### Verified capability
- NVIDIA’s official MiniMax M3.1 Flash documentation confirms OpenAI-compatible `text` and `image_url` content parts and multi-image input support.
- The engine does not use those image parts. `ChatMessage.content` is `string | null`.
- Screenshot tools create base64 PNG data, but no code path adds it to a model request.
- The fallback model’s image support was not verified against vendor documentation in this pass.

### Operational behavior
- The agent uses a bounded tool-calling loop with retry/failover. Completed edits are preserved when a later verification or infrastructure step fails.
- Streaming is used at the model client level. The cloud UI primarily observes step/log metadata rather than incremental model tokens; true token-level UI streaming is `UNVERIFIED`.
- The cloud worker needs the NVIDIA key in its deployed Trigger environment. The local `.env` key is synced at deploy time by `trigger.config.ts`; deployed Trigger secrets were not inspected.

**Status:** Text reasoning `VERIFIED WORKING`; vision `MISSING`; fallback vision `UNVERIFIED`; UI token streaming `UNVERIFIED`.

---

## 6. Autonomous Coding Capability Matrix

| Capability | Status | Evidence / limitation |
|---|---|---|
| Multi-step task planning | `VERIFIED WORKING` | Agent loop, plan state, bounded steps |
| Read/search files | `VERIFIED WORKING` | Workspace tools and path checks |
| Create/edit files | `VERIFIED WORKING` | Atomic edits, syntax validation, selected tests pass |
| Run terminal commands | `PARTIALLY WORKING` | Commands execute; guard is pattern-based, not a sandbox |
| Build/test application | `PARTIALLY WORKING` | Build commands supported; results depend on environment |
| Start local app | `VERIFIED WORKING` | `app-lifecycle` detects commands, allocates ports, probes readiness |
| Local live preview | `VERIFIED WORKING` | Dev server URL is surfaced to the UI |
| Cloud static preview | `PARTIALLY WORKING` | Text artifacts only; SSR/full-stack not supported |
| Cloud persistent app | `MISSING` | No task/UI wiring, no live provisioning |
| Browser DOM verification | `VERIFIED WORKING` | Playwright verification and selected tests pass |
| Visual screenshot understanding | `MISSING` | Screenshots are captured but not sent to a model |
| UI attachment ingestion | `MISSING` | Attachments are displayed, not submitted |
| Git clone/commit/push | `PARTIALLY WORKING` | HTTPS/GitHub path exists; exact host policy unverified |
| Account/task history | `PARTIALLY WORKING` | Task store exists; project-level continuity incomplete |
| Cancel/delete task | `VERIFIED WORKING` | Routes and companion cancellation exist |
| Persistent preview/HMR | `MISSING` end-to-end | Lifecycle components tested; not connected to agent UI |

---

## 7. Website-Building Quality

### Implemented
- A substantial design guide and quality framework exists: website principles, structured design guidance, category scoring, and automated checks.
- Browser verification focuses on semantic text, buttons, forms, layout geometry, and interaction behavior.
- Engine tests for the website design guide and file syntax pass.

### Limits
- Quality scoring is heuristic and DOM-centric. It does not inspect rendered pixels.
- The model cannot see a screenshot; visual judgments are inferred from DOM measurements and code.
- `inspect_visual_quality` is not a substitute for a vision-language feedback loop.
- Website tasks may still produce visually weak output despite passing structural checks.

**Status:** `PARTIALLY WORKING`. Structural and interaction verification is credible; perceived visual quality is not actually verified.

---

## 8. Account, Project History, and Persistence

### Implemented
- `coding_agent_tasks` and related migrations persist task status, payload, results, artifacts, and workspace linkage.
- Task history and artifact restoration exist.
- Persistent workspace tables, ownership checks, preview tokens, and a `runtime_workspace_id` migration exist.
- `pgstore-workspaces.ts` has a PostgreSQL implementation; `persistent-workspace-store.ts` has a JSON-file fallback.
- Task route uses a 5-minute idempotency window and a per-user, per-instance 5/minute rate limit.

### Gaps
- The web client sends `workspaceId` but not `projectId`; artifact restoration is therefore keyed primarily by workspace/session identifiers rather than an explicit project identity.
- `DATABASE_URL` is absent from the inspected env files. Production DB behavior is `BLOCKED`/`UNVERIFIED`.
- The JSON fallback is ephemeral on Vercel; persistence depends on PostgreSQL being configured.
- Guest sessions are treated as completed users and can reach workspace/coding-agent APIs.
- Rate limiting is in-memory and does not behave consistently across serverless instances.
- Persistent workspace APIs are not connected to the coding-agent task or UI history.

**Status:** `PARTIALLY WORKING`. Task history exists; durable production persistence and project isolation are not proven.

---

## 9. Live Preview and Browser Workflow

### Local
- The agent can spawn a dev server and surface its URL.
- Readiness probing, port selection, and process lifecycle exist.
- Local preview is the strongest preview path and supports real app behavior.

### Cloud
- `servePreviewFile` resolves `index.html` or `dist/index.html`, injects a `<base href>`, and sets CSP.
- Artifacts are limited to text files; binary assets, fonts, and images may be omitted.
- The artifact scan cap is 250 files with per-file/total limits.
- Next.js/SSR/server-side API preview is not supported; `.next` output is not a static entrypoint.
- Deep SPA routes are not rewritten to `index.html`.
- The base href does not include the preview token, so subresources rely on the session cookie.
- Preview tokens are valid for 24 hours and are bucketed into 10-minute windows.

### Persistent
- `workspace-preview` can proxy to a runtime with authentication, but the UI does not consume it.
- The proxy forwards incoming cookies to the runtime and forwards query strings.

### Security
- The preview iframe combines `allow-scripts` and `allow-same-origin` on same-origin content. This effectively permits generated JavaScript to access the parent origin and session.
- CSP permits inline and evaluated scripts, which is expected for generated apps but increases the impact of the same-origin boundary failure.
- The HMAC token fallback secret is a known development constant if `SESSION_SECRET`/`CSRF_SECRET` are missing.

**Status:** Local `VERIFIED WORKING`; cloud static `PARTIALLY WORKING`; persistent preview `MISSING` end-to-end; preview security `REGRESSED`/unsafe.

---

## 10. Autonomous Error Recovery and Loop Prevention

### Implemented
- Maximum step count and maximum recovery attempts are configurable and clamped.
- Primary/fallback model failover handles rate limits, transient server errors, and network timeouts.
- Snapshot/rollback support exists.
- Completed edits are preserved; unrecoverable verification/infrastructure failures can return `PARTIAL`.
- Repeated edit failures have specific handling.
- Task cancellation and workspace locks exist.

### Limits
- No hard sandbox prevents a misbehaving agent from consuming host resources or exfiltrating secrets.
- Retries can multiply cost/latency; no explicit token/cost budget was observed.
- Recovery quality depends on heuristics and does not guarantee semantic correctness.
- Rollback is not a full transactional filesystem rollback in all failure modes.

**Status:** `VERIFIED WORKING` for the implemented recovery mechanics; production safety is `PARTIALLY WORKING` because execution is not isolated.

---

## 11. Git, Local/Cloud Execution, and Deployment

### Git
- `GitWorkspace` clones into a unique temporary directory and supports identity configuration, commit, and push.
- GitHub HTTPS URLs can receive `GITHUB_TOKEN`/`GIT_TOKEN`; private non-GitHub hosts have no credential injection.
- Engine validation appears HTTPS-only with a local test allowance; the exact host allowlist was not confirmed.
- The web route accepts HTTP repository URLs, but the engine rejects them, causing a mode mismatch.

### Local/cloud execution
- Local mode executes on the user’s machine with full user privileges.
- Cloud mode uses an ephemeral Trigger worker with a temporary workspace and text-artifact persistence.
- There is no persistent cloud container for the normal coding-agent flow.
- Persistent workspace APIs can provision a runtime adapter, but not for normal task execution.

### Deployment
- Web: Next.js 16.4.2 on Vercel.
- Cloud jobs: Trigger.dev, configured for 1800 seconds and Playwright Chromium.
- Persistent runtime: Railway adapter plus Docker sidecar; **not provisionable** in the inspected environment because Railway credentials and a published image are not confirmed.
- The runtime Dockerfile runs as root and exposes command-execution ports.

**Status:** Local `VERIFIED WORKING`; cloud batch jobs `PARTIALLY WORKING`; persistent deployment `BLOCKED`; Git `PARTIALLY WORKING`.

---

## 12. Security, Isolation, and Production Reliability

### 12.1 F-01 — Companion local trust-boundary bypass (P0)
- **Status:** `REGRESSED`
- **Evidence:** `src/server.ts` `isAllowedOrigin` accepts any `*.vercel.app`, any hostname containing `workswithachu`/`works-with-achu`, and requests without an `Origin`. `/api/companion/token` is loopback-restricted but reachable from a browser on the user’s machine. `authorize-workspace`, `tasks`, `sync-artifacts`, and `update/apply` pass when the token header is omitted. WebSocket checks origin only, and `run_task` accepts an explicit `workspaceRoot`. The update endpoint launches `powershell.exe -ExecutionPolicy Bypass` detached without CSRF protection.
- **Reproduction (safe, conceptual):** A page on an attacker-controlled `*.vercel.app` deployment requests the loopback token, submits `POST /api/companion/authorize-workspace` with a chosen directory, then invokes the task/WebSocket path with no token header, or triggers the update endpoint.
- **Impact:** Arbitrary local file access under the user’s account; agent-driven command execution; update/restart trigger. This is local remote code execution via the browser.
- **Fix:** Exact-origin allowlist; remove wildcard/substring matching; require a per-session token on every endpoint; authenticate WebSocket handshakes; remove token from logs; require user confirmation for absolute paths; add CSRF/origin checks and signed updates; disable unauthenticated browse/update/status endpoints.
- **Dependencies/risks:** Companion install/upgrade compatibility; browser CORS behavior; token storage; localhost-only binding.
- **Regression tests:** Unauthorized-origin token denial; missing-token denial; WebSocket denial; arbitrary-path denial; update CSRF denial; browser integration with exact allowed origin.

### 12.2 F-02 — Unauthenticated workspace-runtime RCE (P0)
- **Status:** `REGRESSED` (latent until a public runtime domain exists)
- **Evidence:** `workspace-runtime/server.js` has no auth middleware and `Access-Control-Allow-Origin: *`. `/api/exec` uses `shell: true`, merges client environment, and accepts `node -e`. `/api/dev-server/start` accepts arbitrary commands. `/api/shutdown` is unauthenticated. `validatePath` uses a string prefix without a separator and does not resolve symlinks. The Dockerfile runs as root with no `USER`.
- **Reproduction (conceptual):** Request `/api/exec` or `/api/dev-server/start` on a reachable runtime with a shell command; read files via the file APIs; invoke `/api/shutdown`.
- **Impact:** Remote code execution as root inside the runtime, data theft, lateral movement, denial of service, and billing abuse.
- **Fix:** Authenticate every runtime request with a short-lived workspace token; remove shell execution and `node -e`; use argv-based allowlisted commands; enforce `realpath` confinement; run non-root; disable CORS `*`; require signed control-plane calls; remove or authenticate shutdown; add egress policy.
- **Dependencies/risks:** Adapter must inject and rotate tokens; reverse proxy must preserve auth; Railway public-domain configuration.
- **Regression tests:** Unauthenticated request denial; command-injection denial; symlink/prefix traversal denial; non-root image check; CORS policy check; shutdown denial.

### 12.3 F-03 — Broad secret inheritance by generated apps (P1)
- **Status:** `REGRESSED`
- **Evidence:** `src/server.ts` `loadLocalEnv` has hardcoded `C:\Users\Achu146\...` paths and loads engine plus web `.env`/`.env.local`. `src/tools/app-lifecycle.ts` sets `spawnEnv = {...process.env, PORT}` and passes it to generated apps; static fallback runs `npx --yes serve -l 3000 .` bound to `0.0.0.0`. Trigger workers also expose worker env to generated app processes.
- **Impact:** Generated or prompt-injected code can read `SESSION_SECRET`, `CSRF_SECRET`, database, Trigger, NVIDIA, and other credentials; a local static app may be reachable from the LAN.
- **Fix:** Build generated-app env from an explicit allowlist; never load web env into the engine; remove hardcoded user paths; inject only app-specific variables; bind local preview servers to loopback; separate worker credentials from app runtime credentials.
- **Dependencies/risks:** App functionality may depend on env vars; installers must locate env files safely.
- **Regression tests:** Child-process env fixture; generated app cannot see secrets; static server bind address; app startup after allowlist.

### 12.4 F-04 — Same-origin preview sandbox and cookie forwarding (P1)
- **Status:** `REGRESSED`
- **Evidence:** The preview iframe uses `allow-scripts` plus `allow-same-origin` for same-origin content. CSP permits `'unsafe-inline'` and `'unsafe-eval'`. The preview token is in the initial URL only; `<base>` lacks it. `workspace-preview` forwards `Cookie` headers to a runtime. The preview-token fallback secret is a fixed development constant.
- **Impact:** Generated JavaScript can access parent/window origin state, call authenticated APIs, and exfiltrate session data. Runtime proxies may leak session cookies. Misconfigured deployments can forge preview tokens.
- **Fix:** Serve previews from an isolated origin; remove `allow-same-origin`; use a strict CSP; put a scoped preview token on all asset requests; never forward session cookies to runtimes; fail closed on missing signing secrets; use a dedicated preview signing key.
- **Dependencies/risks:** Preview origin/DNS; generated apps that need cookies; asset authorization.
- **Regression tests:** Cross-origin isolation; token required for assets; cookie not forwarded; fallback-secret startup failure; iframe sandbox contract.

### 12.5 F-05 — Persistent runtime is not wired end-to-end (P1)
- **Status:** `MISSING`
- **Evidence:** `remote-workspace-agent.ts` exists and imports the store, but the tasks route and client do not import it. Workspace APIs exist and are authenticated, but no task creation populates files, starts a server, or returns a persistent preview to the agent UI.
- **Impact:** The “persistent cloud runtime” feature is not delivered; users still get ephemeral Trigger runs or local-only execution.
- **Fix:** Connect task creation to `getOrCreateWorkspace`; upload task files; start the runtime dev server; persist `runtime_workspace_id`; return a workspace preview URL; add UI state and cleanup.
- **Dependencies/risks:** Railway credentials; image; database migration; task lifecycle; cost controls.
- **Regression tests:** Create workspace -> upload -> start -> preview -> stop/delete; task/workspace ownership; restart/reconnect.

### 12.6 F-06 — Railway lifecycle, readiness, domains, and cleanup (P1)
- **Status:** `PARTIALLY WORKING` / `BLOCKED`
- **Evidence:** `RailwayAdapter.isConfigured()` requires `RAILWAY_API_KEY` and `RAILWAY_PROJECT_ID`, both absent. Readiness constants exist but the create/API flow does not wait for readiness. No `serviceDomainCreate` was found, so public runtime URL creation is unverified. `stop()` without force only stops the dev server while the service remains billable. No cleanup scheduler invokes `cleanupExpiredWorkspaces`; `expiresAt` is set but unused.
- **Impact:** Provisioning can return an unusable or unreachable workspace; services and databases can leak cost; users may see stale “running” states.
- **Fix:** Require readiness before returning success; create/attach a domain explicitly; implement force cleanup and a scheduled reaper; align DB state with remote state; add quotas and budget alarms.
- **Dependencies/risks:** Railway API schema; billing approval; public domain policy.
- **Regression tests:** Mock readiness timeout/failure; service domain creation; stop/delete state reconciliation; expired-workspace cleanup.

### 12.7 F-07 — Vision is not integrated (P1)
- **Status:** `MISSING`
- **Evidence:** `ChatMessage` is string-only. Screenshots are base64 in `browser-session.ts` and `browser-tools.ts` but never added to a model request. The screenshot tool documents that the agent cannot interpret pixels.
- **Impact:** The agent cannot visually validate layouts, compare designs, or debug visual regressions. Claims of visual quality are overstated.
- **Fix:** Extend message/tool types to OpenAI `image_url` content parts; send screenshot/base64 for relevant steps; add attachment plumbing; add image size/type limits; test with MiniMax; verify fallback support or remove fallback image claims.
- **Dependencies/risks:** Model support; token cost; screenshot size; prompt-injection risk from images.
- **Regression tests:** Image content-part serialization; screenshot-to-model path; attachment-to-payload path; fallback behavior when vision is unsupported.

### 12.8 F-08 — UI attachments never reach the payload (P1)
- **Status:** `MISSING`
- **Evidence:** `AchuCodingAgentClient.tsx` maintains `composerAttachments` and renders chips, but `handleComposerAttach` reads text only and the submit payload excludes attachments.
- **Impact:** Users can attach images/documents that silently do nothing; no multimodal task input exists.
- **Fix:** Encode supported attachments; include them in the payload with type/size validation; persist them with the task; pass image parts to the agent; add failure UI for unsupported files.
- **Dependencies/risks:** Storage; payload limits; model image support; security scanning.
- **Regression tests:** UI attachment -> payload; invalid type rejection; size limit; history rendering.

### 12.9 F-09 — Command guard is not an isolation boundary (P1)
- **Status:** `PARTIALLY WORKING`
- **Evidence:** `validateCommand` is pattern-based and permits `node -e`, `powershell`, `cmd`, `curl`, environment inspection, and absolute-path reads. The agent executes with the user’s privileges.
- **Impact:** Prompt-injected repository content can read secrets and exfiltrate them; no OS-level containment.
- **Fix:** Execute in a container/VM with a read-only secret boundary; network egress allowlist; user approval for privileged commands; remove direct host execution for untrusted repositories.
- **Dependencies/risks:** Performance; local developer experience; platform support.
- **Regression tests:** Secret-read denial; network egress denial; shell bypass tests; approval flow.

### 12.10 F-10 — Local status route uses server-side loopback (P2)
- **Status:** `REGRESSED`
- **Evidence:** `app/api/coding-agent/tasks/[taskId]/route.ts` detects local mode and fetches `http://127.0.0.1:3001/...` from the Next.js server. On Vercel, that is the server’s loopback, not the user’s companion.
- **Impact:** Hosted status/persistence for local tasks can fail or become stale; direct client polling may mask the issue.
- **Fix:** Poll the companion from the browser, or add an authenticated relay/tunnel; do not fetch user-localhost from the server.
- **Dependencies/risks:** CORS; token handling; offline behavior.
- **Regression tests:** Hosted local-mode status; reconnect; DB reconciliation.

### 12.11 F-11 — Web regression test fails (P2)
- **Status:** `REGRESSED`
- **Evidence:** `tests/coding-agent-preview-regression.test.ts` expects `achu_coding_agent_selected_task_id` and `targetCloudTaskId`; the client uses `achu_coding_agent_active_task_id` and lacks `targetCloudTaskId`.
- **Impact:** The preview/history regression contract is not enforced; the suite is red.
- **Fix:** Decide whether the old key/payload contract must be restored or the test should be updated; align client, tests, and docs.
- **Dependencies/risks:** Existing users may have the old session key; migration/fallback.
- **Regression tests:** Reload restore; cloud task selection; session migration.

### 12.12 F-12 — Defaults, guest access, rate limits, headers (P2)
- **Status:** `PARTIALLY WORKING`
- **Evidence:** Preview and CSRF modules contain fixed development fallback secrets. Guest sessions bypass profile DB checks. Task rate limiting is in-memory. `next.config.*` adds no security headers; no middleware/`vercel.json` was found.
- **Impact:** Misconfiguration can weaken token/CSRF integrity; guest/cost abuse; inconsistent limits; missing defense-in-depth headers.
- **Fix:** Fail closed on missing production secrets; add distributed rate limits and quotas; decide guest policy; add CSP/HSTS/frame/referrer headers at the edge.
- **Dependencies/risks:** Deployment env; guest product requirements.
- **Regression tests:** Missing-secret startup failure; guest policy; limit enforcement across instances; header checks.

### 12.13 F-13 — Preview capability limits (P2)
- **Status:** `PARTIALLY WORKING`
- **Evidence:** Static artifact-only preview, text-only collection, 250-file/2 MB limits, no Next.js/SSR runtime, no SPA deep-route fallback, base href lacks token.
- **Impact:** Many generated apps cannot be previewed truthfully; users may see a broken or incomplete app while the task is marked successful.
- **Fix:** Add a runtime preview for full-stack apps; support binary assets; implement SPA fallback; include tokens in asset URLs; label static-preview limitations.
- **Dependencies/risks:** Persistent runtime; storage; build pipeline.
- **Regression tests:** Next.js preview; SPA route; image asset; missing asset handling; artifact cap behavior.

### 12.14 F-14 — Git validation and HTTP mismatch (P2)
- **Status:** `PARTIALLY WORKING` / `UNVERIFIED`
- **Evidence:** Web accepts HTTP Git URLs; engine validation appears HTTPS-only. Exact host allowlist was not confirmed. `GitWorkspace` injects credentials only for GitHub HTTPS. Internal HTTPS URLs could be cloned if reachable (SSRF surface).
- **Impact:** Valid-looking tasks fail; private non-GitHub repos cannot authenticate; potential internal network access.
- **Fix:** Align web/engine validation; enforce an explicit host allowlist; block private/link-local/metadata destinations; surface auth requirements before dispatch.
- **Dependencies/risks:** Git provider support; enterprise hosts.
- **Regression tests:** HTTP rejection; host allowlist; metadata-IP rejection; private repo auth.

### 12.15 F-15 — Static server and supply-chain exposure (P3)
- **Status:** `PARTIALLY WORKING`
- **Evidence:** Static fallback uses `npx --yes serve` at runtime, binds `0.0.0.0`, and downloads an unpinned package. The runtime image uses an unpinned `pnpm@latest` and a `:latest` runtime image by default.
- **Impact:** LAN exposure of generated apps; supply-chain drift; unreproducible builds.
- **Fix:** Pin dependencies/images by digest; use a bundled static server; bind loopback; add an explicit LAN opt-in.
- **Dependencies/risks:** Offline installs; image publishing.
- **Regression tests:** Lockfile/image digest check; bind-address test; offline start.

### 12.16 F-16 — Production database configuration absent (P2/BLOCKED)
- **Status:** `BLOCKED`
- **Evidence:** No `DATABASE_URL` in inspected env files; `db.ts` enforces production database configuration. The local JSON fallback is not durable on Vercel.
- **Impact:** Cloud/persistent task history cannot be verified locally; production deployment may return 503 or lose state if the platform secret is missing.
- **Fix:** Provision the production database, set `DATABASE_URL`, run migrations, verify backups/retention, and add a readiness check.
- **Dependencies/risks:** Database provider; migration window; data retention.
- **Regression tests:** Production-mode startup; migration idempotency; task save/read; reconnect.

### 12.17 Security posture summary
| Area | Status | Highest severity |
|---|---|---|
| Local companion auth | `REGRESSED` | P0 |
| Runtime sidecar isolation | `REGRESSED` | P0 |
| Secret/environment isolation | `REGRESSED` | P1 |
| Preview isolation | `REGRESSED` | P1 |
| Agent command isolation | `PARTIALLY WORKING` | P1 |
| Cloud workspace lifecycle | `BLOCKED`/`MISSING` | P1 |
| Web API auth/CSRF | `PARTIALLY WORKING` | P2 |
| App-wide headers/limits | `PARTIALLY WORKING` | P2 |

**Conclusion:** The system’s security documentation overstates the current protections. Pattern checks and signed tokens exist, but the effective trust boundaries are bypassable.

---

## 13. Tests and Verification Results

### Checks actually run
| Check | Result |
|---|---|
| Engine `npx tsc --noEmit` | Pass, no output |
| Web `npx tsc --noEmit --incremental false` | Pass, no output |
| Web `npm run build` (Next.js 16.4.2/Turbopack) | Pass: compiled in 23.9s; TypeScript finished in 10.3s; 24 static pages generated |
| Engine selected tests (`model-routing-failover`, `edit-file`, `file-syntax-validator`, `website-design-guide`, `package-version`) | Pass |
| Web selected tests (`coding-agent-tasks`, `coding-agent-preview-regression`, `workspace-runtime-proxy`, `persistent-workspace-lifecycle-hmr`) | One failure; remaining selected checks passed |
| Docker/runtime execution tests | Not run (Docker unavailable/skipped) |
| Live Trigger/Railway integration | Not run (no deployment/credentials) |
| Full test suites | Not run |

### Exact failing test
- File: `tests/coding-agent-preview-regression.test.ts`
- Test: “Client persists selected task ID and restores preview across reloads”
- Failure: expects source strings `achu_coding_agent_selected_task_id` and `targetCloudTaskId`; the client uses `achu_coding_agent_active_task_id` and does not contain `targetCloudTaskId`.
- Classification: test/code contract drift, `REGRESSED`. The runtime impact is not fully determined; the test must be reconciled with the intended contract.

### Build notes
- Next.js emitted warning: a package-lock outside the Git repository was ignored; set `turbopack.root` if that directory is intentional.
- Next.js emitted experimental `localStorage` warnings during static generation.
- No source files were modified by this inspection. The build wrote `.next` only.

### Existing claims not independently verified
- The repository’s P2-A report claims 58 workspace tests pass and that the runtime is “complete and correct” but not live-provisioned. This inspection did not reproduce that full suite.
- The report claims path traversal prevention and SSRF protection; static review found a prefix/symlink weakness in `workspace-runtime` and cookie forwarding in the preview proxy.
- No live MiniMax image request was made. Vision support is based on official documentation plus static code inspection.

---

## 14. Confirmed Bugs, Incomplete Functionality, and Unverified Assumptions

### 14.1 Confirmed defects
| ID | Defect | Status | Severity |
|---|---|---|---|
| F-01 | Companion origin/token/WS/update bypass and arbitrary workspace authorization | `REGRESSED` | P0 |
| F-02 | Unauthenticated workspace-runtime RCE, root container, path bypass | `REGRESSED` | P0 |
| F-03 | Generated apps inherit broad secrets; static server binds `0.0.0.0` | `REGRESSED` | P1 |
| F-04 | Same-origin preview sandbox, weak CSP, cookie forwarding, fallback secrets | `REGRESSED` | P1 |
| F-05 | Persistent runtime not connected to tasks/UI | `MISSING` | P1 |
| F-06 | Railway readiness/domain/cleanup incomplete; credentials absent | `PARTIALLY WORKING`/`BLOCKED` | P1 |
| F-07 | Vision not integrated despite model support | `MISSING` | P1 |
| F-08 | UI attachments never submitted | `MISSING` | P1 |
| F-09 | Command guard is not a sandbox | `PARTIALLY WORKING` | P1 |
| F-10 | Hosted local status polls wrong loopback | `REGRESSED` | P2 |
| F-11 | Preview regression test fails | `REGRESSED` | P2 |
| F-12 | Fixed fallback secrets, guest access, in-memory limits, no headers | `PARTIALLY WORKING` | P2 |
| F-13 | Static preview cannot represent SSR/full-stack apps | `PARTIALLY WORKING` | P2 |
| F-14 | HTTP/HTTPS Git validation mismatch; host policy unverified | `PARTIALLY WORKING`/`UNVERIFIED` | P2 |
| F-15 | Unpinned runtime deps/images and LAN-bound static server | `PARTIALLY WORKING` | P3 |
| F-16 | Production database URL absent in inspected environment | `BLOCKED` | P2 |

### 14.2 Unverified assumptions
- MiniMax image requests have not been executed live.
- Fallback model image support is unknown.
- Trigger deployed environment secret contents are unknown.
- Railway GraphQL schema/domain behavior is unknown without credentials.
- The default workspace-runtime image may not be published or may not match the inspected Dockerfile.
- Whether the cloud UI displays incremental tokens (rather than polling metadata) is unconfirmed.
- Whether `validateGitUrl` has a host allowlist beyond scheme checks is unconfirmed.
- Whether `withCsrfProtection` protects every non-GET method as intended was not fully traced.
- Whether guest sessions can be created at will and abused for cost is unverified.

### 14.3 Documentation discrepancies
- “Strict isolation and security” is not supported by the effective companion/runtime behavior.
- “Production-grade” descriptors for runtime adapters overstate readiness; live provisioning was never verified.
- The sidecar’s command allowlist is not a security boundary because `node -e` and arbitrary dev-server commands are accepted.
- Preview token/CSP protections do not prevent same-origin artifact execution.

---

## 15. Product Capability Comparison

| Promise | Local mode | Cloud mode | Persistent cloud | Verdict |
|---|---|---|---|---|
| Generate an app from natural language | `VERIFIED WORKING` | `PARTIALLY WORKING` | Not wired | Functional locally; cloud limited |
| Edit an existing repo | `VERIFIED WORKING` | `PARTIALLY WORKING` | Not wired | Depends on Git/workspace setup |
| Run a terminal | `VERIFIED WORKING` | `PARTIALLY WORKING` | Sidecar exists | Unsafe without isolation |
| Preview app live | `VERIFIED WORKING` | Static artifacts only | Proxy exists, unused | Full-stack cloud preview missing |
| See visual screenshots | `MISSING` | `MISSING` | `MISSING` | No multimodal feedback |
| Attach images/documents | `MISSING` | `MISSING` | `MISSING` | UI-only attachments |
| Persist project state | `PARTIALLY WORKING` | `PARTIALLY WORKING` | `MISSING` | DB required; project key incomplete |
| Persistent cloud app | No | No | Scaffolded only | Not delivered |
| Secure multi-tenant execution | No | Partially | No | P0 blockers |

---

## 16. Prioritized Roadmap

### P0 — Security containment (must precede external use)
1. Replace wildcard/substring origin checks with an exact allowlist.
2. Require a per-session token on every companion HTTP endpoint and WebSocket handshake; reject missing tokens.
3. Remove unauthenticated browse/update/status surfaces; add CSRF and explicit user confirmation to updates.
4. Authenticate the workspace-runtime sidecar; remove shell execution, `node -e`, arbitrary dev-server commands, and unauthenticated shutdown; run non-root; fix `realpath` confinement.
5. Stop inheriting web `.env` and full process env into generated apps; bind local servers to loopback.

### P1 — Capability and isolation
6. Isolate previews on a separate origin with strict CSP and no session cookie forwarding.
7. Wire vision and attachments end-to-end, with limits and fallback behavior.
8. Connect persistent workspaces to task execution/UI, including readiness, domain creation, file upload, and preview.
9. Add a durable database, distributed quotas, and production startup checks.
10. Replace the pattern-based command guard with a real sandbox/egress boundary.

### P2 — Reliability and product quality
11. Fix the preview regression test and restore/align session contracts.
12. Add Next.js/SPA/binary preview support or clearly label static-only limitations.
13. Fix local status polling architecture.
14. Add security headers, structured security logging, and secret-scanning tests.

### P3 — Hardening and operations
15. Pin images/dependencies; build a reproducible sidecar image; add SBOM/signing.
16. Add cost budgets, cleanup reapers, and workspace quotas.
17. Add full E2E and adversarial test suites in CI.

### P4 — Expansion
18. Multi-provider model routing with explicit vision capability metadata.
19. Isolated per-tenant runtime pools, observability, and replayable task traces.

---

## 17. Target Architecture Specification

### Local companion
- Bind to loopback by default; LAN mode requires explicit user opt-in.
- Pairing token generated per install, rotated, stored securely, never logged.
- Exact origin allowlist, no wildcard subdomains.
- Token required on all HTTP/WS paths; per-session scoped tokens for tasks.
- User confirmation for workspace paths outside an approved root.
- Signed, user-initiated updates with integrity verification.
- Agent executes in a sandbox with an env allowlist and egress policy.

### Cloud execution
- Per-run isolated container with no platform secrets in the app environment.
- Scoped repository credentials and short-lived tokens.
- Artifact sanitizer; binary/asset storage separate from text artifacts.
- Full-stack preview via isolated runtime, not static artifact serving.

### Persistent workspace
- Control plane authenticates every operation.
- Runtime sidecar uses short-lived workspace tokens; no public unauthenticated API.
- Explicit public-domain creation and readiness checks.
- File upload/start commands are orchestrated by the control plane.
- TTL cleanup, quotas, cost alarms, and state reconciliation.

### Preview
- Separate preview domain/origin.
- No application session cookies.
- Scoped preview token on HTML and assets.
- Strict CSP; no `allow-same-origin` for untrusted artifacts.
- Clear “static snapshot” vs “live runtime” labeling.

### Data
- PostgreSQL as production task/workspace store.
- Explicit `projectId` in task payloads.
- Durable artifact/object storage for binaries.
- Migration and rollback discipline.

---

## 18. Affected Files Inventory for Target Implementation

| Area | Files |
|---|---|
| Companion auth/update | `src/server.ts`, `src/tools/directory-browser.ts`, installer/update scripts |
| Agent execution isolation | `src/agent.ts`, `src/tools/terminal.ts`, `src/utils/command-guard.ts`, sandbox/runner modules |
| App environment | `src/server.ts` (`loadLocalEnv`), `src/tools/app-lifecycle.ts`, `trigger.config.ts` |
| Preview security | `AchuCodingAgentClient.tsx`, `app/lib/preview-server.ts`, `app/lib/preview-token.ts`, preview routes |
| Runtime sidecar | `workspace-runtime/server.js`, `workspace-runtime/Dockerfile`, `workspace-runtime/package.json` |
| Persistent runtime | `app/lib/remote-workspace-agent.ts`, `persistent-workspace-store.ts`, `pgstore-workspaces.ts`, adapters, workspace APIs |
| Task/history | `app/api/coding-agent/tasks/route.ts`, `[taskId]/route.ts`, `coding-agent-store.ts`, `pgstore.ts`, migrations |
| Vision/attachments | `src/agent.ts`, `src/browser/browser-session.ts`, `browser-tools.ts`, `AchuCodingAgentClient.tsx`, task schema |
| Security config | `app/lib/csrf.ts`, `app/lib/guard.ts`, `next.config.*`, deployment headers |
| Tests | `tests/coding-agent-preview-regression.test.ts`, `tests/p2a-cloud-runtime.test.ts`, workspace-runtime tests, new adversarial tests |

---

## 19. Acceptance Criteria for Key Improvements

### P0 security
- A request from an unlisted origin cannot obtain a token, authorize a workspace, run a task, or connect a WebSocket.
- Omitting the token header on any protected endpoint returns 401.
- The update endpoint cannot be triggered cross-site; updates require an explicit user action and signature.
- The runtime sidecar rejects unauthenticated requests and never executes arbitrary shell strings.
- Generated apps cannot read platform secrets.
- Preview artifacts cannot access the web app origin/session.
- A malicious repo cannot exfiltrate env secrets through the agent’s terminal.

### Vision/attachments
- An attached image is persisted, sent as an `image_url` content part, and acknowledged by the UI.
- A screenshot can be sent to MiniMax and returns a visual observation.
- Unsupported models fail gracefully without claiming visual verification.
- Image size/type limits are enforced server-side.

### Persistent runtime
- A task can create a workspace, upload files, start the app, return a preview URL, and stop/delete it.
- Readiness failure is surfaced before success.
- Expired workspaces are reaped; billing state matches DB state.
- Ownership checks prevent cross-user access.

### Preview
- SSR/full-stack apps can be previewed in an isolated runtime, or the UI explicitly labels static-only limits.
- SPA deep routes and binary assets work or fail with clear diagnostics.
- Preview tokens cover all subresources.

### Tests/operations
- Full test suites, Docker runtime tests, production build, and a live Trigger/Railway smoke test pass.
- Security regression tests cover every P0 bypass.
- Production database and secrets are configured and verified without exposing values.

---

## 20. Configuration and Environment Setup

### Required/expected keys
| Key | Purpose | Present in inspected env? |
|---|---|---|
| `NVIDIA_API_KEY` | Model gateway | Yes |
| `TRIGGER_SECRET_KEY` | Trigger dispatch | Yes |
| `SESSION_SECRET` | Session/preview signing | Yes (web) |
| `CSRF_SECRET` | CSRF/preview fallback | Yes (web) |
| `DATABASE_URL` | Production task/workspace store | No |
| `RAILWAY_API_KEY` | Railway provisioning | No |
| `RAILWAY_PROJECT_ID` | Railway project target | No |
| `WORKSPACE_RUNTIME_IMAGE` | Sidecar image | No |
| `ACHU_COMPANION_TOKEN` | Companion token override | No |
| `ACHU_ALLOWED_ORIGINS` | Companion origin allowlist | No |
| `GITHUB_TOKEN`/`GIT_TOKEN` | Private GitHub clone/push | Not verified |
| `RAILWAY_ENVIRONMENT_ID` | Railway environment | No |

### Observations
- Missing companion token means the server generates/persists one; the token is logged to console.
- Missing origin allowlist means built-in wildcard/substring defaults apply.
- Missing database URL means JSON fallback locally and no verified production persistence.
- Missing Railway credentials means persistent provisioning is blocked.
- `trigger.config.ts` syncs only NVIDIA-related keys to Trigger at deploy time.
- No secret values are included in this report.

### Production prerequisites
1. Exact production origins and companion token policy.
2. PostgreSQL URL, migrations, backups, and retention.
3. Trigger deployment and secret verification.
4. Railway credentials, published pinned image, domain policy, and billing approval.
5. Edge security headers and distributed rate limiting.

---

## 21. Deployment and Rollback Strategy

### Deployment topology
- **Web:** Vercel/Next.js 16.4.2 production build.
- **Cloud jobs:** Trigger.dev worker with Playwright and 1800-second duration.
- **Local agent:** installed companion on `127.0.0.1:3001`.
- **Persistent runtime:** Railway service from the workspace-runtime image; currently not provisioned.

### Pre-deploy gates
1. P0 security fixes and regression tests pass.
2. `DATABASE_URL` configured; migrations applied and verified.
3. Trigger environment secrets verified via a health task.
4. Runtime image built, pinned, scanned, and pushed; Railway credentials verified.
5. Web production build and full test suite pass.

### Migration strategy
- Apply additive migrations first (`runtime_workspace_id`, workspace/preview tables).
- Keep backward-compatible fallbacks for missing columns.
- Backfill or tolerate nulls; verify ownership queries.
- Roll back application code independently of additive columns where possible.
- Provide down migrations and test them on a staging copy.

### Rollback
- Disable persistent workspace provider via configuration; fall back to local/Trigger.
- Revert only the affected web/engine deployment; do not force-push or rewrite history.
- Rotate any credential exposed during a failed deployment.
- Reconcile orphaned Railway services and database records.
- Preserve task/artifact data unless explicitly authorized.

### Current deployment status
- Web build: `VERIFIED WORKING`.
- Trigger live run: `UNVERIFIED`.
- Railway provisioning: `BLOCKED`.
- Runtime Docker execution: `UNVERIFIED`.
- Production migrations: `BLOCKED` (no database URL).

---

## 22. End-to-End Release Verification Checklist

### Local mode
- [ ] Companion starts on `127.0.0.1`; token is not printed in production logs.
- [ ] Exact allowed origin succeeds; unlisted/\*.vercel.app origin and no-Origin requests are denied.
- [ ] Token is required on every HTTP/WS endpoint.
- [ ] Authorizing an arbitrary absolute path requires confirmation.
- [ ] Task creates/edits files; terminal runs with sandbox/egress policy.
- [ ] App starts, preview loads, and HMR works where applicable.
- [ ] Cancel, failure, cancellation, and lock release work.
- [ ] Generated app cannot read platform secrets.

### Cloud mode
- [ ] Task route enforces auth, CSRF, quotas, and idempotency across instances.
- [ ] Trigger dispatch succeeds and worker secrets are scoped.
- [ ] Git HTTPS/private repo behavior is correct; HTTP is rejected consistently.
- [ ] Build and artifact scan work; failures are reported, not marked successful.
- [ ] Task status/history persist in PostgreSQL.
- [ ] Static preview renders assets; SPA deep routes and missing assets are diagnosed.
- [ ] Preview token is required for HTML and assets; no cookies are forwarded.
- [ ] Next.js/SSR limitation is explicitly labeled or supported by runtime preview.

### Persistent runtime
- [ ] Create -> upload -> start -> preview -> stop/delete.
- [ ] Readiness failures do not return success.
- [ ] Cross-user access is denied.
- [ ] Expired services are cleaned up and billing state is reconciled.
- [ ] Sidecar requires auth and rejects shell/`node -e`/shutdown abuse.

### Security negative tests
- [ ] Malicious `.vercel.app` page cannot retrieve the token or drive the agent.
- [ ] Missing token cannot run a task or update the agent.
- [ ] Symlink/prefix path traversal is denied.
- [ ] Preview artifact cannot read parent/session data.
- [ ] Guest/rate-limit abuse is bounded.
- [ ] Missing production signing secrets fail closed.

### Operations
- [ ] `npx tsc --noEmit` passes in both repositories.
- [ ] Full tests pass, including Docker/runtime tests.
- [ ] `npm run build` passes.
- [ ] Trigger live smoke test passes.
- [ ] Railway smoke test passes with cost controls.
- [ ] Rollback and restore drills pass.

---

## 23. Remaining Unknowns and Questions

1. What exact Git URL host policy is intended beyond HTTPS? Should enterprise/private hosts be supported?
2. What are the exact `withCsrfProtection` semantics for every mutating method and content type?
3. Is the deployed Trigger environment receiving the NVIDIA key, and is the worker image using the same agent version as local?
4. Is the default workspace-runtime image published and identical to the inspected Dockerfile?
5. Does the Railway API create a public domain automatically, or is that a manual prerequisite?
6. Should local tasks be status-polled directly by the browser, through an authenticated relay, or only while the web app is local?
7. Should guest sessions be allowed to run cloud tasks, and what cost controls apply?
8. What is the intended attachment storage/retention policy, and should documents be parsed or only images sent to the model?
9. Should the fallback model support images, or should vision tasks fail over only to vision-capable models?
10. What are the production database retention, backup, and migration ownership rules?
11. Is the web app expected to run full-stack generated apps in persistent runtimes, or only static frontends?
12. Are there budget approvals for Railway services, volumes, and cleanup guarantees?

---

## 24. Final Verdict and First Phase

### Verdict
- **Local code generation:** `VERIFIED WORKING` on a trusted machine.
- **Cloud code generation:** `PARTIALLY WORKING` as ephemeral batch execution.
- **Persistent cloud apps:** `MISSING` end-to-end.
- **Vision/multimodal:** `MISSING`.
- **Security posture:** `REGRESSED`/not production-ready due to P0 trust-boundary defects.
- **Production readiness:** `BLOCKED`.

### Recommended first phase (before any feature work)
1. Lock down the local companion: exact origins, mandatory token on all endpoints/WS, no unauthenticated update/browse, confirmation for paths.
2. Lock down the workspace-runtime: auth, non-root, no shell/`node -e`, `realpath` confinement, authenticated shutdown.
3. Isolate secrets: explicit generated-app env allowlist, no web env in engine, loopback-only local servers.
4. Isolate previews: separate origin, strict CSP, scoped tokens, no cookie forwarding.
5. Add adversarial regression tests for each P0 bypass.

Only after those are green should the team proceed to vision/attachments, persistent workspace wiring, and production deployment verification.

---

**Report status:** Complete inspection. No implementation or deployment was performed. The web production build passed; the full test/Railway/Trigger verification remains blocked by missing credentials, Docker availability, and the one failing web regression test.
