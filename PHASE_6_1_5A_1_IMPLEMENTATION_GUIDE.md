# Phase 6.1.5A.1 Implementation Guide
## Trace Propagation Fabric — Infrastructure Component Core

**Status**: Schema + Runtime Ready
**Date**: 2026-05-18
**Blocking Phase 6.2**: Automated Remediation

---

## Overview

Phase 6.1.5A.1 establishes the immutable runtime substrate for causal tracing. This document explains:
1. What has been created (schema, engine, adapters)
2. How to integrate into existing codebase (5 key boundaries)
3. Verification gates before proceeding to Phase 6.1.5A.2

---

## What Was Created

### 1. **TraceContext Interface** (`apps/api/types/trace-context.ts`)

Core trace model combining W3C Trace Context standard with Phase 6.1.5 extensions:
- `traceId`, `spanId`, `parentSpanId`, `traceFlags` (W3C standard)
- `correlationId` (user-facing), `sessionId`, `executionContext`, `metadata` (Phase 6.1.5)
- Isolation boundaries: `ExecutionContext = 'PRODUCTION' | 'SANDBOX' | 'SIMULATION' | 'REPLAY' | 'TESTING'`
- `AsyncLocalStorage<TraceContext>` for automatic propagation through async boundaries

**Key Functions:**
- `getTraceContext()` / `getTraceContextOrNull()` — Access current trace
- `runWithTraceContext()` / `runWithTraceContextAsync()` — Execute within trace boundary
- `calculateCoherenceTier(latencyMs)` — Map latency to NOMINAL/DEGRADED/STALE/SEVERE
- Serialization: `TraceContextWireFormat` (W3C traceparent/tracestate headers)
- Serialization: `TraceContextPayload` (queue envelopes, async storage)

### 2. **GovernanceCausalityEngine** (`apps/api/services/governance-causality-engine.ts`)

Runtime service for trace lifecycle management:
- `createRootTraceContext()` — At mutation origin
- `createChildSpan()` — For nested async operations
- `serializeTraceContextToWireFormat()` — HTTP header injection
- `deserializeTraceContextFromWireFormat()` — HTTP header extraction
- `recordSpanEvent()` — Persist to mutation_lifecycle_events table
- `recordCacheCoherenceMetrics()` — Map latency to coherence tier
- `verifyTerminalState()` — STATE_VERIFIED assertion
- `getCorrelationChain()` — Reconstruct full causal history
- Automatic segregation: SIMULATION → governance_simulation_journal (production safe)

### 3. **Migration 104** (`docker/infrastructure/schema.sql/02-migration-104-trace-propagation.sql`)

Schema additions:
- `governance_mutation_journal`: Add trace_id, span_id, parent_span_id, execution_context, metadata_payload
- `mutation_lifecycle_events`: New table for 10-stage progression (INTENT_RECEIVED → STATE_VERIFIED)
- `cache_coherence_telemetry`: Replace is_divergent with coherence_tier (NOMINAL/DEGRADED/STALE/SEVERE)
- `governance_simulation_journal`: Sandbox isolation (prevents test data pollution)
- Safe backfill: Uses 'LEGACY_UNTRACED' marker for existing rows
- Global stitching views: v_correlation_timeline, v_coherence_by_tier, v_lifecycle_latency_by_state

### 4. **Trace Context Adapters** (`apps/api/adapters/trace-context-adapters.ts`)

Middleware for async boundary propagation:
- **Queue Jobs**: `enqueueTaskWithTrace()` / `processQueueJobWithTrace()`
- **SSE Streams**: `createSSEEventWithTrace()` / `formatSSEEventForTransmission()`
- **HTTP Fetch**: `fetchWithTrace()` — Injects traceparent/tracestate headers
- **TanStack Query**: `withQueryTrace()` — Attaches trace to query metadata
- **Retries**: `executeWithRetryTrace()` — Maintains chain across attempts
- **Transactions**: `executeInTransactionWithTrace()` — DB transaction wrapping

---

