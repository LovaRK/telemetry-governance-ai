# Phase 6.1 Extensions: Critical Blockers for Phase 2B SSE

**Status**: Phase 6.1 Core Complete ✓  
**New Requirement**: Three architectural extensions REQUIRED before Phase 2B SSE deployment  
**Date**: 2026-05-18  
**Blocker Level**: MANDATORY (SSE amplifies these issues 200x)

---

## Why These Three Blockers Exist

**Phase 6.1** delivered core causality & cache coherence instrumentation for the Splunk governance dashboard. This is sufficient for Phase 2A Queue Boundary (production-grade).

**Phase 2B** introduces SSE streaming (one mutation → 200 subscribers). This amplifies three architectural weaknesses:

```
Without Blockers Resolved (Current Risk):
  Single worker timeout → automation acts locally (safe-ish)
  SSE: Single worker timeout → 200 subscribers reconnect → 200 traces with same problem
       → All 200 trigger independent remediation → automation storm → system collapse

With Blockers Resolved (Safe):
  Same scenario: PropagationConfidence detects systemic signal
  → Escalates as single incident → automation gate drops to PAUSE
  → SRE investigates once, not 200x
```

---

## Three Critical Blockers

### 1. PropagationConfidence Domain (`apps/api/types/propagation-confidence.ts`)

**Problem**: Structural trust (phase 6.1.5a.1.1) is necessary but insufficient.

A trace can be 100% complete but arrive via broken channels:
- HTTP header missing (extraction failure)
- AsyncLocalStorage lost context (ALS boundary)
- Queue message lost traceparent (broker failure)
- Worker visibility timeout creating dual claims (causal fork)

**Solution**: Quantify propagation reliability **independent** of structure.

```typescript
interface PropagationConfidence {
  // Four layers of measurement
  extractionSuccessRate: number;        // [0,1] — Can we read traceparent?
  alsIntegrity: number;                 // [0,1] — Does AsyncLocalStorage hold?
  asyncBoundaryIntegrity: number;       // [0,1] — Does context survive broker?
  replayContinuityScore: number;        // [0,1] — Do retries maintain causality?
  
  // Floor of all: weakest link dominates
  compositeScore: number;               // [0,1] = min(extraction, als, boundary, replay)
}

interface EffectiveAutomationTrust {
  structuralTrust: number;              // From Phase 6.1.5A.1.1
  propagationConfidence: PropagationConfidence;
  freshnessModifier: number;            // From Phase 2 decay service
  
  // Final verdict: multiplicative
  effectiveScore = structuralTrust × propagationConfidence.compositeScore × freshnessModifier
  automationGate: { allowFull, allowSuggestOnly, allowEscalationOnly }
}
```

**Impact for Phase 2B**: SSE introduces 200x fanout. Propagation confidence gates automation gate separately from structural trust. If propagation degrades (e.g., network blip), automation pauses even if traces are structurally sound.

**File**: `apps/api/types/propagation-confidence.ts` (212 lines)  
**Functions**:
- `computeEffectiveAutomationTrust()` — Blends three signals multiplicatively
- `classifyPropagationConfidenceTier()` — EXCELLENT/HEALTHY/DEGRADED/CRITICAL for UI

---

### 2. BoundaryEvidence Interface (`apps/api/types/boundary-evidence.ts`)

**Problem**: When propagation fails, we don't know WHERE.

Was it the HTTP header? The queue? The SSE broadcast? The worker dequeue?

**Solution**: Immutable forensic snapshots at each boundary.

```typescript
interface BoundaryEvidence {
  evidenceId: string;                   // UUID — unique forensic record
  boundaryType: 
    | 'HTTP_INGRESS'                    // HTTP header parsing
    | 'QUEUE_ENQUEUE' | 'QUEUE_DEQUEUE' // Message broker boundaries
    | 'SSE_BROADCAST' | 'SSE_RECEIVE'   // Streaming boundaries
    | 'WORKER_TOPOLOGY'                 // Deployment/scaling
    | 'CACHE_INVALIDATION';
  
  // What arrived vs what departed
  inboundContext: TraceContextSnapshot | null;
  outboundContext: TraceContextSnapshot | null;
  
  // Success/failure diagnosis
  propagationStatus: 'SUCCESS' | 'PARTIAL_LOSS' | 'COMPLETE_LOSS' | 'FORK_DETECTED';
  
  // Critical for queue: concurrency signals
  visibilityTimeout: { duration_seconds, expiresAt };
  claimedByWorkers: number;  // >1 = causal fork (Test 12)
  forkDetectionMethod: 'VISIBILITY_TIMEOUT' | 'IDEMPOTENCY_KEY' | 'TRACE_ID_COLLISION';
  
  // Immutable
  readonly writtenAt: string;
  readonly isPersisted: boolean;
}

interface BoundaryEvidenceChain {
  traceId: string;
  evidenceSnapshots: BoundaryEvidence[]; // One per boundary
  
  // Aggregated analysis
  propagationIntegrity: {
    integrityScore: number;  // [0,1] = boundaries_ok / total_boundaries
  };
  
  rootCauseIfFailed: {
    type: 'EXTRACTION_FAILURE' | 'ALS_LOSS' | 'BROKER_DROP' | 'VISIBILITY_TIMEOUT_FORK';
    evidenceId: string;      // Which boundary failed
    remediationSuggestion: string;
  };
}
```

