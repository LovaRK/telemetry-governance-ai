# Phase 6.1.5A.1.1 Validation Gates (9-11)
## Behavioral Integrity Under Stress

**Purpose**: Prove trace propagation is correct under failure conditions, not just structural completion

**Status**: Definition only (tests and implementation pending)

---

## Gate 9: Retry Lineage Integrity

**Definition**: All retry attempts preserve trace_id and maintain correct parent-child relationships

**Test Scenario**:
```
mutation
 → fails (timeout)
 → retry 1 (child of mutation, retryCount=1)
   → fails (timeout)
   → retry 2 (child of mutation, retryCount=2, not child of retry 1)
     → succeeds
```

**Verification Checklist**:
- [ ] All retries share same `trace_id` ✅
- [ ] All retries have `parentSpanId` pointing to original mutation (not to previous retry)
- [ ] Each retry has correct `retryCount` (0, 1, 2, ...)
- [ ] Each retry is a SIBLING branch off root, not a chain (parent is always root)
- [ ] Completeness validator reports 0 orphan spans
- [ ] Replay/DLQ redelivery preserves same `trace_id` from original envelope

**What Breaks This**:
```typescript
// ❌ WRONG: Each retry becomes new root
for (let attempt = 0; attempt < 3; attempt++) {
  const newRoot = engine.createRootTraceContext(); // Each retry = new trace
  // This makes collision seem like separate incidents
}

// ✅ RIGHT: Each retry is child of original
const retryContext = engine.createChildSpan(originalContext, { retryAttempt });
// All retries share original trace_id
```

**Why This Matters for Phase 6.2**: If retries spawn new traces, automated remediation will see a version collision as three separate anomalies instead of one retriable operation. It will trigger three independent remediation workflows instead of one.

---

## Gate 10: Parallel Async Integrity

**Definition**: Promise.all / fanout operations maintain parent-child relationships

**Test Scenario**:
```
mutation (root)
 ├─ queue publish (child)
 ├─ audit snapshot (child)
 ├─ telemetry record (child)
 └─ [all async, all run in parallel]
```

**Verification Checklist**:
- [ ] All parallel branches share same `trace_id`
- [ ] All parallel branches have `parentSpanId` pointing to mutation root (same parent)
- [ ] No branch has `parentSpanId` pointing to another branch (not siblings-of-siblings)
- [ ] AsyncLocalStorage properly isolates context within Promise.all
- [ ] Completeness validator detects 3 branches + root = 4 total spans
- [ ] Reconstruction shows isLinearChain=false, branches>=2

**What Breaks This**:
```typescript
// ❌ WRONG: Create children outside AsyncLocalStorage boundary
const orphan1 = engine.createChildSpan(root);
const orphan2 = engine.createChildSpan(root); // Both lose context

// ✅ RIGHT: Create children inside boundary
await Promise.all([
  runWithTraceContextAsync(root, async () => {
    const child1 = engine.createChildSpan(root);
  }),
  runWithTraceContextAsync(root, async () => {
    const child2 = engine.createChildSpan(root);
  })
]);
```

**Why This Matters for Phase 6.2**: If parallel operations lose parent linkage, the causality graph fragments. Automated remediation loses visibility into whether failure was in queue, audit, or telemetry layer.

---

## Gate 11: Streaming Continuity

**Definition**: SSE reconnect + replay preserves original trace context

**Test Scenario**:
```
mutation
 → recordSpanEvent(STATE_PERSISTED)
 → emit to SSE
 → client disconnect
 → reconnect
 → replay buffer from server
 → client continues with SAME trace_id
```

**Verification Checklist**:
- [ ] SSE event serialization captures full `TraceContextPayload`
- [ ] Client receives serialized context (embedded in event or header)
- [ ] Client deserialization produces **identical** `trace_id` and `correlationId`
- [ ] Client-side handlers run within restored trace boundary
- [ ] Replayed events don't create new spans, they resume existing chain
- [ ] Completeness validator sees continuous lineage (no orphans from replay)
- [ ] Test: Disconnect at various lifecycle stages (INTENT_RECEIVED, STATE_PERSISTED, UI_RECONCILED)

**What Breaks This**:
```typescript
// ❌ WRONG: Replay creates new context
const replayContext = engine.createRootTraceContext(); // New trace!
// Original mutation trace is now incomplete

// ✅ RIGHT: Replay restores original context
const replayContext = engine.deserializeTraceContextFromPayload(sseEvent.traceContext);
// Same trace_id, continues original chain
```

**Why This Matters for Phase 6.2**: If replay loses context, long-running mutations that reconnect appear as separate incidents. Automated remediation can't distinguish between "mutation retried after disconnect" vs. "new mutation started".

---

## Trace Completeness Validation

**New Capability**: Validate that ALL expected lifecycle stages are present

**Definition**: For a given `trace_id`, verify complete 10-stage progression:

