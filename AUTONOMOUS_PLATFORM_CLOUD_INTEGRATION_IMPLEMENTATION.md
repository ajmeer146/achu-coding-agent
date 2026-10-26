# Autonomous Platform Cloud Integration Implementation Report

**Date:** 2026-10-26  
**Lead Cloud Systems Architect & Principal Security Engineer**  
**Engine Repository:** `C:\Users\Achu146\achu-coding-agent` (Local Commit: `0db9baaf6ec9570127aced35fe7c708c199ccd6a`)  
**Web Repository:** `C:\Users\Achu146\OneDrive\Desktop\works-with-achu-v2` (Local Commit: `ed811d17f3d4223ce34fe0dca2837a5b164c655b`)  
**Primary Model:** `minimaxai/minimax-m3.1-flash` via NVIDIA NIM  
**Fallback Model:** `nvidia/nemotron-3.5-lightning-30b-a3b`  
**Deliverable File:** `C:\Users\Achu146\achu-coding-agent\AUTONOMOUS_PLATFORM_CLOUD_INTEGRATION_IMPLEMENTATION.md`

---

## 1. Executive Summary & Objective

This report details the architectural implementation that bridges the existing serverless batch cloud path (`Trigger.dev`) with persistent cloud workspaces (`Railway` and `workspace-runtime`), while maintaining 100% backward compatibility, user isolation, and multi-tenant billing cost-leak protections.

Prior to this implementation:
1. `remote-workspace-agent.ts` was an orphaned module unimported by the active task submission route.
2. `POST /api/coding-agent/tasks` dispatched exclusively to Trigger.dev batch workers without persistent workspace association.
3. `cleanupExpiredWorkspaces()` only deleted database records and never invoked `adapter.delete()` on cloud providers, creating a severe ghost-service billing leak.
4. If a persistent workspace was provisioned, preview URLs in `tasks/[taskId]` remained hardcoded to static artifact views rather than live proxy endpoints.

### Key Implementations Delivered
1. **Task Lifecycle & Persistent Workspace Bridge (`app/api/coding-agent/tasks/route.ts`):**
   - Connected `getOrCreateWorkspace` to the task creation path for tasks carrying a `projectId`.
   - Bounded fallback: When running in production Vercel serverless without Railway credentials, it safely logs a warning and falls back to Trigger.dev serverless container execution without throwing or crashing.
   - When a persistent workspace is linked, `finalPayload.workspaceId` is bound to the workspace and persisted in `coding_agent_tasks.runtime_workspace_id`.
2. **Dynamic Preview Routing (`app/api/coding-agent/tasks/[taskId]/route.ts`):**
   - When a task is associated with an active persistent workspace (`status === "ready"` or `"starting"`), `previewUrl` dynamically points to the authenticated reverse proxy (`/api/workspace-preview/${ws.id}/`).
   - When no persistent workspace is linked or the workspace is unconfigured, it preserves the signed static preview fallback (`/api/coding-agent/preview/${task.id}?token=...`).
3. **Automated Cost-Leak Protection & Cleanup Reaper Service (`app/lib/workspace-cleanup-reaper.ts`):**
   - Created `reapExpiredWorkspaces(options)`:
     - Scans expired workspaces (`expiresAt < NOW`).
     - **Active Task Guard:** Checks `getActiveTasksForWorkspace(userId, ws.id)`. Workspaces with running tasks are strictly skipped to prevent terminating active builds.
     - **Provider Deletion First:** Calls `adapter.delete(ws.id)` *before* removing database records.
     - **Failure Resilience:** If cloud provider deletion fails or times out, the database row is retained so subsequent reaper runs will retry, preventing untracked billable services on Railway.
     - **Database Cleanup Second:** Only deletes tracking rows from PostgreSQL / store after the provider confirms container deletion.
4. **Cleanup API Route (`app/api/workspaces/cleanup/route.ts`):**
   - Provides `POST` and `GET` endpoints for cron jobs or admin execution.
   - Authenticates via `CRON_SECRET` header (`x-cron-secret`) or authenticated user session.
5. **Serverless Production Guard (`app/lib/remote-workspace-agent.ts`):**
   - Detects `process.env.NODE_ENV === "production"` with `adapter.provider === "local"` and safely falls back to Trigger.dev containers, preventing unsupported local process spawning inside Vercel lambdas.

---

## 2. Exact Files Changed and Created

### Web Repository (`works-with-achu-v2`)
1. `app/lib/workspace-cleanup-reaper.ts` (**New File**):
   - Implements `reapExpiredWorkspaces` with active task protection, provider-first deletion, and retry resilience.
2. `app/api/workspaces/cleanup/route.ts` (**New File**):
   - Secure endpoint for Vercel Cron or manual cleanup execution.
3. `app/lib/remote-workspace-agent.ts` (**Modified**):
   - Added production serverless provider guard.
4. `app/lib/persistent-workspace-store.ts` (**Modified**):
   - Exported `listExpiredWorkspaces()` for provider-aware reaper scanning.
5. `app/lib/pgstore-workspaces.ts` (**Modified**):
   - Implemented `pgListExpiredWorkspaces()` querying expired rows.
6. `app/api/coding-agent/tasks/route.ts` (**Modified**):
   - Connected `getOrCreateWorkspace` into cloud task dispatch; links `workspaceId` and preserves Trigger.dev fallback.
