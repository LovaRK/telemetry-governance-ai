# Phase 6.1.5A.1.1: Behavioral Integrity Validation Layer
## The Missing Link Between Infrastructure and Safety

**Why This Exists**: Phase 6.1.5A.1 built the *structure* correctly. Phase 6.1.5A.1.1 proves it *works* under stress.

**Status**: DESIGN COMPLETE — Awaiting Implementation

---

## The Problem Statement

Phase 6.1.5A.1 delivered:
- ✅ Schema (Migration 104)
- ✅ Engine (GovernanceCausalityEngine)
- ✅ Adapters (5 boundaries)
- ✅ AsyncLocalStorage integration

What it did NOT prove:
- ❌ Propagation correctness under retry scenarios
- ❌ Lineage preservation through parallel async operations
- ❌ Context continuity across SSE reconnects
- ❌ Trace integrity through queue redelivery chains
- ❌ Parent linkage under TanStack Query cancellation

**The Critical Gap**: You can build observability infrastructure that looks correct but is *incomplete under failure*. A broken trace looks identical to a complete one until you look closely. Phase 6.2 automation needs to know the difference.

---

## What Phase 6.1.5A.1.1 Delivers

### 1. Trace Completeness Validator

**File**: `apps/api/validators/trace-completeness-validator.ts` (294 lines)

**Purpose**: Answer the question "Did we fully observe this mutation?"

**Key Functions**:
- `validateTraceCompleteness(traceId, pool)` — Comprehensive trace audit
- `reconstructSpanGraph(traceId, pool)` — Build complete span tree
- `generateTraceAuditReport(pool, lookbackDays)` — Forensic compliance report

**Completeness Score** (0-100):
- 40 pts: All 10 lifecycle stages present
- 30 pts: Stages in correct order (no reversals)
- 20 pts: No orphan spans (all linked to root)
- 10 pts: All spans reachable from root (no disconnected subtrees)

**Output Example**:
```typescript
{
  traceId: "trc_1234...",
  isComplete: true,
  completenessScore: 95,
  observedStages: [
    "INTENT_RECEIVED",
    "MUTATION_DISPATCHED",
    // ... all 10 stages
  ],
  missingStages: [],
  orphanSpans: [],
  parentChildLinkageValid: true
}
```

### 2. Failure-Mode Test Suite

**File**: `apps/api/validators/trace-failure-modes.test.ts` (490 lines)

**Purpose**: Prove trace propagation works under realistic failure conditions

**5 Failure Modes Tested**:

#### Mode 1: Async Fragmentation
```
Mutation triggers Promise.all([queue, audit, telemetry])
Test: Do all branches share same trace_id and point to correct parent?
Risk: Lost parent linkage in parallel operations
```

#### Mode 2: Retry Chains
```
Attempt 1 fails → Retry 1 fails → Retry 2 succeeds
Test: Are all retries children of root (not siblings-of-siblings)?
Risk: Each retry becomes new trace, losing lineage
```

#### Mode 3: SSE Reconnect & Replay
```
Mutation → SSE emit → Client disconnect → Reconnect → Replay
Test: Does replayed event preserve original trace_id?
Risk: Replay creates new trace, fragmenting long-running mutation
```

#### Mode 4: Queue Redelivery & DLQ
```
Job publish → Worker fails → Retry → DLQ → Replay → Success
Test: Does envelope preserve trace context across all redeliveries?
Risk: Each redelivery loses context, trace becomes disconnected
```

#### Mode 5: TanStack Query Cancellation
```
Query refetch → User navigates → Query cancelled → Retry
Test: Does cancelled span mark terminal without orphaning original trace?
Risk: Cancelled query becomes orphan, retry doesn't attach to original
```

**Each test includes**:
- ✅ Correct implementation (trace propagates properly)
- ❌ Broken implementation (demonstrates how it fails)
- Verification that completeness validator detects both

### 3. Verification Gates 9-11

**Gate 9: Retry Lineage Integrity**
- All retries share `trace_id`
- All retries are children of root (correct parent)
- Completeness validator confirms linkage

**Gate 10: Parallel Async Integrity**
- All Promise.all branches share `trace_id`
- All branches have same parent (root)
- AsyncLocalStorage isolation verified

**Gate 11: Streaming Continuity**
- SSE replay preserves `trace_id` and `correlationId`
- Client context restoration works correctly
- Reconnected mutations continue original trace

---

## Why This Matters for Phase 6.2

### Phase 6.2 Automation Depends On:
1. **Knowing what happened**: Event journal (Phase 6)
2. **Knowing the causal chain**: Correlation IDs (Phase 6.1)
3. **Knowing we observed everything**: Completeness (Phase 6.1.5A.1.1) ← **YOU ARE HERE**

If completeness is missing:
```
Phase 6.2 sees: "mutation X failed at state Y"
Reality: "mutation X failed at state Y, but we didn't see what happened in queue"
Phase 6.2 Response: "Retry the mutation" ← WRONG, queue never processed it
Result: Infinite retry loop
```

With completeness validation:
```
Phase 6.2 sees: "mutation X has completeness score 45/100 (missing QUEUE_PROCESSED)"
Phase 6.2 Response: "Don't retry, fix the queue first"
Result: Correct remediation
```

---

## Implementation Checklist

### Phase 6.1.5A.1.1 Is Complete When:

1. **Trace Completeness Validator** ✅
   - [ ] `validateTraceCompleteness()` implemented
   - [ ] Queries for all 10 lifecycle stages
   - [ ] Detects orphan spans (recursive CTE)
   - [ ] Validates stage ordering
   - [ ] Calculates completeness score
   - [ ] Handles all edge cases (empty trace, partial trace, broken linkage)