**Impact for Phase 2B**: SSE failures are opaque without boundary evidence. Did the broadcast fail? Did clients lose context on reconnect? Evidence snapshots answer these forensically. This enables root cause analysis in < 2 minutes instead of hours.

**File**: `apps/api/types/boundary-evidence.ts` (387 lines)  
**Functions**:
- `createHttpIngressEvidence()` — Captures HTTP header parsing
- `createQueueDequeueEvidence()` — Captures queue visibility timeout + fork detection
- `isBoundaryFailure()` — Boolean predicate for failed boundaries
- `reconstructCausalPath()` — Builds timeline for UI display

---

### 3. Test 12: Visibility Timeout Fork (`apps/api/__tests__/Phase2QueueBoundary.test.ts`)

**Problem**: Queue visibility timeout enables concurrent dequeue races.

Message enqueued, Worker A dequeues (visibility = 30s). If Worker A takes > 30s to process, message becomes visible again. Worker B dequeues SAME message. Now:
- Two execution paths claim same `trace_id`
- Same parent span with 2 children
- Causal fork: system doesn't know which execution "won"

Result: Automation gate must BLOCK (can't safely decide which execution to trust).

**Scenario** (Test 12):
```
T=0:  Message enqueued (span: spn_enq)
T=1:  Worker A dequeues, starts execution (span: spn_worker_a, parent: spn_enq)
      Visibility timeout: 30 seconds
T=31: Message visible again (A still processing)
      Worker B dequeues SAME message (span: spn_worker_b, parent: spn_enq)  ← FORK
T=35: Worker A completes (JOB_EXECUTION_SUCCESS on spn_worker_a)
T=40: Worker B completes (JOB_EXECUTION_SUCCESS on spn_worker_b)

Result: One trace_id, one parent (spn_enq), TWO children executing → FORK DETECTED
Automation verdict: UNTRUSTWORTHY, escalation-only
```

**Test Validates**:
1. ✓ Fork is detectable (two siblings from same parent)
2. ✓ Visibility timeout metadata captures fork reason
3. ✓ Trace completeness validator flags fork
4. ✓ Trust evaluator classifies as UNTRUSTWORTHY
5. ✓ Automation gate blocks (allowFull=false, allowSuggestOnly=false, allowEscalationOnly=true)
6. ✓ Boundary evidence would capture claimedByWorkers > 1

**File**: `apps/api/__tests__/Phase2QueueBoundary.test.ts`  
**Test**: Added to phase 2A suite (lines ~505-650)

---

## Why Phase 2B Cannot Launch Without These

**SSE Amplification Factor**: 1 mutation → 200 subscribers

| Failure Mode | Without SSE | With SSE | Impact |
|---|---|---|---|
| Worker timeout on 1 message | 1 fork detected, 1 escalation | 200 subscribers reconnect → 200 forks → 200 escalations | 200x |
| Network partition (5 min) | 20 in-flight jobs timeout | 20 jobs × 200 subscribers × retries = 4,000 fork events | 200x |
| Deployment window (topology change) | Workers execute mixed V1/V2 | 200 clients see topology change → propagation confidence drops on all 200 | 200x |

Without BoundaryEvidence + PropagationConfidence:
- Automation can't tell if propagation failure is local or systemic
- Creates false positives: "this trace looks healthy structurally, automation should act"
- But propagation is broken, so automation acts on stale context
- SSE amplifies: 200 independent "healthy-looking" traces → 200 remediation actions on broken context

**With these blockers**:
- PropagationConfidence detects systemic signal (200 traces with similar propagation failure)
- BoundaryEvidence proves WHERE failure occurred (HTTP ingress? Queue? SSE?)
- Automation gate gates on BOTH structural trust AND propagation confidence
- SRE investigates once with forensic evidence, not 200x independently

---

## Integration Checklist

These three extensions integrate into existing Phase 6.1 components:

### PropagationConfidence Integration

**Into**: `apps/api/validators/trace-trust-evaluator.ts`

```typescript
// Current (Phase 6.1):
export async function evaluateTraceTrust(
  completeness: TraceCompleteness,
  spanGraph: any,
  pool: Pool
): Promise<TraceTrustAssessment>

// NEW (Phase 6.1.5A.2):
import { PropagationConfidence, computeEffectiveAutomationTrust } from '../types/propagation-confidence';

export async function evaluateTraceTrustWithPropagation(
  completeness: TraceCompleteness,
  spanGraph: any,
  propagationConfidence: PropagationConfidence,  // NEW
  pool: Pool
): Promise<EffectiveAutomationTrust>  // NEW return type
```

**Into**: `apps/api/services/governance-causality-service.ts`

```typescript
// Add method:
export static computePropagationConfidence(
  traceId: string,
  boundaryEvidenceChain: BoundaryEvidenceChain
): PropagationConfidence {
  // Measure extraction, ALS, boundary, replay rates
  // Return composite score
}
```

### BoundaryEvidence Integration

**Into**: `apps/api/services/governance-causality-service.ts`

```typescript
// Add method:
export static recordBoundaryEvidence(
  evidence: BoundaryEvidence,
  pool: Pool
): Promise<void> {
  // Write immutable snapshot to cold tier
  // Emit [SPLUNK_GOVERNANCE_STREAM] JSON with boundary details
}

// Add method:
export static reconstructBoundaryEvidenceChain(
  traceId: string,
  pool: Pool
): Promise<BoundaryEvidenceChain> {
  // Query all evidence snapshots for trace
  // Compute propagation integrity score
  // Identify root cause if failed
}
```

**Into**: `apps/api/routes/governance-telemetry-router.ts`

```typescript
// Add endpoint:
POST /api/governance/boundary-evidence
  Body: BoundaryEvidence
  Response: 201 with evidenceId
  
  // Records immutable boundary snapshot
  // Emits to [SPLUNK_GOVERNANCE_STREAM]
```

### Test 12 Integration

**File**: Already integrated into `apps/api/__tests__/Phase2QueueBoundary.test.ts`

**Run**: `npm test -- Phase2QueueBoundary.test.ts` (6 tests total)

---

## Timeline: When to Implement

| Phase | Work | Timeline | Blocker |
|-------|------|----------|---------|
| 6.1 (COMPLETE) | Core causality + cache coherence | ✓ Done | None |
| 6.1.5A.2 (THIS SPRINT) | PropagationConfidence domain | 2-3 days | YES for 2B |
| 6.1.5A.2 (THIS SPRINT) | BoundaryEvidence interface | 2-3 days | YES for 2B |
| 6.1.5A.2 (THIS SPRINT) | Test 12: Visibility Timeout Fork | 1 day | YES for 2B |
| Integration (NEXT SPRINT) | Wire into trace-trust-evaluator | 2-3 days | YES for 2B |
| Integration (NEXT SPRINT) | Wire into governance-causality-service | 2-3 days | YES for 2B |
| **THEN Phase 2B** | SSE streaming boundary | 4 weeks | Safe ✓ |

---

## How Phase 2B Becomes Safe

**Phase 6.1** → Causality fabric (what happens)  
**Phase 6.1.5A.2** → Propagation reliability (CAN WE TRUST what happens?)  
**Phase 2B** → SSE streaming (reach 200x fanout safely because propagation is gated)

```
Phase 6.2 Automation Decision Logic:

BEFORE (Phase 6.1 only):
  structuralTrust = validateTraceCompleteness() + evaluateTraceTrust()
  if (structuralTrust.safeForAutomation) {
    automationGate.allowFull = true  // DANGER: ignores propagation failures
  }

AFTER (Phase 6.1.5A.2):
  structuralTrust = validateTraceCompleteness() + evaluateTraceTrust()
  propagationConfidence = computePropagationConfidence(boundaryEvidenceChain)
  effectiveScore = computeEffectiveAutomationTrust(
    structuralTrust, propagationConfidence, freshnessModifier
  )
  
  if (effectiveScore >= 0.85 && ALL components >= 0.80) {
    automationGate.allowFull = true  // SAFE: all vectors must pass
  } else if (effectiveScore >= 0.70) {
    automationGate.allowSuggestOnly = true
  } else {
    automationGate.allowEscalationOnly = true
  }
```

---

## Completion Criteria ✓

When all three are complete:

- [ ] PropagationConfidence domain implemented + integrated
- [ ] BoundaryEvidence interface implemented + wired into service
- [ ] Test 12 passing + validated
- [ ] Documentation updated
- [ ] Phase 6.1 + 6.1.5A.2 committed to main
- [ ] THEN Phase 2B SSE boundary can safely launch

**After that**: Phase 2A.1 Systemic Correlation becomes next priority (cross-trace aggregation to prevent remediation storms at massive scale).

---

## References

- [Phase 6.1 Causality & Cache Coherence](phase6_1_causality_implementation.md)
- [Phase 2A Queue Boundary](phase2a_completion.md)
- [Phase 2A.1 Systemic Correlation](phase2a1_systemic_correlation.md)
- [Cardinality & Scaling Roadmap](cardinality_and_scaling_roadmap.md)
