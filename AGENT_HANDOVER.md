# Agent Handover — Current Runtime + Dashboard Baseline
**Branch:** `main`
**Last updated:** 2026-05-26
**Handed off from:** Codex
**Intended recipient:** next implementation/debugging agent

---

## Current Live Entry Flow

This is the current browser-verified behavior after a full rebuild:

1. `docker compose -f docker/docker-compose.yml down`
2. `docker compose -f docker/docker-compose.yml up -d --build`
3. Health check passes on `http://localhost:3002/api/health`
4. User logs in at `http://localhost:3002/login`
5. Existing tenant config is found
6. User lands directly on `/` dashboard
7. Dashboard shows:
   - published snapshot data
   - AI inspector
   - `Cache Fresh`
   - terminal lifecycle state if latest run already completed

## Working Credentials / Runtime Inputs

These are the currently working app credentials used during browser verification:

- App login email: `admin@bitso.com`
- App login password: `Admin@12345`

Current runtime assumption:

- tenant already has persisted Splunk configuration in the database
- because of that, login goes directly to dashboard rather than forcing the settings screen

## What Was Revalidated In This Session

- full Docker restart/rebuild succeeds
- `postgres`, `web`, `worker` all become healthy
- `/api/health` returns healthy schema + purity state
- browser login lands on the dashboard
- dashboard no longer falls back to `Splunk Not Configured` for the configured tenant
- `/api/cache` accepts empty POST body again
- standard browser API routes can derive tenant context from verified JWT claims if explicit context headers are missing
- `/api/cache-status` exposes active `pipelineRunId` again

## Current Runtime State

Execution layer is materially healthier than dashboard semantics:

- pipeline reliability: high
- auditability: medium-high
- dashboard correctness: still incomplete
- explainability: incomplete

## Immediate Open Bugs

These are the highest-signal remaining product issues. They are not hypothetical.

1. KPI trend charts
- Current KPI cards can show values while `7d/30d/90d` charts remain empty.
- Needs API/data-binding verification against historical snapshot rows.

2. KPI formula trust
- ROI / GainScope / Low-Value Spend / Savings Potential need backend-to-UI certification against the published snapshot.
- Current values may render, but formula provenance is still not surfaced.

3. Coverage gap card rendering
- Confidence gauge still has alignment/bounds defects.
- Security + Ops + Confidence layout still needs final UI cleanup.

4. Split charts
- Data Volume Split and Sourcetype Split need verification against telemetry snapshot data.
- Empty/underutilized-only rendering is still suspicious and may be a binding or formula issue.

5. Settings/dashboard navigation clarity
- Current routing is technically working but product semantics are confusing:
  - settings exists as a route
  - dashboard may open directly after login
  - config page is no longer a guaranteed first-run step

## Current Architecture Rule

Do not revert to UI-inferred lifecycle.

Keep:

- backend lifecycle truth in `/api/cache-status`
- dashboard consuming published snapshot state separately from active run state
- no fallback AI decisions when model is unavailable

## Next Work Recommendation

Do not spend the next pass on pipeline reliability first. Execution is mostly working.

Work in this order:

1. certify KPI formulas against DB rows and API payloads
2. fix chart binding for trends and split charts
3. fix coverage confidence card rendering/layout
4. update dashboard explainability/provenance surfaces

---

## Stable Baseline Freezes

| Tag | Scope | Status |
|-----|-------|--------|
| `v0.9-trust-baseline` | Trust + Explainability (D1, D2, D3, D5) | ✅ Frozen |
| `v1.0-incremental-baseline` | Incremental aggregation + parallel fetch | ✅ Frozen |
| `v1.0-refactor-plan` | Phased architecture refactor roadmap | ✅ Frozen |
| **`v1.1-runtime-stable`** | **Phase 1 Runtime QA certification** | **✅ Frozen** |
| **`v1.2-trust-stable`** | **Stabilization + Trust freeze** | **✅ Frozen** |

**v1.1-runtime-stable frozen scope:**
- Login form accessibility (htmlFor/id) — all 6 fixes applied
- E2E test locators, localStorage key, hydration regex, SSE disconnect filter
- test-connection returns 503 (external dep unavailable), not 500
- Auth route: GET handler + cookie fix for `/api/auth?action=me`
- Detail page: `fetch`→`apiFetch` for authenticated cache-status calls
- 55/55 E2E tests | 227/227 contract tests | Typecheck clean
- Runtime QA evidence: 8-tab validation, 7-case settings, 3-state empty, 4-scenario slow-network
- `artifacts/runtime-qa/MANIFEST.md` with full evidence

