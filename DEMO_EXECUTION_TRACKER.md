# Demo Execution Tracker

**Window:** 60-minute demo stabilization  
**Mode:** hard freeze on features, parity and correctness only  
**Last updated:** 2026-05-26

## Scope Rule

Allowed:

- bug fix
- formula fix
- data-binding fix
- empty-state fix
- UI/rendering fix
- parity fix
- documentation fix

Forbidden:

- new agents
- new tabs
- new dashboards
- new settings surfaces
- new diagnostics features
- new score families

## Current Status Board

### Done

- `DEMO_FREEZE.md` created
- Full Docker restart completed
- `postgres`, `web`, `worker` healthy after rebuild
- `GET /api/health` healthy
- Real browser login path verified
- Login lands on dashboard for configured tenant
- `Splunk Not Configured` gate no longer shown for configured tenant
- `POST /api/cache` no longer crashes on empty request body
- `/api/cache-status` exposes active `pipelineRunId`
- Fresh refresh cycle reaches terminal `READY / READY / READY`
- Source-of-truth and handover docs updated for current runtime behavior
- `requestId`, `lastCompletedRun`, and model execution metadata are exposed in lifecycle payloads
- KPI history API verified live: `7d / 30d / 90d` endpoints return non-empty arrays
- Root cause isolated for wrong executive KPI cards: live worker rebuild path was writing incorrect formula outputs into `executive_kpis`
- Live worker rebuild path patched to use tenant + snapshot scoped KPI rebuild logic
- **Fixed active snapshot `executive_kpis` overwrite**: Changed worker's `rebuildExecutiveKpis()` from bare UPDATE to UPSERT (INSERT ... ON CONFLICT)
- **Added missing `avgDetection` field to KPI history API** to match executive_kpis schema
- **Fixed coverage confidence gauge overflow**: Changed MiniGauge SVG overflow from 'visible' to 'hidden'
- **Verified KPI persistence**: Latest snapshot shows correct calculated values:
  - ROI Score: 12.50 (from `avg(composite_score)` of agent_decisions)
  - GainScope: 0.00
  - Low-Value Spend: $0.02/year
  - Annual Spend: $0.02
  - Total Daily GB: 0.0001
  - Total Sourcetypes: 3
  - Avg Utilization: 2.3%
  - Avg Detection: 39.3%
  - Avg Quality: 86.7%
  - Avg Confidence: 100%
- **API verified**: `/api/executive-summary` returns correct KPI values from database

### In Progress

- Dashboard UI parity verification (KPI cards rendering correct values)
- KPI history chart rendering / binding
- Split-chart data-binding audit

### Pending

- ✅ ROI Score certification (verified: 12.50 from avg(composite_score))
- ✅ GainScope certification (verified: 0.00 calculated correctly)
- ✅ Low-Value Spend certification (verified: $0.02)
- ✅ Annual Spend certification (verified: $0.02)
- KPI trends `7d / 30d / 90d` chart rendering
- Data Volume Split chart data-binding
- Sourcetype Split chart data-binding
- Coverage gap card visual fix
- Refresh-disabled explanation
- Remaining hardcoded/default runtime values scan
- Formula/source traceability surfacing in UI

## Live Known Bugs

1. ✅ **FIXED**: Executive KPI cards persistence - active snapshot KPIs now correctly overwritten with calculated values
2. ✅ **FIXED**: Coverage confidence arc overflow - MiniGauge SVG overflow set to 'hidden' for proper clipping
3. Executive KPI card UI values not yet verified in browser render (pending dashboard verification)
4. KPI trend charts - frontend data binding verified; awaiting browser render verification
5. Split charts may not reflect current published snapshot correctly (need to verify in browser)
6. Settings/config flow is technically working but product semantics are still confusing for demo users

## Certification Table

| KPI | Formula Source | API | DB | UI | Status |
|---|---|---|---|---|---|
| ROI Score | `avg(composite_score)` | ✅ 12.50 | ✅ 12.50 | 🔄 Pending | **Fixed** |
| GainScope | `Tier1+2 GB / Total GB * 100` | ✅ 0.00 | ✅ 0.00 | 🔄 Pending | **Fixed** |
| Low-Value Spend | `Tier3+4 annual cost` | ✅ 0.02 | ✅ 0.02 | 🔄 Pending | **Fixed** |
| Annual Spend | `sum(daily_gb * cost_per_gb_year)` | ✅ 0.02 | ✅ 0.02 | 🔄 Pending | **Fixed** |
| Daily Ingest | `snapshot total volume` | ✅ 0.0001 GB | ✅ 0.0001 GB | 🔄 Pending | **Fixed** |
| Sourcetype Count | `count(distinct sourcetype)` | ✅ 3 | ✅ 3 | 🔄 Pending | **Fixed** |
| Storage Savings | `retention + field savings` | ⏳ 0.02 | ⏳ 0.02 | 🔄 Pending | Open |

## Certified Findings

- `GET /api/kpi-history?days=7|30|90` returns real, non-empty history arrays. Empty KPI trend charts are therefore a frontend rendering/binding defect, not a missing-history backend defect.
- Prior published snapshot DB certification showed:
  - ROI expected `12.50` from `avg(composite_score)`
  - GainScope expected `0.00`
  - Low-Value Spend expected `0.02`
  - Annual Spend expected `0.02`
  - Total Sourcetypes expected `3`
- The dashboard/API were showing `100 / 100 / 0.26`, proving `executive_kpis` persistence drift rather than snapshot/decision drift.

## Current Priority Order

1. Certify KPI formulas
2. Eliminate empty graphs
3. Fix split-chart bindings
4. Fix coverage confidence rendering
5. Document exact UI/API parity gaps
