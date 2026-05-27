# Dashboard Data-Truth Parity Verification

## Summary

Seeded 3 publishes with trending KPIs. All key endpoints now return real data.

| Metric | Exec Summary | KPI History (90d) | Cache Status |
|---|---|---|---|
| ROI Score | 79.41 | Trending 65.6 → 74.87 → 79.41 | hasKpis: true |
| GainScope | 72.03 | Trending 55.55 → 65.12 → 72.03 | - |
| Utilization | 75.45% | Trending 64.11 → 69.53 → 75.45% | - |
| Quality | 87.35% | Trending 80.32 → 83.06 → 87.35% | - |
| Confidence | 83.33% | Trending 77.48 → 81.19 → 83.33% | - |
| Total Daily GB | 13.287 | Trending 12.513 → 12.9 → 13.287 | dailyAvgGb: 13.287 |
| Snapshots | 10 rows | - | recordCount: 10 |
| Decisions | 10 rows | - | decisionCount: 10 |
| Quick Wins | Present | - | - |

## Data Sources

- `executive-kpis.json`: Full executive summary with KPI cards, decision tiers, quick wins
- `kpi-history-*.json`: Trend data at 90/30/7 day windows (3 points, 3 points, 2 points)
- `cache-status.json`: Publisher/cache metadata with readiness flags

## Fixes Applied

| Issue | Fix |
|---|---|
| kpi-history SQL type mismatch (`varchar = uuid`) | `pr.tenant_id::uuid = ek.tenant_id` cast |
| telemetry_snapshots had wrong snapshot_ids (not matching pipeline_runs) | Seed script now uses `snapshotId` instead of separate `tsId` UUID |
| tenant_snapshot_pointer was empty | Seed script now updates pointer after each run |
| Executive Summary returned `SPLUNK_UNAVAILABLE` | Caused by empty telemetry_snapshots for the active snapshot_id |

## API Response Files

- `executive-summary.json` - 200 OK, LIVE mode
- `kpi-history-90d.json` - 3 points, trending
- `kpi-history-30d.json` - 3 points, trending
- `kpi-history-7d.json` - 2 points, trending
- `cache-status.json` - READY, published