2. **Test Suite Passing** ✅
   - [ ] Failure Mode 1 (async fragmentation) - all sub-tests pass
   - [ ] Failure Mode 2 (retry chains) - both ✅ correct and ❌ broken detected
   - [ ] Failure Mode 3 (SSE reconnect) - replay preserves trace_id
   - [ ] Failure Mode 4 (queue redelivery) - envelope context preserved
   - [ ] Failure Mode 5 (query cancellation) - cancelled spans handled correctly
   - [ ] Composite test (all failures combined) - realistic mutation scenario

3. **Gate 9 Verification** ✅
   - [ ] Retry attempts maintain parent linkage
   - [ ] All retries share trace_id
   - [ ] Completeness validator confirms lineage
   - [ ] Queue redelivery preserves envelope context

4. **Gate 10 Verification** ✅
   - [ ] Promise.all branches maintain parent linkage
   - [ ] All branches share trace_id
   - [ ] AsyncLocalStorage isolation proven
   - [ ] No orphans in parallel operations

5. **Gate 11 Verification** ✅
   - [ ] SSE event serializes full trace context
   - [ ] Client deserialization produces identical trace_id
   - [ ] Replay doesn't create new spans
   - [ ] Reconnection preserves chain integrity

6. **Integration Points** ✅
   - [ ] Validator accessible from Phase 6.2 automation (dependency injection)
   - [ ] Audit report generation available (forensic queries)
   - [ ] Completeness checks available at mutation boundary
   - [ ] Score thresholds documented (when is trace "good enough")

---

## Database Extensions Required

### New SQL View: `v_trace_completeness`
```sql
SELECT
  trace_id,
  count(DISTINCT lifecycle_state) as observed_stage_count,
  CASE WHEN count(DISTINCT lifecycle_state) = 10 THEN 'COMPLETE' ELSE 'INCOMPLETE' END as completeness_status,
  ROUND(100.0 * count(DISTINCT lifecycle_state) / 10, 1) as stage_coverage_pct
FROM mutation_lifecycle_events
GROUP BY trace_id;
```

### New Indexes
- `mutation_lifecycle_events(trace_id, recorded_at DESC)`
- `mutation_lifecycle_events(parent_span_id)` (for orphan detection)

---

## Timeline & Effort

### Estimated Effort:
- Trace completeness validator: **8 hours** (core logic + edge cases)
- Test suite implementation: **6 hours** (5 scenarios + composite)
- Database extensions: **2 hours** (views + indexes)
- Integration testing: **4 hours** (verify all gates pass)
- Documentation: **2 hours**

**Total: ~22 hours**

### Critical Path:
1. Implement validator (8h) → Validate basic traces
2. Implement test suite (6h) → Find and fix issues
3. Integration testing (4h) → Verify all gates
4. Phase 6.1.5A.2 unblocked

---

## Success Criteria

### Phase 6.1.5A.1.1 is done when:

✅ All 5 failure-mode tests pass (both correct ✅ and broken ❌ patterns)
✅ Completeness validator correctly scores all test scenarios
✅ No trace is incorrectly marked "complete" when orphans exist
✅ Retry chains maintain parent linkage
✅ Parallel async operations link correctly
✅ SSE reconnects preserve trace context
✅ Queue redelivery maintains envelope context
✅ Query cancellation doesn't orphan spans
✅ Composite test (realistic scenario) validates end-to-end

### Red Flags (STOP if these occur):

❌ Test shows retries creating new trace_id (Gate 9 broken)
❌ Test shows Promise.all branches becoming orphans (Gate 10 broken)
❌ Test shows SSE replay creating new trace_id (Gate 11 broken)
❌ Completeness validator misses orphans
❌ Completeness score shows 100 when trace is actually broken

---

## The Payoff

Once Phase 6.1.5A.1.1 is complete:

### Phase 6.2 Can Safely:
- Automate mutation retries (knows lineage is preserved)
- Pause mutations on coherence degradation (has confidence data)
- Replay scenarios in sandbox (complete isolation proven)
- Recommend operator actions (won't base decisions on incomplete traces)

### Your Control Plane Becomes:
- **Provably correct**: Not just observable, but forensically complete
- **Safe to automate**: Traces are validated before remediation
- **Auditable**: Can prove causality under investigation
- **Predictable**: Won't have hidden blind spots under failure

---

## What's Next

### Immediate (This Session):
- ✅ Complete Phase 6.1.5A.1.1 design (DONE)
- ⏳ Implement trace completeness validator
- ⏳ Implement failure-mode test suite
- ⏳ Verify all 3 gates pass

### After All Gates Pass:
- Begin Phase 6.1.5A.2 (Backend Integration)
- Wire the 5 boundaries with completeness validation
- Full-system E2E testing under realistic loads

### Critical: DO NOT Skip Validation

The temptation is to skip this and move to A.2 now. Don't.

- Skipping validation = shipping partially verified causality
- Partial causality = Phase 6.2 automation will inherit hidden blind spots
- This is exactly where you should invest extra rigor, not cut corners

---

## Summary

**Phase 6.1.5A.1**: Built trace infrastructure ✅
**Phase 6.1.5A.1.1**: Proves it works under failure ⏳ (This phase)
**Phase 6.1.5A.2**: Wires it into the system ⏳ (Blocked on .1.1)

The control plane's safety depends on getting this right.
