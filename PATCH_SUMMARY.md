# Data Purity Phase 2C.1 — Patch Summary

**Patch File:** `data-purity-phase-2c.patch`  
**Review File:** `PATCH_REVIEW_CHECKLIST.md`  
**Total Changes:** 8 files  
**Lines Added:** ~450  
**Lines Removed:** ~60

---

## What This Patch Does

Enforces the system invariant: **No synthetic data in runtime paths.**

```
BEFORE:
  System can fallback → silent failures → user doesn't know
  Config stored in memory → lost on restart
  Adapters return whatever → no source tracking
  APIs return data → no attribution

AFTER:
  System only accepts live data → loud on failure
  Config persisted with source → traceable
  Adapters MUST return source/mode/traceId
  All APIs carry meta (source + mode + trace_id)
```

---

## Files Changed

### 📁 3 New Files Created

| File | Purpose |
|------|---------|
| `packages/core/guards/data-purity.guard.ts` | Core guard function: validates all data carries source+mode+traceId |
| `packages/core/guards/fail-loud.ts` | Error handler: converts exceptions to SYSTEM_INVARIANT_VIOLATION |
| `apps/api/middleware/data-purity.middleware.ts` | API middleware: enforces meta field on responses |

### 📝 1 Database Migration

| File | Purpose |
|------|---------|
| `prisma/migrations/122_data_purity/migration.sql` | Adds source/mode/trace_id columns + constraints to execution tables; creates system_config table |

### 🔧 4 Files Modified (Surgical Changes)

| File | Change | Impact |
|------|--------|--------|
| `apps/api/bootstrap.ts` | Hard-fail if DEMO_MODE set | Prevents silent synthetic data fallback |
| `packages/core/workflow/executor-v2.ts` | Guard injection before DB write | Validates adapter response before persistence |
| `apps/web/app/api/governance/replay/route.ts` | Remove fallback to agent_decisions | Fails loudly if journal empty instead of fabricating |
| `apps/web/app/api/config/route.ts` | Load from DB, remove in-memory | Config always traceable to origin |
| `.github/workflows/test.yml` | Add purity check step | CI blocks non-pure code |

### 🛠️ 1 CI Script Added

| File | Purpose |
|------|---------|
| `scripts/no-mock-check.sh` | Pre-commit enforcement: grep for mock/demo/fake/fallback/sample |

---

## Guard Injection Points (The 3 Layers)

### Layer 1: Adapter Output
```typescript
const result = await splunkAdapter.mutateIndex(...);
assertDataPurity(result);  // 🔒 Validate response carries metadata
```

### Layer 2: Before Database Write
```typescript
await db.execution_results.create({
  source: result.source,      // 🔒 Required
  mode: result.mode,          // 🔒 Must be 'live'
  traceId: result.traceId,    // 🔒 Required for tracing
});
```

### Layer 3: API Response
```typescript
return NextResponse.json({
  data,
  meta: {
    source: 'postgres',  // 🔒 Required
    mode: 'live',        // 🔒 Enforced by DB constraint
    traceId: uuid,       // 🔒 Required
  },
});
```

---

## Key Constraints Added

### Database Level
```sql
-- execution_actions & execution_results
ALTER TABLE ... ADD CONSTRAINT chk_mode_live CHECK (mode = 'live');

-- system_config
source VARCHAR(32) CHECK (source IN ('user_override', 'system_default', 'splunk_tag'))
```

### Application Level
```typescript
// assertDataPurity throws on:
// ❌ Missing source
// ❌ Missing traceId
// ❌ mode !== 'live'
// ❌ Invalid source
```

---

## Expected Post-Patch Behavior

### ✅ Correct Signals (System Working as Designed)
- APIs fail with "Missing meta" — ✅ Working (guard caught missing attribution)
- Config not found in DB — ✅ Working (no defaults allowed)
- Adapter missing source field — ✅ Working (contract violation detected)
- Bootstrap fails if DEMO_MODE=true — ✅ Working (synthetic data blocked)

### ❌ Incorrect Signals (System Broken)
- APIs silently return empty array — ❌ Guard failed (investigate)
- System uses default config value — ❌ Constraint violated (investigate)
- Replay reconstructs from agent_decisions — ❌ Fallback executed (patch not applied)

---

## Migration & Fix Timeline

**Phase 1: Apply Patch (30 min)**
```bash
git apply data-purity-phase-2c.patch
```

**Phase 2: Fix Breakages (60-90 min)**
1. Run migration: `prisma migrate deploy`
2. Populate system_config with current values
3. Update all adapters to return `{source, mode, traceId}`
4. Update all APIs to return `{data, meta: {...}}`
5. Move mocks strictly to `/tests` directories
6. Remove DEMO_MODE from environment

**Phase 3: Validate (20 min)**
```bash
npm run test:chaos
```

---

## How to Review the Patch

**Step 1:** Read `PATCH_REVIEW_CHECKLIST.md`

**Step 2:** Run checklist against patch content:
```bash
# Verify files exist
grep "^diff --git" data-purity-phase-2c.patch

# Verify no mock/demo/fake in runtime code
grep "mock\|demo\|fake" data-purity-phase-2c.patch
```

**Step 3:** Verify logic:
- assertDataPurity throws on any invalid metadata ✓
- failLoudly prevents silent continuation ✓
- No fallback patterns remain ✓
- All DB writes include source + mode + trace_id ✓
- All APIs return meta field ✓

**Step 4:** Green light to apply

---

## What Happens If You Skip This

❌ **Don't skip.** This is the system boundary.

If purity enforcement isn't in place:
- Lineage UI will validate false data
- Dashboards will show potentially synthetic values
- Trust system collapses
- Compliance guarantees void

---

## After This Merges: Next Phase

Once patch is applied + fixes complete + chaos tests pass:

👉 **Phase 3: Build Lineage UI**

With traceId as backbone, you can then:
- Show Splunk → Score → Policy → Approval → Execution → Result chain
- Build Jaeger-style graph explorer
- Validate every pixel is traceable to origin
- Enable CTO dashboard with full provenance

---

## Questions During Review?

**Q: Why is mode always 'live'?**  
A: System operates with real data only. If data isn't live, it shouldn't be used.

**Q: What if I need test data?**  
A: Use `/tests` directory with Testcontainers, WireMock, or fixtures. Never in runtime code.

**Q: What if Splunk is down?**  
A: System fails loudly (503). Operator sees real error. Better than showing stale data.

**Q: Why remove in-memory config?**  
A: Config must be auditable. Lost on restart = not auditable.

---

## Green Light Checklist

Before applying, confirm:

- [ ] You've read PATCH_REVIEW_CHECKLIST.md
- [ ] You understand expected breakages
- [ ] You have a plan to fix config/adapters/APIs
- [ ] Chaos tests are ready to run
- [ ] Team agrees this is non-negotiable

If all ✓ → **Ready to apply**
