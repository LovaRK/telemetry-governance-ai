# Coding Agent Execution Checklist (End-to-End)

## Scope
Make dashboard calculation-correct, API-driven, explainable, and aligned to V3/V4 reference behavior.

## Non-negotiables
- No mock/hardcoded/default KPI values.
- No fallback AI decisions.
- If local LLM unavailable => `FAILED_MODEL_UNAVAILABLE`.
- UI must not mix active run and published snapshot.

## Execution Order

1. API state model
- Introduce `publishedState` + `activeState` in `/api/cache-status`.
- Add explicit IDs: `executionId`, `jobId`, `publishedSnapshotId`, `activeSnapshotId`, `requestId`.

2. Publish contracts
- Enforce: `decisionCount > 0 => decisionHash != null`.
- Enforce: `READY => snapshot READY + llm READY`.

3. Formula correctness
- Centralize KPI formulas in one source module only.
- Verify ROI/GainScope/Detection/Quality/Composite against calculation guide.

4. Historical trends
- Build 7/30/90 endpoint from historical snapshots.
- Show `Insufficient history` when points < 2.

5. Chart/data binding
- Rebind all graphs to published snapshot tables.
- Remove placeholder rows and synthetic fallbacks.

6. Explainability coverage
- For each KPI/chart: formula, source endpoint/table, snapshotId, runId/executionId, confidence reason.

7. API parity verification
- Run `scripts/verify-dashboard-parity.ts`.
- Save fixtures under `tests/fixtures/live-dashboard`.
- Fail if parity report violations exist.

8. Test gates
- `npx tsc --noEmit`
- `npm run test:contract`
- `npx playwright test`
- Add E2E assertions: UI values match API fixtures.

## Deliverables
- Updated bug closure report by graph name.
- Before/after screenshots.
- Fixture evidence JSON.
- Green test outputs.
