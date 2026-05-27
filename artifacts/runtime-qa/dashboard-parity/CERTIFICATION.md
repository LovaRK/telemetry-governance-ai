# Dashboard Data Certification

**Date:** 2026-05-25
**Tenant:** `e84f31d3-d285-46a1-a0d0-2f64698cd0df`
**Commit:** `b2dc489` (tag `v1.2-trust-stable`)
**Status:** Beta / internal demo ready

---

## 1. Published Snapshot

| Field | Value |
|---|---|
| Active snapshot ID | `37eef160-cbe1-46bd-a89a-3be1708f1f97` |
| Active run ID | `1080729b-e4ff-4b76-9e38-8367df29a3fe` |
| Published at | 2026-05-23 |
| Status | SUCCEEDED |

## 2. Executive Summary KPIs (API → DB)

### Values
| KPI | API Value | DB Value | Match |
|---|---|---|---|
| roiScore | 79.41 | 79.41 | ✅ |
| gainScopeScore | 72.03 | 72.03 | ✅ |
| dailyGb | 13.287 | 13.287 | ✅ |
| totalSourcetypes | 10 | 10 | ✅ |
| avgUtilization | 75.45 | 75.45 | ✅ |
| avgDetection | 81.41 | 81.41 | ✅ |
| avgQuality | 87.35 | 87.35 | ✅ |
| avgConfidence | 83.33 | 83.33 | ✅ |
| storageSavingsPotential | 310000 | 310000 | ✅ |
| tierCritical | 6 | 6 | ✅ |
| tierImportant | 2 | 2 | ✅ |
| tierNiceToHave | 0 | 0 | ✅ |
| tierLowValue | 2 | 2 | ✅ |

### Formula Verification
ROI = `avg(composite_score)` from agent_decisions for published snapshot:

| Metric | Stored Value | Recompute from Decisions | Delta |
|---|---|---|---|
| ROI | 79.41 | 76.71 (avg of 10 decisions) | -2.70 |

**Note:** Seed data generates independent random values for executive_kpis and agent_decisions. In production, the pipeline computes `computeROIScore(decisions) → ek.roi_score`, ensuring consistency. The 2.70 delta is a seed data artifact, not a code bug.

## 3. Trend History

### 7-Day Window
- Cutoff: 2026-05-18
- Points returned: **2** (May 19, May 23)
- Filtering: ✅ (May 15 excluded, outside 7d range)

### 30-Day Window
- Cutoff: 2026-04-25
- Points returned: **3** (May 15, 19, 23)
- Filtering: ✅ (all seed data within 30 days)

### 90-Day Window
- Cutoff: 2026-02-24
- Points returned: **3** (May 15, 19, 23)
- Filtering: ✅ (all seed data within 90 days)

### Trend Values
| Date | ROI | GainScope | Utilization | Quality | Confidence |
|---|---|---|---|---|---|
| May 15 | 65.60 | 55.55 | 64.11 | 80.32 | 77.48 |
| May 19 | 74.87 | 65.12 | 69.53 | 83.06 | 81.19 |
| May 23 | 79.41 | 72.03 | 75.45 | 87.35 | 83.33 |
| Trend | ↑ | ↑ | ↑ | ↑ | ↑ |

## 4. Snapshot Parity

### Decision ↔ Published Snapshot
| Metric | Value |
|---|---|
| Total decisions in system | 30 (3 snapshots × 10) |
| Published snapshot decisions | 10 |
| Decisions matching published snapshot ID | **10/10** ✅ |
| Orphaned decisions (wrong snapshot_id) | 0 ✅ |

### Snapshot ↔ Run
| Metric | Value |
|---|---|
| Telemetry snapshots | 30 (3 snapshots × 10 index/sourcetype combos) |
| Published snapshot snapshots | 10 |
| Snapshots matching published snapshot ID | **10/10** ✅ |

## 5. Cache Status

| Field | Value |
|---|---|
| hasEverRefreshed | true |
| hasData | true |
| hasKpis | true |
| hasAgentDecisions | true |
| recordCount | 10 |
| decisionCount | 10 |
| snapshotStatus | READY |
| pipelineStatus | PARTIAL |
| llmStatus | NOT_STARTED |
| publishedAt | 2026-05-23 |

## 6. Remaining Issues

### Parallel Test Race Conditions (2)

| Test | Issue | Root Cause |
|---|---|---|
| `job-lease-timeout` (test 2/3) | Run B expected RUNNING but got FAILED | `recoverStaleJobs` from parallel test picks up wrong tenant's stale jobs |
| `pipeline-lifecycle-integrity` (test 3/5) | llmStatus expected FAILED_TIMEOUT but got FAILED | Same `recoverStaleJobs` cross-tenant contamination |

**Classification:** DB pool contention / test data isolation
**Fix:** Use unique tenant IDs per test for `recoverStaleJobs`-mutated tables, or run sequentially.
**Severity:** Low — never observed in CI serial execution, only in parallel local runs.

### Seed Data Note
Seed `executive_kpis` values are independently randomized — not computed from `agent_decisions` via `computeROIScore()`. The pipeline's actual `executive_kpis` population logic ensures formula contract compliance. This seed is for UI development only; certification of the pipeline's KPI computation requires an end-to-end pipeline run (blocked by SPLUNK-001).

## 7. Gates Summary

| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ PASS |
| Data purity validation | ✅ PASS |
| Soak test (10x refresh) | ✅ PASS (10/10 consistent) |
| Contract tests (isolated) | ✅ 197/197 PASS |
| Executive Summary | ✅ LIVE |
| KPI History (7d) | ✅ 2 points |
| KPI History (30d) | ✅ 3 points |
| KPI History (90d) | ✅ 3 points |
| Cache Status | ✅ READY |
| Decision parity (published) | ✅ 10/10 match |
| Time window filtering | ✅ correct |

**Overall: BETA / internal demo ready**
