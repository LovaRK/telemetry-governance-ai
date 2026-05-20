# Data Purity Phase 2C.1 Final — Patch Review Checklist

**File:** `data-purity-phase-2c-final.patch`  
**Status:** Ready for production review  
**Total Changes:** 12 files (4 new, 8 modified)  
**Added Components:** Trace context fabric, operator-aware errors, event purity

---

## 📋 Review Instructions

Use these lenses to verify the patch enforces the system invariant **AND** establishes end-to-end traceability.

Each item must pass. Order matters — check guard structure first, then trace propagation, then database constraints.

---

## ✅ Checklist: Complete System Validation

### 1. Guard Files Created ✓
**Validates:** Core enforcement foundation + trace context

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

- [ ] `packages/core/guards/trace-context.ts` exists **[NEW]**
  - [ ] Exports `TraceContext` type
  - [ ] Exports `withTraceContext()` function (AsyncLocalStorage wrapper)
  - [ ] Exports `getTraceId()` function
  - [ ] Uses AsyncLocalStorage for context propagation
  - [ ] getTraceId() returns empty string if context missing (signals error)
  - [ ] Comments note: "fallback uuid generation ONLY at request boundary"

---

### 2. Middleware Files Created ✓
**Validates:** API-layer enforcement + request boundary trace injection

- [ ] `apps/api/middleware/data-purity.middleware.ts` exists
  - [ ] Exports `ApiResponse<T>` interface with meta field
  - [ ] Exports `enforceMeta()` function
  - [ ] Throws on missing `response.meta`
  - [ ] Calls `assertDataPurity()` on response.meta

- [ ] `apps/api/middleware/trace-context.middleware.ts` exists **[NEW]**
  - [ ] Exports `withTraceId()` higher-order function
  - [ ] Accepts incoming x-trace-id header
  - [ ] Generates fresh uuid if header missing
  - [ ] Calls `withTraceContext()` to wrap handler
  - [ ] Used as HOF on all route handlers (GET, POST, etc.)

---

### 3. Migration 122 Applied ✓
**Validates:** Database constraints enforce invariant + source attribution

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
- [ ] Comments explain source attribution requirement

---

### 4. DEMO_MODE Killed ✓
**Validates:** No silent fallback to synthetic data

- [ ] `apps/api/bootstrap.ts` modified
- [ ] Contains check: `if (process.env.DEMO_MODE === 'true')`
- [ ] Throws error with message containing "DEMO_MODE is forbidden"
- [ ] Check happens FIRST (before other bootstrap logic)

---

### 5. Executor Guards Injected ✓
**Validates:** Adapter response validated + trace propagated before persistence

- [ ] `packages/core/workflow/executor-v2.ts` modified
- [ ] Imports `assertDataPurity`, `failLoudly`, `getTraceId`
- [ ] After adapter call: `assertDataPurity(result)` validates response
- [ ] Calls `getTraceId()` before DB write
- [ ] Insert statement includes columns: `source, mode, trace_id`
- [ ] Error handler calls `failLoudly()` (never `throw error`)
- [ ] Trace ID is from `getTraceId()`, NOT generated new

---

### 6. Replay Route Hardened ✓
**Validates:** No fallback + structured operator-aware error + meta field

- [ ] `apps/web/app/api/governance/replay/route.ts` modified
- [ ] ❌ Fallback code REMOVED completely (no agent_decisions query)
- [ ] If journal empty: returns 503 with structured error
- [ ] Error includes fields: `error`, `message`, `details`, `meta`
- [ ] Meta contains: `source: 'system'`, `mode: 'live'`, `traceId: getTraceId()`
- [ ] Success response includes meta field
- [ ] Uses `getTraceId()` for trace propagation

---

### 7. Config Migrated to Database ✓
**Validates:** No in-memory config + source attribution + trace propagation