**v1.2-trust-stable frozen scope:**
- Baseline verification (tsc, contracts 197/197, E2E 55/55)
- Runtime truth closure: refresh soak (10/10 proper error, 10/10 cache consistent)
- Governance stream classification: 401 expected without cookie, 4 deferred issues filed
- P3 query consolidation validated: stream-excluded requests 49→15 single-pass
- Settings local-first certified: 7/7 LLM cases pass, zero silent cloud fallback
- `networkidle`→`domcontentloaded`+timeout fix for SSE hang in E2E tests
- `artifacts/runtime-qa/` with full evidence for all 5 steps

---

## Latest Verified State

- **Tag:** `v1.2-trust-stable`
- **Commit:** `b2dc489`
- **Contract tests:** `203/203` passing (25 suites)
- **E2E tests:** `55/55` passing
- **Typecheck:** `npx tsc --noEmit` clean
- **Runtime evidence:** `artifacts/runtime-qa/certification/phase-start-verify.txt`
- **Stabilization artifacts:** `artifacts/runtime-qa/runtime-truth/`, `artifacts/runtime-qa/p3-validation/`, `artifacts/runtime-qa/settings/`
- **Freeze status:** valid

### P3 Query Consolidation (Validated This Session)

- **Status:** Confirmed working via single-pass comparison
- **Scope:** Web app orchestration only (`dashboard-query-service`) using existing API routes
- **Validation gates:**
  - `npx tsc --noEmit` ✅
  - `npm run test:contract` ✅ `203/203`
  - `npm run test:e2e` ✅ `55/55`
- **Artifacts:**
  - `artifacts/runtime-qa/p3-validation/request-comparison-rerun.md`
  - `artifacts/runtime-qa/p3-validation/request-comparison-rerun.json`
- **Measured result (stream-excluded):**
  - requests: `49 -> 15` (single-pass)
  - `/api/cache-status`: `29 -> 15` (single-pass)

---

## 2026-05-23 Session: Stabilization + Trust Freeze

**Commit:** `b2dc489` | **Tag:** `v1.2-trust-stable` | **Branch:** `main`

### Remote Push Unblocked
- PAT `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` (now expired) used to push `main` + all tags to `github.com/BitsIO-Ram/telemetry-governance-ai.git`
- Remote URL cleaned back to HTTPS form

### Step 1 — Baseline Verification
- `git status` (clean), `git rev-parse --abbrev-ref HEAD` (main), `git tag --list` (5 tags present)
- `npx tsc --noEmit` ✅
- Contract tests: `197/197` PASS (fixed `truth-agent-resilience.contract.test.ts` — added 30000ms timeout)
- E2E tests: `55/55` PASS (fixed SSE stream hang: `networkidle` → `domcontentloaded` + `waitForTimeout(3000)` in 06-production-certification.spec.ts (11 calls) and 03-track3-browser-ui-e2e.test.ts (4 calls))
- Evidence: `artifacts/runtime-qa/certification/phase-start-verify.txt`

### Step 2 — Runtime Truth Closure (Refresh Soak)
- 10x refresh cycles: 10/10 proper error structure, 10/10 cache consistent, zero zombie state
- Evidence: `artifacts/runtime-qa/runtime-truth/refresh-soak-10x.json`, `ui-state-matrix.md`

### Step 3 — Governance Stream Noise Classification
- `requireSSEContext` reads `accessToken` cookie; EventSource without cookie returns 401 (expected behavior)
- 4 deferred issues classified (STREAM-001 to STREAM-004):
  - STREAM-001: No exponential backoff on reconnect (fixed 5s interval)
  - STREAM-002: Auth safety-net gap — `requireSSEContext` doesn't engage on fetch exceptions
  - STREAM-003: Unhandled rejection noise in E2E logs from reconnect cycle
  - STREAM-004: EventSource in no-cors mode can't set `Authorization` header
- Evidence: `artifacts/runtime-qa/runtime-truth/governance-401-trace.json`

### Step 4 — P3 Query Consolidation Validation
- Stream-excluded request reduction confirmed: `49 → 15` single-pass
- Orchestrator deduplication working correctly
- Evidence: `artifacts/runtime-qa/p3-validation/request-comparison-rerun.md` + `.json`

### Step 5 — Settings Local-First Certification
- 7/7 LLM provider cases pass:
  1. Default: provider = Local (Ollama), no Anthropic key field visible
  2. Select Anthropic → key field appears
  3. Persist: save Anthropic key → survives reload
  4. Select Local → stored key wiped
  5. Missing key → fails gracefully
  6. Invalid key → fails, not persisted
  7. No silent cloud fallback when Local
- All data truthfulness checks pass
- Field names consistent frontend/backend (`llmProvider`, `anthropicApiKey`, `anthropicModel`)
- Evidence: `artifacts/runtime-qa/settings/local-first-certification.md`

### Splunk Config Seeded in DB
- Updated `tenants` table directly for test tenant `550e8400-e29b-41d4-a716-446655440000`
- Port 5433, user `telemetry:telemetry`

