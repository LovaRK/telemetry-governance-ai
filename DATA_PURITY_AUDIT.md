# Data Purity Audit Report
**Date:** 2026-05-19  
**Status:** 🚨 CRITICAL VIOLATIONS DETECTED

---

## Executive Summary

| Category | Count | Severity | Impact |
|----------|-------|----------|--------|
| Demo Mode Bypasses | 4 | 🔴 CRITICAL | UI shows synthetic data without user awareness |
| In-Memory Data Storage | 1 | 🔴 CRITICAL | Config values lost across restarts, not source-tracked |
| Fallback Patterns | 2 | 🟠 HIGH | Governance replay uses stale data when primary source unavailable |
| Hardcoded Values | 4 | 🟠 HIGH | Credentials and default data embedded in code |
| Missing Source Attribution | 6+ | 🟠 HIGH | APIs return data without `source` and `mode` fields |

**Overall Rating:** ❌ **NOT PRODUCTION-READY** for data purity enforcement

---

## 1. CRITICAL: In-Memory Configuration API

**File:** `apps/web/app/api/config/route.ts`

**Violation:**
```typescript
// Line 16-17
// In-memory storage for demo purposes (not persisted across restarts)
let config: UserConfig = { ...DEFAULT_CONFIG };
```

**Problem:**
- User configuration (costPerGbPerDay, maxIndexesPerRun, llmTimeoutMs, decisionWeights) is stored in-memory
- Changes are lost on server restart
- Configuration affects decision scoring but is NOT traceable to Splunk or database
- No source attribution: when a decision uses a weight from config, there's no way to know if it came from user or default

**Affected Operations:**
- Cost calculations (costPerGbPerDay)
- Decision weights (composite scoring)
- Timeout behavior (LLM inference)

**Fix Required:**
```sql
-- Create config table
CREATE TABLE IF NOT EXISTS user_config (
  config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  key VARCHAR(64) NOT NULL,
  value JSONB NOT NULL,
  source VARCHAR(32) NOT NULL CHECK (source IN ('user_override', 'system_default', 'splunk_tag')),
  mode VARCHAR(16) NOT NULL CHECK (mode = 'live'),
  trace_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, key)
);
```

**Severity:** 🔴 CRITICAL  
**Timeline:** Must fix BEFORE Phase 2C implementation

---

## 2. CRITICAL: Demo Mode Bypass

**Files:**
- `apps/web/app/lib/runtime-mode-context.tsx` — allows DEMO_MODE when dependencies missing
- `apps/web/middleware.ts` — silently falls back to DEMO_MODE
- `apps/web/app/layout.tsx` — renders DemoModeBanner without blocking operations

**Violation:**
```typescript
// runtime-mode-context.tsx line 15-20
const [mode, setMode] = useState<RuntimeMode>('DEMO_MODE');
// ...
// Default to DEMO_MODE if health check fails
setMode('DEMO_MODE');
```

```typescript
// middleware.ts
// No hard errors for web-only mode — let APIs handle DEMO_MODE gracefully
```

**Problem:**
- System silently degrades to DEMO_MODE when Splunk/Database unavailable
- UI renders without telling user data is not live
- Decision-making continues with potentially stale/synthetic data
- VIOLATES: "Fail loudly" principle

**Affected Paths:**
- `apps/web/app/api/agent-decisions/route.ts` — returns mode: 'DEMO_MODE'
- `apps/web/app/api/queue-health/route.ts` — returns mode: 'DEMO_MODE'
- `apps/web/app/components/DriftMonitor.tsx` — detects DEMO_MODE but continues rendering

**Fix Required:**
Replace fallback with hard failure:

```typescript
// ❌ REMOVE
const [mode, setMode] = useState<RuntimeMode>('DEMO_MODE');
// ...
setMode('DEMO_MODE');

// ✅ REPLACE WITH
export async function validateLiveMode(): Promise<void> {
  const splunkHealthy = await checkSplunkConnection();
  const dbHealthy = await checkDatabaseConnection();
  
  if (!splunkHealthy || !dbHealthy) {
    throw new Error(
      `❌ Cannot operate without live data. Splunk: ${splunkHealthy}, DB: ${dbHealthy}`
    );
  }
}
```

**Severity:** 🔴 CRITICAL  
**Timeline:** Must fix before any governance operations

---

## 3. HIGH: Governance Replay Fallback

