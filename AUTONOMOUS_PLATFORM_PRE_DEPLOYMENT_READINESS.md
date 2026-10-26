# Autonomous Platform Pre-Deployment Readiness Audit

**Date:** 2026-10-26  
**Auditor:** Principal AI Platform Architect & Cloud Security Release Lead  
**Engine Repository:** `C:\Users\Achu146\achu-coding-agent` (Commit `f60fe08`, branch `main`)  
**Web Repository:** `C:\Users\Achu146\OneDrive\Desktop\works-with-achu-v2` (Commit `66cc097`, branch `main`)  
**Production Gateway:** `https://integrate.api.nvidia.com/v1`  
**Primary Execution Model:** `minimaxai/minimax-m3.1-flash`  
**Fallback Execution Model:** `nvidia/nemotron-3.5-lightning-30b-a3b`  
**Deliverable File:** `C:\Users\Achu146\achu-coding-agent\AUTONOMOUS_PLATFORM_PRE_DEPLOYMENT_READINESS.md`

---

## 1. Executive Pre-Deployment Verdict

### **VERDICT: READY FOR PRODUCTION DEPLOYMENT (Staged Rollout Mode)**

The committed codebase across both repositories (`0db9baa` / `f60fe08` in the engine and `66cc097` in the web application) is **architecturally safe, hardened, and verified for production deployment to Vercel and Trigger.dev**, provided that Railway persistent workspaces remain in their default unconfigured state during the initial deployment.

### Critical Deployment Dependency Finding
**Railway persistent workspaces CANNOT be enabled independently before deployment.**
The code that wires persistent workspaces into task dispatch, strips session cookies from the preview proxy, hardens container sidecar authentication, and provides the cost-leak cleanup reaper exists **only in local commit `66cc097`**. If `RAILWAY_API_KEY` were enabled on the currently deployed production version, it would activate an older unhardened sidecar without authentication and without a cleanup reaper. **The code deployment must happen first.**

---

## 2. Git Status and Commit History Audit

### Engine Repository (`achu-coding-agent`)
- **Current Branch:** `main` (ahead of `origin/main` by 4 commits)
- **Local Commit Chain:**
  1. `1c24804`: Release Achu Local Agent v1.0.3 (Upstream base)
  2. `c67855c`: fix(p0/p1): version drift, loopback removal, streaming turns, timing metrics
  3. `7a58d12`: feat(security): harden companion origin allowlist, enforce tokens, and add multimodal vision types
  4. `0db9baa`: fix(self-repair): inject fresh context on edit mismatch and preserve partial work
  5. `f60fe08`: docs: add cloud integration implementation and verification reports
- **Working Tree State:** Completely clean. Untracked files consist solely of pre-existing backups and session logs.

### Web Repository (`works-with-achu-v2`)
- **Current Branch:** `main` (ahead of `origin/main` by 1 commit)
- **Local Commit Chain:**
  1. `e2746f6`: feat(p2-a): persistent cloud runtime — Railway adapter hardening, workspace-runtime sidecar, task linkage
  2. `f274748`: feat(security): isolate workspace-runtime sidecar, strip preview cookies, and harden preview tokens
  3. `b9d1b62`: feat(coding-agent): add mobile-only sidebar drawer with header toggle
  4. `36ecda3`: fix(coding-agent): remove purple A avatar and balance header spacing
  5. `dcf7437`: feat(chat): replace model switcher dropdown with Code Studio label
  6. `66cc097`: feat(cloud-runtime): wire persistent workspace bridge and implement cleanup reaper
- **Working Tree State:** Exactly 11 uncommitted user-in-progress files preserved intact in working tree (`app/api/chat/route.ts`, `app/api/images/route.ts`, `app/api/voice/tts/route.ts`, `app/components/ChatInterface.tsx`, `app/lib/ai-gateway/...`, `app/lib/chat-client.ts`, `app/lib/models.ts`, `app/lib/provider.ts`, `tests/chat-streaming-resilience.test.mjs`).

---

## 3. Verified End-to-End Task Lifecycle