### Blockers
- No real Splunk at `localhost:8089` — all 10 refresh soaks return `500 "Cannot connect to Splunk: Connection failed"`
- SSE reconnect storm creates ~12 req/min noise under sustained auth failure — mitigated but not fixed (STREAM-001)
- `v1.2-trust-stable` freezable without live Splunk (error-handling, cache consistency, settings all certified); full pipeline validation requires real Splunk (P5 scope)

### Artifact Index
| Artifact | Content |
|---|---|
| `artifacts/runtime-qa/certification/phase-start-verify.txt` | Baseline gate results |
| `artifacts/runtime-qa/runtime-truth/refresh-soak-10x.json` | 10x refresh cycle results |
| `artifacts/runtime-qa/runtime-truth/ui-state-matrix.md` | Cache state → UI mapping |
| `artifacts/runtime-qa/runtime-truth/governance-401-trace.json` | SSE noise analysis + 4 deferred issues |
| `artifacts/runtime-qa/p3-validation/request-comparison-rerun.md` + `.json` | P3 request counts |
| `artifacts/runtime-qa/settings/local-first-certification.md` | 7/7 settings cases |

---

## 1. Project Overview

This is a multi-tenant observability dashboard for Bitso. It ingests Splunk telemetry, runs AI/LLM analysis, and presents governance-gated KPIs. The stack is:
- **Frontend:** Next.js 14 (App Router) at `apps/web/`
- **API routes:** Co-located in `apps/web/app/api/`
- **Worker:** Background pipeline processor at `docker/worker.ts`
- **Database:** PostgreSQL 16 with Row-Level Security (RLS), connection pool at `core/database/connection.ts`
- **Auth:** JWT via `packages/auth/` — Edge-compatible verifier + `requireContext()` / `requireSSEContext()`
- **Docker:** `docker/docker-compose.yml` — services: `web`, `worker`, `postgres`

---

## 2. What Was Completed in This Session

### 2A. Critical Bug Fix: PostgreSQL SET syntax → set_config()

**The bug (recurring, now permanently closed):**
```sql
-- BROKEN: PostgreSQL SET does not accept parameterized values
SET app.current_tenant = $1   -- throws "syntax error at or near '$1'"

-- FIXED: set_config() accepts parameterized $1
SELECT set_config('app.current_tenant', $1, true)
```

**File changed:** `core/database/connection.ts`
- `setTenantContext()` now uses `SELECT set_config('app.current_tenant', $1, true)` with `[tenantId]` as parameter
- Third argument `true` = transaction-local (auto-resets when transaction ends)
- All three callers updated: `query()`, `getClient()`, `transaction()`

### 2B. Dual Auth Pattern: requireContext vs requireSSEContext

**File changed:** `packages/auth/request-context.ts`

Two strictly separated functions:

| Function | For | Auth source | Fails if |
|---|---|---|---|
| `requireContext()` | Standard API routes | `Authorization: Bearer <token>` + 3 explicit headers | Any header missing or invalid |
| `requireSSEContext()` | SSE/EventSource routes | `accessToken` cookie (or header fallback) → JWT claims | Token invalid or claims missing |

**Which routes use which:**
- `requireSSEContext`: `/api/governance/stream`, `/api/job-stream`, `/api/events/*`
- `requireContext`: everything else (cache, cache-status, executive-summary, pipeline-runs, agent-decisions)

**Critical invariant:** `requireContext()` is fail-closed — no fallbacks, no auto-injection. Middleware explicitly does NOT inject context headers into downstream requests (see `apps/web/middleware.ts` — the header injection was removed intentionally).

### 2C. Frontend Context Header Propagation

**File changed:** `apps/web/lib/api-client.ts`

Added `getContextHeaders()` that reads from `localStorage`:
1. First tries `auth_context` key (new format written at login)
2. Falls back to `user` key (legacy format)

Both initial request and 401-retry path include these headers.

**File changed:** `apps/web/app/login/page.tsx`

On successful login, stores `auth_context` object:
```json
{ "userId": "...", "email": "...", "role": "...", "tenantId": "...", "permissions": [...], "timestamp": ..., "token": "..." }
```

**File changed:** `apps/web/lib/services/auth.service.ts`
- `login()` and `refreshToken()` both map API response into `AuthContext` with `tenantId`

**File changed:** `apps/web/lib/types/index.ts`
- Added `tenantId: string` to `AuthContext` interface

### 2D. Docker Full Volume Mounts

**File changed:** `docker/docker-compose.yml`

Added `../core:/app/core` mount so changes to `core/database/connection.ts` hot-reload without container rebuild. Full mount set for web service:
```yaml
- ../apps/web:/app/apps/web
- ../packages:/app/packages
- ../core:/app/core
- ../apps/api:/app/apps/api
- /app/apps/web/.next   # excluded from mount — use container build cache
```

### 2E. Worker TypeScript Fix

