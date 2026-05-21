# DEMO Pipeline Proof (AI Layer)

## Objective
Prove the full path: ingestion trigger -> processing -> decisioning -> evidence -> KPI materialization -> dashboard render.

## Evidence chain
1. Ingestion trigger
- User action: `Refresh from Splunk`
- API: `/api/cache-status`, `/api/executive-summary`, `/api/recommendations`

2. Processing and materialization
- Tables represented in APIs:
  - `telemetry_snapshots` (raw aggregated telemetry)
  - `agent_decisions` (AI/action classification)
  - `executive_kpis` (summary KPIs)

3. Decision visibility
- UI surfaces:
  - Telemetry detail table (tier/action/composite/utilization/detection/quality)
  - Governance queue and mutation widgets

4. Evidence linkage
- Recommendation/evidence fields exposed by summary/recommendations endpoints
- API audit report confirms postgres live mode metadata for core routes

## Current run proof
- Fast gate status:
  - Contract: PASS
  - Fixture reasoning: PASS
  - Agent reasoning: PASS
  - Pipeline tests: PASS
  - UI mapping: PASS
- See files:
  - `evidence/test_contract_output.txt`
  - `evidence/test_fixtures_output.txt`
  - `evidence/test_agent_output.txt`
  - `evidence/test_pipeline_output.txt`
  - `evidence/test_ui_output.txt`

## Segregation proof table
| Layer | Input | Logic | Output | Where visible |
|---|---|---|---|---|
| Telemetry aggregation | Index/sourcetype usage + cost + risk | Score computation + tier/action classification | Classified rows | Telemetry table |
| AI decisioning | Aggregated telemetry signals | Recommendation + confidence + reasoning | Decision rows | Recommendations/governance |
| KPI synthesis | Decision + telemetry aggregates | ROI/savings/confidence summarization | KPI cards/history | Overview tab |

## Timing proof procedure (during live run)
1. Capture timestamp at refresh click (`T0`).
2. Capture timestamp when KPI cards update (`T1`).
3. Capture timestamp when governance widgets refresh (`T2`).
4. Report:
- pipeline UI latency = `T1 - T0`
- governance update latency = `T2 - T0`

## Acceptance
- At least one recommendation path visible with confidence/evidence.
- KPI and telemetry render updated values without crash.
- Pipeline latencies are finite and repeatable.
