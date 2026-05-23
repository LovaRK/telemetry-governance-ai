# Runtime QA Manifest

## Phase 1 Runtime Certification — `v1.1-runtime-stable`

**Date:** 2026-05-23
**Branch:** `feature/data-purity-phase-2c-1`
**Baseline tags:** `v0.9-trust-baseline`, `v1.0-incremental-baseline`, `v1.0-refactor-plan`

---

## Step 1: Dashboard Runtime Proof

| # | Test | Status | Evidence |
|---|------|--------|----------|
| 1.1 | Login form accessibility (htmlFor/id) | ✅ PASS | `apps/web/app/login/page.tsx` — htmlFor fixes |
| 1.2 | Test locators (getByLabel→locator) | ✅ PASS | `tests/e2e/dashboard.spec.ts`, `release-certification.spec.ts` |
| 1.3 | localStorage key (token→access_token) | ✅ PASS | `tests/e2e/production-certification.test.ts` |
| 1.4 | Hydration regex fix | ✅ PASS | `tests/e2e/06-production-certification.spec.ts` |
| 1.5 | test-connection returns 503 (not 500) | ✅ PASS | `apps/web/app/api/test-connection/route.ts` |
| 1.6 | SSE disconnect filter (status 0) | ✅ PASS | `tests/e2e/06-production-certification.spec.ts` |
| 1.7 | Explainability 401 filter | ✅ PASS | `tests/e2e/*` |
| 1.8 | "demo" regex word boundaries | ✅ PASS | `/demo\b/` — avoids matching "demonstrates" |
| 1.9 | Executive Summary: networkidle→domcontentloaded | ✅ PASS | `tests/e2e/06-production-certification.spec.ts` |
| 1.10 | Form submission test: "Aetheris Sentinel"→"datasensAI" | ✅ PASS | `tests/e2e/02-api-integration.test.ts` |
| **All E2E** | 55/55 Pass | ✅ PASS | `npx playwright test --timeout=90000` |

**Fixes applied:** 10 (see commits for auth route fix, detail page apiFetch, etc.)

---

## Step 2: Tab Validation

| Route | Status | Screenshot |
|-------|--------|------------|
| `/` (dashboard) | ✅ PASS | `artifacts/runtime-qa/tabs/dashboard.png` |
| `/governance` | ✅ PASS | `artifacts/runtime-qa/tabs/governance.png` |
| `/settings` | ✅ PASS | `artifacts/runtime-qa/tabs/settings-llm.png` |
| `/settings/splunk` | ✅ PASS | `artifacts/runtime-qa/tabs/settings-splunk.png` |
| `/settings/account` | ✅ PASS | `artifacts/runtime-qa/tabs/settings-account.png` |
| `/detail` | ✅ PASS | `artifacts/runtime-qa/tabs/detail.png` |
| `/audit-trail` | ✅ PASS | `artifacts/runtime-qa/tabs/audit-trail.png` |
| `/trust-inspection` | ✅ PASS | `artifacts/runtime-qa/tabs/trust-inspection.png` |

**Total:** 8/8 tabs pass ✅

**Issues found & fixed:**
- `/api/auth?action=me` — GET handler missing (only POST existed) → added `GET` export
- `/api/auth?action=me` — cookie name mismatch (`auth_token`→`accessToken`) → fixed to use `accessToken` cookie  
- `/detail` — `/api/cache-status` used raw `fetch` instead of `apiFetch` → fixed to use `apiFetch`

---

## Step 3: Settings Validation (LLM Provider)

| # | Case | Status | Detail |
|---|------|--------|--------|
| 1 | Default provider is Ollama (local) | ✅ PASS | Provider select shows "local" |
| 2 | Anthropic opt-in and save | ✅ PASS | Provider changed to "anthropic", success indicator shown |
| 3 | Persist after reload | ✅ PASS | After reload, provider still "anthropic" |
| 4 | Reset to local persists | ✅ PASS | After save + reload, provider still "local" |
| 5 | Missing key rejected | ✅ PASS | "API key is required" validation shown |
| 6 | Invalid key rejected | ✅ PASS | API returns error, no success indicator |
| 7 | No silent cloud fallback | ✅ PASS | Zero Anthropic API calls detected with local provider |

**Total:** 7/7 cases pass ✅

---

## Step 4: Empty-State Validation

| # | Scenario | Status | Detail |
|---|----------|--------|--------|
| 1 | No Splunk config | ✅ PASS | No fake KPIs, no mock/fabricated text |
| 2 | Config exists, no refresh | ✅ PASS | Shows "Connect to Splunk to get started" — no fake data |
| 3 | Refresh done but no data | ✅ PASS | Shows "No Telemetry Data" + "Refresh from Splunk" button |

**Total:** 3/3 tests pass ✅

---

## Step 5: Slow-Network Validation

| # | Scenario | Status | Detail |
|---|----------|--------|--------|
| 1 | Slow 3G simulation | ✅ PASS | Page loads, no crash (latency: 400ms, throughput: 500Kbps) |
| 2 | Offline simulation | ✅ PASS | No application crash |
| 3 | API 500 errors | ✅ PASS | Graceful error state, page content still renders |
| 4 | Recovery after failure | ✅ PASS | Page recovers when network returns |

**Total:** 4/4 tests pass ✅

---

## Step 6: Certification Gate

| # | Gate | Result | Detail |
|---|------|--------|--------|
| 1 | TypeScript type check | ✅ PASS | `npx tsc --noEmit` → EXIT 0, no errors |
| 2 | Contract tests | ✅ PASS | 227/227 pass (34 suites, 14.7s) |
| 3 | E2E tests | ✅ PASS | 55/55 pass (8.7m) |
| 4 | Docker containers | ✅ PASS | postgres (23h healthy), web (7m healthy) |
| 5 | `/api/health` | ✅ PASS | HTTP 200, `{"status":"healthy"}` |
| 6 | `/api/settings/llm` | ✅ PASS | HTTP 200, provider correctly persisted |
| 7 | `/api/executive-summary` | ✅ PASS | HTTP 200, real KPI data returned |

**Total:** 7/7 gates pass ✅

---

## Summary

```
Phase 1 Runtime QA: ✅ ALL PASS
  ├─ Step 1: Dashboard runtime proof     ✅ 10 fixes, 55/55 E2E
  ├─ Step 2: Tab validation              ✅ 8/8 tabs (3 regressions fixed)
  ├─ Step 3: Settings validation         ✅ 7/7 LLM provider cases
  ├─ Step 4: Empty-state validation      ✅ 3/3 scenarios
  ├─ Step 5: Slow-network validation     ✅ 4/4 scenarios
  ├─ Step 6: MANIFEST.md                 ✅ Generated
  └─ Step 7: Certification gate         ✅ 7/7 checks pass
```

**Regressions found and patched during Phase 1:**
1. `apps/web/app/api/auth/route.ts` — Added GET handler for `action=me`, fixed cookie name
2. `apps/web/app/detail/page.tsx` — Changed `fetch` to `apiFetch` for `/api/cache-status`
3. `tests/schema/schema-contract-validator.test.ts` — Updated mock to match `applied_migrations` query
4. `tests/e2e/02-api-integration.test.ts` — Updated text from "Aetheris Sentinel" to "datasensAI"

**Evidence directory:** `artifacts/runtime-qa/`

Ready for Step 7 freeze: `git tag v1.1-runtime-stable`