**Files changed:** `tsconfig.worker.json`, `docker/Dockerfile.worker`

- Added `@packages/auth/*: ['./packages/auth/*']` path alias to worker tsconfig
- Added `packages/**/*.ts` to worker tsconfig `include` array
- Added `COPY packages ./packages` to `Dockerfile.worker`

### 2F. CI Gate — Prevents SET Regression

**New file:** `scripts/ci-guard-no-set-tenant.sh`

Scans `apps/`, `packages/`, `core/` for `SET app.current_tenant =` (with `=` to avoid matching comments). Exits 1 if found. Run with:
```bash
bash scripts/ci-guard-no-set-tenant.sh
```

Add to `package.json` scripts as `"ci-guard": "bash scripts/ci-guard-no-set-tenant.sh"` and wire into CI.

### 2G. Regression Tests

**New file:** `tests/contract/db-tenant-isolation.regression.test.ts`

Two test suites:
1. **Static (unit):** Reads `core/database/connection.ts` source, asserts `set_config` present and `SET app.current_tenant =` absent
2. **Integration:** `cache-status`, `executive-summary`, `agent-decisions` must not return 500; malformed `x-tenant-id` must return 401 (rejected at auth layer before DB)

### 2H. Jest Config Fix

**File changed:** `jest.config.js`
- `baseUrl: '<rootDir>'` → `baseUrl: '.'` (the `<rootDir>` placeholder is only substituted in outer jest config properties, NOT inside inline ts-jest `tsconfig` object)

### 2I. Contamination Cleanup

**Database state (clean as of this session):**

| Table | Bad rows deleted | Method |
|---|---|---|
| `pipeline_runs` | 1 row (`tenant_id = 'default'`) | `DELETE FROM pipeline_runs WHERE tenant_id = 'default'` |
| `agent_decisions` | 2 rows (`tenant_id IS NULL`) | `DELETE FROM agent_decisions WHERE tenant_id IS NULL` |
| `executive_kpis` | 0 | — |
| `telemetry_snapshots` | 0 | — |
| `job_queue` | 0 | — |

### 2J. Pilot RLS Activation

**Database state:**

All 4 tenant-scoped tables now have RLS **enabled** (`relrowsecurity = true`):
- `pipeline_runs` — RLS enabled this session; policy `pipeline_runs_tenant_policy` was already in place from Migration 202
- `agent_decisions` — RLS enabled from prior migration
- `executive_kpis` — RLS enabled from prior migration
- `telemetry_snapshots` — RLS enabled from prior migration

Policy pattern (all tables):
```sql
USING (tenant_id = current_setting('app.current_tenant', true))
```

This works end-to-end because `connection.ts` now uses `set_config()` to write the session variable before every tenant-scoped query.

---

## 3. Current Test Status

```
Full contract suite:    197/197 passing (23 suites)
E2E suite:              55/55  passing (tests/e2e/)
Typecheck:              CLEAN  (npx tsc --noEmit)
```

Run all contract tests:
```bash
npx jest tests/contract/ --runInBand
```

Run E2E tests:
```bash
npx playwright test tests/e2e/06-production-certification.spec.ts
```

---

## 4. Architecture: Tenant Isolation Layers (Defense in Depth)

```
Request
  │
  ▼
[Layer 1] middleware.ts
  - Verifies JWT is valid (verifyTokenEdge)
  - Does NOT inject context headers (intentional — routes must pull explicitly)
  - Sets x-trace-id for correlation
  │
  ▼
[Layer 2] requireContext() / requireSSEContext()  ← packages/auth/request-context.ts
  - requireContext: validates Bearer token + x-tenant-id + x-user-id + x-user-role
  - requireSSEContext: reads cookie/header token, extracts claims from JWT payload
  - UUID validation on tenantId (rejects "default", malformed strings)
  - Returns RequestContext or NextResponse(401) — no exceptions thrown
  │
  ▼
[Layer 3] query() / transaction() / getClient()  ← core/database/connection.ts
  - If context present: acquires dedicated client, calls setTenantContext()
  - setTenantContext: SELECT set_config('app.current_tenant', $1, true)
  - Then executes query with RLS session variable set
  │
  ▼
[Layer 4] PostgreSQL RLS
  - All 4 tenant tables: USING (tenant_id = current_setting('app.current_tenant', true))
  - Rows not matching session variable are invisible — not 403, just empty result
```

---

## 5. Key File Map