1. `INTENT_RECEIVED`
2. `MUTATION_DISPATCHED`
3. `API_ACCEPTED`
4. `STATE_PERSISTED`
5. `AUDIT_SNAPSHOTTED`
6. `QUERY_INVALIDATED`
7. `CACHE_REFRESH_REQUESTED`
8. `QUERY_REFETCHED`
9. `UI_RECONCILED`
10. `STATE_VERIFIED`

**Scoring**:
- **Completeness Score** (0-100):
  - Stage presence: 40 pts (4 pts per stage)
  - Stage ordering: 30 pts (all in correct sequence)
  - Parent-child linkage: 20 pts (no orphans)
  - Reachability: 10 pts (all spans reachable from root)

**Thresholds**:
- **Complete**: Score ≥ 90 AND no missing stages AND no orphans
- **Degraded**: Score 70-89 (minor gaps, but major chain intact)
- **Broken**: Score < 70 (significant missing stages or structure issues)

**Forensic Output**:
```typescript
{
  traceId: "...",
  isComplete: true,
  observedStages: ["INTENT_RECEIVED", "MUTATION_DISPATCHED", ...],
  missingStages: [],
  stageOrderingValid: true,
  orphanSpans: [],
  completenessScore: 95
}
```

---

## Implementation Requirements

### File: `apps/api/validators/trace-completeness-validator.ts`
- `validateTraceCompleteness(traceId, pool)` → `TraceCompleteness`
- `reconstructSpanGraph(traceId, pool)` → `TraceReconstruction`
- `generateTraceAuditReport(pool, lookbackDays)` → `TraceAuditReport`

### File: `apps/api/validators/trace-failure-modes.test.ts`
- Test suite: 5 failure modes + 1 composite
- Each test validates both ✅ correct behavior and ❌ broken patterns
- Integration harness using Vitest

### Database Queries Required
- Recursive CTE to find all spans reachable from root
- Depth calculation (span graph traversal)
- Stage ordering validation (compare timestamps)

---

## Verification Protocol

### Phase 6.1.5A.1.1 is DONE when:

1. **Gate 9 - Retry Lineage** ✅
   - All retry scenarios pass (test: `Failure Mode 2`)
   - No trace resets on retry
   - Completeness validator confirms lineage

2. **Gate 10 - Parallel Async** ✅
   - Promise.all scenarios pass (test: `Failure Mode 1`)
   - All branches linked to same parent
   - AsyncLocalStorage isolation verified

3. **Gate 11 - Streaming Continuity** ✅
   - SSE reconnect/replay passes (test: `Failure Mode 3`)
   - Replayed events preserve trace_id
   - Client-side context restoration verified

4. **Completeness Validation** ✅
   - All 10 lifecycle stages can be validated
   - Orphan detection working
   - Stage ordering enforced
   - Audit report generation functional

5. **Failure-Mode Tests** ✅
   - All 5 scenarios + composite test passing
   - Both ✅ correct and ❌ broken patterns detected
   - Coverage: Retries, parallel async, streaming, queue, cancellation

---

## What Happens When Gate Fails

### If Gate 9 (Retry) Fails:
```
Symptom: Retries create new traces instead of child spans
Impact: Collision storms look like separate incidents
Phase 6.2 Response: Triggers N independent remediation workflows instead of 1
Risk: Cascading automation false positives
```

### If Gate 10 (Parallel) Fails:
```
Symptom: Promise.all branches lose parent linkage
Impact: Audit, queue, telemetry appear unrelated to mutation
Phase 6.2 Response: Can't determine which subsystem failed
Risk: Automation stalls waiting for complete causality data
```

### If Gate 11 (Streaming) Fails:
```
Symptom: SSE replay creates new trace
Impact: Long-running mutations fragment on disconnect/reconnect
Phase 6.2 Response: Can't correlate pre-disconnect state with post-disconnect
Risk: False positives (thinks mutation failed when it just network-reset)
```

### If Completeness Fails:
```
Symptom: Missing stages not detected
Impact: Partial traces appear complete
Phase 6.2 Response: Automation acts on incomplete information
Risk: HIGHEST - automation becomes unpredictably broken
```

---

## Passing Criteria Summary

| Gate | Passing Criteria | Test | Consequence if Failed |
|------|-----------------|------|----------------------|
| 9 | All retries = children of root | Failure Mode 2 | Retries misdiagnosed as incidents |
| 10 | All Promise.all branches linked | Failure Mode 1 | Parallel ops lose causality |
| 11 | SSE replay preserves trace_id | Failure Mode 3 | Reconnects fragment trace |
| Completeness | Score ≥ 90, no orphans | All tests | Automation acts on incomplete data |

---

## Integration Point: Phase 6.1.5A.2

Once all Gates 9-11 pass:
- Phase 6.1.5A.2 can wire boundaries with confidence
- Each boundary integration can validate against completeness criteria
- Audit trail proves propagation correctness under stress

If any gate fails:
- STOP Phase 6.1.5A.2 proceeding
- Fix the failure mode
- Re-validate

This is the validation layer that makes Phase 6.2 automation safe.
