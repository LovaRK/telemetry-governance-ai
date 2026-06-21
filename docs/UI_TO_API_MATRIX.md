# UI to API to Database Matrix

**Date**: 2026-06-03  
**Purpose**: Complete mapping of every screen component to its data source  
**Use For**: P0.4-P0.5 implementation blueprint

---

## Tab 1: Executive Overview

### Screen Layout
```
┌─────────────────────────────────────────────────────┐
│ Executive Summary                                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ROI Score: 52.3      GainScope: 46.7%             │
│  [Donut Gauge]        [Donut Gauge]                │
│                                                     │
│  Annual License Spend: $2.74M                       │
│  [Horizontal Bar]                                   │
│                                                     │
│  Storage Savings Potential: $187K                   │
│  Security Gaps: 2 | Operational Gaps: 5            │
│                                                     │
│  Portfolio Overview (Tier Distribution)            │
│  Tier 1 (Critical):  150 GB/day    → $547K/year   │
│  Tier 2 (Important): 200 GB/day    → $730K/year   │
│  Tier 3 (Nice-to-Have): 300 GB/day → $1.09M/year │
│  Tier 4 (Low-Value): 100 GB/day    → $365K/year  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Component → API → Table Mapping

#### Component 1: ROI Score Card
```
React Component
  └─ <RoiGauge value={data.roiScore} />
      ↓
API Endpoint
  └─ GET /api/executive-summary
      ↓
API Response
  └─ { data: { kpis: { roiScore: 52.3 } } }
      ↓
Database Query
  └─ SELECT roi_score FROM executive_kpis 
     WHERE tenant_id = ? AND snapshot_id = ?
      ↓
Source Table
  └─ executive_kpis
     └─ Column: roi_score (DECIMAL)
```

**Formula Reference**: PDF Section 8, "ROI Score"  
**Verified**: ✅ YES (FORMULA_VERIFICATION_REPORT.md)  

#### Component 2: GainScope Card
```
React Component
  └─ <GainScopeGauge value={data.gainScopeScore} />
      ↓
API Endpoint
  └─ GET /api/executive-summary
      ↓
API Response
  └─ { data: { kpis: { gainScopeScore: 46.7 } } }
      ↓
Database Query
  └─ SELECT gainscope_score FROM executive_kpis 
     WHERE tenant_id = ? AND snapshot_id = ?
      ↓
Source Table
  └─ executive_kpis
     └─ Column: gainscope_score (DECIMAL)
```

**Formula Reference**: PDF Section 8, "GainScope"  
**Verified**: ✅ YES

#### Component 3: Annual License Spend Card
```
React Component
  └─ <SpendCard value={formatCurrency(data.totalLicenseSpend)} />
      ↓
API Endpoint
  └─ GET /api/executive-summary
      ↓
API Response
  └─ { data: { kpis: { totalLicenseSpend: 2737500 } } }
      ↓
Database Query
  └─ SELECT total_license_spend FROM executive_kpis 
     WHERE tenant_id = ? AND snapshot_id = ?
      ↓
Source Table
  └─ executive_kpis
     └─ Column: total_license_spend (BIGINT)
```

**Formula Reference**: PDF Section 8, "Annual License Spend"  
**Verified**: ✅ YES

#### Component 4: Storage Savings Potential Card
```
React Component
  └─ <SavingsCard value={formatCurrency(data.storageSavingsPotential)} />
      ↓
API Endpoint
  └─ GET /api/executive-summary
      ↓
API Response
  └─ { data: { kpis: { storageSavingsPotential: 187000 } } }
      ↓
Database Query
  └─ SELECT storage_savings_potential FROM executive_kpis 
     WHERE tenant_id = ? AND snapshot_id = ?
      ↓
Source Table
  └─ executive_kpis
     └─ Column: storage_savings_potential (BIGINT)
```

**Formula Reference**: PDF Section 8, "Storage Savings Potential"  
**Verified**: ✅ YES

#### Component 5: Security Gaps Count
```
React Component
  └─ <MetricCard label="Security Gaps" value={data.securityGaps} />
      ↓
API Endpoint
  └─ GET /api/executive-summary
      ↓
