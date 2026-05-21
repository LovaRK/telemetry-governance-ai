# Dashboard API-to-UI Audit Report
Generated: 2026-05-20T19:03:25.248Z
Base URL: http://localhost:3002

## 1) API Call Log (captured in browser)
- GET /api/cache-status -> statuses: 200
- GET /api/decision-lineage?limit=1 -> statuses: 200
- GET /api/executive-summary -> statuses: 200
- GET /api/governance/stream -> statuses: 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200
- POST /api/test-connection -> statuses: 200
- GET /api/kpi-history?days=7 -> statuses: 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200
- GET /api/governance/cache-coherence?limit=50 -> statuses: 200, 200
- GET /api/governance/cache-coherence -> statuses: 200, 200
- GET /api/governance/mutation-lifecycle?limit=50 -> statuses: 200, 200
- GET /api/recommendations?snapshotId=c0b84b4b-85f0-4156-8d9b-29d96b52d7e7 -> statuses: 200, 200
- GET /api/queue-health?limit=30 -> statuses: 200, 200
- GET /api/model-health -> statuses: 200, 200
- GET /api/decision-lineage?limit=100 -> statuses: 200, 200
- GET /api/governance/mutations?limit=10 -> statuses: 200, 200

## 2) Dashboard Tab Evidence (visible text/metrics)
### Tab: overview
- URL: http://localhost:3002/
- Key headers detected:
  - datasensAI
  - EXECUTIVE ROI OVERVIEW
  - EXECUTIVE OVERVIEW
  - TELEMETRY DETAIL
  - GOVERNANCE
- Metric lines sample:
  - LIVE
  - 3 indexes
  - 🔴 TOP RISK INDEXES
  - ⚠ DETECTION GAPS (0)
  - ✓ No critical detection gaps identified
  - $0 potential
  - $0 potential
  - $0
  - of $0.02 total spend
  - < 0.001 GB
  - INDEXES
  - $0.02
  - $0
  - SAVINGS POTENTIAL
  - SEC. GAPS
  - OPS GAPS
  - ROI SCORE
  - $0
  - 0% of total
  - SAVINGS POTENTIAL
  - $0
  - 0% of total
  - < 0.001 GB
  - COVERAGE GAPS
  - CONFIDENCE
  - 🏆 ROI SCORE
  - 🎯 GAINSCOPE %
  - 💰 SAVINGS POTENTIAL
  - $0k
  - 📦 DAILY INGEST (GB)
  - 0.0GB
  - 4%
  - 88%
  - 🤖 AVG AI CONFIDENCE
  - 90%
  - TIER DISTRIBUTION — 0 INDEXES
  - SCORE AVERAGES
  - 4%
  - 36%
  - 88%

### Tab: telemetry
- URL: http://localhost:3002/
- Key headers detected:
  - datasensAI
  - EXECUTIVE ROI OVERVIEW
  - EXECUTIVE OVERVIEW
  - TELEMETRY DETAIL
  - GOVERNANCE
  - TELEMETRY INTELLIGENCE — 3 INDEXES
- Metric lines sample:
  - LIVE
  - 3 indexes
  - TELEMETRY INTELLIGENCE — 3 INDEXES
  - Index	Tier	Action	GB/Day	Cost/Yr	Composite ▼	Util	Detect	Quality	Savings	Conf	Det. Gap	Recommendation	Flags
  - history	INVESTIGATE	INVESTIGATE	0.000	$0.02
  - 0	0	0	—	50%	—
  - main	INVESTIGATE	INVESTIGATE	0.000	$0
  - 0	0	0	—	50%	—
  - tutorial	INVESTIGATE	INVESTIGATE	0.000	$0
  - 0	0	0	—	50%	—

### Tab: governance
- URL: http://localhost:3002/
- Key headers detected:
  - datasensAI
  - EXECUTIVE ROI OVERVIEW
  - EXECUTIVE OVERVIEW
  - TELEMETRY DETAIL
  - GOVERNANCE
  - 🔄 Live Cache Coherence
  - Coherence Score
  - Drift Events
  - Healthy (70+)
  - UNDER_REVIEW
  - ⚖️ GOVERNANCE WORKFLOW
  - Under Review
  - ✅ Model Health Monitor
  - REVIEWS (30 DAYS)
  - APPROVALS NEEDING REVIEW
  - All governance systems nominal
  - Refresh Health Status
  - QUEUE HEALTH
  - No queue health metrics available yet
  - DECISION REVIEW QUEUE