- [ ] `apps/web/app/api/config/route.ts` modified
- [ ] ❌ Removed: `let config: UserConfig = { ...DEFAULT_CONFIG }`
- [ ] ❌ Removed: DEFAULT_CONFIG object
- [ ] ❌ Removed: any hardcoded default values
- [ ] GET endpoint loads from `system_config` table
- [ ] POST endpoint validates `source` field (required, must be known value)
- [ ] Both endpoints wrapped with `withTraceId()` HOF
- [ ] Both endpoints call `getTraceId()` in response meta
- [ ] Both GET and POST return `meta: { source, mode, traceId }`
- [ ] Error responses also include meta field
- [ ] Missing config throws error (doesn't default)

---

### 8. Trace Context Injection ✓
**Validates:** End-to-end trace propagation through entire stack

- [ ] All route handlers use `withTraceId()` HOF
- [ ] `getTraceId()` called in all response meta fields
- [ ] `getTraceId()` called before database writes
- [ ] `getTraceId()` called when emitting events
- [ ] No uuid generation inside business logic
- [ ] No traceId generation in adapters
- [ ] Request boundary is only place where uuid() is called (inside withTraceId)

---

### 9. Event Emission Purity ✓
**Validates:** Events carry purity metadata (lineage continuity)

- [ ] `core/services/events.ts` modified or created
- [ ] Exports `GovernanceEvent` interface
- [ ] Exports `emitGovernanceEvent()` function
- [ ] `emitGovernanceEvent()` wraps event with:
  - [ ] `source: 'system'`
  - [ ] `mode: 'live'`
  - [ ] `traceId: getTraceId()`
- [ ] Old `emit()` function updated to call `emitGovernanceEvent()`
- [ ] All event emissions use proper purity wrapper

---

### 10. CI Enforcement Hardened ✓
**Validates:** Tighter pattern matching prevents obfuscated violations

- [ ] Script file exists: `scripts/no-mock-check.sh`
- [ ] Script is executable (mode 755)
- [ ] Script greps for: `mock|demo|fake|fallback|sample|stub|fixture|dummy|seed`
- [ ] Script excludes: `tests/`, `__tests__/`, `fixtures`, `node_modules`
- [ ] Exits with code 1 on violation
- [ ] Exits with code 0 if clean
- [ ] Error message is helpful (explains what to do)

- [ ] `.github/workflows/test.yml` modified
- [ ] New step: "🔒 Data Purity Check"
- [ ] Step runs: `bash scripts/no-mock-check.sh`
- [ ] `continue-on-error: false` (blocks build on violation)

---

## 🚨 Red Flags (Fail Review If Any Present)

Check the patch does NOT contain:

- [ ] ❌ Any `||` or `??` with defaults in runtime code
- [ ] ❌ Any try/catch that continues silently
- [ ] ❌ Any mock/demo/fake/stub/fixture in runtime (not /tests)
- [ ] ❌ Any DEFAULT_CONFIG or hardcoded values
- [ ] ❌ Any DemoMode detection that allows continued execution
- [ ] ❌ Any APIs missing `meta` field
- [ ] ❌ Any adapters returning response without `source`
- [ ] ❌ Any database writes without `trace_id`
- [ ] ❌ Any events emitted without purity metadata
- [ ] ❌ TraceId generation anywhere except request boundary (withTraceId HOF)
- [ ] ❌ getTraceId() returning uuid() fallback (should return empty string to signal error)
- [ ] ❌ Fallback code to agent_decisions (should return 503)

---

## 📊 Expected Breakage After Applying (CORRECT BEHAVIOR)

This is **correct behavior**. System is exposing reality instead of masking it.

After patch is applied, you SHOULD see:

✅ **APIs failing:** "Missing meta in API response"  
✅ **Config errors:** Trying to access non-existent system_config values  
✅ **Adapter mismatches:** Responses missing source/mode/traceId  
✅ **Trace errors:** getTraceId() returning empty string in untraced contexts  
✅ **Tests breaking:** Because they used mocks (move to `/tests` only)  
✅ **Bootstrap failures:** If DEMO_MODE environment variable set  
✅ **Event errors:** Events missing source/mode/traceId  

---

## 🔧 Fix Order (After Applying Patch)

1. **Database:** Run migration 122
   ```bash
   prisma migrate deploy
   ```

2. **Test Adapters:** Return {source, mode, traceId}
   - Update splunk adapter mock
   - Update datadog adapter mock
   - All return source: 'splunk'|'datadog', mode: 'live', traceId: 'test-*'

3. **Test APIs:** Return meta field
   - Wrap test handlers with withTraceId
   - All responses include meta

4. **Test Contracts:** Match purity requirements
   - Update chaos injection layer
   - Ensure test data carries metadata

5. **Verify:** Run chaos tests
   ```bash
   npm run test:chaos
   ```
   Expected: all pass (tests now honor purity contracts)

---

## 🎯 Trace Context Validation (CRITICAL)

These questions prove you understand trace propagation:

- [ ] Where is traceId generated? (Request boundary in withTraceId)
- [ ] How does it propagate? (AsyncLocalStorage)
- [ ] Where can it be regenerated? (ONLY request boundary)
- [ ] What happens if getTraceId() returns empty? (Error will surface)
- [ ] Is traceId the same throughout request? (Yes, via context)
- [ ] Can adapters generate new traceIds? (No, they must use getTraceId())
- [ ] What about background jobs? (Generate fresh traceId at job start, wrapped with withTraceContext)

---

## ✅ Sign-Off

**Patch is production-ready if:**
- All checklist items pass
- No red flags detected
- You understand expected breakages
- You understand trace propagation
- You have a plan for test contract fixes
- You understand this is foundational (non-negotiable)

**Ready to apply with:**
```bash
git apply data-purity-phase-2c-final.patch
```

---

## 📝 Success Criteria (After Full Cycle)

- [ ] Patch applies cleanly (zero conflicts)
- [ ] Migration runs successfully
- [ ] Chaos tests fail as expected (due to test contracts)
- [ ] Fix test contracts in order
- [ ] Chaos tests pass with strict contracts
- [ ] Zero regressions in execution safety
- [ ] Lineage is traceable end-to-end
- [ ] All events carry purity metadata
- [ ] All APIs return meta field
- [ ] All database writes include trace_id

**When all above ✓:**
👉 Ready for Phase 3 (Lineage UI)
👉 System is now "Deterministic Governance Engine with Provenance Guarantees"
