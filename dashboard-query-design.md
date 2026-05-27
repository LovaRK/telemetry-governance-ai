# P3.1 Dashboard Query Consolidation Design (Design Only)

## Current Flow
Primary page orchestration is spread across multiple calls in `/Users/ramakrishna/Desktop/Teja/Dashboards/apps/web/app/page.tsx`:
1. `fetchSummary()`
   - `GET /api/cache-status`
   - `GET /api/executive-summary`
   - optional: `GET /api/executive-summary/explain`
   - optional: `GET /api/explainability/coverage`
2. `fetchSplunkConfig()`
   - `GET /api/splunk/config`
3. `fetchPendingDecisionsCount()`
   - `GET /api/decision-lineage?limit=1`
4. `hydrateLatestJob()`
   - `GET /api/job-status/latest`
5. `handleRefresh()`
   - `GET /api/config`
   - `POST /api/cache`
6. background reconcile while active job exists
   - `GET /api/job-status/:jobId` every 2.5s

Other mounted components also fetch independently (governance/coherence/trend panels), creating additional overlap.

## Measured Baseline (from artifacts)
- `dashboardLoadMs`: `5135`
- `refreshMs`: `3630`
- `/api/cache` duration (`fast_complete`): `3391`
- Dashboard-load capture (6s window):
  - total requests: `172`
  - unique endpoints: `9`
  - duplicate endpoints: `3`
  - top duplicates:
    1. `/api/governance/stream` = `120`
    2. `/api/cache-status` = `32`
    3. `/api/kpi-history` = `14`

## Top Blocking Endpoints
1. `/api/cache-status` (gates whether summary path runs)
2. `/api/executive-summary` (core payload for main view)
3. `/api/splunk/config` (gates refresh button readiness)

## Sequential Dependency Chains
1. Mount chain:
   - `cache-status` -> `executive-summary` -> (`explain`, `coverage` optional)
2. Refresh chain:
   - `config` -> `POST /api/cache` -> (`fetchSummary`, `fetchPendingDecisionCount`)

## Problems
1. Duplicate core fetches (`cache-status`, summary) triggered by mount + refresh + SSE callbacks.
2. State orchestration split across independent methods, making UI state race-prone.
3. Component-level polling/fetches overlap with page-level state fetches.
4. No single “dashboard state contract” for the page.

## Target Flow
Introduce one orchestration entrypoint in app layer:

`page.tsx`  
↓  
`dashboard-query-service.getDashboardState()`  
↓  
existing API routes (unchanged)

## Proposed Type
```ts
type DashboardState = {
  executiveSummary: unknown | null;
  cacheStatus: unknown | null;
  decisions: {
    pendingCount: number;
    latestJob: unknown | null;
  };
  config: {
    splunk: unknown | null;
    runtime: unknown | null;
  };
  explainability: {
    records: unknown[];
    coverage: unknown | null;
  };
  trends: {
    kpiHistory?: unknown;
  };
  meta: {
    loadedAt: string;
    hadErrors: boolean;
    errors: Array<{ endpoint: string; status?: number; message: string }>;
  };
};
```

## `getDashboardState()` Contract (Design)
Input:
- `showExplainabilityPanel: boolean`
- `includeTrends?: boolean` (default false)

Behavior:
1. Fetch `cache-status` first.
2. If never refreshed, return early state (no summary call).
3. Fetch in a controlled batch:
   - `executive-summary`
   - `splunk/config`
   - `job-status/latest`
   - `decision-lineage?limit=1`
4. If explainability enabled, fetch:
   - `executive-summary/explain`
   - `explainability/coverage`
5. Return normalized `DashboardState` with per-endpoint errors captured.

Non-goal in this phase: changing backend APIs.

## Migration Plan (No Code Yet)
1. Add new app-layer service file (`dashboard-query-service.ts`) with pure fetch orchestration.
2. Replace mount-time `Promise.all([fetchSplunkConfig(), fetchSummary(), fetchPendingDecisionsCount(), hydrateLatestJob()])` with one `getDashboardState()` call.
3. Replace post-refresh dual calls (`fetchSummary()`, `fetchPendingDecisionsCount()`) with one `getDashboardState()` refresh call.
4. Keep existing job polling and refresh POST path unchanged.

## Non-Goals (Hard)
- No React Query/SWR migration.
- No cache rewrite.
- No backend persistence changes.
- No KPI formula changes.
- No AI/governance logic changes.
- No Splunk optimization changes.

## Risks
1. Regressing empty-state gate (`hasEverRefreshed`) if orchestration order changes.
2. Accidentally dropping explainability payload when feature flag is on.
3. Coupling too many panel concerns into one state shape.

## Rollback Plan
- Keep old helpers (`fetchSummary`, `fetchSplunkConfig`, `fetchPendingDecisionsCount`, `hydrateLatestJob`) until P3.2 passes checks.
- If regressions appear, switch page load path back to old helpers via one toggle commit.

## Success Criteria for P3.2
1. Mount path uses one orchestrated state call from page.
2. Duplicate core calls reduced (`/api/cache-status`, `/api/executive-summary`).
3. No change in refresh correctness (`fast_complete` path remains).
4. Existing E2E refresh tests continue passing.
