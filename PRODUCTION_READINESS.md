# Production Readiness — v1.0-handoff

State of the system at handoff, and what must happen before a real customer
deployment.

## What's solid

- **Deterministic scoring is the source of truth.** `runFastAggregation()`
  computes Utilization/Detection/Quality/Composite/Tier from the calc-guide
  formulas and persists them; the LLM contributes narrative only and cannot
  change a score or tier (worker override in `writeDecisionToDb`).
- **Scoring math is pinned.** `tests/golden-dataset/` (23 tests) holds the
  engine to the calc guide's worked examples, including non-default weight
  profiles.
- **Every run is auditable.** `artifacts/score-audit/<runId>.json` records
  raw inputs → weights → sub-scores → composite → tier per index::sourcetype.
  Snapshots carry `scoring_version` + `formula_version`.
- **Idempotent ingestion.** Unique constraints + idempotency hash + snapshot
  diffing; `scripts/reset-demo-data.mjs` clears stale telemetry while
  preserving identity/config/governance.
- **Tenant isolation.** 4-layer (middleware → requireContext → set_config →
  RLS). MCP is additive behind a per-tenant flag with REST fallback.

## Must-do before customer production

### 1. Rotate the leaked credentials (history was not rewritten)

Real secrets were committed historically. Forward-facing files
(`.env.example`, `docker-compose.yml`, `ADMIN_CREDENTIALS.md`) are sanitized,
but the values remain in git history. **Decision: rotate, don't rewrite
history** (deadline-pragmatic; history rewrite is an optional later cleanup).

Rotate:
- [ ] Splunk `ram` password on 144.202.48.85 (was committed base64-encoded)
- [ ] `GOVERNANCE_BOOTSTRAP_KEY` (old `75512d55…`)
- [ ] `SPLUNK_SECRET_ENCRYPTION_KEY` (old `344b0b8b…`) — note: rotating this
      invalidates encrypted tenant Splunk secrets in Postgres; fresh installs
      re-enter Splunk creds in Settings, so this is safe for new deployments
- [ ] Default admin password — now required via `.env`, no baked-in default

### 2. Splunk Enterprise license

The dev instance trial expired; search-time commands are blocked. A live
tally and customer use need Enterprise (see `KNOWN_ISSUES.md`).

### 3. LLM provider decision

Local Ollama (gemma2:9b) is the default and keeps data on-prem. If using the
Anthropic fallback in production, confirm data-residency policy — it is
explicit opt-in only, no silent fallback.

## Verification gate (don't tag/ship until green)

See `HANDOFF_CHECKLIST.md` release criteria. Summary:
root `tsc` clean · golden-dataset + client + mcp contract tests green ·
fresh Docker install works · secrets sanitized · tally documented.

## Architecture quick reference

- Next.js 14 (web :3002) · Postgres 16 (:5433) · worker · Ollama on host
- Pipeline: POST `/api/cache` → `runFastAggregation` → deterministic scores
  persisted + LLM job → worker writes narrative, overrides scores →
  `rebuildExecutiveKpis`
- Live what-if: POST `/api/kpi/recompute` (no pipeline run)
- Scoring engine: `apps/api/services/deterministic-scoring-engine.ts` (reused,
  never copied)
