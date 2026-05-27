# Demo Freeze

**Effective date:** 2026-05-26  
**Mode:** `RELEASE_MODE=true` by policy, even if not yet enforced in runtime config

## Scope Freeze

Until dashboard correctness is certified, do not add:

- new agents
- new tabs
- new config screens
- new diagnostics panels
- new score families
- new explainability widgets
- new chart types unless required for V3 parity

Allowed work only:

- bug fixes
- formula fixes
- data-binding fixes
- empty-state fixes
- chart rendering fixes
- parity fixes against the uploaded V3 executive dashboard and calculation guide
- documentation updates that reflect current code

## Immediate Objective

Stabilize the existing product for demo use:

`Splunk -> snapshots -> KPI formulas -> agent decisions -> API -> UI`

The demo blocker is no longer basic pipeline execution. The blocker is:

- wrong numbers
- empty trend charts
- suspicious split charts
- overflowed gauges
- missing formula traceability

## Current Product Assessment

- Pipeline reliability: high
- Auditability: medium-high
- Dashboard correctness: medium
- UX clarity: low-medium
- Explainability: low

## P0 Must-Fix Items

1. ROI certification
- dashboard ROI must equal `avg(composite_score)` for the current published snapshot

2. GainScope certification
- dashboard GainScope must equal `(Tier 1 + Tier 2 GB) / Total GB * 100`

3. KPI history
- `7d`, `30d`, `90d` endpoints must return real rows or explicit `insufficientHistory`

4. Split charts
- data volume split must bind to current published snapshot
- sourcetype split must bind to current published snapshot

5. Coverage confidence card
- clamp confidence to `0..100`
- fix row layout and arc overflow

6. Active/published snapshot integrity
- charts and cards must not mix values from different `snapshotId` / `runId`

7. No fallback intelligence
- if local model is unavailable, fail the AI phase
- do not publish fake or deterministic fallback decisions

## Verification Standard

Every executive KPI must be certifiable across:

- formula source
- API payload
- DB rows
- rendered UI

If any one of those differs, treat it as a bug, not a product enhancement.