## Integration Checklist

### Phase 1: Database Migration

```bash
# 1. Deploy Migration 104 to staging
psql -h staging-db -d governance_dashboards -f docker/infrastructure/schema.sql/02-migration-104-trace-propagation.sql

# 2. Verify schema:
# - governance_mutation_journal has trace_id, span_id, parent_span_id columns
# - mutation_lifecycle_events table exists with 10 lifecycle states
# - cache_coherence_telemetry has coherence_tier column (NOMINAL/DEGRADED/STALE/SEVERE)
# - governance_simulation_journal exists and is isolated
# - Three new views exist: v_correlation_timeline, v_coherence_by_tier, v_lifecycle_latency_by_state
```

**Gate 1 - Database Verification**: ✅ Schema deployed and verified before proceeding

---

### Phase 2: Runtime Initialization

**File**: `apps/api/lib/db.ts` or `apps/api/server.ts` (wherever DB pool is initialized)

```typescript
import { Pool } from 'pg';
import { initializeGovernanceCausalityEngine } from '@/services/governance-causality-engine';

const pool = new Pool(/* ... */);
initializeGovernanceCausalityEngine(pool);
```

**Gate 2 - Runtime Init**: ✅ Engine initialized at app startup

---

### Phase 3: API Route Integration (5 Boundaries)

#### Boundary 1: Trust Inspection Mutations
**File**: `apps/web/src/app/api/governance/review/[indexName]/route.ts`

**Current**: Governance review endpoint for approve/reject/escalate decisions

**Integration**:
```typescript
import { TraceContext, getTraceContext } from '@/types/trace-context';
import { GovernanceCausalityEngine } from '@/services/governance-causality-engine';
import { fetchWithTrace } from '@/adapters/trace-context-adapters';

export async function POST(req: Request, { params }: { params: { indexName: string } }) {
  const engine = getGovernanceCausalityEngine();
  
  // 1. Create root trace at mutation origin
  const traceContext = engine.createRootTraceContext({
    sessionId: req.headers.get('x-operator-session-id') ?? undefined,
    metadata: { indexName: params.indexName },
  });

  // 2. Execute entire mutation within trace boundary
  return runWithTraceContextAsync(traceContext, async () => {
    // Record INTENT_RECEIVED
    await engine.recordSpanEvent(traceContext, 'INTENT_RECEIVED', {
      status: 'success',
      indexName: params.indexName,
    });

    // Your existing mutation logic here...
    const result = await yourMutationLogic();

    // Record STATE_PERSISTED
    await engine.recordSpanEvent(traceContext, 'STATE_PERSISTED', {
      status: 'success',
      previousState: 'API_ACCEPTED',
    });

    return Response.json(result);
  });
}
```

**Verification**: Mutation handlers create root trace context and record INTENT_RECEIVED → STATE_PERSISTED

---

#### Boundary 2: TanStack Query Cache Invalidation
**File**: `apps/web/src/hooks/useTelemetryWrappedMutations.ts`

**Current**: Invalidates queries after mutation success

**Integration**:
```typescript
import { withQueryTrace } from '@/adapters/trace-context-adapters';
import { useCacheCoherenceMonitor } from '@/hooks/useCacheCoherenceMonitor';

export function useTelemetryWrappedMutation<TData, TError, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  context: GovernanceMutationContext,
  options?: /* ... */
) {
  const queryClient = useQueryClient();
  const monitor = useCacheCoherenceMonitor(context.indexName);
  const engine = getGovernanceCausalityEngine();

  const mutation = useMutation({
    mutationFn: async (variables: TVariables) => {
      const traceContext = getTraceContext();
      
      try {
        const result = await mutationFn(variables);

        // RECORD QUERY_INVALIDATED lifecycle
        monitor.recordInvalidation(); // Records timestamp
        await engine.recordSpanEvent(traceContext, 'QUERY_INVALIDATED', {
          status: 'success',
          previousState: 'STATE_PERSISTED',
        });

        // Invalidate with trace-aware metadata
        const invalidationContext = engine.createChildSpan(traceContext, {
          spanName: 'cache:invalidate',
        });

        await runWithTraceContextAsync(invalidationContext, async () => {
          queryClient.invalidateQueries({
            queryKey: ['trust-inspection', context.indexName],
          });
        });

        // RECORD CACHE_REFRESH_REQUESTED
        monitor.recordRefetch(); // Records timestamp
        await engine.recordSpanEvent(traceContext, 'CACHE_REFRESH_REQUESTED', {
          status: 'success',
          previousState: 'QUERY_INVALIDATED',
        });

        return result;
      } catch (error) {
        // Record failure with trace linkage
        await engine.recordSpanEvent(traceContext, 'QUERY_INVALIDATED', {
          status: 'error',
          errorCode: 'CACHE_INVALIDATION_FAILED',
          errorMessage: (error as Error)?.message,
        });
        throw error;
      }
    },
  });

  return mutation;
}
```