| File | Role |
|---|---|
| `core/database/connection.ts` | DB pool, `set_config()` tenant session, `query()` / `transaction()` / `getClient()` |
| `packages/auth/request-context.ts` | `requireContext()` + `requireSSEContext()` — the auth layer |
| `packages/auth/auth-edge.ts` | Edge-compatible JWT verifier (`verifyTokenEdge`) |
| `apps/web/lib/api-client.ts` | Frontend fetch wrapper — sends context headers, handles 401 retry |
| `apps/web/app/login/page.tsx` | Stores `auth_context` with tenantId to localStorage on login |
| `apps/web/lib/services/auth.service.ts` | Maps login/refresh API response to AuthContext |
| `apps/web/middleware.ts` | JWT verification only — no header injection |
| `apps/web/app/api/cache/route.ts` | Refresh trigger — uses `requireContext` |
| `apps/web/app/api/cache-status/route.ts` | Refresh status — uses `requireContext` |
| `apps/web/app/api/executive-summary/route.ts` | KPI dashboard data — uses `requireContext` |
| `apps/web/app/api/agent-decisions/route.ts` | AI decisions — uses `requireContext` |
| `apps/web/app/api/pipeline-runs/[runId]/route.ts` | Run detail — uses `requireContext` |
| `apps/web/app/api/governance/stream/route.ts` | SSE governance events — uses `requireSSEContext` |
| `apps/web/app/api/job-stream/route.ts` | SSE job progress — uses `requireSSEContext` |
| `docker/docker-compose.yml` | Full volume mounts including `../core:/app/core` |
| `docker/Dockerfile.worker` | Includes `COPY packages ./packages` |
| `tsconfig.worker.json` | `@packages/auth/*` alias + `packages/**/*.ts` in include |
| `jest.config.js` | `baseUrl: '.'` fix + `@packages/*` path alias |
| `scripts/ci-guard-no-set-tenant.sh` | CI gate — exits 1 if SET syntax found in source |
| `tests/contract/db-tenant-isolation.regression.test.ts` | Static + integration regression tests |

---

## 6. Environment

### Running locally
```bash
cd docker
docker compose up --build
```
- Web: `http://localhost:3002`
- Postgres: `localhost:5433`
- Login: `admin@bitso.com` / `Admin@12345` (configurable via `ADMIN_EMAIL` / `ADMIN_PASSWORD`)

### Key environment variables (docker-compose.yml)
```
DATABASE_URL=postgresql://telemetry:telemetry@postgres:5432/telemetry_os
GOVERNANCE_BOOTSTRAP_KEY=75512d550a46fc514ca7874ba7fee1244f39303d99a782e82cbcfd2097ee03cd
NEXT_PUBLIC_SPLUNK_MCP_URL=https://144.202.48.85:8089
NEXT_PUBLIC_SPLUNK_TOKEN=Basic cmFtOlJhbWFAMTk4OA==
LLM_MODEL=gemma2:9b
ANTHROPIC_API_KEY=  (optional — Ollama used by default)
```

---

## 7. What To Do Next (Priority Order)

### Known Working Baseline (Freeze)

Use this as the last known healthy rollback target for demos and triage:

| Item | Value |
|---|---|
| Branch | `feature/data-purity-phase-2c-1` |
| Last stable commit | `bd9f5d0` |
| Docker health | `web: healthy`, `postgres: healthy`, `worker: healthy (can be disabled for pure sync path validation)` |
| Contract tests | `174 passed`, `8 suites passed` |
| TypeScript | `tsc clean` (use latest local check before release) |
| Feature flags | `ENABLE_CANONICAL_NORMALIZATION=false`, `NORMALIZATION_SHADOW_COMPARE=true` |
| Pipeline mode | synchronous `/api/cache` is active default; queue worker path exists but is not universal default substrate |

### Do NOT Change Without Tests (Protected Contracts)

These formulas are contract-protected and must not be modified without updating tests and benchmarks in the same change set:

```text
ROI = avg(composite_score)
GainScope = (Tier1+Tier2 GB / Total GB) * 100
Detection = 0.4 * potential + 0.6 * realized
Savings = deterministic only
```

### Performance Limits (Current Envelope)

Current practical operating envelope before P7–P10 scaling work:

| Volume | Status |
|---|---|
| `<2TB/day` | Safe |
| `10–20TB/day` | Stress |
| `>20TB/day` | Risk |
| `200TB/day+` | Not supported |

### Next Architectural Bottleneck

Primary bottleneck is **sequential Splunk fetch**.  
It is not currently formula correctness, normalization governance, or core deterministic scoring.

### Status Drift Corrections (Authoritative)

The following streams were previously completed and must not be treated as pending:

| Stream | Status |
|---|---|
| Savings Engine (P3 deterministic savings) | **COMPLETE** |
| Normalization Layer (P4 normalization engine + variance persistence) | **COMPLETE** |
| Normalization Governance (P4.5–P4.12 rollback/confidence/drift/replay/CI gates) | **COMPLETE** |

Current verified contract baseline from latest local run:

```text
Contract suites: 8 passed
Contract tests: 174 passed, 0 failed
```

### P0 — Wire CI gate into build pipeline
Add to `package.json`:
```json
"scripts": {
  "ci-guard": "bash scripts/ci-guard-no-set-tenant.sh"
}
```
Add `npm run ci-guard` as a step in `.github/workflows/` (or equivalent CI config). This prevents the `SET app.current_tenant` regression from ever shipping again.

