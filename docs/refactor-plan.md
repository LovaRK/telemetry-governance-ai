# BitsIO / datasensAI — Approved Phased Architecture Refactor Roadmap

**Tagged:** `v1.0-refactor-plan`
**Frozen:** Do not modify this plan without explicit approval.

---

## Architecture (Preserved — Do Not Change)

```
Splunk tstats (via MCP abstraction)
  ↓
Normalization (canonical)
  ↓
Deterministic KPIs ← TRUST LAYER (ROI/GainScope/Detection — never computed by LLM)
  ↓
LLM Reasoning (explain + recommend only, NEVER compute KPI values)
  ↓
Governance (with memory: decision_history, operator_feedback, approval_outcomes)
  ↓
UI (with "AI did this" badges, reasoning cards, evidence chains)
```

**Core rule:** LLM augments. LLM is never the source of truth for KPI values. Deterministic scoring from `packages/core/engine` is the single source of truth.

---

## Global Non-Negotiables

### Required before every phase tag

```bash
npx tsc --noEmit       # PASS
npm run test:contract  # 197/197 PASS
npm run test:e2e       # 20/20 PASS
```

No exceptions. Any regression = stop and fix before tagging.

### Rollback criteria

If any of the following occur during a phase, rollback immediately:

```bash
git checkout <previous-tag>
```

Rollback triggers:
- Contract tests fail
- E2E tests fail
- Typecheck fails
- Runtime regression (dashboard 500s, missing data, incorrect KPIs)
- Mock data or hardcoded defaults introduced

### Migration discipline

Each phase MUST follow this commit ordering:
1. **Migration commit** — database schema changes only
2. **Runtime commit** — service/API/pipeline logic only
3. **UI commit** — frontend components only

Never mixed. Never combined.

### Observability (mandatory for every new subsystem)

Every new service, pipeline stage, or subsystem MUST emit:

- Latency (p50/p95/p99)
- Error count
- Duration
- Cache hit/miss ratio

Persist to `observability_metrics` table or equivalent. Not optional.

---

## Phase 0 — Freeze + Inventory

**Tag:** `v1.1-inventory`
**Duration:** 1–2 days
**Mode:** Read-only

**Goal:** Know exactly what exists.

**Tasks:**
- Run `ts-prune` → list all unused exports
- Run `depcruise` → generate dependency graph
- Run `madge --circular` → find circular dependencies
- Run bundle analyzer → identify large/hot modules
- Audit all Next.js routes → find undocumented or dead endpoints
- Audit all migrations → identify which are applied vs leftover files
- Output `DEAD_CODE.md` and `ARCHITECTURE_MAP.md` with evidence per finding

**Do NOT modify any code.** This phase is pure inventory.

**Gate:** 197 contracts, 20 E2E, typecheck PASS

---

## Phase 1 — Runtime Stability

**Tag:** `v1.2-runtime-stable`
**Status:** Partly started

**Goal:** The app works reliably in all user-facing states.

**Tasks:**

### Settings Runtime Validation (7 cases)
1. Ollama path — Default Local works with zero config
2. Anthropic path — Requires explicit API key + model selection in UI
3. Persist — Settings survive browser refresh
4. Reload — New settings apply immediately on save
5. Missing key — Clear UI error when Anthropic selected but no key
6. Invalid key — Clear UI error on invalid Anthropic key
7. No silent cloud fallback — System never uses Anthropic without explicit opt-in

### Empty-State Validation
- Delete all data
- Verify no mock data appears anywhere
- Verify no crash on empty state
- Verify truthful empty states: KPIs show 0/N/A, charts show empty text, tables show "No data available"

### Slow-Network Validation
- Loading skeletons/shimmers appear during fetch
- Failed requests retry with exponential backoff
- Timeout messages after 10s
- Requests succeed when network restored
- No stale data shown after recovery

**Gate:** 197 contracts, 20 E2E, typecheck PASS

---

## Phase 2 — Folder Restructure (NO behavior changes)

**Tag:** `v1.3-structure`

**Goal:** Clean folder structure. No logic changes. No behavior changes.

**Target layout:**