7. `app/api/coding-agent/tasks/[taskId]/route.ts` (**Modified**):
   - Dynamic `previewUrl` routing to `/api/workspace-preview/[workspaceId]/` when persistent workspace is ready/starting.
8. `tests/cloud-runtime-integration.test.ts` (**New File**):
   - 5 comprehensive automated tests for reaper lifecycle, active task protection, serverless fallback, and route wiring.

### Engine Repository (`achu-coding-agent`)
1. `src/agent.ts` (**Committed in `0db9baa`**):
   - In-band fresh context auto-recovery on context mismatch.
2. `src/server.ts` (**Committed in `0db9baa`**):
   - Honest `PARTIAL` status reporting and app URL preservation.
3. `src/tools/edit-file.ts` (**Committed in `0db9baa`**):
   - Exported `isEditContextMismatchError`.
4. `tests/edit-context-mismatch-recovery.test.ts` (**Committed in `0db9baa`**):
   - 6 regression tests covering context mismatch recovery.

---

## 3. End-to-End Cloud Task & Workspace Execution Flow

```
                      User Prompt via Web UI
                               │
                               ▼
                POST /api/coding-agent/tasks
                               │
            ┌──────────────────┴──────────────────┐
     Has projectId?                        No projectId
            │                                     │
            ▼                                     ▼
 getOrCreateWorkspace(userId, projectId)   Ephemeral Container
            │                              (Trigger.dev worker)
    ┌───────┴───────┐                             │
Configured?    Unconfigured / Prod local          │
    │               │                             │
    ▼               ▼                             ▼
Provision/Reuse  Fall back to Trigger.dev  Trigger.dev coding-agent-run
Railway Service  with static artifacts     (Clones/mounts, runs loop)
(workspaceId)    (workspaceId generated)          │
    │               │                             │
    └───────┬───────┘                             ▼
            ▼                              Scans text artifacts
triggerCodingAgentTask(payload)                   │
            │                                     ▼
            ▼                              Save to PostgreSQL
Poll GET /api/coding-agent/tasks/[taskId]         │
            │                                     ▼
    ┌───────┴───────┐                      Static Preview
Workspace ready?  Static only              (/preview/[taskId]?token=...)
    │               │
    ▼               ▼
Live Proxy URL   Static URL
(/workspace-preview/[wsId]/)
```

---

## 4. Cost-Leak Protection and Cleanup Guarantees

| Vulnerability in Previous Architecture | Safeguard Implemented in Cleanup Reaper |
|---|---|
| Workspaces expired without any automated cleanup trigger | Added `reapExpiredWorkspaces` and `/api/workspaces/cleanup` route for cron scheduling. |
| Database rows deleted while active builds were running | `getActiveTasksForWorkspace` inspects tasks; any running/pending task blocks workspace deletion. |
| Deleting DB rows left Railway services running and billing | `adapter.delete(ws.id)` is called **before** `deleteWorkspace(ws.userId, ws.id)`. |
| Cloud provider network failures caused permanent ghost services | If `adapter.delete` throws, the database record is **retained**, logging an observable failure so the next reaper run retries. |
| Serverless lambdas attempting local process spawning | `getOrCreateWorkspace` checks `NODE_ENV === "production"` and skips `LocalWorkspaceAdapter` when remote provider is absent. |

---

## 5. Verification Commands and Results

1. **New Cloud Integration Test Suite (`tests/cloud-runtime-integration.test.ts`):**
   - Command: `npx tsx --test tests/cloud-runtime-integration.test.ts`
   - Result: **5 / 5 tests PASS (Exit code 0, 1.7s)**
   - Covers: Expired workspace discovery, active task protection, database cleanup after provider delete, production serverless fallback, task route source wiring.
2. **Full Combined Web Test Suite (148 tests):**
   - Command: `npx tsx --test tests/cloud-runtime-integration.test.ts tests/security-runtime-sidecar.test.ts tests/p2a-cloud-runtime.test.ts tests/coding-agent-preview-regression.test.ts tests/coding-agent-tasks.test.ts tests/coding-agent-permanent-cloud-preview.test.ts tests/persistent-workspace-lifecycle-hmr.test.ts`
   - Result: **148 / 148 tests PASS (Exit code 0, 32.8s)**
3. **Web Production Build (Next.js 16 Turbopack):**
   - Command: `npm run build`
   - Result: **Compiled successfully in 24.2s + 19.5s TypeScript (Exit code 0, 24 static pages, 37 dynamic API routes)**
4. **Engine Test Suite (73 tests):**
   - Command: `npx tsx --test tests/edit-context-mismatch-recovery.test.ts ...`
   - Result: **73 / 73 tests PASS (Exit code 0, 2.4s)**

---

## 6. Next Steps for Production Activation

1. **Configure Railway Environment Variables:** Set `RAILWAY_API_KEY` and `RAILWAY_PROJECT_ID` in Vercel project settings.
2. **Publish Docker Sidecar Container:** Build and push `ajmeer146/workspace-runtime:latest` using `workspace-runtime/Dockerfile`.
3. **Configure Cron Job:** Add a daily or hourly cron trigger to call `GET /api/workspaces/cleanup` with `CRON_SECRET`.
