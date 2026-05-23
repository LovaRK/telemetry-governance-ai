# Phase 1 Stabilization + Trust — Execution Checklist

Baseline: `v1.1-runtime-stable` (commit `058252b`)  
Branch: `feature/data-purity-phase-2c-1`  
Discipline: each commit is backend-only, frontend-only, or runtime-only — never mixed.

---

## Commit A — Backend: LLM Settings Persistence + Validation

**Scope:** Secure API key storage, validation endpoint, no silent cloud fallback

**Files:**
```
apps/web/app/api/settings/llm/route.ts           (new — create if missing)
packages/core/settings/provider-store.ts           (new — encrypted key storage)
packages/core/settings/provider-store.test.ts      (new — unit tests)
```

**What it must do:**
- Store Anthropic API key encrypted (AES-256-GCM) in `llm_settings` table
- GET /api/settings/llm — returns provider, model, masks key (`sk-ant-...XXXX`)
- POST /api/settings/llm — accepts provider + key, validates key via Anthropic `/v1/models` test call
- If test call fails → return 400 `{error: "Invalid API key"}`, do NOT persist
- If provider=`local` → wipe stored key, never fall back to cloud
- All routes behind `requireContext()` auth

**Tests required:**
```
npm run test:contract                  # settings-related contract tests pass
npx jest tests/contract/settings*      # explicit settings contract coverage
```

**Migration required (if DB schema changes):**
```
infrastructure/migrations/131_llm_settings.sql
```

**Rollback:** `git revert <sha>` — safe, no data loss

**Stop condition:** `CONTRACT TESTS PASS` — do not proceed to Commit B without green contracts

---

## Commit B — Frontend: Settings UI for Anthropic Key Flow

**Scope:** UI only — depends on Commit A API contract

**Files:**
```
apps/web/app/settings/page.tsx                     (governance tab — LLM section)
apps/web/components/settings/AnthropicKeyInput.tsx  (new — key entry + test button)
tests/e2e/settings-llm-flow.spec.ts                (new E2E)
```

**What it must do:**
- Provider dropdown: `Local (Ollama)` selected by default
- Selecting `Cloud (Anthropic)` reveals:
  - API key input (type=password, placeholder `sk-ant-...`)
  - Model selector text input (default `claude-3-5-sonnet-20241022`)
  - "Test Connection" button → calls POST /api/settings/llm with validate flag
  - On success: green check + persist
  - On failure: red error message, do NOT persist
- Selecting Local again: confirms "Switch to local? Stored key will be removed." → clears key
- No save activated when key is empty or invalid
- Reload persists selection

**E2E test cases (in settings-llm-flow.spec.ts):**
1. Default: provider = Local, no key field visible
2. Select Anthropic → key field appears
3. Enter valid key → Test Connection succeeds → green check
4. Enter invalid key → Test Connection fails → red error, not persisted
5. Switch to Local → confirmation dialog → key wiped
6. Reload → persists last saved provider
7. Network tab: zero calls to `api.anthropic.com` while provider=Local

**Rollback:** `git revert <sha>` — safe

**Stop condition:** `E2E + CONTRACT TESTS PASS` — run both suites

---

## Commit C — Backend: Formula Explainability Data

**Scope:** Every KPI response carries formula, inputs, source, timestamp, confidence

**Files:**
```
packages/core/engine/formula-registry.ts            (new — centralized formula defs)
packages/core/engine/formula-registry.test.ts       (new)
apps/web/app/api/executive-summary/route.ts         (extend response with explainability)
apps/web/app/api/kpi-history/route.ts               (extend response)
packages/core/engine/types.ts                       (add ExplainabilityPayload type)
tests/contract/explainability.contract.test.ts       (already exists — update assertions)
```

**Formula registry shape:**
```typescript
interface FormulaDefinition {
  id: string;
  name: string;
  expression: string;            // e.g., "utilizationScore = (alerts * alertWeight + searches * searchWeight) / maxWeight"
  inputs: string[];              // ["alertCount", "searchCount", "activeUsers"]
  source: string;                // e.g., "splunk_index_metrics.daily_alerts"
  confidence: number;            // 0–1, based on data completeness
  lastComputed: string;          // ISO timestamp
}
```

