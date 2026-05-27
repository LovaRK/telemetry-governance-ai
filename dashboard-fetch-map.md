# P3.0 Dashboard Fetch Inventory

## Scope
- Source files inspected:
  - `/Users/ramakrishna/Desktop/Teja/Dashboards/apps/web/app/page.tsx`
  - `/Users/ramakrishna/Desktop/Teja/Dashboards/apps/web/components/**`
  - `/Users/ramakrishna/Desktop/Teja/Dashboards/apps/web/lib/**`
- This is inventory only (no orchestration changes).

## Fetch Map
| Caller | Endpoint | Trigger | Blocking | Duplicate | Notes |
|---|---|---|---|---|---|
| `page.tsx::fetchSummary` | `/api/cache-status` | mount, refresh follow-up, SSE callbacks (`onGovernance`, `onDecision`) | yes (gates summary path) | yes | Called frequently; also used in SSE auth probe path. |
| `page.tsx::fetchSummary` | `/api/executive-summary` | after cache-status when refreshed exists | yes | yes | Central payload; re-fetched via multiple triggers. |
| `page.tsx::fetchSummary` | `/api/executive-summary/explain` | fetchSummary when explainability enabled | no | yes | Parallel with coverage API. |
| `page.tsx::fetchSummary` | `/api/explainability/coverage` | fetchSummary when explainability enabled | no | yes | Repeated after every summary refresh. |
| `page.tsx::fetchSplunkConfig` | `/api/splunk/config` | mount | yes (for refresh readiness) | maybe | Used for top bar connection state. |
| `page.tsx::fetchPendingDecisionsCount` | `/api/decision-lineage?limit=1` | mount, post-refresh | no | yes | Tiny read but redundant with governance panel queries. |
| `page.tsx::hydrateLatestJob` | `/api/job-status/latest` | mount | no | maybe | Hydrates run stage state. |
| `page.tsx::job reconcile interval` | `/api/job-status/:jobId` | every 2.5s while run is active | no | no | Polling loop while `activeJobId` exists. |
| `page.tsx::handleRefresh` | `/api/config` | every refresh click | no | yes | Used only to fetch cost config pre-refresh. |
| `page.tsx::handleRefresh` | `/api/cache` | every refresh click | yes | no | Primary pipeline trigger. |
| `use-governance-stream` | `/api/governance/stream` (EventSource) | mount when enabled | no | yes | Long-lived stream; reconnect loop source. |
| `use-governance-stream` | `/api/cache-status` | on SSE error path | no | yes | Auth probe endpoint, contributes to extra traffic. |
| `GovernanceWorkflowPanel` | `/api/recommendations*` | mount + actions | no | maybe | Separate governance tab data path. |
| `DriftAlertFeed` | `/api/governance/cache-coherence` | mount + 15s interval | no | yes | Overlaps with LiveCacheCoherenceMonitor. |
| `DriftAlertFeed` | `/api/governance/mutations?limit=10` | mount + 15s interval | no | yes | Similar data family as mutation timeline. |
| `LiveCacheCoherenceMonitor` | `/api/governance/cache-coherence?limit=50` | mount + 10s interval | no | yes | Duplicate domain with DriftAlertFeed. |
| `MutationLifecycleTimeline` | `/api/governance/mutation-lifecycle?limit=50` | mount + 15s interval | no | maybe | Governance timeline polling. |
| `ModelHealthMonitor` | `/api/model-health` | component mount | no | maybe | Standalone panel fetch. |
| `QueueHealthMetrics` | `/api/queue-health?limit=30` | component mount | no | maybe | Standalone panel fetch. |
| `KPITrendChart` | `/api/kpi-history?days=<7|30|90>` | chart mount / range change | no | maybe | Tab/detail interaction fetch. |
| `DecisionReviewQueue` | `/api/decision-lineage?limit=100` | component mount | no | yes | Same endpoint family as pending count call. |

## Dashboard Load Metrics (latest observed)
- Evidence sources:
  - `/Users/ramakrishna/Desktop/Teja/Dashboards/artifacts/p5-baseline/baseline-post-instrumentation.json`
  - `/Users/ramakrishna/Desktop/Teja/Dashboards/artifacts/runtime/governance-401-trace.json`
- Current measured values:
  - `dashboardLoadMs`: ~`5.1s`
  - `refreshMs`: ~`3.6s`
  - `/api/cache` duration: ~`3.4s`

## Request Shape (current)
- During dashboard load/soak traces:
  - Total requests observed: high (hundreds when stream reconnects/401 loops are present).
  - Unique endpoint count: medium (core dashboard + governance + health + stream).
  - Duplicate endpoints: high (`/api/cache-status`, `/api/executive-summary`, governance polling family).
  - Parallel requests: present (explainability pair; independent panel mounts).
  - Sequential requests: present in core path (`cache-status` -> `executive-summary` -> optional explainability).

## Immediate Duplication Candidates (for P3.2, not changed yet)
1. Collapse repeated `fetchSummary` triggers into one orchestrated dashboard state fetch per cycle.
2. Unify governance coherence/mutation polling ownership (avoid multiple components polling overlapping endpoints).
3. Remove redundant `/api/config` read on every refresh if config is already available in page state.
4. Coalesce decision lineage count + list fetches where feasible.

## Non-goals in P3.0
- No caching strategy changes.
- No endpoint contract changes.
- No Splunk query optimization.
- No KPI cache/materialization.
- No React Query migration.
