# Dashboard Verification Plan

## Objective
Confidently verify dashboard correctness when Splunk data is sparse, without fake UI values.

## Core Principle
Sparse/zero values are acceptable **if they are truthfully derived** from backend data.

## What must be proven
1. Every displayed metric is server-derived.
2. Empty/zero states are intentional and accurate.
3. Charts/cards match API payload values exactly.
4. No hardcoded/mock/demo values leak into runtime UI.

## Verification Checklist

### A. Endpoint Health
- `/api/cache-status`
- `/api/executive-summary`
- `/api/governance/*`
- `/api/queue-health`
- `/api/decision-lineage`

Expected:
- HTTP 200
- valid `{data, meta}` shape

### B. KPI Truth Mapping
For each KPI card/chart:
- Capture API value
- Capture rendered value
- Assert equality/transformation rule

Examples:
- `kpis.totalSourcetypes` -> "Indexes" count
- `kpis.totalDailyGb` -> ingest card/chart
- `kpis.storageSavingsPotential` -> savings card

### C. Empty-State Truth Tests
When data is absent/small:
- `$0` savings shown
- `No quick wins` shown
- `No queue health metrics` shown

These should be marked **PASS** if API values are empty/zero.

### D. Regression Guards
- DOM scan denies `mock`, `demo`, `synthetic`, hardcoded leak patterns
- API call list checked for 4xx/5xx failures during tab walkthrough

## Minimal Data Test Strategy
Use tiny fixtures only (3-10 rows), then cleanup immediately.

Run pattern:
1. Seed fixture
2. Trigger pipeline
3. Assert API + UI mapping
4. Teardown fixture

This provides strong confidence without mass Splunk data.

## Confidence Model

- Unit tests alone: logic confidence only
- Integration tests: API + DB confidence
- UI mapping tests: presentation truth confidence
- E2E tests: operational confidence

Final confidence = all layers together.

## Suggested Commands (example)
- `npm run test:contract`
- `npm run test:fixtures`
- `npm run test:ui-mapping`
- `npm run test:e2e`
- `npm run test:all-gates`

## Gate to claim "working"
You can confidently claim working when:
1. API failures in dashboard walkthrough = 0
2. KPI/UI mapping assertions = pass
3. Empty-state truth tests = pass
4. AI decision fixture tests = pass
5. End-to-end pipeline run = pass