API Response
  └─ { data: { kpis: { securityGaps: 2 } } }
      ↓
Database Query
  └─ SELECT security_gaps FROM executive_kpis 
     WHERE tenant_id = ? AND snapshot_id = ?
      ↓
Source Table
  └─ executive_kpis
     └─ Column: security_gaps (INTEGER)
```

**Formula Reference**: PDF Section 8, "Security Gaps"  
**Verified**: ✅ YES

#### Component 6: Operational Gaps Count
```
React Component
  └─ <MetricCard label="Operational Gaps" value={data.operationalGaps} />
      ↓
API Endpoint
  └─ GET /api/executive-summary
      ↓
API Response
  └─ { data: { kpis: { operationalGaps: 5 } } }
      ↓
Database Query
  └─ SELECT operational_gaps FROM executive_kpis 
     WHERE tenant_id = ? AND snapshot_id = ?
      ↓
Source Table
  └─ executive_kpis
     └─ Column: operational_gaps (INTEGER)
```

**Formula Reference**: PDF Section 8, "Operational Gaps"  
**Verified**: ✅ YES

#### Component 7: Tier Distribution Card
```
React Component
  └─ <TierDistribution tiers={data.tierBreakdown} />
      ↓
API Endpoint
  └─ GET /api/executive-summary
      ↓
API Response
  └─ { data: { 
        tierBreakdown: {
          tier1: { dailyGB: 150, annualSpend: 547500 },
          tier2: { dailyGB: 200, annualSpend: 730000 },
          tier3: { dailyGB: 300, annualSpend: 1095000 },
          tier4: { dailyGB: 100, annualSpend: 365000 }
        }
      }}
      ↓
Database Query
  └─ SELECT tier, SUM(daily_avg_gb), SUM(annual_cost)
     FROM scored_results 
     WHERE snapshot_id = ?
     GROUP BY tier
      ↓
Source Tables
  └─ scored_results (tier, daily_avg_gb)
  └─ agent_decisions (annual_cost per tier)
```

**Formula Reference**: PDF Section 8, "Portfolio Overview"  
**Verified**: 🟡 NEEDS CHECK

---

## Tab 2: Telemetry

### Screen Layout
```
┌─────────────────────────────────────────────────────┐
│ Data Telemetry                                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Indexed Volume (Last 7 Days)                        │
│ [Line Chart: Daily GB over time]                    │
│                                                     │
│ Top Sourcetypes by Volume                           │
│ endpoint:edr          │████████│ 8.0 GB/day        │
│ network:traffic       │██████  │ 4.2 GB/day        │
│ windows:event         │█████   │ 3.5 GB/day        │
│ syslog:auth           │████    │ 2.1 GB/day        │
│ ...                                                 │
│                                                     │
│ Data Quality Metrics                                │
│ Parsing Errors:       342 (0.003%)                 │
│ Date Parse Errors:    12  (0.001%)                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Component → API → Table Mapping

#### Component 1: Daily Volume Time Series
```
React Component
  └─ <VolumeTimeSeries data={data.dailyVolumeHistory} />
      ↓
API Endpoint
  └─ GET /api/telemetry/volume?days=7
      ↓
API Response
  └─ { data: { 
        volumeHistory: [
          { date: "2026-05-27", totalGB: 745, sourcetypes: [...] },
          { date: "2026-05-28", totalGB: 742, sourcetypes: [...] },
          ...
        ]
      }}
      ↓
Database Query
  └─ SELECT date, daily_avg_gb, sourcetype
     FROM telemetry_snapshots
     WHERE snapshot_date >= NOW() - INTERVAL 7 days
     ORDER BY date
      ↓
Source Table
  └─ telemetry_snapshots
     └─ Columns: date, daily_avg_gb, sourcetype
```

**Formula Reference**: PDF Section 4, "Telemetry"  
**Verified**: 🟡 NEEDS CHECK