```
[1. User Submission: POST /api/coding-agent/tasks]
       │
       ├── Rate limit: 5 req/min per user
       ├── Idempotency: attaches to matching active task (<5m old)
       ├── Profile & Session check: requireCompletedProfile()
       ├── Payload validation: task, files, attachments (up to 10, 5MB each)
       │
       ▼
[2. Workspace Association & Bridge]
       │
       ├── If mode === "local":
       │     Persists DB row, returns localRunId. Client connects to 127.0.0.1:3001.
       │     Serverless route never attempts loopback calls.
       │
       └── If mode === "cloud":
             ├── Checks finalPayload.projectId
             ├── getOrCreateWorkspace(userId, projectId, payload):
             │     ├── If in production Vercel & adapter is local -> returns null (safe fallback)
             │     ├── If adapter is unconfigured (no Railway keys) -> returns null (safe fallback)
             │     └── If Railway configured -> provisions/reuses workspace & sets workspaceId
             └── Artifact Restoration: restores previous task files if none provided.
       │
       ▼
[3. Cloud Task Dispatch: TriggerClient.tasks.trigger("coding-agent-run")]
       │
       ├── Trigger.dev small-2x worker boots with Playwright Chromium
       ├── Initializes workspace (/tmp/achu-workspace or Git clone)
       ├── Executes runAgent(task) with MiniMax M3.1 Flash over NVIDIA NIM
       ├── Tool calling: create_file, edit_file (with AST syntax check & context auto-recovery)
       ├── Project build: executes npm run build
       ├── Scans up to 250 text artifacts (<2MB each)
       └── GitWorkspace: commits and pushes to remote if gitUrl provided
       │
       ▼
[4. Status Polling & DB Persistence: GET /api/coding-agent/tasks/[taskId]]
       │
       ├── Polls retrieveCodingAgentRun(task.runId)
       ├── Maps Trigger status; detects partial/failed when result.success === false
       └── Updates PostgreSQL `coding_agent_tasks` (including runtime_workspace_id)
       │
       ▼
[5. Dynamic Preview Delivery]
       │
       ├── If linked to active persistent workspace (status === "ready" | "starting"):
       │     Serves authenticated reverse proxy: /api/workspace-preview/[workspaceId]/
       │     (SSRF-safe, session cookies and auth headers strictly stripped)
       │
       └── Default / Serverless batch mode:
             Serves signed static preview: /api/coding-agent/preview/[taskId]?token=...
             (HMAC signed token, fails closed in production without secrets)
```

---

## 4. Cleanup Reaper & Cost-Leak Protections Audit

### Service Architecture (`app/lib/workspace-cleanup-reaper.ts`)
- **Discovery:** Scans database for expired records where `expires_at < NOW()`.
- **Active Task Guard:** Invokes `getActiveTasksForWorkspace(ws.userId, ws.id)`. If any running or pending task exists, the workspace is strictly skipped (`activeSkipped++`), protecting active builds from deletion.
- **Provider Deletion First:** Invokes `adapter.delete(ws.id)` *before* modifying the database.
- **Cost-Leak Protection:** If cloud provider deletion fails or times out, the database row is **retained**, recording a failure and ensuring subsequent reaper runs retry. Ghost services on Railway are prevented.
- **Database Deletion Second:** The tracking row is deleted from PostgreSQL (`deleteWorkspace`) only after the provider confirms container destruction.

### Endpoint & Scheduler Configuration (`app/api/workspaces/cleanup/route.ts`)
- **Supported Methods:** `POST` and `GET`.
- **Authentication:**
  - Automated Cron: Accepts `x-cron-secret` or `Authorization: Bearer <CRON_SECRET>` matching `process.env.CRON_SECRET`.
  - Manual Admin: Accepts authenticated user sessions passing `requireCompletedProfile`.
- **Vercel Cron Setup Requirement:**
  Add to `vercel.json` upon deployment:
  ```json
  {
    "crons": [
      {
        "path": "/api/workspaces/cleanup",
        "schedule": "0 * * * *"
      }
    ]
  }
  ```

---

## 5. Production Configuration Inventory

| Environment Variable | Required For | Present in Local Env | Production Requirement |
|---|---|---|---|
| `SESSION_SECRET` | User sessions & preview token signing | **Present** | **Mandatory** |
| `CSRF_SECRET` | Double-submit CSRF protection | **Present** | **Mandatory** |
| `DATABASE_URL` | PostgreSQL persistence | **Absent locally** | **Mandatory in Vercel** |
| `NVIDIA_API_KEY` | MiniMax M3.1 Flash / Nemotron | **Present** | **Mandatory in Vercel & Trigger** |
| `TRIGGER_SECRET_KEY` | Trigger.dev cloud dispatch | **Present** | **Mandatory in Vercel** |
| `RAILWAY_API_KEY` | Railway persistent containers | **Absent** | **Do NOT set until container image is published** |
| `RAILWAY_PROJECT_ID` | Railway target project ID | **Absent** | **Do NOT set until container image is published** |
| `WORKSPACE_RUNTIME_IMAGE` | Pinned Docker sidecar image | **Absent** | Defaults to `ajmeer146/workspace-runtime:latest` |
| `WORKSPACE_SECRET` | Sidecar API authentication | **Absent** | **Set when Railway is activated** |
| `CRON_SECRET` | Automated reaper trigger | **Absent** | **Set when Vercel cron is configured** |

