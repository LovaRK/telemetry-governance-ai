# datasensAI Agent — Production Handover

**Audience:** Tejas (installs on his own laptop, points at his own Splunk).
**Companion docs:** [`INSTALL_TEJA.md`](INSTALL_TEJA.md) (install steps),
`datasensAI_calculation_guide.pdf` (the formula spec this agent implements).

This document states exactly **what is verified-correct**, **what was fixed**,
and **what still depends on your Splunk environment** — so you can install,
run, and trust the numbers.

---

## 1. What this agent does

It answers one question — *"Are you getting value from the data you pay to
ingest into Splunk?"* — by scoring every sourcetype on three dimensions
(Utilization, Detection, Quality), combining them into a Composite score,
assigning a Tier (Critical / Important / Nice-to-Have / Low-Value), and
surfacing dollar-impact recommendations.

**Architecture is deterministic-first:**

```
Splunk (MCP/REST) → deterministic scoring engine → scores+tiers are AUTHORITATIVE
                                                  ↓
                          local LLM (Ollama gemma2:9b) → narrative only
                          (recommendation / reasoning / action / savings)
                                                  ↓
                          worker OVERWRITES any LLM-emitted score with the
                          deterministic value before persisting → no LLM drift
```

The LLM never decides scores or tiers. It only writes the human-readable
narrative. This is enforced in `docker/worker.ts` (the precomputed-score
override block) and is the reason the numbers are reproducible.

---

## 2. Verified: the engine matches the calculation guide exactly

Every formula in `datasensAI_calculation_guide.pdf` is faithfully implemented.
Audited file-by-file this session:

| Guide formula | Implementation | Status |
|---|---|---|
| Utilization = `(alerts×3 + scheduled×3 + dashboards×2 + adhoc×1 + users×2)` normalized 0–100 vs leader | `packages/core/engine/scoring/utilization.ts` | ✅ exact |
| Detection = `0.40×potential + 0.60×realized`; `potential = max(mitre×1.25, lantern×6.0)`; hard rule 0 if no mappings | `packages/core/engine/scoring/detection.ts` | ✅ exact |
| Quality = `max(0, 100 − issue_density×2000)`; `issue_density = weighted_issues / (daily_gb×1M)` | `packages/core/engine/scoring/quality.ts` | ✅ exact |
| Composite = `util×Wu + det×Wd + qual×Wq`, weights sum to 1.0 | `packages/core/engine/scoring/composite.ts` | ✅ exact |
| Tier thresholds 65 / 40 / 20 | `packages/core/engine/tier.ts` | ✅ exact |
| ROI Score = `avg(composite)` | `packages/core/engine/kpi/index.ts` + `docker/worker.ts` | ✅ exact |
| GainScope = `(Tier1+2 GB / Total GB) × 100` | `kpi/index.ts` | ✅ exact |
| Low-Value Spend = annual cost of Tier 3+4 | `kpi/index.ts` | ✅ exact |
| Annual cost = `daily_gb × cost_per_gb_year` (default 3650) | `aggregation-service.ts` | ✅ exact |
| Detection gap (`technique≥15 AND coverage<25`), Operational gap (`lantern≥4 AND alerts=0`) | `detection.ts` | ✅ exact |
| Default weights 0.35 / 0.40 / 0.25 + 4 profiles | `composite.ts` | ✅ exact |

**Worked examples cross-check (guide §11):** the engine reproduces Example A
(Critical, composite 97), B (Nice-to-Have, 32.2), and C (Wasteful) given the
same inputs. One intentional refinement beyond the guide: a *minimum-activity
gate* (`composite.ts`) caps clean-but-inert data (util<2 AND detection=0) at
19.9 so it correctly lands in Tier 4 — the guide §12-E quirk is handled, not a
bug.

---

## 3. Fixed this session

