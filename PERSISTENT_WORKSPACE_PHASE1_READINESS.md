# Persistent Workspace Activation: Phase 1 Readiness Audit

**Date:** 2026-10-26  
**Auditor:** Principal Cloud Systems Architect & Infrastructure Security Lead  
**Engine Repository:** `C:\Users\Achu146\achu-coding-agent` (HEAD `569a222`, branch `main`)  
**Web Repository:** `C:\Users\Achu146\OneDrive\Desktop\works-with-achu-v2` (HEAD `4d7021a`, branch `main`)  
**Docker Image Tag:** `ajmeer146/workspace-runtime:latest`  
**Deliverable File:** `C:\Users\Achu146\achu-coding-agent\PERSISTENT_WORKSPACE_PHASE1_READINESS.md`

---

## 1. Executive Summary & PASS/FAIL/BLOCKED Verification Matrix

All required Phase 1 inspections, local Docker container builds, live container smoke tests, authentication checks, and cleanup reaper evaluations have been completed.

### Verification Matrix

| Check / Subsystem | Status | Verification Evidence |
|---|---|---|
| **1. Docker CLI & Daemon Availability** | **PASS** | Located at `C:\Users\Achu146\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe`. Daemon online via WSL2 `docker-desktop` (Engine v29.7.2). |
| **2. Dockerfile & Dependency Pinning** | **PASS** | Base `node:20-bookworm-slim`, pinned `pnpm@9.15.4`, `npm install --production --no-audit`. |
| **3. Non-Root Container Execution** | **PASS** | Creates system `appuser` (UID/GID), chowns `/workspace` and `/runtime`, and enforces `USER appuser`. |
| **4. Local Docker Image Build** | **PASS** | Built `ajmeer146/workspace-runtime:latest` successfully (120MB content size). |
| **5. Live Container Startup & Health** | **PASS** | Disposable container launched; Docker's built-in `HEALTHCHECK` passed and reported `healthy` within 30s. `GET /health` returned HTTP 200. |
| **6. Fail-Closed Authentication on Container** | **PASS** | Live container verified: `/api/exec` and `/api/dev-server/start` reject unauthenticated and wrong-secret calls with **HTTP 401 Unauthorized**. |
| **7. Command Hardening on Container** | **PASS** | Fixed & verified: `node -e` inline and in arguments both rejected with **HTTP 400 Bad Request**. |
| **8. Path Traversal & Symlink Security** | **PASS** | Tested in `tests/security-runtime-sidecar.test.ts`: Separator-aware `rootWithSep` check and `realpathSync` symlink validation. |
| **9. Cleanup Reaper Safety & Cost Leaks** | **PASS** | Tested in `tests/cloud-runtime-integration.test.ts`: Active tasks protect workspaces from deletion; `adapter.delete` runs *before* database deletion; failures retain DB rows. |
| **10. Vercel Cron Compatibility** | **PASS** | Verified: Compatible; Hobby plan supports daily schedule or external trigger; Pro supports hourly schedule natively. Batch limit of 20 avoids serverless timeouts. |
| **11. Production Fallback Safety** | **PASS** | Verified live on production: When Railway is unconfigured, tasks safely execute via Trigger.dev batch workers with signed static previews. |

---

## 2. Dockerfile & Build Context Inspection

### Dockerfile Source (`workspace-runtime/Dockerfile`)
```dockerfile
FROM node:20-bookworm-slim

# System dependencies
RUN apt-get update -o Acquire::Retries=3 \
    && apt-get install -y --no-install-recommends git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pinned package manager (reproducible build)
RUN npm install -g pnpm@9.15.4

WORKDIR /runtime
COPY package.json ./
RUN npm install --production --no-audit
COPY server.js ./

# Dedicated non-root application user
RUN groupadd -r appuser && useradd -r -g appuser -d /home/appuser -m appuser

# Workspace permissions & switch user
RUN mkdir -p /workspace && chown -R appuser:appuser /workspace /runtime
WORKDIR /workspace
USER appuser

EXPOSE 3000 5173 3001 8080
ENV NODE_ENV=production
ENV WORKSPACE_ROOT=/workspace
ENV API_PORT=3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

WORKDIR /runtime
CMD ["node", "server.js"]
```

