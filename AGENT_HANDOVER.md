# Handover - Refresh/Governance Stabilization (Phase 1E-1G)

## Branch
- `feature/data-purity-phase-2c-1`

## What was completed
- Moved publish gate out of HTTP refresh path.
  - `POST /api/cache` now enqueues and marks AI/Governance as in-progress.
  - Publish happens only in worker after AI + governance success.
- Worker fail-fast + ledger updates for governance failure.
  - On `NO_ACTIVE_MODEL_POINTER`: AI stage failed, run failed, publish not started.
- Added read-only governance runtime endpoint:
  - `GET /api/llm/governance/active`
  - Returns runtime + promotion + cache diagnostics only.
  - No secret fields exposed.
- Added/updated deterministic and integration tests for invariants:
  - governance cache invalidation + reconnect behavior
  - pointer immutability
  - no zombie in-progress stages
  - orphaned running job detection
  - failed run stays failed/not-published after delay

## Key files changed (core)
- `apps/web/app/api/cache/route.ts`
- `docker/worker.ts`
- `apps/web/app/api/llm/governance/active/route.ts`
- `apps/web/lib/model-governance-service.ts`
- `apps/api/services/model-governance-service.ts`
- `apps/infrastructure/migrations/114_phase_1g_b_governance_compat.sql`
- `apps/infrastructure/migrations/115_seed_governance_baseline.sql`

## Test evidence run
Executed and passing:
- `npx jest apps/api/services/__tests__/pipeline-governance-failure-ledger.test.ts --runInBand`
- `npx jest apps/api/services/__tests__/governance-sandbox.test.ts --runInBand`
- `npx jest apps/api/services/__tests__/contract/governance-active.contract.test.ts --runInBand`

Also passing with live-Splunk test scaffold (skips without env vars):
- `apps/api/services/__tests__/integration/splunk-worker-e2e.test.ts`

## Refresh mechanism status
- Code-path status: **fixed** for architecture issue that caused premature publish.
- Runtime verification in this shell could not be fully completed because local app instance at `localhost:3002` is currently serving a stale Turbopack module-not-found error page from an older compile context.
- Current source has corrected import (`@/lib/model-governance-service`), but running server needs restart/rebuild in your active runtime.

## Pending actions to close live verification
1. Restart web runtime cleanly (and worker) so latest code is loaded.
2. Run one real refresh from UI/API and confirm:
   - stages: Splunk Fetch -> Snapshot Write -> KPI Aggregation -> AI Decisions -> Governance Sync -> Publish
   - failed governance run never publishes
   - executive summary remains on previous published snapshot during failures
3. For full live test, set:
   - `TEST_SPLUNK_MCP_URL`
   - `TEST_SPLUNK_TOKEN`
   and run:
   - `npx jest apps/api/services/__tests__/integration/splunk-worker-e2e.test.ts --runInBand`

## Notes
- Scope intentionally kept read-only for governance API (`GET /api/llm/governance/active`).
- Promote/Rollback mutation endpoints were not exposed.