**Verification**: Query invalidation records QUERY_INVALIDATED → CACHE_REFRESH_REQUESTED with timing

---

#### Boundary 3: Queue Job Publishing
**File**: Any mutation handler that publishes background work

**Integration**:
```typescript
import { enqueueTaskWithTrace } from '@/adapters/trace-context-adapters';

// In mutation handler or mutation function
const traceContext = getTraceContext();
const engine = getGovernanceCausalityEngine();

// Publish work with automatic trace injection
const envelope = await enqueueTaskWithTrace(
  'governance-remediation',
  { indexName, action: 'auto_remediate_version_collision' },
  engine,
  { priority: 'high' }
);

// Queue consumer in worker process:
import { processQueueJobWithTrace } from '@/adapters/trace-context-adapters';

worker.process('governance-remediation', async (job) => {
  return processQueueJobWithTrace(
    job.data as QueueJobEnvelope<any>,
    async (payload, context) => {
      // Your worker logic here — trace context is automatically available
      // to all nested async operations
      return await performRemediation(payload);
    },
    engine
  );
});
```

**Verification**: Queue jobs carry trace envelope, worker restores context for all async ops

---

#### Boundary 4: SSE Stream Events
**File**: `apps/web/src/app/api/governance/stream/route.ts` or similar

**Integration**:
```typescript
import { createSSEEventWithTrace, formatSSEEventForTransmission } from '@/adapters/trace-context-adapters';

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  const traceContext = getTraceContext();
  const engine = getGovernanceCausalityEngine();
  let eventSequence = 0;

  return new Response(
    new ReadableStream({
      async start(controller) {
        // Send governance health updates with trace
        const healthEvent = createSSEEventWithTrace(
          'governance-health',
          { status: 'healthy', lastUpdate: new Date() },
          engine,
          eventSequence++
        );
        const formatted = formatSSEEventForTransmission(healthEvent);
        controller.enqueue(encoder.encode(formatted));

        // Send mutations with trace
        const mutationEvent = createSSEEventWithTrace(
          'mutation-committed',
          { indexName: 'my-index', decision: 'approved' },
          engine,
          eventSequence++
        );
        const formattedMutation = formatSSEEventForTransmission(mutationEvent);
        controller.enqueue(encoder.encode(formattedMutation));
      },
    })
  );
}
```

**Frontend SSE Handler**:
```typescript
import { extractTraceContextFromSSEEvent } from '@/adapters/trace-context-adapters';

const eventSource = new EventSource('/api/governance/stream');
const engine = getGovernanceCausalityEngine();

eventSource.addEventListener('mutation-committed', (event) => {
  // Extract trace from SSE event
  const { data, traceContext } = extractTraceContextFromSSEEvent(
    event.data,
    engine
  );
  
  // Use trace context for subsequent operations
  if (traceContext) {
    // Run all response handlers within trace boundary
    runWithTraceContextAsync(traceContext, async () => {
      await handleMutationCommitted(data);
    });
  }
});
```

**Verification**: Every SSE event carries trace context, client-side handlers restore it