**File:** `apps/web/app/api/governance/replay/route.ts` (lines 44-78)

**Violation:**
```typescript
// Fallback: use agent_decisions + recommendation_actions as replay source
if (res.rows.length === 0) {
  // Query agent_decisions instead of governance_replay_journal
}
```

**Problem:**
- If primary governance_replay_journal is empty, falls back to agent_decisions table
- agent_decisions is NOT part of the event ledger (Phase 2B)
- Replay becomes unreliable: user doesn't know if they're seeing canonical events or reconstructed data
- Missing `source` field in response (governance_replay_journal vs agent_decisions)

**Affected Operations:**
- Audit trail replay (if governance_replay_journal empty)
- Governance timeline reconstruction
- Compliance reporting

**Fix Required:**
```typescript
// ✅ Do NOT fallback. Fail explicitly.
let res = await query<any>(
  `SELECT replay_id, index_name, sourcetype, snapshot_state, recorded_at, replay_source
   FROM governance_replay_journal
   WHERE recorded_at <= $1 ${indexWhere}
   ORDER BY recorded_at DESC LIMIT $2`,
  params
);

if (res.rows.length === 0) {
  return NextResponse.json(
    { 
      error: 'No governance replay available',
      action: 'governance_replay_journal not populated',
      asOf: asOfDate.toISOString()
    },
    { status: 503 }
  );
}
```

**Severity:** 🟠 HIGH  
**Timeline:** Fix before Phase 2C.1 (Execution Substrate) — new events will populate governance_replay_journal

---

## 4. HIGH: Missing Source Attribution

**APIs Requiring Source + Mode Fields:**

| Endpoint | Current Response | Missing Fields | Risk |
|----------|------------------|-----------------|------|
| `/api/governance/events` | `{ events: [] }` | `source`, `mode`, `trace_id` | Can't verify if events are from ledger or reconstructed |
| `/api/governance/mutations` | `{ mutations: [] }` | `source`, `mode` | Can't distinguish live mutations from cached |
| `/api/governance/stream` | SSE events | `mode` field | Stream client doesn't know if REALTIME or stale |
| `/api/recommendations` | `{ recommendations: [] }` | `source` (Splunk, LLM, hybrid) | Can't attribute data origin |
| `/api/cache-status` | `{ status: {...} }` | `source` (Splunk, cache, estimation) | Recommendations based on potentially stale data |

**Fix Template:**
All governance APIs must return:
```json
{
  "data": [...],
  "meta": {
    "source": "splunk|postgres|llm|hybrid",
    "mode": "live",
    "trace_id": "uuid",
    "timestamp": "ISO8601"
  }
}
```

**Severity:** 🟠 HIGH  
**Timeline:** Integrate into Phase 2C.1 (Execution Actions responses)

---

## 5. HIGH: Hardcoded Credentials & Default Values

**File:** `apps/web/app/login/page.tsx`

**Violation:**
```typescript
const [email, setEmail] = useState('admin@bitsio.com');
// ...
Default: admin@bitsio.com / Admin@1234
```

**Files with Hardcoded Data:**
- `apps/web/app/login/page.tsx` — demo credentials
- `apps/web/app/index/[name]/page.tsx` — hardcoded `actorEmail: 'admin@bitsio.com'`
- `apps/web/components/dashboard/ExecutiveOverview.tsx` — hardcoded actor emails
- `apps/web/app/api/config/route.ts` — DEFAULT_CONFIG values

**Problem:**
- Credentials in UI source code
- Default actors in traces
- Audit trails polluted with fake actor data

**Fix Required:**
- Remove all hardcoded credentials from source
- Load default credentials from secure config (not code)
- Use actual operator session IDs from auth context

**Severity:** 🟠 HIGH  
**Timeline:** Before production deployment

---

## 6. MEDIUM: Default Values in Configuration

**File:** `apps/web/app/api/config/route.ts` (lines 10-14)

```typescript
const DEFAULT_CONFIG: UserConfig = {
  costPerGbPerDay: 0.5,           // Where did 0.5 come from?
  maxIndexesPerRun: 1000,        // Where did 1000 come from?
  llmTimeoutMs: 30000,           // Where did 30s come from?
};
```

**Problem:**
- Defaults have no source attribution
- Decisions made with these defaults are untrackable
- If a user doesn't set costPerGbPerDay, system uses 0.5 — from where?