**Each KPI API response must include:**
```json
{
  "value": 0.78,
  "formula": {
    "expression": "...",
    "inputs": { "alertCount": 142, "searchCount": 89, "activeUsers": 34 },
    "source": "splunk_index_metrics.daily_alerts",
    "confidence": 0.92,
    "lastComputed": "2026-05-23T05:00:00Z"
  }
}
```

**Tests:**
- Contract tests verify every KPI in executive-summary has formula metadata
- All formulas referenced by ID exist in formula-registry

**Rollback:** `git revert <sha>` — safe

**Stop condition:** `CONTRACT TESTS PASS` — verify payload shape with explicit assertions

---

## Commit D — Frontend: Explainability UI Disclosure

**Scope:** Every KPI/chart renders formula, inputs, source, timestamp, confidence

**Files:**
```
apps/web/components/dashboard/KPIFormulaTooltip.tsx   (new — hover/click explainer)
apps/web/components/dashboard/ExecutiveKPIDisplay.tsx  (extend — add ? icon → tooltip)
apps/web/components/dashboard/SourcetypeRiskHeatmap.tsx (extend)
apps/web/components/dashboard/SourceIntelligenceGrid.tsx (extend)
apps/web/components/dashboard/DecisionExplainabilityPanel.tsx (verify consistency)
tests/e2e/07-explainability-ui.spec.ts                 (new E2E)
```

**What it must do:**
- Every KPI card shows `ⓘ` icon → tooltip with formula, inputs, source, confidence, timestamp
- Sourcetype scores show same tooltip on click
- Decision explainability panel references formula IDs from registry
- No formula exposed = confidence `null` with "Formula source unavailable" message
- Tooltip is non-blocking (hover, not modal)

**E2E test cases:**
1. Executive KPI cards show explainability icon
2. Clicking icon shows formula expression
3. Sourcetype score tooltip shows formula inputs
4. Missing formula shows graceful fallback text
5. No crash on partial data

**Rollback:** `git revert <sha>` — safe

**Stop condition:** `E2E + CONTRACT TESTS PASS`

---

## Commit E — Frontend: UI Truthfulness Sweep

**Scope:** Remove ambiguous messaging, align state displays, no mock/hardcoded data

**Files:**
```
apps/web/app/page.tsx                                    (connection screen + dashboard states)
apps/web/components/state/EmptyState.tsx                  (verify messaging)
apps/web/components/dashboard/ExecutiveOverview.tsx       (stale/fresh indicators)
apps/web/components/dashboard/AgentIntelligencePanel.tsx  (pending/complete alignment)
apps/web/components/dashboard/GovernanceWorkflowPanel.tsx (state labels)
apps/web/components/shared/ConnectionGatedUI.tsx          (disconnected messaging)
tests/e2e/08-truthfulness-consistency.spec.ts             (new E2E)
```

**Requirements:**
- Every panel uses same state labels: `idle` | `loading` | `pending` | `running` | `complete` | `failed` | `unavailable`
- Remove any variation: `in_progress`, `in-progress`, `Processing...`, `loading data`
- No mock/hardcoded/fabricated outputs in any state
- `hasEverRefreshed=false` → "Connect to Splunk to get started" (already correct, verify)
- `hasEverRefreshed=true, hasData=false` → "No Telemetry Data" (already correct, verify)
- API error → show error message from `{error}` field, not generic "Something went wrong"
- SSE disconnect → no false "failed" label on governance panels

**E2E test cases:**
1. Every state panel shows correct label per status
2. No page contains "mock" or "fabricated" or "demo" (with word boundaries) outside test files
3. Network error → error text from API, not generic fallback
4. All state transitions render without crash

**Rollback:** `git revert <sha>` — safe (UI only)

**Stop condition:** `E2E TESTS PASS` — run full suite

---

## Commit F — Runtime: Pipeline Metadata Standardization

**Scope:** Standard stage metadata contract + correlation IDs across all pipeline stages