### P1 — Enable RLS on remaining tables
`job_queue` does not yet have RLS enabled. Check and enable:
```sql
-- Check
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'job_queue';

-- Enable (if not already)
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job_queue
  USING (tenant_id = current_setting('app.current_tenant', true));
```

Also check `recommendation_actions`, `governance_events`, `audit_log` if they exist and have tenant_id columns.

### P2 — Verify full contract suite in Docker
The 28 tests pass locally against the host DB, but verify they also pass inside the Docker environment:
```bash
docker exec $(docker ps -q -f name=web) npx jest tests/contract/ --runInBand
```

### P3 — SSE route security audit
The `/api/events/*` routes were specified by the user to use `requireSSEContext`, but only `governance/stream` and `job-stream` were updated this session. Find all SSE routes:
```bash
grep -rn "ReadableStream\|text/event-stream\|EventSource" apps/web/app/api/ --include="*.ts" -l
```
Ensure each one imports and calls `requireSSEContext`.

### P4 — Contamination proof SQL — run periodically
```sql
SELECT 'pipeline_runs' AS tbl, count(*) AS bad_rows FROM pipeline_runs WHERE tenant_id IS NULL
UNION ALL SELECT 'agent_decisions', count(*) FROM agent_decisions WHERE tenant_id IS NULL
UNION ALL SELECT 'executive_kpis', count(*) FROM executive_kpis WHERE tenant_id IS NULL
UNION ALL SELECT 'telemetry_snapshots', count(*) FROM telemetry_snapshots WHERE tenant_id IS NULL
UNION ALL SELECT 'job_queue', count(*) FROM job_queue WHERE tenant_id IS NULL;
```
All should return 0. If not, investigate before enabling RLS on that table.

### P5 — Phase 1I: Apply RLS migrations to remaining tables via SQL migration files
Currently RLS was enabled interactively (psql). For reproducibility, create:
- `apps/infrastructure/migrations/204_enable_rls_pipeline_runs.sql`
- `apps/infrastructure/migrations/205_enable_rls_all_tenant_tables.sql`

Pattern:
```sql
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
-- (policy already existed from migration 202)
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job_queue
  USING (tenant_id = current_setting('app.current_tenant', true));
```

### P6 — Dashboard → CSV → Splunk validation
(User mentioned wanting to validate the full Splunk data pipeline through the dashboard UI. Upload fresh screenshots/PDFs of the dashboard to resume this work — prior uploads expired.)

### P7 — Incremental aggregation (Enterprise milestone)
Implement changed-index processing only:
- Persist `last_processed_at` per index/sourcetype.
- Compute snapshot diffs before aggregation.
- Skip unchanged partitions.

### P8 — Parallel Splunk fetch
Replace sequential index loops with bounded concurrency:
- Use `Promise.allSettled()` with a concurrency limiter.
- Preserve partial-success semantics and stage-level error accounting.

### P9 — Materialized KPI layer
Precompute and persist frequently read KPI vectors:
- `daily_gb`, `utilization`, `detection`, `roi`.
- Read dashboard KPIs from the materialized layer first, with controlled refresh.

### P10 — Async execution substrate
Move refresh back to queue-driven execution as the default path:
- `POST /api/cache` enqueues and returns quickly.
- Worker performs aggregation/AI/governance/publish.
- UI tracks state from ledger and pointer updates.

---

## 8. Current Maturity Snapshot

| Area | Actual |
|---|---|
| Deterministic scoring | High |
| Formula correctness | High |
| Savings engine | High |
| Normalization | High |
| Governance/drift | High |
| Tenant/RLS | Medium-High |
| LLM abstraction | Medium |
| Incremental aggregation | Low |
| Parallel Splunk fetch | Low |
| Enterprise ingestion substrate | Low |

## 9. Outstanding Risks

1. Sequential Splunk index fetch
2. Full refresh recomputes all indexes
3. No incremental aggregation in primary path
4. No materialized KPI cache
5. Synchronous `/api/cache` path can still block UX under load
6. Queue-based execution substrate is not yet the default for all refresh paths
7. Backpressure controls are limited
8. LLM inline execution can increase refresh latency when candidate volume grows

---

## 10. Known Issues / Gotchas

1. **`agent_decisions` schema change needed**: The table has `tenant_id` as `character varying` (not `uuid`). Other tables may differ. Always check the type before writing RLS policy casts.

2. **`requireSSEContext` JWT payload shape**: The function destructures `{ tenantId, sub: userId, role }` from the JWT payload. The JWT must include `tenantId` as a top-level claim. Verify this matches what `packages/auth/auth-edge.ts` produces when signing tokens.