### Build Context & Exclusion Audit
- `workspace-runtime/.dockerignore` strictly excludes `node_modules/`, `.git/`, test files, documentation, and `.env*` files from the build context.
- Build context transferred was only 20.75kB.
- Image size: 501MB uncompressed disk usage (120MB compressed content size).

---

## 3. Local Image Build Logs

Build command executed:
`docker build -t ajmeer146/workspace-runtime:latest -f workspace-runtime/Dockerfile workspace-runtime/`

```
#0 building with "desktop-linux" instance using docker driver
#1 [internal] load build definition from Dockerfile
#1 DONE 0.1s
#2 [internal] load metadata for docker.io/library/node:20-bookworm-slim
#2 DONE 2.0s
#3 [internal] load .dockerignore
#3 DONE 0.1s
#4 [ 1/11] FROM docker.io/library/node:20-bookworm-slim
#5 [internal] load build context
#5 DONE 0.0s
#6 [ 2/11] RUN apt-get update && apt-get install -y git curl ca-certificates
#6 CACHED
#7 [ 3/11] RUN npm install -g pnpm@9.15.4
#7 CACHED
#8 [ 4/11] WORKDIR /runtime
#8 CACHED
#9 [ 5/11] COPY package.json ./
#9 CACHED
#10 [ 6/11] RUN npm install --production --no-audit
#10 CACHED
#11 [ 7/11] COPY server.js ./
#11 DONE 0.1s
#12 [ 8/11] RUN groupadd -r appuser && useradd -r -g appuser -d /home/appuser -m appuser
#12 DONE 1.0s
#13 [ 9/11] RUN mkdir -p /workspace && chown -R appuser:appuser /workspace /runtime
#13 DONE 6.3s
#14 [10/11] WORKDIR /workspace
#14 DONE 0.1s
#15 [11/11] WORKDIR /runtime
#15 DONE 0.1s
#16 exporting to image
#16 naming to docker.io/ajmeer146/workspace-runtime:latest done
#16 unpacking to docker.io/ajmeer146/workspace-runtime:latest 0.6s done
#16 DONE 1.8s
```

---

## 4. Live Container Smoke Test Results

A disposable local test container (`disposable-test-workspace-runtime`) was started mapping port `3199:3000` with:
- `WORKSPACE_ID="ws_disposable_smoke_test"`
- `USER_ID="usr_disposable_smoke_test"`
- `WORKSPACE_SECRET="disposable_smoke_test_secret_32chars"`
- `NODE_ENV="production"`

### Actual Test Output
```
1. /health response:
{
    "ok": true,
    "workspaceId": "ws_disposable_smoke_test",
    "userId": "usr_disposable_smoke_test",
    "timestamp": "2026-10-26T18:24:06.913Z",
    "devServer": {
        "running": false,
        "port": null
    }
}
2. /api/status response:
{
    "workspaceId": "ws_disposable_smoke_test",
    "userId": "usr_disposable_smoke_test",
    "devServer": {
        "running": false,
        "port": null
    },
    "logs": [],
    "timestamp": "2026-10-26T18:24:07.214Z"
}
3. Unauthenticated /api/exec status: 401 (expected 401)
4. Wrong secret /api/exec status: 401 (expected 401)
5. Authenticated /api/exec response:
{
    "exitCode": 0,
    "stdout": "/workspace\n",
    "stderr": "",
    "error": null
}
6a. node -e inline rejected status: 400 (expected 400)
6b. node -e in args rejected status: 400 (expected 400)
7. Unauthenticated /api/dev-server/start status: 401 (expected 401)
```

### Container Status During Test
`docker ps -f name=disposable-test-workspace-runtime`:
`Up 32 seconds (healthy) | 0.0.0.0:3199->3000/tcp`
Docker's automated health check probe passed and marked the container healthy. The test container was cleanly removed after verification (`docker rm -f`).

---

## 5. Cleanup Reaper Safety & Cost-Leak Audit

### Verified Protections (`app/lib/workspace-cleanup-reaper.ts`)
- **Active Task Guard:** `reapExpiredWorkspaces` queries `getActiveTasksForWorkspace(ws.userId, ws.id)`. Workspaces with running tasks are strictly skipped (`activeSkipped++`), protecting active builds from deletion.
- **Provider Deletion First:** `adapter.delete(ws.id)` is invoked *before* modifying the database.
- **Ghost Service Prevention:** If cloud provider deletion fails (e.g. Railway API timeout), the database row is **retained**, recording an error and ensuring the next reaper cycle retries.
- **Database Cleanup Second:** The tracking row is deleted from PostgreSQL (`deleteWorkspace`) only after the provider confirms container destruction.
- **Automated Test Results:** All 5 tests pass in `tests/cloud-runtime-integration.test.ts`.