#### Component 2: Top Sourcetypes by Volume
```
React Component
  └─ <SourcetypeVolumeTable sourcetypes={data.topSourcetypes} />
      ↓
API Endpoint
  └─ GET /api/telemetry/top-sourcetypes?limit=10
      ↓
API Response
  └─ { data: { 
        topSourcetypes: [
          { name: "endpoint:edr", dailyGB: 8.0, ... },
          { name: "network:traffic", dailyGB: 4.2, ... },
          ...
        ]
      }}
      ↓
Database Query
  └─ SELECT sourcetype, daily_avg_gb
     FROM telemetry_snapshots
     WHERE snapshot_id = ?
     ORDER BY daily_avg_gb DESC
     LIMIT 10
      ↓
Source Table
  └─ telemetry_snapshots
     └─ Column: daily_avg_gb (DECIMAL)
```

**Formula Reference**: PDF Section 4, "Top Sourcetypes"  
**Verified**: 🟡 NEEDS CHECK

#### Component 3: Data Quality Metrics
```
React Component
  └─ <DataQualityCard 
       parsingErrors={data.parsingErrorCount}
       dateErrors={data.dateErrorCount} />
      ↓
API Endpoint
  └─ GET /api/telemetry/data-quality
      ↓
API Response
  └─ { data: { 
        parsingErrorCount: 342,
        dateErrorCount: 12,
        totalEvents: 11200000,
        parsingErrorRate: "0.003%",
        dateErrorRate: "0.001%"
      }}
      ↓
Database Query
  └─ SELECT 
       SUM(parsing_error_count) as parsing_errors,
       SUM(date_error_count) as date_errors,
       SUM(approximate_events) as total_events
     FROM telemetry_snapshots
     WHERE snapshot_id = ?
      ↓
Source Table
  └─ telemetry_snapshots
     └─ Columns: parsing_error_count, date_error_count, approximate_events
```

**Formula Reference**: PDF Section 4, "Data Quality"  
**Verified**: 🟡 NEEDS CHECK

---

## Tab 3: Detail / Sourcetype Deep Dive

### Screen Layout
```
┌─────────────────────────────────────────────────────┐
│ Sourcetype: endpoint:edr                            │
│ [Breadcrumb: Executive > endpoint:edr]              │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Composite Score: 97.0 (Tier 1 - Critical)          │
│                                                     │
│ Dimension Breakdown                                 │
│ ┌─ Utilization: 100.0 [ⓘ Explain]                 │
│ ├─ Detection: 92.5 [ⓘ Explain]                    │
│ └─ Quality: 100.0 [ⓘ Explain]                     │
│                                                     │
│ Knowledge Objects Usage                             │
│ Alerts: 0 | Scheduled Searches: 8                   │
│ Dashboards: 238 | Ad-hoc: 0 | Users: 6             │
│                                                     │
│ MITRE Coverage                                      │
│ Techniques: 65 | Coverage: 0% (0 detections)        │
│ Techniques Covered: (none)                          │
│ Techniques Not Covered: [list of 65]               │
│                                                     │
│ Lantern Use Cases: 0                                │
│                                                     │
│ Data Quality                                        │
│ Parsing Errors: 0 | Date Errors: 0                 │
│ Field Count: 245 | Used: 32 | Unused: 213         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Component → API → Table Mapping

#### Component 1: Composite Score & Tier
```
React Component
  └─ <CompositeScoreDisplay 
       value={data.composite}
       tier={data.tier} />
      ↓
API Endpoint
  └─ GET /api/detail/:sourcetype
      ↓
API Response
  └─ { data: { 
        sourcetype: "endpoint:edr",
        composite: 97.0,
        tier: "Critical"
      }}
      ↓
Database Query
  └─ SELECT composite_score, tier
     FROM scored_results
     WHERE snapshot_id = ? AND sourcetype = ?
      ↓
Source Table
  └─ scored_results
     └─ Columns: composite_score, tier
```

**Formula Reference**: PDF Section 5, "Composite Score"  
**Verified**: ✅ YES

#### Component 2: Dimension Breakdown
```
React Component
  └─ <DimensionBreakdown 
       util={data.utilization}
       det={data.detection}
       qual={data.quality} />
      ↓
API Endpoint
  └─ GET /api/detail/:sourcetype
      ↓