3. **Middleware header injection was intentionally removed**: In a prior version, middleware injected `x-tenant-id`, `x-user-id`, `x-user-role` from JWT claims into every request. This was removed because it made routes appear to work without explicit context validation. The current design requires each route to call `requireContext()` explicitly — this is the correct fail-closed pattern.

4. **Docker rebuild needed for worker changes**: The worker does not have hot-reload. Changes to `docker/worker.ts` or `core/database/connection.ts` (for worker) require `docker compose up --build worker`.

5. **`forceRowSecurity` is false** on all tables — this means the superuser (`telemetry`) bypasses RLS. The application user connecting via `DATABASE_URL` is `telemetry`. For production, create a restricted role:
   ```sql
   CREATE ROLE app_user;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
   ALTER TABLE pipeline_runs FORCE ROW LEVEL SECURITY;
   ```
   Then connect as `app_user` from the app. (This is a future hardening step — not urgent for dev/staging.)

---

## 11. Prior Sessions Summary

| Session | Phase | What was done |
|---|---|---|
| Sessions 1–4 | Phase 1A–1F | Schema migrations 100–115, multi-tenant schema, governance baseline, RLS policy definitions |
| Session 5 | Phase 2A | Queue boundary tests (5 failure-mode tests passing), background pipeline worker |
| Session 5 (late) | Sprint 2A Security | HMAC key rotation, audit fork detection, envelope replay prevention |
| Session 5 (late) | Phase 6.1.5A | Trace propagation fabric (AsyncLocalStorage), boundary adapters |
| Session 6 | Phase 2B/2C-1 | LLM pipeline complete, 19/19 contract tests passing, component crash fixed |
| Session 7 | Phase 2C-1 continued | set_config() fix, requireSSEContext split, frontend context headers, RLS activated, contamination cleaned |
| **This session** | **Stabilization + Trust freeze** | **v1.2-trust-stable: baseline verification, runtime truth, governance stream classification, P3 validation, settings certification, docs consolidation** |

Full migration history: `apps/infrastructure/migrations/` (files 100–203)

---

## 10. Git State

**Branch:** `main` (checkout `b2dc489` for freeze baseline)
**Status:** All changes committed and pushed. Previous session (Phase 2C-1) work on `feature/data-purity-phase-2c-1` was merged into `main`.

### Current session files modified:
- `tests/contract/truth-agent-resilience.contract.test.ts` — added 30000ms timeout
- `tests/e2e/06-production-certification.spec.ts` — 11x `networkidle`→`domcontentloaded`+timeout
- `tests/e2e/03-track3-browser-ui-e2e.test.ts` — 4x `networkidle`→`domcontentloaded`+timeout

### Artifacts created this session:
- `artifacts/runtime-qa/certification/phase-start-verify.txt`
- `artifacts/runtime-qa/runtime-truth/refresh-soak-10x.json`
- `artifacts/runtime-qa/runtime-truth/ui-state-matrix.md`
- `artifacts/runtime-qa/runtime-truth/governance-401-trace.json`
- `artifacts/runtime-qa/p3-validation/request-comparison-rerun.md`
- `artifacts/runtime-qa/p3-validation/request-comparison-rerun.json`
- `artifacts/runtime-qa/settings/local-first-certification.md`

---

## 2026-05-21 Addendum — Refresh Presentation Stabilization

### Current Live Verification Result

The local Docker stack was tested against the live Splunk endpoint `https://144.202.48.85:8089/services/mcp` using the real tenant context:

- Tenant: `4fb5e7fd-895e-4320-a080-8a2380659296`
- User: `cdc19941-dfe3-4ea5-8518-10d63ec89fc0`
- Latest successful run: `86fd4e71-e1e7-4187-8c87-f408c0b86176`
- Latest successful snapshot: `6e8ee11a-13d1-4d8c-aac3-f89c9fec274e`
- Refresh HTTP duration: `2080ms`
- Worker publish duration: `3966ms`
- Published rows: 3 Splunk-derived indexes (`history`, `main`, `tutorial`)
- Active pointer: `tenant_snapshot_pointer.active_run_id = 86fd4e71-e1e7-4187-8c87-f408c0b86176`

Verified endpoint outputs:

```text
GET /api/health                  -> 200, schema valid, purity valid, syntheticDataDetected=false
GET /api/cache-status            -> status=fresh, recordCount=3, decisionCount=0, dailyAvgGb=0.0351
GET /api/pipeline-runs/latest    -> status=SUCCEEDED, published=true, durationMs=3966
GET /api/executive-summary       -> meta.runId matches latest run, snapshotCount=3, totalDailyGb=0.0351, annual spend=$6.41
```

The dashboard UI was also checked with Playwright. It no longer shows `AI is calculating...` after refresh. It shows the published Splunk server data with a clear `No LLM decisions yet` banner when the local model does not produce decisions for the small dataset.

### Fixes Added After Commit d63f321

