# Phase 2A Shadow Mode Integration

**Status**: ✅ COMPLETED - RGE wired into splunk-config-service.ts  
**Date**: 2026-05-28  
**Mode**: SHADOW (Parallel evaluation, non-blocking)  
**Integration Point**: POST /splunk/config → saveSplunkConfig()

---

## What Changed

### 1. Request Context Propagation

**File**: `apps/api/routes/splunk-config-routes.ts`

Added request tracing context generation:
```typescript
const trace_id = (req.headers['x-trace-id'] as string) || uuidv4();
const correlation_id = (req.headers['x-correlation-id'] as string) || uuidv4();
const causation_id = req.headers['x-causation-id'] as string;

const requestContext = {
  trace_id,
  correlation_id,
  causation_id,
  actor_id: user.user_id,
  actor_type: 'human' as const,
};

// Pass to saveSplunkConfig
const status = await splunkService.saveSplunkConfig(
  user.tenant_id, 
  config, 
  undefined, 
  requestContext  // ← NEW
);
```

**Why**: Governance decisions require complete correlation context for:
- Audit trail reconstruction
- Forensic grouping
- Replay detection
- Causality tracking

### 2. Shadow Mode Evaluation in Service

**File**: `apps/api/services/splunk-config-service.ts`

Updated saveSplunkConfig signature:
```typescript
async saveSplunkConfig(
  tenant_id: string,
  config: SplunkConfig,
  client?: PoolClient,
  requestContext?: {  // ← NEW
    trace_id?: string;
    correlation_id?: string;
    causation_id?: string;
    actor_id?: string;
    actor_type?: 'human' | 'agent' | 'service';
  }
): Promise<TenantSplunkStatus>
```

Implementation:
```typescript
// OLD: Only runs environmentValidator
const urlValidation = environmentValidator.validateAllSplunkUrls(...);

// NEW: Runs BOTH old validator AND RGE in parallel (shadow mode)
let rgeDecision: GovernanceDecision | null = null;
try {
  if (requestContext?.trace_id && requestContext?.correlation_id) {
    rgeDecision = governanceEngine.evaluate({
      action: 'SAVE_SPLUNK_CONFIG',
      actor_id: requestContext.actor_id || tenant_id,
      actor_type: requestContext.actor_type || 'human',
      resource: `splunk:config:${config.apiUrl || config.url || 'unknown'}:8089`,
      trace_id: requestContext.trace_id,
      correlation_id: requestContext.correlation_id,
      causation_id: requestContext.causation_id,
      policy_snapshot_hash: 'policy-v1-phase-2a'
    });

    // Log both decisions for comparison
    console.log('[GOVERNANCE_SHADOW_MODE]', {
      trace_id: requestContext.trace_id,
      decision_id: rgeDecision.decision_id,
      rge_decision: rgeDecision.decision,
      old_validator: urlValidation.valid ? 'ALLOW' : 'DENY',
      mismatch: (rgeDecision.decision === Decision.DENY) !== !urlValidation.valid,
      environment: governanceEngine.getEnvironment(),
      created_at: new Date().toISOString()
    });
  }
} catch (rgeError) {
  // Log RGE errors but don't block (shadow mode)
  console.error('[GOVERNANCE_EVALUATION_ERROR]', {...});
}
```

**Key behavior**:
- ✅ RGE evaluation runs in PARALLEL with old validator
- ✅ Both results logged with trace_id for comparison
- ✅ Decision mismatch detected and logged
- ✅ RGE DENY does NOT block execution (commented out)
- ✅ RGE errors logged but don't interrupt flow
- ✅ Old validator remains authoritative (no behavior change)

---

## Shadow Mode Monitoring Logs

Three new log types to monitor:

### 1. `[GOVERNANCE_SHADOW_MODE]` - Decision Comparison
```json
{
  "trace_id": "uuid-here",
  "decision_id": "decision-abc123def456",
  "rge_decision": "ALLOW",
  "old_validator": "ALLOW",
  "mismatch": false,
  "environment": "sandbox",
  "created_at": "2026-05-28T10:15:33Z"
}
```

**What to look for**:
- `mismatch: true` → RGE decision differs from old validator
- All decisions should be ALLOW (Phase 2A only does environment isolation)
- Environment should match deployed environment

### 2. `[GOVERNANCE_EVALUATION_ERROR]` - RGE Failures
```json
{
  "error": "policy_snapshot_hash is required",
  "trace_id": "uuid-here",
  "timestamp": "2026-05-28T10:15:33Z"
}
```

**What to look for**:
- Missing request context fields
- RGE engine initialization issues
- Policy evaluation exceptions