**Files:**
```
packages/core/pipeline/stage-metadata.ts              (new — MetadataContract type + helpers)
packages/core/pipeline/pipeline-run.ts                (extend — inject correlation into stages)
packages/core/pipeline/worker.ts                      (extend — write metadata)
packages/core/pipeline/stage-events.ts                (extend — correlation passthrough)
tests/contract/pipeline-metadata.contract.test.ts     (new — contract for stage metadata shape)
```

**Metadata contract:**
```typescript
interface StageMetadata {
  stage: string;                    // "splunk_fetch" | "normalize" | "kpi" | "ai" | "governance"
  runId: string;
  correlationId: string;            // same across all stages of one run
  status: 'pending' | 'running' | 'complete' | 'failed';
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  inputSnapshotIds: string[];
  outputSnapshotIds: string[];
  errors: Array<{ code: string; message: string; context?: unknown }>;
  metadata: Record<string, unknown>;  // stage-specific
}
```

**Contract tests verify:**
- Every stage in a completed run has all required fields
- correlationId is identical across all stages of same runId
- durationMs = completedAt - startedAt (within tolerance)
- No orphan stages (every stage references a valid runId)

**Rollback:** `git revert <sha>` — safe

**Stop condition:** `CONTRACT TESTS PASS`

---

## Commit G — Certification Freeze: `v1.2-trust-stable`

**Scope:** No code changes. Full certification gate + tag.

**Commands:**
```bash
npx tsc --noEmit
npm run test:contract
npm run test:e2e
# Manual: verify Docker healthy, curl /api/health, /api/settings/llm, /api/executive-summary
```

**If all pass:**
```bash
git commit -m "chore(trust): stabilization certification baseline"
git tag v1.2-trust-stable
```

**Rollback:** `git tag -d v1.2-trust-stable`

**Stop condition:** `ALL GATES GREEN` — otherwise revert last failing commit, fix, retry

---

## Dependencies Between Commits

```
A (backend: settings) ──→ B (frontend: settings UI)
C (backend: formulas) ──→ D (frontend: explainability UI)
A ──→ D? No — independent
E (UI truthfulness) ─── independent (can be done any time after C+D if overlapping)
F (pipeline metadata) ── independent (runtime only)
G (freeze) ───────────── depends on A+B+C+D+E+F
```

**Parallelization possible:**
- A + C + E + F can be done in parallel (different subsystems)
- B depends on A
- D depends on C
- G depends on all

---

## Rollback Protocol

| Scenario | Action |
|----------|--------|
| Commit A contract fails | `git revert A` fix issue, re-commit |
| Commit B E2E fails | `git revert B`, fix, re-commit |
| Commit C contract fails | `git revert C`, fix, re-commit |
| Commit D E2E fails | `git revert D`, fix, re-commit |
| Commit E E2E fails | `git revert E`, fix, re-commit |
| Commit F contract fails | `git revert F`, fix, re-commit |
| Commit G freeze fails | revert failing commit (A-F), fix, re-run freeze |

All reverts are safe — each commit is self-contained with no shared mutable state across backend/frontend/runtime boundaries.

---

## Estimated Effort

| Commit | Type | Est. files | Est. time |
|--------|------|-----------|-----------|
| A | Backend | 3 new + 1 migration | 45–90 min |
| B | Frontend + E2E | 1 new + 1 modified + 1 test | 60–90 min |
| C | Backend | 3 new + 3 modified + 1 test | 60–120 min |
| D | Frontend + E2E | 1 new + 4 modified + 1 test | 60–90 min |
| E | Frontend + E2E | 5 modified + 1 test | 45–90 min |
| F | Runtime | 3 new + 2 modified + 1 test | 60–90 min |
| G | Freeze | 0 | 15–30 min |
| **Total** | | ~30 files | **5–9 hours** |

---

## Entry Criteria

Before Commit A:
- [ ] Branch: `feature/data-purity-phase-2c-1`
- [ ] Baseline: `v1.1-runtime-stable`
- [ ] Contracts: 227/227 PASS
- [ ] E2E: 55/55 PASS
- [ ] Typecheck: clean
- [ ] Docker: both containers healthy