```
apps/
  web/                    Next.js (UI + API routes as thin controllers)
    app/
    api/                  ← keep as edge/controller layer
  api/                    NEW — business logic moved here
    services/
    agents/
    orchestration/
  desktop/                README ONLY
    README.md             ← NO implementation, NO dependencies, NO Electron, NO Tauri

packages/
  core/                   EXISTING — scoring, normalization, governance, engine
  ai/                     NEW — providers, reasoning, agents, memory, prompts
  splunk/                 NEW — client, mcp, queries, aggregation
  shared/                 NEW — types, utils, constants
  ui/                     NEW — reusable React components
```

**Call chain (preserved):**

```
Web route → apps/api/service → packages/core
```

NOT `web → express → service`.

**Do NOT split Next.js API routes into Express/Fastify.** Next API routes remain as thin edge/controller layer. Business logic moves into `apps/api/services/`.

**Move only. No logic changes. `git mv` everywhere to preserve history.**

**Gate:** 197 contracts, 20 E2E, typecheck PASS

---

## Phase 3 — Data Orchestration Refactor

**Tag:** `v1.4-dashboard-query`

**Goal:** Replace 5+ independent fetches with single, cached, retryable query.

**Current:** `page.tsx` has 5+ `useEffect` blocks fetching cache-status, executive-summary, decisions, config, explainability independently.

**Target:**
- Single `dashboard-query-service.ts` with `getDashboardState()`
- Use **React Query / TanStack Query** — do NOT build custom caching
- Single response → cache, retry, skeleton, stale-while-revalidate
- Reduces stale state, flicker, and waterfall requests

**Gate:** 197 contracts, 20 E2E, typecheck PASS

---

## Phase 4 — Parallel + Incremental Pipeline

**Tag:** `v1.5-runtime-scale`

**Goal:** Wire existing P7 (incremental) and P8 (parallel) abstractions into runtime. No new logic.

**Tasks:**
- Parallel Splunk fetch via `Promise.allSettled()` (existing `parallel-fetch-service.ts`)
- Incremental aggregation via watermarks + delta recompute (existing `delta-aggregation` engine)
- Wire both into the main pipeline orchestration

**Gate:** 197 contracts, 20 E2E, typecheck PASS

---

## Phase 5 — Materialized KPI Cache (P9)

**Tag:** `v2.0-kpi-cache`

**Goal:** Dashboard reads from cache, not recomputation.

**Rationale:** Caching gives immediate runtime gains and safer rollout than changing Splunk query shape. Done first.

**Tasks:**
- Create `executive_kpis_cache` table with columns for all computed KPIs
- Cache invalidation triggers:
  - Pipeline complete → write new cache
  - Manual refresh → invalidate + refresh
  - TTL expiry → trigger background refresh
- Dashboard reads from cache (cache-first, fallback to live)
- Without proper invalidation, stale KPIs will happen — implement all three triggers

**Observability:**
- Cache hit/miss ratio
- Cache latency vs live compute latency

**Migration discipline:** Migration commit → runtime commit → UI commit

**Gate:** 197 contracts, 20 E2E, typecheck PASS

---

## Phase 6 — Splunk Aggregation Redesign

**Tag:** `v1.6-splunk-opt`

**Goal:** Single aggregated query replaces per-index loops.

**Do NOT replace MCP.** Keep abstraction. Update MCP client to support the new query shape.

**Tasks:**
- New structure: `packages/splunk/{client,mcp,queries,aggregation}/`
- Single query: `| tstats count, sum(bytes) by index, sourcetype`
- Aggregate once on the server side
- MCP abstraction survives for Splunk Cloud / Enterprise / Local future support

**Observability:**
- Query latency (p50/p95/p99)
- Rows returned vs expected
- Error rate

**Gate:** 197 contracts, 20 E2E, typecheck PASS

---

## Phase 7 — Local AI Layer

**Tag:** `v2.1-local-ai`

**Goal:** Wrap existing provider switching with orchestration. Do NOT rewrite the AI layer.

**Tasks:**
- Create `packages/ai/{providers,reasoning,agents,memory,prompts}/`
- **Ollama** (default): Gemma, Qwen, Llama models — zero config
- **Anthropic** (opt-in only): explicit API key + model selection required
- No silent cloud fallback — never
- Add orchestration layer on top of existing Ollama/Anthropic switching in the LLM settings
- Prompt management: versioned prompt templates in `packages/ai/prompts/`

**Observability:**
- Inference latency per provider
- Error rate per provider
- Token usage

**Gate:** 197 contracts, 20 E2E, typecheck PASS

---

