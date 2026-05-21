# DEMO Runbook (Manual Screen Recording)

## Recording control
- Record ON: immediately before opening login screen
- Record OFF: after final release gate checklist is shown

## Demo path (primary)
1. Login
- Open `http://localhost:3002/login?next=%2F`
- Sign in with valid credentials
- Outcome: Dashboard shell renders, no crash

2. Health and refresh
- Confirm cache status banner
- Click `Refresh from Splunk`
- Outcome: refresh starts and completes; no infinite spinner

3. Overview tab (business value)
- Show KPI cards (ROI, savings, daily ingest, confidence)
- Narrate: values are API-backed from `/api/executive-summary`

4. Telemetry tab (data segregation)
- Show index rows with tier/action/scores
- Narrate: raw telemetry is bucketed into actionable classifications

5. Governance tab (operational control)
- Show cache coherence, mutation lifecycle, queue health widgets
- Narrate: governance layer is live and auditable

6. AI layer proof
- Open recommendation/evidence areas
- Narrate: decision + confidence + evidence linkage
- Reference API proof from audit report and network HAR

7. Human-in-the-loop proof
- Perform one approve/reject/defer action on a recommendation
- Outcome: status/timeline/history updates
- Narrate: actor attribution and audit trail captured

8. Final stability shot
- Return to top-level dashboard state
- Show no fatal errors, no broken widgets, no stuck refresh state

## Sparse-live-data fallback branch
Use only if live Splunk dataset is insufficient for full coverage:
1. Use controlled tagged temporary dataset for validation.
2. Run full same walkthrough.
3. Announce temporary-data usage transparently.
4. Run cleanup + verify-clean.
5. End with live-only final screen if possible.

## Evidence to capture during recording
- Screenshot IDs:
  - `E-LOGIN-OK`
  - `E-OVERVIEW-KPI`
  - `E-TELEMETRY-TABLE`
  - `E-GOVERNANCE-STATE`
  - `E-AI-EVIDENCE`
  - `E-HITL-MUTATION`
  - `E-FINAL-STABLE`
