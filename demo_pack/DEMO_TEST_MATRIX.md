# DEMO Test Matrix (UI Element -> API -> Pass Rule)

## Core mapping matrix
| UI Element | API Endpoint | Expected Field Mapping | Pass Rule | Evidence ID |
|---|---|---|---|---|
| Cache status badge/banner | `/api/cache-status` | `data.status`, `data.hasData`, `data.lastRefreshAt` | Banner/status text aligns with API state | E-OVERVIEW-KPI |
| KPI cards (ROI/savings/ingest/confidence) | `/api/executive-summary` | `data.kpis.*` | Displayed values match sampled response values | E-OVERVIEW-KPI |
| Savings staircase / quick wins | `/api/executive-summary` | `data.savingsStaircase`, `data.quickWins` | Sections render without null/undefined errors | E-OVERVIEW-KPI |
| Telemetry intelligence table | `/api/executive-summary` | `data.snapshots[]`, `data.decisions[]` | Row count and key score columns render consistently | E-TELEMETRY-TABLE |
| Recommendations list | `/api/recommendations` | `data.recommendations[]` | Recommendation cards/rows show action + confidence + rationale | E-AI-EVIDENCE |
| Governance stream status | `/api/governance/stream` | event stream connectivity | No fatal crash; stream errors surfaced gracefully | E-GOVERNANCE-STATE |
| Cache coherence monitor | `/api/governance/cache-coherence` | `data.summary`, `data.records[]` | Widget renders summary and handles empty state correctly | E-GOVERNANCE-STATE |
| Mutation lifecycle timeline | `/api/governance/mutation-lifecycle` | `data.summary`, `data.events[]` | Timeline renders or clean empty state; no runtime error | E-HITL-AUDIT |
| Governance mutation list | `/api/governance/mutations` | `data.summary`, `data.mutations[]` | List counts/rows consistent with API | E-HITL-AUDIT |
| Queue health panel | `/api/queue-health` | `data.*` | Panel renders valid status or explicit empty state | E-GOVERNANCE-STATE |
| Model health monitor | `/api/model-health` | `data.*` | Monitor shows healthy/error state without crash | E-GOVERNANCE-STATE |

## Failure-mode checks
| Check | Expected behavior |
|---|---|
| Missing data | Clear empty state, no crash |
| Refresh in progress | Button/state updates; no permanent spinner |
| API warning/error banner | Correct message displayed, UI still usable |
| Runtime safety | No `undefined`/`toFixed`/null dereference errors |
| Hardcoded/demo text | Not shown on final screen |

## Current evidence references
- `evidence/dashboard_audit_report_fresh.md`
- `evidence/network.har`
- `evidence/after_login.png`
- test outputs under `evidence/test_*_output.txt`
