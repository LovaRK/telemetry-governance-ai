# Agent Decision Verification Plan

## Goal
Prove, with repeatable evidence, that the product works as an **agentic decision system** (not only a dashboard):

Observe -> Reason -> Recommend -> Prioritize -> Act -> Audit

This plan avoids UI mocks/hardcoded values and validates server-driven behavior end-to-end.

## Production Testing Strategy (5 layers)

### Layer 1: API Contract Tests (Required)
Purpose: prevent schema drift and broken UI bindings.

Validate for critical endpoints:
- `/api/executive-summary`
- `/api/governance/*`
- `/api/decision-lineage`
- `/api/recommendations/*`

Assertions:
- Response shape always `{ data: ..., meta: ... }`
- Required keys exist with stable types
- Numeric fields are numbers (not strings/null unless explicitly allowed)
- `meta.source`, `meta.mode`, `meta.traceId` present

Recommended tools:
- Jest/Vitest + `zod` schemas

Release gate:
- 100% pass for contract test suite

---

### Layer 2: Deterministic Fixture Tests (Highest ROI)
Purpose: verify AI/business logic with tiny controlled datasets (no mass data required).

Create minimal fixture packs (3-10 rows each):
- `healthy_telemetry`
- `waste_telemetry`
- `risky_removal`
- `mixed_portfolio`

Example expected outcomes:
- healthy -> `KEEP`, high confidence
- waste -> `OPTIMIZE` or `REMOVE`, with savings > 0
- risky_removal -> `APPROVAL_REQUIRED` / governance escalation

Assertions:
- Decision class (`KEEP`/`OPTIMIZE`/`ARCHIVE`/`INVESTIGATE` etc.)
- Confidence bounds
- Reasoning contains expected evidence anchors
- Savings estimate non-negative and directionally correct

Release gate:
- Golden dataset outputs match expected snapshots

---

### Layer 3: AI Decision Correctness Tests (Agent Eval)
Purpose: prove recommendation quality, not just API availability.

For each fixture:
- Input telemetry profile
- Expected decision and rationale
- Expected governance behavior (auto-approve vs review-required)

Track evaluation metrics:
- Decision precision
- False positive rate (unsafe delete/archive recommendations)
- Human override/rejection rate
- Confidence calibration (high confidence should correlate with correctness)

Release gate:
- Thresholds agreed (example):
  - precision >= 0.85
  - false positives <= 0.05
  - override rate <= 0.20

---

### Layer 4: UI Mapping Tests (Truthfulness)
Purpose: ensure UI is a faithful rendering of server values.

Assertions:
- KPI cards match `/api/executive-summary` exactly
- Chart points match API arrays exactly
- Empty states are truthful (e.g., `$0`, `No quick wins`) when source values are zero/empty
- No hardcoded/demo/mock values in DOM

Release gate:
- API-vs-UI snapshot assertions pass for Overview/Telemetry/Governance

---

### Layer 5: End-to-End Operational Tests
Purpose: prove the real pipeline works with live integrations.

Flow:
1. Trigger refresh/job
2. Worker ingests
3. DB writes snapshots/decisions/KPIs
4. Governance stream/events emitted
5. Dashboard updates

Assertions:
- Job succeeds
- New snapshot_id appears in DB
- Decisions written
- KPI row updated
- UI reflects updated values

Release gate:
- Full path pass in one run with zero failing APIs

## Test Data Policy

Allowed:
- Controlled fixtures for testing only
- Seed on setup, delete on teardown in single run
- Deterministic, versioned test datasets

Not allowed:
- Hardcoded UI metrics
- Permanent demo rows mixed into production paths
- Mocked values in production code paths

## Recommended Repository Structure

`tests/contract/`
- API response schemas and drift tests

`tests/fixtures/`
- fixture definitions + expected outputs

`tests/agent_reasoning/`
- decision correctness and confidence calibration tests

`tests/ui_mapping/`
- API-vs-UI verification

`tests/e2e/`
- operational pipeline tests

`fixtures/`
- `healthy.json`
- `waste.json`
- `security.json`
- `mixed.json`

## Immediate Execution Plan (Next 3 steps)

1. Add contract schemas for all critical endpoints and wire into CI.
2. Implement 3 golden fixtures + expected decision outputs.
3. Add API-vs-UI checks for top KPI cards and governance widgets.

## Release Statement Rule

Do not state "production ready" unless all are true:
- Failed dashboard APIs = 0
- Stream auth stable (no 401 reconnect loop)
- KPI aggregation validated against fixture and live runs
- AI decision correctness thresholds met
- UI mapping tests pass