| Fix | File | Effect |
|---|---|---|
| Quick Wins panel was blank when the LLM flagged no quick-wins | `components/dashboard/ExecutiveOverview.tsx`, `app/api/executive-summary/route.ts` | Now falls back to the top-5 actions by dollar impact (guide §8 "top recommended actions") — never empty when savings exist |
| Executive-summary API omitted `*Classification` + `tier*SpendAnnual` fields | `app/api/executive-summary/route.ts` | Refactored gauge component + `ExecutiveKPIs` type now receive REAL/EMPTY classifications (the old live component gates on `hasAgentDecisions` and was unaffected, but the type contract is now honoured) |
| Tier fallback for sub-threshold indexes returned an action string instead of a tier name | `app/api/executive-summary/route.ts` | `deprecated_siem` / `old_itsm` now show a real tier ("Nice-to-Have") |
| **MITRE/Lantern counts were hardcoded in code, not read from Splunk** | `apps/api/services/splunk-queries-service.ts`, `aggregation-service.ts` | New `queryDetectionMappings()` reads `sourcetype_attack_mapping.csv` / `sourcetype_lantern_mapping.csv` via `inputlookup` **lookup-first, baseline-fallback** — detection now scores from your Splunk when the TA is installed; behaviour is identical to before when the lookups are absent (zero regression) |
| Mock Splunk now serves the two TA lookups | `tools/sandbox/splunk-mock-server.ts` | The dev/demo environment exercises the real lookup path |
| **Detail tables silently empty** — worker INSERTed non-existent columns, errors swallowed by `.catch(()=>{})` | `docker/worker.ts` (`populateSecondaryTables`) | Fixed schema mismatch (`security_coverage`, `quality_hotspots`), added idempotent deletes + error logging. Security Detection Gaps now returns 12 rows (verified via API), sourced from lookup-driven detection |

All changes compile cleanly (`tsc` root + worker configs; only pre-existing
test-file type errors remain).

---

## 4. ⚠️ What depends on YOUR Splunk environment (read before you demo)

The pipeline pulls from the customer's Splunk. Three data sources determine how
"full" the dashboard looks. **The executive dashboard works today; the items
below mainly enrich Detection and the Detail dashboard.**

### 4a. Detection scoring needs the two mapping lookups
Detection is driven by MITRE ATT&CK technique counts and Splunk Lantern use-case
counts per sourcetype. Per guide §2 these ship as lookups with the
**TA-bitsIO-datasensAI** add-on:
- `sourcetype_attack_mapping.csv`
- `sourcetype_lantern_mapping.csv`