**Fix Required:**
These values must come from:
- Splunk tags (splunk_cost_per_gb_per_day)
- Database config_overrides table
- Explicit user settings (stored in database)

**Never:** Hardcoded in code

**Severity:** 🟡 MEDIUM  
**Timeline:** Fix before config-dependent decisions are evaluated

---

## 7. Data Purity Gaps in Phase 2B (Event Sourcing)

**Files:**
- `core/governance/policy-engine-events.ts`
- `core/database/pipeline-events.ts`
- `infrastructure/migrations/119_control_plane_unified_event_ledger.sql`

**Issue:**
Phase 2B events (POLICY_VALIDATION_EXECUTED, OPERATOR_APPROVAL_GRANTED) don't carry:
- `source` field (always 'system', but should be explicit)
- `mode` field (should enforce 'live')
- Adapter source when action execution events arrive

**Fix Required:** (Phase 2C.1 — Execution Substrate)
```sql
ALTER TABLE pipeline_events
ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'system',
ADD COLUMN mode VARCHAR(16) NOT NULL DEFAULT 'live',
ADD COLUMN trace_id UUID,
ADD CONSTRAINT chk_mode_live CHECK (mode = 'live');
```

**Severity:** 🟡 MEDIUM  
**Timeline:** Build into Phase 2C.1 — make it enforced from the start

---

## Enforcement Strategy

### Layer 1: Runtime Guards (Immediate)
```typescript
// packages/core/guards/data-purity.guard.ts
export function assertLiveData<T>(
  data: T | null | undefined,
  source: string
): T {
  if (!data) {
    throw new Error(`❌ No live data from ${source}`);
  }
  return data;
}

export function assertDataSource(
  response: any,
  expectedSource: string[]
): void {
  if (!response.meta?.source) {
    throw new Error('❌ Missing source attribution');
  }
  if (!expectedSource.includes(response.meta.source)) {
    throw new Error(
      `❌ Expected source [${expectedSource}], got ${response.meta.source}`
    );
  }
  if (response.meta.mode !== 'live') {
    throw new Error(`❌ Data mode is ${response.meta.mode}, not live`);
  }
}
```

### Layer 2: CI Enforcement (Before Merge)
```bash
#!/bin/bash
# scripts/enforce-data-purity.sh

VIOLATIONS=$(grep -r "||.*Default\|fallback.*return\|mock.*data\|fake.*response" \
  apps/ packages/ core/ \
  --include="*.ts" --include="*.tsx" \
  | grep -v tests | grep -v node_modules)

if [ -n "$VIOLATIONS" ]; then
  echo "❌ Data purity violations found:"
  echo "$VIOLATIONS"
  exit 1
fi

echo "✅ Data purity check passed"
```

### Layer 3: Database Constraints (Already in Phase 2C)
```sql
-- Prevent non-live data from entering system
ALTER TABLE execution_results
ADD CONSTRAINT chk_mode_live CHECK (mode = 'live');

ALTER TABLE pipeline_events
ADD CONSTRAINT chk_source_attributed CHECK (source IS NOT NULL);
```

---

## Remediation Timeline

### Phase 2C.1 (Immediate)
- [ ] Remove in-memory config API
- [ ] Migrate config to database with source attribution
- [ ] Add `source`, `mode`, `trace_id` to all execution APIs
- [ ] Hard-fail on DEMO_MODE (no silent degradation)
- [ ] Remove hardcoded credentials

### Phase 2C.2 (Pause & Recovery)
- [ ] Implement governance replay as immutable ledger-only (no fallback)
- [ ] Remove agent_decisions fallback
- [ ] Audit all operator decision events for proper source

### CI/CD (All Phases)
- [ ] Add data-purity enforcement script to pre-commit hook
- [ ] Add to pipeline before merge
- [ ] Report violations in PR comments

---

## Summary

**Current State:** System has multiple synthetic data leaks that violate the purity principle.

**After Phase 2C Implementation + Fixes:** System will be verifiable as pure — every value traceable to Splunk, database, or explicit user action.

**Non-Negotiable for Production:**
1. Remove in-memory config storage
2. Hard-fail on missing Splunk/DB (never DEMO_MODE)
3. Enforce `source` + `mode` + `trace_id` on all responses
4. Remove hardcoded credentials
5. CI enforcement before merge