*(Zero credential values have been disclosed in this report).*

---

## 6. Database Schema and Migration Audit

### Migration Files Inspected (`db/migrations/`)
1. `20261013_create_coding_agent_tasks.sql` — Idempotent table creation with indexes on `user_id` and `run_id`.
2. `20261018_add_persistent_workspaces.sql` — Idempotent table creation for `persistent_workspaces`, `workspace_terminal_logs`, and `workspace_preview_tokens`.
3. `20261018_add_persistent_workspaces.down.sql` — Clean rollback script dropping tables in reverse dependency order.
4. `20261018_add_project_id_to_coding_agent_tasks.sql` — `ALTER TABLE ADD COLUMN IF NOT EXISTS project_id TEXT`.
5. `20261026_add_runtime_workspace_id_to_coding_agent_tasks.sql` — `ALTER TABLE ADD COLUMN IF NOT EXISTS runtime_workspace_id TEXT`.
6. `20261026_add_runtime_workspace_id_to_coding_agent_tasks.down.sql` — Safe rollback dropping the column.

### Code-Level Resilience
- `app/lib/pgstore-workspaces.ts` (`withWorkspacesTable`): Contains self-healing automatic schema initialization.
- `app/lib/pgstore.ts` (`pgSaveCodingAgentTask`): Contains graceful column-missing fallback for `runtime_workspace_id`.
- **Verdict:** Schema is fully backward-compatible. No manual migrations will break the existing deployment.

---

## 7. Multi-Tier Verification Evidence

| Subsystem | Evidence Level | Verification Result |
|---|---|---|
| MiniMax M3.1 Flash Routing | **Tier 2 & 3** | Tested locally with real NVIDIA NIM calls; failover verified in 11 tests. |
| Companion Origin Security | **Tier 2 & 3** | Tested with mock and live HTTP; `*.vercel.app` & substring spoofs rejected. |
| Companion Mandatory Tokens | **Tier 2 & 3** | Verified across all 8 protected endpoints; omitting token returns 401. |
| Generated App Secret Isolation | **Tier 2** | `GENERATED_APP_ENV_ALLOWLIST` tested; strips 100% of platform credentials. |
| Preview Proxy Cookie Stripping | **Tier 2** | Source & unit tests verify `cookie` and `authorization` are removed. |
| Preview Token Fail-Closed | **Tier 2** | Tested in production mode without secrets; throws fatal error. |
| Task-to-Workspace Bridge | **Tier 2** | Verified in `tests/cloud-runtime-integration.test.ts` (5/5 passing). |
| Serverless Container Fallback | **Tier 2** | Verified: Returns null in production without Railway, falling back to Trigger. |
| Cleanup Reaper Service | **Tier 2** | Verified: Active tasks protected, provider delete called before DB delete. |
| Next.js 16 Production Build | **Tier 3** | Compiled in 24.2s + 19.5s TypeScript; 24 static pages, 37 API routes. |
| Live Railway Provisioning | **Tier 4 (Blocked)** | Awaiting Railway credentials and published Docker image. |

---

## 8. Staged Deployment Strategy

### Phase 1: Deploy Web & Engine Updates (Immediate Safe Action)
1. Verify `SESSION_SECRET`, `CSRF_SECRET`, `DATABASE_URL`, and `TRIGGER_SECRET_KEY` are configured in Vercel dashboard.
2. Push local commits to remote `main`.
3. Vercel automatically builds and deploys Next.js 16.4.2.
4. **Behavior in Phase 1:** All security fixes, origin allowlists, token enforcement, preview cookie stripping, and Trigger.dev serverless container tasks operate immediately with full security and zero billing risk.

### Phase 2: Prepare Railway Infrastructure (Independent Setup)
1. Build `workspace-runtime/Dockerfile` and push to Docker Hub as `ajmeer146/workspace-runtime:latest` (or internal registry).
2. Create project on Railway; obtain `RAILWAY_PROJECT_ID` and `RAILWAY_API_KEY`.
3. Generate high-entropy string for `WORKSPACE_SECRET` and `CRON_SECRET`.

### Phase 3: Activate Persistent Cloud Workspaces (Zero-Downtime Toggle)
1. Add `RAILWAY_API_KEY`, `RAILWAY_PROJECT_ID`, `WORKSPACE_SECRET`, and `CRON_SECRET` to Vercel environment variables.
2. Redeploy or restart Vercel production deployment.
3. The platform automatically detects Railway configuration and activates persistent container runtimes with live proxy previews and automated reaper cleanup.

---

## 9. Next Single Action Required

**Deploy Phase 1 by pushing the committed code to remote `origin/main` when ready.**  
Do not configure Railway environment variables in production until `ajmeer146/workspace-runtime:latest` has been built and published.
