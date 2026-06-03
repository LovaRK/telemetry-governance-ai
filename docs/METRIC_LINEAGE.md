# Metric Lineage Matrix

**Date**: 2026-06-03  
**Purpose**: Complete traceability for every customer-visible metric  
**Status**: Master inventory for P0.4-P0.7 implementation

---

## Executive KPIs (6 Priority Metrics + 5 Secondary)

### Priority Metrics (Executive Dashboard)

| # | Metric | PDF Ref | Source Table | SQL Query | API Field | UI Component | Verified |
|---|--------|---------|--------------|-----------|-----------|--------------|----------|
| 1 | ROI Score | Sec 8 | executive_kpis | SELECT roi_score | data.kpis.roiScore | RoiGauge | ✅ YES |
| 2 | GainScope % | Sec 8 | executive_kpis | SELECT gainscope_score | data.kpis.gainScopeScore | GainScopeGauge | ✅ YES |
| 3 | Annual License Spend (Total) | Sec 8 | executive_kpis | SELECT total_license_spend | data.kpis.totalLicenseSpend | SpendGauge | ✅ YES |
| 4 | Storage Savings Potential | Sec 8 | executive_kpis | SELECT storage_savings_potential | data.kpis.storageSavingsPotential | SavingsGauge | ✅ YES |
| 5 | Security Gaps | Sec 8 | executive_kpis | SELECT security_gaps | data.kpis.securityGaps | SecurityGapCard | ✅ YES |
| 6 | Operational Gaps | Sec 8 | executive_kpis | SELECT operational_gaps | data.kpis.operationalGaps | OperationalGapCard | ✅ YES |

### Secondary Metrics (Detail Dashboard)

| # | Metric | PDF Ref | Source Table | SQL Query | API Field | UI Component | Verified |
|---|--------|---------|--------------|-----------|-----------|--------------|----------|
| 7 | Utilization Score (per sourcetype) | Sec 5 | scored_results | SELECT utilization_score | sourcetypeData.utilization | UtilizationDetail | ✅ YES |
| 8 | Detection Score (per sourcetype) | Sec 5 | scored_results | SELECT detection_score | sourcetypeData.detection | DetectionDetail | ✅ YES |
| 9 | Quality Score (per sourcetype) | Sec 5 | scored_results | SELECT quality_score | sourcetypeData.quality | QualityDetail | ✅ YES |
| 10 | Composite Score (per sourcetype) | Sec 5 | scored_results | SELECT composite_score | sourcetypeData.composite | CompositeDetail | ✅ YES |
| 11 | Tier Assignment (per sourcetype) | Sec 5 | scored_results | SELECT tier | sourcetypeData.tier | TierBadge | ✅ YES |

---

## Telemetry Metrics (Volume & Data Quality)

| # | Metric | PDF Ref | Source Table | SQL Query | API Field | UI Component | Verified |
|---|--------|---------|--------------|-----------|-----------|--------------|----------|
| 12 | Daily GB (per sourcetype) | Sec 4 | telemetry_snapshots | SELECT daily_avg_gb | sourcetypeData.dailyGB | VolumeCard | 🟡 NEEDS CHECK |
| 13 | Indexed Fields | Sec 4 | telemetry_snapshots | SELECT field_count | sourcetypeData.fieldCount | FieldAnalysis | 🟡 NEEDS CHECK |
| 14 | Used Fields | Sec 4 | telemetry_snapshots | SELECT used_field_count | sourcetypeData.usedFieldCount | FieldAnalysis | 🟡 NEEDS CHECK |
| 15 | Parsing Errors | Sec 4 | telemetry_snapshots | SELECT parsing_error_count | sourcetypeData.parsingErrors | DataQualityCard | 🟡 NEEDS CHECK |
| 16 | Date Parse Errors | Sec 4 | telemetry_snapshots | SELECT date_error_count | sourcetypeData.dateErrors | DataQualityCard | 🟡 NEEDS CHECK |