The agent now reads them (`queryDetectionMappings`). **Action:** install the TA
in your Splunk (or place those two lookups in any app's `lookups/` dir). Without
them, detection falls back to a built-in baseline keyed by common sourcetype
names — fine for a smoke test, but real scores need your lookups. The env-prep
scripts do **not** create these (they're TA-shipped); confirm the column names
in your TA match `sourcetype` + a count column (`technique_count` /
`lantern_usecase_count`) — the reader is schema-tolerant but verify once.

### 4b. Detail-dashboard secondary tables — status & lookup checklist

The Detail panels read three DB tables (`security_coverage`, `quality_hotspots`,
`field_usage`) populated by the **worker** (`populateSecondaryTables` in
`docker/worker.ts`) from the agent decisions. (Note: the `query*` functions in
`splunk-queries-service.ts` live in `runAggregation`, which is **dead code** in
the current async flow — ignore them; the worker path is what runs.)

**Fixed this session:** `security_coverage` and `quality_hotspots` were silently
empty because the worker INSERTed into non-existent columns (`mitre_techniques`;
`impact`/`issue_type`/`daily_gb`) and `.catch(() => {})` swallowed the failures.
Corrected to the real schema, added idempotent per-snapshot deletes, and made
insert failures log instead of vanish. **Verified:** Security Detection Gaps now
returns 12 rows via `/api/security-coverage`, sourced from the lookup-driven
detection scores. *(Requires a worker container rebuild to go live — see §7.)*

**Lookup consumption checklist** (concrete state for completing "fully
lookup-driven"):

```
Implemented / consumed:
  ✓ sourcetype_attack_mapping.csv   → Detection (MITRE), Security Coverage panel
  ✓ sourcetype_lantern_mapping.csv  → Detection (Lantern)
  ✓ _internal parsing errors        → Quality score + Quality Hotspots (data-driven)

Still NOT lookup-driven (estimation fallback):
  ☐ sourcetype_fields_summary.csv        → Field Usage (currently fields_indexed=1,
                                            optimization = 100 − utilization; wire this
                                            lookup for real indexed-vs-used field counts)
  ☐ required_fields_for_each_datamodel.csv → Field gap context (not yet read)
  ☐ data_quality_issues_lookup.csv        → Quality Hotspots currently derive from the
                                            _internal parse-error path, not this TA lookup;
                                            wire it if you want the TA's curated issue list
```

**Priority:** P2 for the Executive dashboard (unaffected), **P1 for full
platform completion** — `field_usage` is the last panel still on estimation
rather than a TA lookup. Panels degrade gracefully to "No data" when a table is
empty (verified — no crashes).

### 4c. Splunk license
A Splunk *Free* or expired-trial license indexes data but blocks search-time
commands, so scores come back zero. Use **Enterprise** (also in
`INSTALL_TEJA.md`).

---

## 5. Install & run (summary — full steps in INSTALL_TEJA.md)

1. `git clone … && cp .env.example .env`; set `ADMIN_*`,
   `SPLUNK_SECRET_ENCRYPTION_KEY`, `GOVERNANCE_BOOTSTRAP_KEY`
   (`openssl rand -hex 32` each).
2. Local LLM: `ollama pull gemma2:9b` (default; nothing leaves your machine).
   Anthropic is opt-in only via Settings → AI Provider — **no silent fallback**.
3. `docker compose --env-file .env -f docker/docker-compose.yml up -d`
   (Mac/Windows via Docker Desktop; Linux via engine+compose).
4. Open `http://localhost:3002`, log in, **Settings → Splunk Connection**, Test
   until green, Save.
5. Click **Refresh** → Splunk pull → deterministic scoring → local-LLM narrative
   → publish. KPIs populate in ~1–3 min; full LLM narrative completes in the
   background (a full run is ~10–17 min on a laptop with gemma2:9b).

**Demo environment (optional):** `scripts/env-prep/run-all.mjs` reverse-engineers
the 1stMile lookup CSVs into a Splunk instance (indexes, events, knowledge
objects, usage). Add the two mapping lookups from §4a for full detection.

---

## 6. Verify a run from the command line

```bash
# login
TOKEN=$(curl -s -X POST localhost:3002/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"<admin>","password":"<pw>"}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

# KPIs (note: also send x-tenant-id / x-user-id / x-user-role from the JWT)
curl -s localhost:3002/api/executive-summary \
  -H "Authorization: Bearer $TOKEN" -H "x-tenant-id: <tid>" \
  -H "x-user-id: <uid>" -H "x-user-role: admin" | jq '.data.kpis'

# pipeline health — expect pipelineStatus/llmStatus READY, failureCode null
curl -s localhost:3002/api/cache-status -H "Authorization: Bearer $TOKEN" \
  -H "x-tenant-id: <tid>" -H "x-user-id: <uid>" -H "x-user-role: admin" | jq '.data.pipelineStatus'
```

**Reference numbers from the bundled synthetic environment** (20 sourcetypes,
detection pulled from the mock TA lookups): ROI 71.0 · GainScope 73.7 · Annual
Spend $592 · Savings Potential $86.40 · Low-Value Spend $156 · Avg Detection
56.7 · Security Gaps 12 · tiers Critical 12 / Important 0 / Nice-to-Have 6 /
Low-Value 0 · Savings Staircase: 5 stages (Current→After Ingest→After Retention
→After S3→Optimized Target). Your own Splunk
will differ — these confirm the pipeline math, not a target.

> **Note on the synthetic tier split.** The mock environment gives every active
> index identical knowledge-object counts, so Utilization normalizes to a flat
> 100 and the tier distribution is bimodal (well-detected security data →
> Critical; under-utilized archive candidates → Nice-to-Have), with nothing in
> the Important band. This is a *mock-data* characteristic, not an engine issue —
> a real Splunk environment has naturally varied saved-search/dashboard/alert
> counts that spread Utilization (and therefore the tiers) across all four bands.
> Run `scripts/env-prep` against a real Splunk for a representative spread.

---

## 7. v3/v4 Parity — Final Verification Results (2026-06-20)

### Pipeline run results (post worker rebuild)
| KPI | Value | Status |
|---|---|---|
| ROI Score | 71.01 | VERIFIED |
| GainScope | 73.65 | VERIFIED |
| Storage Savings Potential | $86.40 | VERIFIED (was $0k — fixed) |
| Annual License Spend | $592.44 | VERIFIED |
| Low-Value Spend | $156.12 | VERIFIED |
| Quick Wins | 5 entries | VERIFIED |
| Decisions | 18 | VERIFIED |
| Snapshots | 20 | VERIFIED |
| Pipeline Status | READY | VERIFIED |

### 5-Stage Savings Staircase (guide §8)
| Stage | Spend | Savings | Cumulative |
|---|---|---|---|
| Current | $592.44 | — | — |
| After Ingest Optimization | $545.64 | $46.80 | $46.80 |
| After Retention | $506.04 | $39.60 | $86.40 |
| After S3 Tiering | $506.04 | $0.00 | $86.40 |
| Optimized Target | $506.04 | $0.00 | $86.40 |

### Implementation phases completed
| Phase | Description | Status |
|---|---|---|
| P1 | Dollar formatter ($0k bug fix) | DONE — `formatUsd()` shared utility, 19 tests pass |
| P2 | Wire `computeDeterministicSavings` as savings source of truth | DONE — replaces action-proxy in worker |
| P3 | Storage $/GB·Month filter (UI→API→worker→config) | DONE — FilterBar field, recompute API wired |
| P4 | 5-stage savings staircase | DONE — persisted + rendered |
| P5 | Detail dashboard v4 parity (Resolution Confidence + Field Usage) | DONE — gauges + panels in /detail |
| P6 | Governance + Setup flows functional | DONE — verified end-to-end |
| P7 | High Storage Cost Assessment page | DONE — /storage-cost route + page |
| P8 | End-to-end verification | DONE |

### Contract tests
- `format-usd.contract.test.ts`: 7/7 pass
- `storage-savings.contract.test.ts`: 12/12 pass
- Live recompute verified: storage rate $150/GB/month → savings scale to $864 (correct 10x)

### Evidence-based parity matrix
| Item | Evidence | Status |
|---|---|---|
| Scoring engine (U/D/Q/Composite/Tier) | guide §2–§7 | VERIFIED |
| Storage savings formula | guide §8 | VERIFIED |
| ROI/GainScope/LowValue gauges | v3 screencapture | VERIFIED |
| Savings Potential gauge | v3 + guide §8 | VERIFIED (was $0k) |
| Savings Staircase (5 stages) | v3 + guide §8 | VERIFIED |
| KPI trend tiles (dollar formatter) | v3 | VERIFIED |
| Storage $/GB·Month filter | v3 filter bar | VERIFIED |
| Resolution Confidence gauge | v4 screencapture | VERIFIED |
| Field Usage panel | v4 | RECONSTRUCTED (estimation; needs TA lookup) |
| High Storage Cost Assessment | guide nav title | RECONSTRUCTED (no screencapture) |
| MITRE/Lantern distribution | v4 (cut off) | VERIFIED (lookup-first) |
| Governance flows | no reference | VERIFIED (functional) |

### Remaining BLOCKED items
- **Field Usage lookup** (`sourcetype_fields_summary.csv`) — panel shows estimation until TA lookup is installed
- **v4 lower section pixel-perfect parity** — screencapture was cut off; verified functional but no pixel ref
- **High Storage Cost Assessment** — built from guide, no screencapture for pixel-match

---

## 8. Known limitations

- Detail-dashboard `field-usage` / `security-coverage` / `quality-hotspots`
  queries are stubs (§4b) — Detail drilldowns for those are empty until wired.
- Detection uses a baseline unless the TA mapping lookups are present (§4a).
- KPI trend charts need history — a single first run shows one data point;
  trends fill in over successive refreshes.
- Pre-existing module-not-found warning in the `splunk/diagnostics` route
  (`'../database/db-client'`) — does not affect the executive/detail dashboards.
- Worker containers bake source at build time (no volume mount) — after editing
  `docker/worker.ts` or scoring code consumed by the worker, rebuild the worker
  container. The **web** container hot-reloads `apps/api`, so the fast
  aggregation path picks up changes without a rebuild.