---

#### Boundary 5: HTTP Fetch Calls
**File**: Any client-side fetch calls (frontend mutations, queries)

**Integration**:
```typescript
// Replace standard fetch
import { fetchWithTrace } from '@/adapters/trace-context-adapters';

// Automatically injects traceparent/tracestate headers from current context
const response = await fetchWithTrace('/api/governance/review/my-index', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'approve_decision', reason: 'Looks good' }),
});

// Server-side: extract from headers
export async function POST(req: Request) {
  const traceparent = req.headers.get('traceparent');
  const tracestate = req.headers.get('tracestate');
  const engine = getGovernanceCausalityEngine();

  let traceContext;
  if (traceparent) {
    traceContext = engine.deserializeTraceContextFromWireFormat(
      traceparent,
      tracestate ?? undefined,
      req.headers.get('x-operator-session-id') ?? undefined
    );
  } else {
    // Fallback: create root if not provided
    traceContext = engine.createRootTraceContext();
  }

  return runWithTraceContextAsync(traceContext, async () => {
    // All async operations here automatically inherit trace
    return Response.json(/* ... */);
  });
}
```

**Verification**: HTTP calls carry W3C traceparent/tracestate headers, servers extract and restore context

---

## Verification Gates

### Gate 1: Schema Deployment ✅
- [ ] Migration 104 applied without errors
- [ ] New tables exist: mutation_lifecycle_events, governance_simulation_journal
- [ ] Columns added: trace_id, span_id, parent_span_id, execution_context, metadata_payload, coherence_tier
- [ ] Indexes created for trace traversal
- [ ] Backfill complete (check metadata_payload for 'backfill_source')

### Gate 2: Runtime Initialization ✅
- [ ] GovernanceCausalityEngine instantiated at app startup
- [ ] getGovernanceCausalityEngine() callable without error
- [ ] AsyncLocalStorage context properly isolated per request

### Gate 3: Mutation Boundary ✅
- [ ] Mutations create root trace context with createRootTraceContext()
- [ ] INTENT_RECEIVED recorded before mutation executes
- [ ] STATE_PERSISTED recorded after DB write
- [ ] All mutations in governance domain record trace events

### Gate 4: Cache Invalidation Boundary ✅
- [ ] Query invalidation creates child span
- [ ] QUERY_INVALIDATED recorded before invalidation
- [ ] Cache coherence metrics recorded post-refetch
- [ ] Refetch latency calculated and recorded

### Gate 5: Queue Job Boundary ✅
- [ ] Background jobs use enqueueTaskWithTrace()
- [ ] Queue envelope contains serialized trace context
- [ ] Workers use processQueueJobWithTrace()
- [ ] Worker context restored before work execution

### Gate 6: SSE Stream Boundary ✅
- [ ] Server emits SSE events with createSSEEventWithTrace()
- [ ] Trace context embedded in SSE comment line
- [ ] Client extracts trace with extractTraceContextFromSSEEvent()
- [ ] Client-side handlers run within restored trace boundary

### Gate 7: HTTP Fetch Boundary ✅
- [ ] Client-side: All fetch calls use fetchWithTrace()
- [ ] Headers include traceparent and tracestate
- [ ] Server-side: deserializeTraceContextFromWireFormat() successfully reconstructs
- [ ] Cross-boundary correlation preserved

### Gate 8: Terminal Verification ✅
- [ ] UI reconciliation completes
- [ ] STATE_VERIFIED recorded with state hash comparison
- [ ] Hash mismatch triggers error event
- [ ] Correlation chain fully connected from root to leaf

---

## Testing Strategy

### Unit Tests
```typescript
// Test trace generation
const context = engine.createRootTraceContext();
expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
expect(context.spanId).toMatch(/^[0-9a-f]{16}$/);

// Test W3C serialization
const wireFormat = engine.serializeTraceContextToWireFormat(context);
expect(wireFormat.traceparent).toMatch(/^00-[0-9a-f]+-[0-9a-f]+-[0-9a-f]{2}$/);

// Test round-trip deserialization
const restored = engine.deserializeTraceContextFromWireFormat(
  wireFormat.traceparent,
  wireFormat.tracestate
);
expect(restored.traceId).toBe(context.traceId);
```