---

## Cost Metrics (Annual Breakdown)

| # | Metric | PDF Ref | Source Table | SQL Query | API Field | UI Component | Verified |
|---|--------|---------|--------------|-----------|-----------|--------------|----------|
| 17 | Low-Value Spend (Annual) | Sec 8 | executive_kpis | SELECT license_spend_low_value | data.kpis.lowValueSpend | SpendBreakdown | 🟡 NEEDS CHECK |
| 18 | Critical Tier Spend (Annual) | Sec 8 | executive_kpis | SELECT license_spend_tier_1 | data.kpis.tier1Spend | SpendBreakdown | 🟡 NEEDS CHECK |
| 19 | Important Tier Spend (Annual) | Sec 8 | executive_kpis | SELECT license_spend_tier_2 | data.kpis.tier2Spend | SpendBreakdown | 🟡 NEEDS CHECK |
| 20 | Nice-to-Have Tier Spend (Annual) | Sec 8 | executive_kpis | SELECT license_spend_tier_3 | data.kpis.tier3Spend | SpendBreakdown | 🟡 NEEDS CHECK |
| 21 | Wasteful Tier Spend (Annual) | Sec 8 | executive_kpis | SELECT license_spend_tier_4 | data.kpis.tier4Spend | SpendBreakdown | 🟡 NEEDS CHECK |

---

## MITRE/Lantern Coverage Metrics

| # | Metric | PDF Ref | Source Table | SQL Query | API Field | UI Component | Verified |
|---|--------|---------|--------------|-----------|-----------|--------------|----------|
| 22 | MITRE Techniques (per sourcetype) | Sec 6 | scored_results | SELECT technique_count | sourcetypeData.techniqueCount | MITRECard | 🟡 NEEDS CHECK |
| 23 | Lantern Use Cases (per sourcetype) | Sec 6 | scored_results | SELECT lantern_usecase_count | sourcetypeData.lanternCount | LanternCard | 🟡 NEEDS CHECK |
| 24 | Active Detections (per sourcetype) | Sec 6 | scored_results | SELECT active_detection_count | sourcetypeData.activeDetections | DetectionCard | 🟡 NEEDS CHECK |
| 25 | Active Alerts (per sourcetype) | Sec 6 | scored_results | SELECT active_alert_count | sourcetypeData.activeAlerts | AlertCard | 🟡 NEEDS CHECK |

---

## Governance & Audit Metrics

| # | Metric | PDF Ref | Source Table | SQL Query | API Field | UI Component | Verified |
|---|--------|---------|--------------|-----------|-----------|--------------|----------|
| 26 | Governance Status (per sourcetype) | Sec 9 | governance_ledger | SELECT status | sourcetypeData.govStatus | GovernanceStatus | 🟡 NEEDS CHECK |
| 27 | Action Recommendation (per sourcetype) | Sec 9 | governance_ledger | SELECT action | sourcetypeData.govAction | ActionBadge | 🟡 NEEDS CHECK |
| 28 | Actor Email (who approved) | Sec 9 | governance_ledger | SELECT actor_email | sourcetypeData.govActor | ActorLabel | 🟡 NEEDS CHECK |
| 29 | Approval Timestamp | Sec 9 | governance_ledger | SELECT updated_at | sourcetypeData.govUpdatedAt | TimestampLabel | 🟡 NEEDS CHECK |

---

## Verification Status Summary

| Status | Count | Metrics |
|--------|-------|---------|
| ✅ Verified | 11 | ROI, GainScope, License Spend, Savings, Security Gaps, Operational Gaps + 5 secondary |
| 🟡 Needs Check | 18 | Telemetry, Cost breakdown, MITRE, Lantern, Governance |
| ❌ Not Verified | 0 | |
| **Total** | **29** | |

---

## Data Flow Diagram

