# P3 Request Comparison (Normalized)

Source:
- `/Users/ramakrishna/Desktop/Teja/Dashboards/artifacts/runtime/p3-request-metrics.json`
- Pre-P3 baseline references from prior captures.

## Raw Counts (includes stream traffic)
| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Total requests | 172 | 206 | +34 |
| Unique endpoints | 9 | 9 | 0 |
| Governance stream requests | 120 | 157 | +37 |
| Job stream requests | 0 | 0 | 0 |

Interpretation: raw totals are dominated by long-lived/reconnect stream traffic and are not a fair P3 signal.

## Stream-Excluded Counts (P3-relevant)
(Excludes `/api/governance/stream` and `/api/job-stream`)

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Requests (stream-excluded) | 52 | 49 | -3 |
| Unique endpoints (stream-excluded) | N/A (not captured in old artifact) | 8 | N/A |
| `/api/cache-status` count | 32 | 29 | -3 |
| `/api/executive-summary` count | N/A | 1 | N/A |
| `/api/kpi-history` count | 14 | 14 | 0 |

## Duplicate Blocking Chains
- Before: 2 known sequential blockers
  - `cache-status -> executive-summary -> explainability`
  - `config -> /api/cache -> post-refresh reload`
- After P3.2:
  - mount path consolidated through single orchestrator `getDashboardState()` in app layer.
  - refresh post-load also uses same orchestrator.

## Latency Snapshot
| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Dashboard load ms | 5135 | 6120 | +985 |
| Refresh ms | 3630 | (unchanged target path, not re-measured in this doc) | — |
| `/api/cache` duration ms | 3391 | (unchanged target path, not re-measured in this doc) | — |

## Interpretation
1. P3.2 achieved orchestration consolidation without backend contract changes.
2. Stream-excluded request count improved slightly (`-3`) and `cache-status` frequency reduced (`-3`).
3. Raw request count worsened due to stream traffic variance, which is outside P3 scope.
4. Latency did not improve in this single sample; additional controlled runs are needed.

## Next Decision Gate
- P4 runtime scaling should not be decided on raw totals.
- Decide using repeated stream-excluded measurements over multiple runs.