API Response
  └─ { data: { 
        utilization: 100.0,
        detection: 92.5,
        quality: 100.0
      }}
      ↓
Database Query
  └─ SELECT 
       utilization_score,
       detection_score,
       quality_score
     FROM scored_results
     WHERE snapshot_id = ? AND sourcetype = ?
      ↓
Source Table
  └─ scored_results
     └─ Columns: utilization_score, detection_score, quality_score
```

**Formula Reference**: PDF Section 5, "Three Dimensions"  
**Verified**: ✅ YES

#### Component 3: Knowledge Objects
```
React Component
  └─ <KnowledgeObjectSummary 
       alerts={data.alertCount}
       scheduled={data.scheduledCount}
       dashboards={data.dashboardCount}
       adhoc={data.adhocCount}
       users={data.uniqueUsers} />
      ↓
API Endpoint
  └─ GET /api/detail/:sourcetype
      ↓
API Response
  └─ { data: { 
        alertCount: 0,
        scheduledCount: 8,
        dashboardCount: 238,
        adhocCount: 0,
        uniqueUsers: 6
      }}
      ↓
Database Query
  └─ SELECT 
       alert_count,
       scheduled_search_count,
       dashboard_count,
       ad_hoc_search_count,
       unique_user_count
     FROM scored_results
     WHERE snapshot_id = ? AND sourcetype = ?
      ↓
Source Table
  └─ scored_results
     └─ Columns: alert_count, scheduled_search_count, dashboard_count, 
                  ad_hoc_search_count, unique_user_count
```

**Formula Reference**: PDF Section 5, "Utilization Formula"  
**Verified**: ✅ YES

#### Component 4: MITRE Coverage
```
React Component
  └─ <MITRECoverageCard 
       techniques={data.techniqueCount}
       covered={data.coveredTechniques}
       uncovered={data.uncoveredTechniques} />
      ↓
API Endpoint
  └─ GET /api/detail/:sourcetype
      ↓
API Response
  └─ { data: { 
        techniqueCount: 65,
        coveredTechniques: [],
        uncoveredTechniques: [
          "Obfuscation",
          "Scripting",
          ...
        ]
      }}
      ↓
Database Query
  └─ SELECT 
       technique_count,
       covered_techniques,
       uncovered_techniques
     FROM scored_results
     WHERE snapshot_id = ? AND sourcetype = ?
      ↓
Source Table
  └─ scored_results
     └─ Columns: technique_count, covered_techniques, uncovered_techniques
```

**Formula Reference**: PDF Section 6, "MITRE Coverage"  
**Verified**: 🟡 NEEDS CHECK

#### Component 5: Lantern Use Cases
```
React Component
  └─ <LanternCard lanternCount={data.lanternUsecaseCount} />
      ↓
API Endpoint
  └─ GET /api/detail/:sourcetype
      ↓
API Response
  └─ { data: { lanternUsecaseCount: 0 } }
      ↓
Database Query
  └─ SELECT lantern_usecase_count
     FROM scored_results
     WHERE snapshot_id = ? AND sourcetype = ?
      ↓
Source Table
  └─ scored_results
     └─ Column: lantern_usecase_count (INTEGER)
```

**Formula Reference**: PDF Section 6, "Lantern Use Cases"  
**Verified**: 🟡 NEEDS CHECK

#### Component 6: Data Quality Detail
```
React Component
  └─ <DataQualityDetail 
       parsingErrors={data.parsingErrors}
       dateErrors={data.dateErrors}
       fieldCount={data.fieldCount}
       usedFields={data.usedFieldCount} />
      ↓
API Endpoint
  └─ GET /api/detail/:sourcetype
      ↓
API Response
  └─ { data: { 
        parsingErrors: 0,
        dateErrors: 0,
        fieldCount: 245,
        usedFieldCount: 32,
        unusedFieldCount: 213
      }}
      ↓
Database Query
  └─ SELECT 
       parsing_error_count,
       date_error_count,
       field_count,
       used_field_count
     FROM telemetry_snapshots
     WHERE snapshot_id = ? AND sourcetype = ?
      ↓
Source Table
  └─ telemetry_snapshots
     └─ Columns: parsing_error_count, date_error_count, field_count, used_field_count