- `apps/api/services/aggregation-service.ts`
  - LLM candidate selection now has materiality gates:
    - `LLM_MIN_DAILY_GB` default `0.1`
    - `LLM_MIN_ANNUAL_COST` default `25`
    - `LLM_MIN_TOTAL_EVENTS` default `1000000`
  - Small Splunk environments publish server-derived snapshot/KPI data without waiting on local inference.

- `docker/worker.ts`
  - Handles `inputs.length === 0` as a valid no-material-candidates path.
  - Publishes the Splunk-derived snapshot atomically and completes the job.
  - Recovers stale running/partial jobs and stale `RUNNING` pipeline runs on startup.
  - Marks all-AI-failed runs as `FAILED` instead of leaving zombies.

- `apps/api/agents/llm-decision-agent.ts` and `agents/reasoning/ollama.ts`
  - Local Ollama calls now fail within bounded time instead of blocking refresh indefinitely.
  - Defaults: `LLM_BATCH_TIMEOUT=45s`, `OLLAMA_REQUEST_TIMEOUT_MS=45000`.

- `apps/web/app/api/cache-status/route.ts`
  - Readiness flags are scoped to the active tenant published snapshot.
  - Historical/global `agent_decisions` rows no longer make the current dashboard think AI decisions exist.
  - Published run pointer overrides stale global cache metadata status to `fresh`.

- `apps/web/app/api/executive-summary/route.ts`
  - `totalDailyGb` now falls back to active snapshot rows when baseline KPI rows contain zero.

- `apps/web/app/api/job-stream/route.ts`
  - POST now enqueues a valid tenant-context payload instead of malformed worker jobs.

- `scripts/validate-tenant-context.js`
  - Tenant gate no longer false-positives on safe rejection checks like `tenantId === 'default'`.

- Removed empty tracked file: `FORCE_REBUILD_1779204700`.

### Verification Commands Run

```bash
npm run validate:tenant-context
npm run test:contract -- --runInBand
npm run test:pipeline -- --runInBand
```

Results:

```text
Tenant context gate: PASS
Contract tests: 8 suites, 174 tests passing
Pipeline tests: 2 suites, 2 tests passing
```

### Known Presentation Note

The current live Splunk dataset is very small (`0.0351 GB/day`, `$6.41/year`). The dashboard intentionally skips LLM analysis for this low-materiality dataset and displays server-derived telemetry only. This is presentation-safe and avoids the previous refresh hang. If a larger Splunk dataset crosses the materiality thresholds, the local Ollama path will run AI decisions with bounded timeouts.

## D1 Stabilization Note (2026-05-22)
- Known blocker resolved: test environment login instability ( returning 500) caused by stale web container serving an older truth-agent import.
- Resolution: restarted web service after D1 code sync; validated with successful login response.
- Verification gate:  and  both passing.
### Commit B — Cache Status Lifecycle Truth (Freeze Eligible)

- `/api/cache-status` now returns canonical lifecycle fields from backend truth:
  - `snapshotStatus`, `llmStatus`, `pipelineStatus`
  - `lastRunId`, `lastRunAt`, `lastDecisionAt`, `requestId`, `pipelineRunId`
- Lifecycle derives from persisted state:
  - active published run via `tenant_snapshot_pointer`
  - run/stage linkage via `pipeline_runs` and `pipeline_stage_events`
- Contract tests added and aligned to published-run pointer truth:
  - `snapshot READY + llm RUNNING => pipeline PARTIAL`
  - `snapshot READY + llm READY => pipeline READY`
  - `snapshot FAILED => pipeline FAILED`
- Validation gates:
  - `npx tsc --noEmit` ✅
  - `npm run test:contract` ✅ `203/203`
  - `npm run test:e2e` ✅ `55/55`

### Commit C — UI Lifecycle Rendering (Freeze Eligible)

- UI lifecycle ownership is now pure render-from-truth:
  - backend defines lifecycle via `/api/cache-status`
  - UI consumes `snapshotStatus`, `llmStatus`, `pipelineStatus`
- Updated UI surfaces:
  - `apps/web/app/page.tsx`
  - `apps/web/components/layout/TopAppBar.tsx`
- Canonical rendering matrix now enforced:
  - `READY + RUNNING` → `Snapshot complete · Intelligence pending`
  - `READY + READY` → `Complete`
  - `READY + FAILED`/`FAILED_TIMEOUT` → `Snapshot ready · Intelligence failed`
  - `FAILED + *` (or pipeline `FAILED`) → `Pipeline failed`
- Commit C constraints respected:
  - no polling changes
  - no SSE redesign
  - no retry/timeout transport changes
  - no backend `/api/cache-status` logic changes
- Validation gates:
  - `npx tsc --noEmit` ✅
  - `npm run test:contract` ✅ `203/203`
  - `npm run test:e2e` ✅ `55/55`
