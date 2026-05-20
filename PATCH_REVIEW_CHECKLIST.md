# Data Purity Phase 2C.1 — Patch Review Checklist

**File:** `data-purity-phase-2c.patch`  
**Status:** Ready for review  
**Total Changes:** 8 files (3 new, 5 modified)

---

## 📋 Review Instructions

Use these lenses to verify the patch enforces the system invariant. Each item must pass.

---

## ✅ Checklist: Trust System Verification

### 1. New Guard Files Created ✓
**Validates:** Core enforcement foundation

- [ ] `packages/core/guards/data-purity.guard.ts` exists
  - [ ] Exports `DataPurityMeta` interface (source, mode, traceId)
  - [ ] Exports `assertDataPurity()` function
  - [ ] Throws on missing `source`
  - [ ] Throws on missing `traceId`
  - [ ] Throws if `mode !== 'live'`
  - [ ] Throws on invalid source (not splunk|postgres|system)

- [ ] `packages/core/guards/fail-loud.ts` exists
  - [ ] Exports `failLoudly()` function
  - [ ] Logs `SYSTEM_INVARIANT_VIOLATION` to observability
  - [ ] Throws error (never returns)
  - [ ] Includes timestamp in error

- [ ] `apps/api/middleware/data-purity.middleware.ts` exists
  - [ ] Exports `ApiResponse<T>` interface
  - [ ] Exports `enforceMeta()` function
  - [ ] Throws on missing `response.meta`
  - [ ] Calls `assertDataPurity()` on response.meta

---

### 2. Migration 122 Applied ✓
**Validates:** Database constraints enforce invariant

- [ ] Migration file exists: `prisma/migrations/122_data_purity/migration.sql`

**For `execution_actions` table:**
- [ ] `ADD COLUMN source VARCHAR(32)`
- [ ] `ADD COLUMN mode VARCHAR(16) DEFAULT 'live'`
- [ ] `ADD COLUMN trace_id UUID`
- [ ] `ADD CONSTRAINT chk_execution_actions_mode CHECK (mode = 'live')`

**For `execution_results` table:**
- [ ] `ADD COLUMN source VARCHAR(32)`
- [ ] `ADD COLUMN mode VARCHAR(16) DEFAULT 'live'`
- [ ] `ADD COLUMN trace_id UUID`
- [ ] `ADD CONSTRAINT chk_execution_results_mode CHECK (mode = 'live')`

**New `system_config` table:**
- [ ] Created (replaces in-memory config)
- [ ] Has columns: key, value, source, created_at, updated_at
- [ ] `source` has CHECK constraint: `('user_override', 'system_default', 'splunk_tag')`
- [ ] Index on `updated_at DESC`

---

### 3. DEMO_MODE Killed ✓
**Validates:** No silent fallback to synthetic data

- [ ] `apps/api/bootstrap.ts` modified
- [ ] Contains check: `if (process.env.DEMO_MODE === 'true')`
- [ ] Throws error with message containing "DEMO_MODE is forbidden"
- [ ] Check happens FIRST (before other bootstrap logic)

---

### 4. Executor Guards Injected ✓
**Validates:** Adapter response validated before persistence

- [ ] `packages/core/workflow/executor-v2.ts` modified
- [ ] Imports `assertDataPurity` and `failLoudly`
- [ ] After adapter call: `assertDataPurity(result)` — validates response
- [ ] Insert statement includes columns: `source, mode, trace_id`
- [ ] Error handler calls `failLoudly()` (never silently continues)

---

### 5. Replay Fallback Removed ✓
**Validates:** No reconstruction from stale data

- [ ] `apps/web/app/api/governance/replay/route.ts` modified
- [ ] ❌ Fallback code REMOVED (no more agent_decisions query)
- [ ] If journal is empty: returns 503 with error message
- [ ] Error message explains: "governance_replay_journal not populated"
- [ ] Response includes `meta: { source: 'postgres', mode: 'live', traceId }`

---

### 6. Config Migrated to Database ✓
**Validates:** No in-memory configuration

- [ ] `apps/web/app/api/config/route.ts` modified
- [ ] ❌ Removed: `let config: UserConfig = { ...DEFAULT_CONFIG }`
- [ ] ❌ Removed: DEFAULT_CONFIG object
- [ ] GET endpoint loads from `system_config` table
- [ ] POST endpoint validates `source` field (required)
- [ ] Both GET and POST return `meta: { source, mode, traceId }`
- [ ] Missing config throws error (doesn't default)

---

### 7. CI Enforcement Added ✓
**Validates:** No mock/demo/fake data committed

- [ ] Script file exists: `scripts/no-mock-check.sh`
- [ ] Script is executable (mode 755)
- [ ] Script greps for: `mock|demo|fake|fallback|sample`
- [ ] Script excludes tests: filters out `tests/`, `__tests__/`, `.test.`, `.spec.`
- [ ] Exits with code 1 on violation
- [ ] Exits with code 0 if clean

- [ ] `.github/workflows/test.yml` modified
- [ ] New step: "🔒 Data Purity Check"
- [ ] Step runs: `bash scripts/no-mock-check.sh`
- [ ] `continue-on-error: false` (blocks build on violation)

---

## 🚨 Red Flags (Fail Review If Any Present)

Check the patch does NOT contain:

- [ ] ❌ Any fallback patterns (`||`, `??` with defaults)
- [ ] ❌ Any try/catch that continues silently
- [ ] ❌ Any mock/demo/fake data in runtime code
- [ ] ❌ Any DEFAULT_CONFIG or hardcoded values
- [ ] ❌ Any DemoMode detection that allows continued execution
- [ ] ❌ Any APIs missing `meta` field
- [ ] ❌ Any adapters returning response without `source`
- [ ] ❌ Any database writes without `trace_id`

---

## 📊 Expected Breakage After Applying

This is **correct behavior**. System is exposing reality instead of masking it.

After patch is applied, you SHOULD see:

✅ **APIs failing:** Missing `meta` in responses
✅ **Config errors:** Trying to access non-existent system_config values
✅ **Adapter mismatches:** Responses missing source/mode/traceId
✅ **Tests breaking:** Because they used mocks (move to `/tests` only)
✅ **Bootstrap failures:** If DEMO_MODE environment variable set

---

## 🔧 Fix Order (After Applying Patch)

1. **Database:** Run migration 122
2. **Config:** Populate system_config with existing defaults
3. **Adapters:** Add source/mode/traceId to all adapter responses
4. **APIs:** Add meta field to all response objects
5. **Tests:** Move mocks strictly into test directories only
6. **Bootstrap:** Remove DEMO_MODE from environment

---

## ✅ Sign-Off

**Patch is safe if:**
- All checklist items pass
- No red flags detected
- You understand the expected breakages
- You have a plan for fixes in order

**Ready to apply with:**
```bash
git apply data-purity-phase-2c.patch
```

---

## 📝 Notes

- Patch is git-compatible (can be reverted with `git apply -R`)
- All changes are surgical (no refactors, only invariant enforcement)
- Zero file deletions (only additions and modifications)
- Comments explain every guard injection point
