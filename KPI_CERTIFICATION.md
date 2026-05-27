# KPI Formula Certification

Each KPI is certified by verifying: **Stored (DB) ≡ API Response ≡ Formula Recompute ≡ Source Tables**.

## Certification Status

| KPI | Formula | Source Tables | Tolerated Δ | Status |
|-----|---------|--------------|-------------|--------|
| ROI Score | `avg(composite_score)` | `agent_decisions` | 0.0 | ✅ PASS |
| GainScope | `(Tier1+2 GB / Total GB) × 100` | `telemetry_snapshots` | 0.0 | ✅ PASS |
| Utilization | `(weighted_sum / max_weighted) × 100` | `telemetry_snapshots` (via Splunk signals) | 0.0 | ✅ PASS |
| Detection | `0.40 × potential + 0.60 × realized` | `telemetry_snapshots` (MITRE/Lantern/alerts) | 0.0 | ✅ PASS |
| Quality | `max(0, 100 − issue_density × 2000)` | `telemetry_snapshots` (daily_gb, issues) | 0.0 | ✅ PASS |
| Composite | `0.35U + 0.40D + 0.25Q` | `agent_decisions` (util/det/qual scores) | 0.0 | ✅ PASS |
| Low-Value Spend | `sum(annual_cost) WHERE tier ∈ {Nice-to-Have, Low-Value}` | `telemetry_snapshots` | 0.0 | ✅ PASS |
| Security Gaps | `count WHERE detectionGap = true` | `telemetry_snapshots` | 0.0 | ✅ PASS |
| Operational Gaps | `count WHERE operationalGap = true` | `telemetry_snapshots` | 0.0 | ✅ PASS |
| Retention Savings | `excess_gb × cost_per_gb × months` | `telemetry_snapshots` | 0.0 | ✅ PASS |
| Field Savings | `unused_field_gb × cost_per_gb × months` | `telemetry_snapshots` | 0.0 | ✅ PASS |
| Compression Savings | `compression_gb × cost_per_gb × months` | `telemetry_snapshots` | 0.0 | ✅ PASS |

## Formula Specification

### ROI Score
```
ROI = round(avg(composite_score), 1)
```
- Source: `agent_decisions.estimated_savings_deterministic`
- Implementation: `packages/core/engine/kpi/index.ts:computeROIScore`

### GainScope
```
tier12_gb = sum(daily_avg_gb) WHERE tier IN ('Critical', 'Important')
total_gb  = sum(daily_avg_gb)
gainscope = round((tier12_gb / total_gb) × 100, 1)
```
- Source: `telemetry_snapshots.daily_avg_gb`, `agent_decisions.tier`
- Implementation: `packages/core/engine/kpi/index.ts:computeGainScope`

### Composite Score
```
composite = U×0.35 + D×0.40 + Q×0.25
```
- Depends on Utilization, Detection, and Quality scores
- Weights configurable via `UserConfig.kpiWeights` (profiles: balanced, security_first, operations_first, data_quality)
- Defaults: utilization=0.35, detection=0.40, quality=0.25
- Must sum to 1.0 (enforced by assert)
- Implementation: `packages/core/engine/scoring/composite.ts:computeCompositeScore`

### Utilization Score
```
weighted_sum = alerts×3 + scheduled×3 + dashboards×2 + adhoc×1 + users×2
score        = round((weighted_sum / max_weighted_across_batch) × 100, 1)
```
- Relative-to-max scoring: highest-use index gets 100, all others scale
- Implementation: `packages/core/engine/scoring/utilization.ts`

### Detection Score
```
mitre_potential   = min(100, mitre_technique_count × 1.25)
lantern_potential = min(100, lantern_usecase_count × 6.0)
potential         = max(mitre_potential, lantern_potential)
realized          = (active_alert_count / max_alert_across_batch) × 100
score             = 0.40 × potential + 0.60 × realized
```
- Gap detection: detectionGap = true when MITRE ≥ 15 techniques AND coverage < 25%
- Gap detection: operationalGap = true when Lantern ≥ 4 use cases AND alerts = 0
- Implementation: `packages/core/engine/scoring/detection.ts`

### Quality Score
```
approx_events  = daily_gb × 1,000,000
issue_density  = weighted_issues / approx_events
score          = max(0, round(100 − issue_density × 2000, 1))
```
- Defaults to 100 when daily_gb = 0
- Implementation: `packages/core/engine/scoring/quality.ts`

### Tier Assignment
```
composite >= 65 → Critical
composite >= 40 → Important
composite >= 20 → Nice-to-Have
composite <  20 → Low-Value
```
- Implementation: `packages/core/engine/tier.ts:assignTier`

### Storage Savings
```
retention_excess_gb = daily_gb × max(0, retention_days − 365) / retention_days
unused_field_gb     = daily_gb × (total_fields − used_fields) / total_fields
compression_gb      = daily_gb × (1 − utilization/100) × 0.3
monthly_cost        = savings_gb × cost_per_gb_per_day × 30
annual_savings      = monthly_cost × 12
```
- Implementation: `packages/core/engine/savings/storage.ts`

## Verification Procedure

1. **Unit**: Each formula has contract tests in `tests/contract/formula-contracts.test.ts` (static inputs)
2. **Integration**: Read `executive_kpis` from DB, recompute from `agent_decisions` + `telemetry_snapshots`, assert match
3. **API**: Fetch from `/api/executive-summary`, assert response matches DB
4. **History**: Fetch from `/api/kpi-history`, assert time-series matches DB rows

## Run Certification

```bash
# Unit tests
npx jest tests/contract/formula-contracts.test.ts --verbose

# Integration (KPI recompute)
npx jest tests/contract/kpi-certification.integration.test.ts --verbose
```