```

**Formula Reference**: PDF Section 4, "Data Quality"  
**Verified**: 🟡 NEEDS CHECK

---

## Tab 4: Governance & Decisions

### Screen Layout
```
┌─────────────────────────────────────────────────────┐
│ Governance Ledger                                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Recommendation                                      │
│ ┌─────────────────────────────────────────────────┐│
│ │ endpoint:edr → KEEP (Tier 1 - Critical)        ││
│ │ Generated: 2026-06-01 14:32:00 UTC             ││
│ │ Confidence: 95%                                 ││
│ │                                                 ││
│ │ Rationale:                                      ││
│ │ "Mission-critical source for EDR data with     ││
│ │  strong utilization (238 dashboards, 65        ││
│ │  MITRE techniques). Recommend retention."      ││
│ │                                                 ││
│ │ Status: APPROVED by ramakrishna@...            ││
│ │ Approved: 2026-06-02 09:15:00 UTC              ││
│ └─────────────────────────────────────────────────┘│
│                                                     │
│ [More recommendations...]                          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Component → API → Table Mapping

#### Component 1: Agent Decision Card
```
React Component
  └─ <AgentDecisionCard 
       decision={data.decision}
       confidence={data.confidence}
       reasoning={data.reasoning} />
      ↓
API Endpoint
  └─ GET /api/governance/decisions
      ↓
API Response
  └─ { data: { 
        decisions: [
          {
            sourcetype: "endpoint:edr",
            action: "KEEP",
            tier: "Critical",
            confidence: 0.95,
            reasoning: "Mission-critical source...",
            generatedAt: "2026-06-01T14:32:00Z"
          },
          ...
        ]
      }}
      ↓
Database Query
  └─ SELECT 
       sourcetype,
       action,
       tier,
       confidence_score,
       reasoning,
       generated_at
     FROM agent_decisions
     WHERE snapshot_id = ?
     ORDER BY composite_score DESC
      ↓
Source Table
  └─ agent_decisions
     └─ Columns: sourcetype, action, tier, confidence_score, 
                  reasoning, generated_at
```

**Formula Reference**: PDF Section 9, "Governance Decisions"  
**Verified**: 🟡 NEEDS CHECK

#### Component 2: Governance Status & Approval
```
React Component
  └─ <ApprovalStatus 
       status={data.govStatus}
       actor={data.govActor}
       timestamp={data.govTimestamp} />
      ↓
API Endpoint
  └─ GET /api/governance/approvals
      ↓
API Response
  └─ { data: { 
        approvals: [
          {
            sourcetype: "endpoint:edr",
            status: "APPROVED",
            actor: "ramakrishna@bitsioinc.com",
            timestamp: "2026-06-02T09:15:00Z",
            note: "Confirmed - critical for security"
          },
          ...
        ]
      }}
      ↓
Database Query
  └─ SELECT 
       sourcetype,
       status,
       actor_email,
       updated_at,
       action_note
     FROM governance_ledger
     WHERE snapshot_id = ?
     ORDER BY updated_at DESC
      ↓
Source Table
  └─ governance_ledger
     └─ Columns: sourcetype, status, actor_email, updated_at, action_note
```

**Formula Reference**: PDF Section 9, "Audit Trail"  
**Verified**: 🟡 NEEDS CHECK

---

## Tab 5: Enhanced Views / Cost Analysis

### Screen Layout
```
┌─────────────────────────────────────────────────────┐
│ Cost Analysis by Tier                               │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Annual Spend Distribution                           │
│ ┌────────────────────────────────────────────────┐ │
│ │ Tier 1 (Critical)   │█████   │ $547,500 (20%)  │ │
│ │ Tier 2 (Important)  │███████ │ $730,000 (27%)  │ │
│ │ Tier 3 (Nice-to-H)  │████████ │ $1,095,000(40%)│ │
│ │ Tier 4 (Wasteful)   │█████    │ $365,000 (13%) │ │
│ └────────────────────────────────────────────────┘ │
│                                                     │
│ Opportunities Summary                               │
│ ┌────────────────────────────────────────────────┐ │
│ │ Potential Savings: $187,000/year                │ │
│ │ (From optimizing Tier 3+4 sources)              │ │
│ └────────────────────────────────────────────────┘ │
│                                                     │
│ Top Cost Sources (Tier 4)                           │
│ vms:perfmon      │█████    │ 2.1 GB/day $75K/yr  │ │
│ legacy:foo       │████     │ 1.8 GB/day $66K/yr  │ │
│ debug:verbose    │███      │ 1.2 GB/day $44K/yr  │ │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Component → API → Table Mapping

#### Component 1: Tier Cost Breakdown
```
React Component
  └─ <TierCostBreakdown tiers={data.tierCosts} />
      ↓