- Metric lines sample:
  - LIVE
  - 3 indexes
  - 🔄 Live Cache Coherence
  - Coherence Score
  - 0%
  - 0%
  - avg across indexes
  - Drift Events
  - Indexes
  - Most Stale Indexes
  - No stale indexes detected ✓
  - Sourcetype Risk Heatmap
  - By Risk
  - By Savings
  - High Risk
  - composite · 3 indexes
  - High Risk (<30)
  - UNDER_REVIEW
  - Under Review
  - MODEL TRUST SCORE
  - 100%
  - Disagreement Rate: 0.0%
  - REVIEWS (30 DAYS)
  - APPROVALS NEEDING REVIEW
  - QUEUE HEALTH
  - No queue health metrics available yet
  - DECISION REVIEW QUEUE
  - No decisions awaiting review

## 3) Direct API Payload Summary (for deterministic compare)
### /api/cache-status
- HTTP: 200 (OK)
- data keys: hasEverRefreshed, hasData, hasAgentDecisions, status, lastRefreshAt, nextRefreshAt, recordCount, message
- meta: source=postgres, mode=live

### /api/executive-summary
- HTTP: 200 (OK)
- data keys: kpis, snapshots, decisions, savingsStaircase, quickWins, snapshotDate, agentReasoning
- meta: source=postgres, mode=live

### /api/decision-lineage?limit=100
- HTTP: 200 (OK)
- data[] length: 0
- meta: source=postgres, mode=live

### /api/governance/cache-coherence?limit=50
- HTTP: 200 (OK)
- data keys: summary, records, lastUpdate
- meta: source=postgres, mode=live

### /api/governance/mutations?limit=50
- HTTP: 200 (OK)
- data keys: summary, mutations, lastUpdate
- meta: source=postgres, mode=live

### /api/governance/mutation-lifecycle?limit=50
- HTTP: 200 (OK)
- data keys: summary, events, lastUpdate
- meta: source=postgres, mode=live

### /api/recommendations
- HTTP: 200 (OK)
- data keys: recommendations
- meta: source=postgres, mode=live

### /api/recommendations/audit?limit=50
- HTTP: 500 (FAIL)
- data type: undefined
- meta: source=system, mode=live

### /api/model-health
- HTTP: 200 (OK)
- data keys: snapshotDate, totalReviews30d, totalRejections30d, modelTrustScore, systemHealthStatus, staleApprovalsCount, expiredApprovalsCount, fingerprintChangesDetected
- meta: source=postgres, mode=live

### /api/queue-health?limit=30
- HTTP: 200 (OK)
- data[] length: 0
- meta: source=postgres, mode=live

## 4) Zero-Value Findings and Likely Root Causes
- totalDailyGb: 0.0001
- totalSourcetypes: 3
- roiScore: 0
- totalLicenseSpend: 0.02
- storageSavingsPotential: 0
- avgUtilization: 3.7
- avgDetection: 36
- avgQuality: 88.3
- avgConfidence: 0.9
- snapshotCount: 3
- decisionCount: 0

1. Cost/savings KPIs are zero, likely due to missing cost model enrichment or upstream Splunk fields not mapped.

## 5) Actionable Bug Queue For Next Agent
1. Validate executive summary KPI source: if `snapshots.length > 0`, ensure `kpis.totalSourcetypes` and `kpis.totalDailyGb` are derived from snapshot fallback when KPI table is missing/zero.
2. Trace cost pipeline: investigate why `totalLicenseSpend` and `storageSavingsPotential` are zero while dashboard has snapshots.
3. Cross-check confidence aggregation: verify `avgConfidence` derivation against decision rows and normalization (0..1 vs 0..100).
4. Add API-vs-UI assertion tests for key cards (Daily Ingest, Indexes, License Spend, Savings Potential) to prevent silent zero regressions.
5. Review failing/empty governance subpanels when endpoint `data[]` is empty; decide expected empty state vs data contract bug.