## Phase 8 — Agentic Pipeline

**Tag:** `v2.2-agentic`

**Goal:** Wire canonical pipeline with agentic reasoning and memory.

**Pipeline:**

```
Splunk → Normalize → Features → Deterministic KPIs → LLM reasoning → Decision → Governance → UI
```

**LLM output structure:**

```json
{
  "classification": "CRITICAL",
  "risk_score": 87,
  "recommendation": "OPTIMIZE",
  "confidence": "HIGH",
  "reasoning": "Based on pattern X, Y, Z...",
  "evidence": ["alert_count > threshold", "mitre_coverage < 40%"]
}
```

**LLM NEVER computes KPI values.** Deterministic scoring from `packages/core/engine` is the single source of truth. LLM receives KPIs as context for explanation only.

**Agent Memory (feedback loop):**
- `decision_history` — all decisions made
- `operator_feedback` — human approval/rejection of recommendations
- `approval_outcomes` — was the decision followed?
- `false_positive_rate` — how often was the recommendation wrong?

Without feedback loops, agents do not improve.

**Observability:**
- Decision latency
- Operator approval rate
- False positive rate

**Gate:** 197 contracts, 20 E2E, typecheck PASS

---

## Phase 9 — Explainable UX

**Tag:** `v2.3-explainable`

**Goal:** Every card shows what AI did, why, and how to verify.

**Required per KPI/recommendation card:**
- Why this score/recommendation
- Formula used
- Source origin (which table, which query)
- Confidence score
- History (was this different before?)
- Reasoning chain
- "AI enhanced this data" badge

**Gate:** 197 contracts, 20 E2E, typecheck PASS

---

## Phase 10 — Browser Audit Agent

**Tag:** `v2.4-ui-audit`

**Goal:** Nightly visual regression detection.

**Tasks:**
- Nightly Playwright run against production/staging
- Persist: visual diff + DOM diff + API diff (not screenshots only)
- Non-blocking — warn on regression, do not block deployment
- Baseline stored, diff stored alongside

**Gate:** 197 contracts, 20 E2E, typecheck PASS

---

## Phase 11 — Async Execution (LAST)

**Tag:** `v3.0-async`

**Goal:** Async execution substrate for scale.

**Only after all sync phases pass reliably.**

**Tasks:**
- Queues (Bull/BullMQ or equivalent)
- Workers (separate process, not in-memory)
- Retry with exponential backoff
- Dead letter queue
- Async execution substrate

**Gate:** 197 contracts, 20 E2E, typecheck PASS

---

## Phase Summary

| Phase | Tag | Description |
|-------|-----|-------------|
| 0 | v1.1-inventory | Read-only inventory, dependency graph, dead code audit |
| 1 | v1.2-runtime-stable | Settings, empty-state, slow-network validation |
| 2 | v1.3-structure | Folder restructure, no behavior changes |
| 3 | v1.4-dashboard-query | Single dashboard query with React Query |
| 4 | v1.5-runtime-scale | Wire incremental + parallel pipeline |
| 5 | v2.0-kpi-cache | Materialized KPI cache with invalidation |
| 6 | v1.6-splunk-opt | Single aggregated Splunk query |
| 7 | v2.1-local-ai | Wrap AI providers with orchestration |
| 8 | v2.2-agentic | Agentic pipeline with memory |
| 9 | v2.3-explainable | Explainable UX on every card |
| 10 | v2.4-ui-audit | Nightly browser audit agent |
| 11 | v3.0-async | Async execution (last) |

---

## Frozen Baselines (Do Not Modify)

- `v0.9-trust-baseline` — Trust + Explainability frozen
- `v1.0-incremental-baseline` — Incremental aggregation frozen
- `v1.0-refactor-plan` — This refactor roadmap

---

## Tagging Convention

```bash
git tag -a <tag> -m "<description>"
```

Tags must be annotated (`-a`). Lightweight tags are not accepted.

---

## Rollback Procedure

If any phase causes regression:

```bash
git checkout <previous-phase-tag>
git checkout -b rollback-<phase>
```

Investigate. Fix in a new branch. Merge when gate passes. Do not retry the same approach without understanding the failure.

---

## Operational Note

Some earlier uploaded screenshots/PDFs referenced in prior dashboard discussions have expired and cannot be reopened. If exact historical UI comparisons are needed later, re-upload those assets before requesting comparisons.