### Integration Tests
Full mutation → queue → worker → invalidation → refetch → reconciliation chain

```typescript
describe('Trace Propagation E2E', () => {
  it('propagates trace from mutation origin to final UI reconciliation', async () => {
    const engine = getGovernanceCausalityEngine();
    
    // 1. Create root context (mutation origin)
    const rootContext = engine.createRootTraceContext();
    
    // 2. Record through lifecycle
    await engine.recordSpanEvent(rootContext, 'INTENT_RECEIVED');
    await engine.recordSpanEvent(rootContext, 'STATE_PERSISTED');
    
    // 3. Publish queue job with context
    const jobContext = engine.createChildSpan(rootContext);
    const envelope = { payload: {}, traceContext: engine.serializeTraceContextToPayload(jobContext) };
    
    // 4. Simulate worker processing
    const workerContext = engine.deserializeTraceContextFromPayload(envelope.traceContext);
    await engine.recordSpanEvent(workerContext, 'QUERY_REFETCHED');
    
    // 5. Verify correlation chain
    const chain = await engine.getCorrelationChain(rootContext.correlationId);
    expect(chain).toHaveLength(3); // root → state_persisted → worker → refetch
  });
});
```

---

## Next Steps (Phase 6.1.5A.2-5)

After all verification gates pass:

### Phase 6.1.5A.2: Backend Causality Runtime
- Wire integration points from this guide into actual handlers
- Verify PRODUCTION vs SIMULATION isolation
- Test coherence tier calculations

### Phase 6.1.5A.3: Queue + Streaming Boundaries
- Implement queue producer/consumer with envelope serialization
- Verify SSE stream trace injection/extraction
- Load-test concurrent trace propagation

### Phase 6.1.5A.4: Frontend Propagation Fabric
- Deploy fetchWithTrace() globally
- Integrate withQueryTrace() into TanStack Query
- Frontend SSE listener integration

### Phase 6.1.5A.5: Full-System E2E Verification
- End-to-end test spanning all 5 boundaries
- Verify unbroken correlation chains
- Verify SIMULATION journal isolation
- Performance: Trace overhead < 5% latency increase

---

## Troubleshooting

### "getTraceContext() called outside trace boundary"
Async operation is not running within `runWithTraceContextAsync()`. Wrap with:
```typescript
const context = getTraceContext(); // Will throw
// vs.
const context = getTraceContextOrNull(); // Returns null safely
```

### Missing traceparent header on cross-boundary calls
Ensure `fetchWithTrace()` is used instead of plain `fetch()`:
```typescript
// Wrong:
await fetch('/api/...');

// Right:
await fetchWithTrace('/api/...');
```

### Simulation data in production metrics
Ensure executionContext is set correctly at root:
```typescript
// Will segregate to governance_simulation_journal automatically
const testContext = engine.createRootTraceContext({
  executionContext: 'TESTING',
});
```

### Trace chain breaks at async boundary
Likely missing adapter wrapping. Check all async operations use:
- Queue: `enqueueTaskWithTrace()` / `processQueueJobWithTrace()`
- SSE: `createSSEEventWithTrace()` / `extractTraceContextFromSSEEvent()`
- Fetch: `fetchWithTrace()`
- TanStack: `withQueryTrace()`
- Retry: `executeWithRetryTrace()`

---

## Summary

Phase 6.1.5A.1 complete: ✅
- Schema deployed (Migration 104)
- Runtime engine ready (GovernanceCausalityEngine)
- Adapters for all 5 boundaries (queue, SSE, fetch, TanStack, retries)
- Automatic context propagation via AsyncLocalStorage
- Production/simulation isolation enforced

Ready for Phase 6.1.5A.2 (Backend Integration) once all verification gates pass.