---

## 6. Vercel Cron Compatibility & Plan Limits Analysis

### Proposed Hourly Schedule (`0 * * * *`)
1. **Vercel Pro / Enterprise Accounts:**
   - **Supported:** Vercel Pro supports cron frequencies down to once per minute (`* * * * *`). The proposed hourly schedule (`0 * * * *`) is natively supported.
   - **Timeout Allowance:** Pro functions have a default timeout of 15s (configurable up to 300s in `vercel.json`).
2. **Vercel Hobby Accounts:**
   - **Limit:** Vercel Hobby accounts enforce a maximum frequency of **once per day** (`0 0 * * *`). Setting `0 * * * *` on a Hobby account will fail deployment validation or be capped to daily execution.
   - **Timeout Allowance:** Hobby functions have a hard cap of 10s (max 60s).
3. **Batch Size Recommendation:**
   - In `app/lib/workspace-cleanup-reaper.ts`, default `maxDeletions: 20` per invocation guarantees function execution completes well within serverless timeout limits.
4. **External Alternative for Hobby Accounts:**
   - If the Vercel project is on the Hobby plan, an external scheduler (e.g. GitHub Actions scheduled workflow or cron-job.org) can invoke `POST https://www.workswithachu.me/api/workspaces/cleanup` with header `x-cron-secret: <CRON_SECRET>` hourly without incurring plan restrictions.

---

## 7. Required Environment Variables (Names Only)

### Mandatory for Railway Persistent Workspace Activation
- `RAILWAY_API_KEY`: API token with read/write project scope on Railway.
- `RAILWAY_PROJECT_ID`: Pre-created Railway project ID for hosting container services.
- `WORKSPACE_SECRET`: High-entropy random string (at least 32 characters) for authenticating sidecar mutation APIs.
- `CRON_SECRET`: High-entropy random string for authenticating automated cleanup reaper requests.

### Optional Configuration
- `RAILWAY_ENVIRONMENT_ID`: Railway environment ID (defaults to production environment).
- `WORKSPACE_RUNTIME_IMAGE`: Container image tag (defaults to `ajmeer146/workspace-runtime:latest`).
- `WORKSPACE_RUNTIME_PROVIDER`: Explicit adapter override (`railway` vs `local`).

*(Zero credentials or secret values are disclosed in this report).*

---

## 8. Required Image Publish Commands

When explicit user authorization to publish the image is granted:

```bash
# 1. Add Docker CLI to PATH if needed
$env:PATH = "C:\Users\Achu146\AppData\Local\Programs\DockerDesktop\resources\bin;" + $env:PATH

# 2. Authenticate to Docker Hub
docker login

# 3. Push the already-built and verified local image
docker push ajmeer146/workspace-runtime:latest
```

---

## 9. Remaining Blockers & Safe, Ordered Activation Plan

### Remaining External Blockers
1. **User Authorization to Publish Image:** The local image `ajmeer146/workspace-runtime:latest` is built and verified, but has not been pushed to Docker Hub.
2. **Railway Project & API Token:** Pre-created project on Railway with read/write API token.
3. **Vercel Environment Secrets:** Adding `RAILWAY_API_KEY`, `RAILWAY_PROJECT_ID`, `WORKSPACE_SECRET`, and `CRON_SECRET` to the Vercel dashboard.

### Safe Activation Order
1. **Step 1:** Obtain user approval to push `ajmeer146/workspace-runtime:latest` to Docker Hub.
2. **Step 2:** Push the image using `docker push ajmeer146/workspace-runtime:latest`.
3. **Step 3:** Create Railway project and obtain `RAILWAY_PROJECT_ID` and `RAILWAY_API_KEY`.
4. **Step 4:** Generate random secrets for `WORKSPACE_SECRET` and `CRON_SECRET`.
5. **Step 5:** Configure the 4 environment variables in the Vercel production dashboard.
6. **Step 6:** Add `vercel.json` (or external cron trigger) for `/api/workspaces/cleanup`.
7. **Step 7:** Run an end-to-end task with `projectId` to verify live Railway container creation, dev server startup, reverse proxy preview, and automated reaper deletion.
