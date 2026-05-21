# API Failure Matrix

Generated: 2026-05-20
Scope: Dashboard governance + KPI reliability gates

| Endpoint | Previous Status | Current Status | Root Cause | Fix Implemented | Evidence (Before -> After) | Owner | Retest |
|---|---:|---:|---|---|---|---|---|
| `/api/governance/stream` | 401 loop | ✅ 200 (with auth cookie) | SSE relies on cookie auth; auth refresh path had cookie-name mismatch and token refresh response parsing bug | Fixed refresh cookie handling + response shape parsing in client. Refresh now sets `accessToken` + `refreshToken` cookies; client parses `data.accessToken`. | Before: dashboard audit log showed repeated 401. After: `curl -b cookies /api/governance/stream` returns `event: connected` + heartbeat (HTTP 200). | Web/API | Re-run browser audit after normal login session >15 min to confirm no recurring 401s |
| `/api/governance/cache-coherence` | 500 | ✅ 200 | Query used non-existent columns (`id`, `coherence_score`, `hit_rate`, etc.) not present in `cache_coherence_telemetry` schema | Rewrote SELECT + mapping to real schema (`coherence_id`, divergence timings, flags) with normalized response fields expected by UI | Before: `{"error":"column \"id\" does not exist"}`. After: HTTP 200 with `{summary, records}` | API | Validate UI cards now consume normalized fields (Coherence/Drift widgets) |
| `/api/governance/mutation-lifecycle` | 500 | ✅ 200 | Query used non-existent columns (`id`, `index_name`, `from_state`, `to_state`) not present in `mutation_lifecycle_events` schema | Rewrote query/mapping to actual schema (`event_id`, `lifecycle_state`, `previous_state`, `metadata`) and adjusted filters | Before: `{"error":"column \"id\" does not exist"}`. After: HTTP 200 with `{summary, events}` | API | Verify timeline renders expected event labels when events exist |
| `/api/recommendations/audit` | 500 | ✅ 200 | Route referenced missing table (`recommendation_action_audit`) and missing column (`sourcetype`) | Switched to `recommendation_audit_log` + `recommendation_actions`, removed invalid sourcetype filter fallback | Before: `{"error":"column \"sourcetype\" does not exist"}`. After: HTTP 200 with `{index, audit, count}` | API | Verify explainability panel timeline uses returned audit rows |
| KPI aggregation (`/api/executive-summary`) | ⚠ Logical mismatch (not transport failure) | ⚠ Partially fixed | Endpoint returned only one snapshot row and tenant-scoped snapshot fetch could return empty set, forcing KPI zeros for `totalDailyGb` and `totalSourcetypes` | Patched summary route to fetch all rows for latest `snapshot_id`, added tenant-fallback for snapshot rows, and KPI fallback from snapshots when KPI table has zero values | Before: `snapshotCount=1`, `totalDailyGb=0`, `totalSourcetypes=0`. After: `snapshotCount=3`, `totalDailyGb=0.0001`, `totalSourcetypes=3` | API/Data pipeline | Still validate worker aggregation for ROI/savings/tier counts and decision generation completeness |

| Executive KPI Aggregation | HIGH | ⚠ Open (release blocker) | Snapshots exist but several KPI fields can remain zero (`roiScore`, `storageSavingsPotential`, tierCounts) when decisions/aggregates are sparse or not written | API-side fallback improved; full pipeline aggregation correctness still pending | Current: snapshots + core counts now present; ROI/savings still zero for this dataset | Data pipeline | YES — release blocked until KPI values are proven correct against known Splunk dataset |

## Code Changes Applied

- `/Users/ramakrishna/Desktop/Teja/Dashboards/apps/web/app/api/governance/cache-coherence/route.ts`
- `/Users/ramakrishna/Desktop/Teja/Dashboards/apps/web/app/api/governance/mutation-lifecycle/route.ts`
- `/Users/ramakrishna/Desktop/Teja/Dashboards/apps/web/app/api/recommendations/audit/route.ts`
- `/Users/ramakrishna/Desktop/Teja/Dashboards/apps/web/app/api/auth/refresh/route.ts`
- `/Users/ramakrishna/Desktop/Teja/Dashboards/apps/web/lib/api-client.ts`

## Release Gate (Operational Certification)

Certification remains **blocked** until all are true:
1. Browser audit shows **failed APIs = 0** during a full tab walkthrough.
2. Governance stream remains authenticated over long-running session (no 401 reconnect loop).
3. KPI aggregation mismatch closed (`snapshotCount > 0` implies non-zero/accurate KPI derivation where expected).
4. API-vs-UI assertion checks added for KPI cards.