API Endpoint
  └─ GET /api/enhanced/cost-by-tier
      ↓
API Response
  └─ { data: { 
        tierCosts: {
          tier1: { spend: 547500, pct: 0.20, count: 45 },
          tier2: { spend: 730000, pct: 0.27, count: 89 },
          tier3: { spend: 1095000, pct: 0.40, count: 156 },
          tier4: { spend: 365000, pct: 0.13, count: 57 }
        }
      }}
      ↓
Database Query
  └─ SELECT tier, SUM(annual_cost), COUNT(*)
     FROM agent_decisions
     WHERE snapshot_id = ?
     GROUP BY tier
      ↓
Source Table
  └─ agent_decisions
     └─ Columns: tier, annual_cost
```

**Formula Reference**: PDF Section 8, "Cost by Tier"  
**Verified**: 🟡 NEEDS CHECK

#### Component 2: Savings Opportunities
```
React Component
  └─ <SavingsOpportunities 
       total={data.totalSavings}
       sources={data.topCosts} />
      ↓
API Endpoint
  └─ GET /api/enhanced/savings-opportunities
      ↓
API Response
  └─ { data: { 
        totalSavings: 187000,
        topCosts: [
          {
            sourcetype: "vms:perfmon",
            dailyGB: 2.1,
            annualCost: 75000,
            tier: 4,
            potential: "eliminate"
          },
          ...
        ]
      }}
      ↓
Database Query
  └─ SELECT 
       sourcetype,
       daily_avg_gb,
       annual_cost,
       tier,
       optimization_action
     FROM agent_decisions
     WHERE snapshot_id = ? AND tier IN (3, 4)
     ORDER BY annual_cost DESC
     LIMIT 10
      ↓
Source Tables
  └─ agent_decisions (sourcetype, tier, annual_cost, optimization_action)
  └─ telemetry_snapshots (daily_avg_gb)
```

**Formula Reference**: PDF Section 8, "Storage Savings Potential"  
**Verified**: 🟡 NEEDS CHECK

---

## Verification Status by Tab

| Tab | Verified Components | Needs Check | Status |
|-----|-------------------|-------------|--------|
| Executive Overview | 6/7 | 1 (tier breakdown) | ✅ Mostly Done |
| Telemetry | 0/3 | 3 | 🟡 Pending |
| Detail / Drill Down | 3/6 | 3 (MITRE, Lantern, Field analysis) | 🟡 Partial |
| Governance | 0/2 | 2 | 🟡 Pending |
| Enhanced Views | 0/2 | 2 | 🟡 Pending |
| **Total** | **9/20** | **11/20** | **45% Verified** |

---

## Implementation Notes for P0.4+

### For P0.4 (Formula Transparency)
- For each component above, create `<FormulaBreakdown/>` modal
- Show formula from PDF + actual component values
- Triggered by "ⓘ Explain" icon

### For P0.5 (Provenance)
- Add to each API response: `source_table`, `pipeline_run_id`, `generated_at`, `confidence_score`
- Display as small badge/tooltip in UI

### For P0.6 (Narrative)
- Add to executive metrics: interpretation text + top 3 opportunities
- Reference sourcetypes from the detail data

### For P0.7 (Dashboard Audit)
- Walk through each tab using this matrix
- Verify component is visible
- Spot-check value against database
- Verify no "Coming Soon", "TBD", hardcoded values

---

**Report Status**: COMPLETE - Ready for verification of "NEEDS CHECK" items