### 3. `[SPLUNK_CONFIG_SAVE]` - Updated with RGE Context
```json
{
  "tenant_id": "tenant-123",
  "environment": "sandbox",
  "apiUrl": "https://144.202.48.85:8089",
  "trace_id": "uuid-here",
  "rge_decision": "ALLOW",
  "timestamp": "2026-05-28T10:15:33Z"
}
```

---

## Cutover Strategy (When Confident)

After 1-2 days of shadow mode monitoring:

### Step 1: Verify No Mismatches
```bash
# Check logs for mismatch: true
grep '"mismatch": true' logs/*.json | wc -l
# Should be 0 or very low
```

### Step 2: Uncomment Authoritative Block
In `splunk-config-service.ts`, uncomment:
```typescript
// Shadow mode: Don't block on RGE DENY yet (comparing decisions)
// Once confident, uncomment below to make RGE authoritative:
if (rgeDecision.decision === Decision.DENY) {
  throw new Error(`[GOVERNANCE] ${rgeDecision.reasons.join(', ')}`);
}
```

### Step 3: Deploy & Monitor
- Deploy with authoritative RGE
- Monitor for any DENY decisions
- Monitor for error rates
- Keep old validator as safety net (remove after 1 week stable)

---

## Shadow Mode Checklist

### Pre-Deployment ✅
- [x] RGE skeleton complete (25/25 tests passing)
- [x] Three pre-integration validations complete
- [x] Request context propagation implemented
- [x] Shadow mode evaluation in saveSplunkConfig
- [x] Log formatting for decision comparison
- [x] RGE DENY commented out (non-blocking)

### During Monitoring
- [ ] Collect 24-48 hours of shadow logs
- [ ] Verify decision_id determinism (same request → same ID)
- [ ] Count decision mismatches (expect 0)
- [ ] Verify environment isolation policy (DENY on prod IPs)
- [ ] Check RGE latency (expect <5ms)
- [ ] Confirm all context fields present

### Before Cutover
- [ ] Zero decision mismatches in logs
- [ ] RGE latency acceptable
- [ ] All 25 determinism tests still passing
- [ ] Operator approval (safety review)

### Post-Cutover
- [ ] Monitor DENY decisions
- [ ] Monitor error rates
- [ ] Keep old validator as safety net
- [ ] Plan removal of old validator (1 week post-cutover)

---

## Phase 2A Step 4: Fail-Closed Proof (Next)

After 1-2 days confident monitoring:

1. Create deliberate test failures:
   - Invalid environment → RGE throws at startup
   - Missing trace_id → RGE throws in evaluate()
   - DENY decision → execution blocked

2. New test file: `tests/integration/governance-fail-closed.test.ts`
   - Environment validation tests
   - Request validation tests
   - Blocking on DENY decision tests

3. Wire fail-closed into splunk-config-service:
   - Uncomment RGE DENY block
   - Verify execution stops
   - Verify audit logged

---

## Code Changes Summary

| File | Change | Lines |
|------|--------|-------|
| splunk-config-routes.ts | Add trace_id, correlation_id generation | +8 |
| splunk-config-routes.ts | Pass requestContext to saveSplunkConfig | +1 |
| splunk-config-service.ts | Import governanceEngine, Decision | +1 |
| splunk-config-service.ts | New requestContext parameter | +8 |
| splunk-config-service.ts | Shadow mode RGE evaluation | +40 |
| splunk-config-service.ts | Log decision comparison | +3 |
| **Total** | **Shadow mode integration** | **~70 lines** |

---

## Important: Non-Blocking Design

**This shadow mode is intentionally NON-BLOCKING**:

```typescript
// RGE evaluation runs
const rgeDecision = governanceEngine.evaluate({...});

// Log for comparison
console.log('[GOVERNANCE_SHADOW_MODE]', {...});

// ❌ RGE DENY does NOT block execution (commented out)
// if (rgeDecision.decision === Decision.DENY) {
//   throw new Error(...);
// }

// ✅ Old validator remains authoritative
if (!urlValidation.valid) {
  throw new Error(...);  // ← Old validator can still block
}
```

**Why non-blocking?**
- Builds operator confidence gradually
- Catches edge cases before impact
- Enables decision log analysis
- Zero production risk during monitoring

---

## Ready for Monitoring

The RGE is now wired into the Splunk config save workflow in shadow mode. Every request will:

1. ✅ Generate tracing context (trace_id, correlation_id)
2. ✅ Run old validator (unchanged behavior)
3. ✅ Run RGE in parallel (new, non-blocking)
4. ✅ Log both results with decision_id
5. ✅ Log any decision mismatches
6. ✅ Continue normally (old validator authoritative)

Next: Deploy, monitor logs, verify determinism, then cut over to RGE authoritative mode (Phase 2A Step 4).