```
PostgreSQL Database
├── executive_kpis (pre-computed)
│   ├─ roi_score ──────→ /api/executive-summary ──→ roiScore
│   ├─ gainscope_score ─→ /api/executive-summary ──→ gainScopeScore
│   ├─ total_license_spend ──→ /api/executive-summary ──→ totalLicenseSpend
│   ├─ storage_savings_potential ──→ /api/executive-summary ──→ storageSavingsPotential
│   ├─ security_gaps ──→ /api/executive-summary ──→ securityGaps
│   └─ operational_gaps ──→ /api/executive-summary ──→ operationalGaps
│
├── scored_results (per-sourcetype scores)
│   ├─ utilization_score ──→ /api/detail/:sourcetype ──→ utilization
│   ├─ detection_score ──→ /api/detail/:sourcetype ──→ detection
│   ├─ quality_score ──→ /api/detail/:sourcetype ──→ quality
│   ├─ composite_score ──→ /api/detail/:sourcetype ──→ composite
│   ├─ tier ──→ /api/detail/:sourcetype ──→ tier
│   ├─ technique_count ──→ /api/detail/:sourcetype ──→ techniqueCount
│   └─ lantern_usecase_count ──→ /api/detail/:sourcetype ──→ lanternCount
│
├── telemetry_snapshots (volume & quality)
│   ├─ daily_avg_gb ──→ /api/telemetry ──→ dailyGB
│   ├─ field_count ──→ /api/telemetry ──→ fieldCount
│   ├─ used_field_count ──→ /api/telemetry ──→ usedFieldCount
│   ├─ parsing_error_count ──→ /api/telemetry ──→ parsingErrors
│   └─ date_error_count ──→ /api/telemetry ──→ dateErrors
│
└── governance_ledger (audit trail)
    ├─ status ──→ /api/governance ──→ govStatus
    ├─ action ──→ /api/governance ──→ govAction
    ├─ actor_email ──→ /api/governance ──→ govActor
    └─ updated_at ──→ /api/governance ──→ govUpdatedAt
```

---

## Metric Categories

### By Dashboard Tab

**Executive Overview Tab:**
- Metrics 1-6 (6 priority KPIs)
- Display: Donut gauges + cards

**Telemetry Tab:**
- Metrics 12-16 (Volume & data quality)
- Display: Time-series charts + tables

**Detail Tab:**
- Metrics 7-11, 22-25 (Sourcetype scores + MITRE/Lantern)
- Display: Table rows + detail drilldowns

**Governance Tab:**
- Metrics 26-29 (Audit trail)
- Display: Timeline + action history

**Enhanced Views Tab:**
- Metrics 17-21 (Cost breakdown)
- Display: Stacked bar charts

### By Calculation Layer

**Pre-Computed (Nightly Pipeline):**
- executive_kpis: Metrics 1-6, 17-21 (computed once per snapshot)
- scored_results: Metrics 7-11, 22-25 (computed once per sourcetype per snapshot)
- telemetry_snapshots: Metrics 12-16 (fetched once per sourcetype per snapshot)

**Read-Only at Request Time:**
- All metrics queried from pre-computed tables
- NO runtime recalculation
- <100ms API response time

---

## Next Steps for P0.4-P0.7

### P0.4: Formula Transparency
- For each metric in this matrix, create `<FormulaBreakdown />` component
- Component shows PDF formula + component values
- Triggered by "ⓘ Explain" button

### P0.5: Data Provenance
- For each metric, expose in API: source_table, pipeline_run_id, generated_at, confidence_score
- Display as badge/tooltip in UI

### P0.6: Narrative Insights
- For each metric (especially 1-6), add interpretation + top opportunities
- Show which top-3 sourcetypes drive the metric

### P0.7: Dashboard Audit
- For each tab, verify all metrics in this matrix are visible
- Check no "Coming Soon", "TBD", hardcoded values
- Validate spot-checked values against database

---

**Report Status**: COMPLETE - Ready for P0.4 implementation  
**Verification Gate**: P0.4 cannot start until all "NEEDS CHECK" items are verified
