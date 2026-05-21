# Demo Speaker Cheat Sheet (1 Page)

## Opening (20 sec)
This platform turns telemetry into explainable decisions, not only dashboards.

## Problem (30 sec)
Teams ingest large Splunk volumes but struggle to know what to keep, optimize, or remove.

## Architecture (40 sec)
Telemetry -> worker -> DB -> AI reasoning -> governance -> dashboard.

## Live Flow (Customer View)
Login -> Dashboard load -> Connect & Refresh -> Overview -> Telemetry -> Governance -> AI recommendation -> Decision rationale -> Queue health -> Governance approval.

## Login + Refresh (45 sec)
Show `Connect & Refresh`.
Narration: Pipeline creates snapshots, recommendations, and KPI updates.

## Overview Tab (45 sec)
Show ROI, Savings, Utilization.
Narration: These are API-backed KPIs.

## Telemetry Tab (45 sec)
Show unused/high-cost index examples.
Narration: Agent evaluates cost, searches, alerts, utilization.

## Governance Tab (60 sec)
Show recommendation action (e.g. REMOVE), reason, confidence, and estimated savings.
Narration: Recommendations are explainable and auditable.

## Human-in-the-Loop (45 sec)
Show approval-required path and perform one governance action.
Narration: Unsafe actions require approval before execution.

## Evidence (30 sec)
Open `/Users/ramakrishna/Desktop/Teja/Dashboards/demo_pack/Telemetry_AI_Demo_Certification.pdf`.
Show HAR, audit report, and pass outputs.

## Close (20 sec)
This is an agentic control plane: observe, reason, govern, act.

## Final Green Checklist
- `/api/governance/stream` -> 200
- `/api/governance/cache-coherence` -> 200
- `/api/governance/mutation-lifecycle` -> 200
- No browser 500s
- Connect/Refresh works
- AI recommendation visible
- Dashboard stable

## Operational Note
If live data is sparse: record successful walkthrough first, then run cleanup and final clean-state proof.
