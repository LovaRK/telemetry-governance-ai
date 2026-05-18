# Phase 1: Quick Reference Guide

## For Frontend Developers

### Enable Trace Generation on a Mutation

```typescript
import { useTelemetryWrappedMutations } from '@/hooks/useTelemetryWrappedMutations';

function MyComponent() {
  const mutation = useTelemetryWrappedMutations();

  const handleSave = async (data: Record<string, any>) => {
    await mutation.mutateAsync({
      indexName: 'my_settings',        // Required: identifies what changed
      changeSet: data,                 // Required: the actual changes
      executionClass: 'DIRECT_MUTATION' // Optional: defaults to DIRECT_MUTATION
    });
  };

  return (
    <button onClick={() => handleSave({ field: 'value' })}>
      Save Settings
    </button>
  );
}
```

### Track Cache Health for an Index

```typescript
import { useCacheCoherenceMonitor, useCoherenceHealth } from '@/hooks/useCacheCoherenceMonitor';

function MyIndexComponent() {
  // Automatically starts monitoring the index
  useCacheCoherenceMonitor('my_settings');

  // Get health status
  const health = useCoherenceHealth('my_settings');

  return (
    <div>
      Cache Health: {health}
      {health === 'CRITICAL' && (
        <p>⚠️ Cache is experiencing degradation</p>
      )}
    </div>
  );
}
```

### Different Execution Classes

```typescript
// Regular mutation (default)
mutation.mutateAsync({
  indexName: 'settings',
  changeSet: { field: 'value' },
  executionClass: 'DIRECT_MUTATION'
});

// Mutation that invalidates entire cache
mutation.mutateAsync({
  indexName: 'settings',
  changeSet: { action: 'refresh_all' },
  executionClass: 'CACHE_INVALIDATING'
});

// Streaming mutation (SSE push)
mutation.mutateAsync({
  indexName: 'settings',
  changeSet: { stream: true },
  executionClass: 'STREAMING'
});

// Background job submission
mutation.mutateAsync({
  indexName: 'settings',
  changeSet: { job: 'process_batch' },
  executionClass: 'QUEUE_ASYNC'
});
```

### View Trace Details (Debug)

```typescript
import { TraceTimelineViewer } from '@/examples/GovernanceSettingsIndex.example';

function DebugPanel({ traceId }: { traceId: string }) {
  return <TraceTimelineViewer traceId={traceId} />;
}

// After mutation completes:
const result = await mutation.mutateAsync(payload);
console.log(result.trace); // Contains traceId, correlationId, etc.
```

---

## For Backend Developers

### Record a Lifecycle Event

```typescript
// In your API endpoint
const res = await fetch('/api/governance/lifecycle-event', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    traceId: 'trc_abc123...',
    spanId: 'spn_def456...',
    parentSpanId: 'spn_parent...',
    correlationId: 'corr_xyz789...',
    lifecycleState: 'DB_WRITE_PROPOSED',
    executionClass: 'DIRECT_MUTATION',
    status: 'success',
    durationInStateMs: 45
  })
});
```

### Emit Cache Coherence Telemetry

```typescript
// After cache invalidation completes
const res = await fetch('/api/governance/telemetry/coherence', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    traceId: context.traceId,
    correlationId: context.correlationId,
    indexName: 'settings',
    invalidationLatencyMs: 250,
    staleRenderDurationMs: 0,
    coherenceTier: 'NOMINAL',
    targetStateHash: 'hash_server_abc',
    actualStateHash: 'hash_server_abc'
  })
});
```

### Get Trace Timeline

```typescript
// Fetch complete trace history
const response = await fetch(`/api/governance/trace/${traceId}/timeline`);
const { events, durationMs } = await response.json();

events.forEach(event => {
  console.log(`${event.lifecycle_state} @ ${event.recorded_at}`);
});
```

### Check Trace Status

```typescript
// Quick check without full timeline
const response = await fetch(`/api/governance/trace/${traceId}/status`);
const { eventCount, errorCount, isComplete } = await response.json();
```

### Get Coherence Metrics

```typescript
// Get cache health for an index
const response = await fetch(
  `/api/governance/metrics/coherence?indexName=settings&windowMs=60000`
);
const { metrics } = await response.json();

console.log(`Average latency: ${metrics.averageLatencyMs}ms`);
console.log(`P95 latency: ${metrics.p95LatencyMs}ms`);
console.log(`Success rate: ${metrics.verificationSuccessRate * 100}%`);
```

### Get ALS Reliability

```typescript
// Check AsyncLocalStorage health for a boundary
const response = await fetch('/api/governance/metrics/als-reliability/http');
const { metrics } = await response.json();

console.log(`Reliability score: ${metrics.averageReliability}`);
console.log(`Health status: ${metrics.healthStatus}`);
```

---

## Execution Class Cheat Sheet

| Class | When to Use | Required Stages | Forbidden Stages |
|-------|-------------|-----------------|------------------|
| **DIRECT_MUTATION** | Regular settings update, state change | INTENT_RECEIVED, DB_WRITE_PROPOSED, UI_RECONCILED | QUEUE_ENQUEUED, STREAM_BROADCAST_EMITTED |
| **CACHE_INVALIDATING** | Bulk refresh, cache clear, schema change | INTENT_RECEIVED, CACHE_EVICTION_EMITTED, UI_RECONCILED | DB_WRITE_PROPOSED, QUEUE_ENQUEUED |
| **STREAMING** | Live updates via SSE, real-time push | INTENT_RECEIVED, STREAM_BROADCAST_EMITTED | DB_WRITE_PROPOSED, QUEUE_ENQUEUED, UI_RECONCILED |
| **QUEUE_ASYNC** | Background jobs, async processing | INTENT_RECEIVED, QUEUE_ENQUEUED, JOB_EXECUTION_START, JOB_EXECUTION_SUCCESS | DB_WRITE_PROPOSED, UI_RECONCILED |

---

## Trust Verdicts Explained

### ✅ TRUSTED
- Completeness ≥ 90%
- All expected stages present for execution class
- Topology stable (no hash changes)
- Temporal ordering valid
- Span cardinality normal

**Automation Gate**: FULL_EXECUTION (no human approval needed)

### ⚠️ DEGRADED
- Completeness 60–89%
- Minor gaps (optional stages missing, not required ones)
- Topology transitioning during deployment
- Some ordering anomalies
- ALS reliability slightly reduced

**Automation Gate**: SUGGEST_ONLY (human reviews before automation)

### 🚫 UNTRUSTWORTHY
- Completeness < 60%
- Missing **required** stages for execution class
- Broken parent-child linkage (orphan spans)
- Temporal anomalies (negative durations, impossible latencies)
- Span explosion (>40 spans, likely retry storm)
- Hash mismatches (infrastructure divergence)

**Automation Gate**: BYPASS_AND_ESCALATE (human investigation required, automation forbidden)

---

## Topology Transitions

During rolling deployments:

```
Timeline
─────────────────────────────────────────────
Old Topology (TOPOLOGY_V1)
        └─ Deployment Begins
            ├─ New nodes spinning up
            ├─ Old nodes draining
            └─ Mixed topology valid for 2–5 minutes
New Topology (TOPOLOGY_V2)
```

**How Trust Handles It:**
- Traces crossing the boundary flagged DEGRADED
- Not UNTRUSTWORTHY (expected and healthy)
- Automation gates to SUGGEST_ONLY during window
- After transition complete, returns to normal trust levels

---

## Common Gotchas

### ❌ Forgot to Emit INTENT_RECEIVED
```typescript
// Wrong: Starting mutation without firing lifecycle event
await fetch('/api/governance/execute-mutation', {
  // Missing INTENT_RECEIVED event first!
});

// Right: useTelemetryWrappedMutations handles this
const mutation = useTelemetryWrappedMutations();
await mutation.mutateAsync(payload); // INTENT_RECEIVED auto-fired
```

### ❌ Wrong Execution Class
```typescript
// Wrong: Saying CACHE_INVALIDATING but not invalidating cache
mutation.mutateAsync({
  changeSet: { field: 'value' },
  executionClass: 'CACHE_INVALIDATING' // Lying about what we're doing!
});

// Right: Use correct execution class
mutation.mutateAsync({
  changeSet: { field: 'value' },
  executionClass: 'DIRECT_MUTATION' // Truthful
});
```

### ❌ Telemetry Blocking UI
```typescript
// Wrong: Awaiting telemetry (blocks user interaction)
await fetch('/api/governance/telemetry/coherence', { /* ... */ });

// Right: useCacheCoherenceMonitor and telemetry endpoints already non-blocking
// Fire and forget, telemetry failure doesn't affect UI
```

### ❌ Ignoring DEGRADED Traces
```typescript
// Wrong: Treating DEGRADED same as UNTRUSTWORTHY
if (assessment.trustLevel !== 'TRUSTED') {
  forbidAutomation(); // Too strict!
}

// Right: Respect automation gate
switch (assessment.automationGate) {
  case 'FULL_EXECUTION': automate(); break;
  case 'SUGGEST_ONLY': requestApproval(); break;
  case 'BYPASS_AND_ESCALATE': escalateToHuman(); break;
}
```

---

## Performance Tips

### 1. Batch Lifecycle Events
Don't fire a separate event for every micro-stage. Group related events:

```typescript
// ❌ Slow: 10 separate API calls
for (const stage of stages) {
  await fetch('/api/governance/lifecycle-event', { /* ... */ });
}

// ✅ Better: Batch in single request (implement in Phase 2)
await fetch('/api/governance/lifecycle-event/batch', {
  body: JSON.stringify({ events: stages })
});
```

### 2. Deferred Telemetry
Lifecycle events must be timely (on-path with mutations). Telemetry can batch:

```typescript
// Cache coherence telemetry can batch (happens after UI update anyway)
// Recommendation: Batch every 100 events or 10 seconds
```

### 3. Selective Monitoring
Only monitor indexes that matter:

```typescript
// Don't monitor every index (too much telemetry)
// Monitor: governance_settings, critical_indexes, user_facing_data
useCacheCoherenceMonitor('governance_settings'); // Yes
useCacheCoherenceMonitor('internal_temp_table'); // No
```

---

## Testing Your Implementation

```bash
# Run Phase 1 integration tests
npm run test -- Phase1BoundaryIntegration

# Run specific test
npm run test -- Phase1BoundaryIntegration -t "Topology crossing"

# Watch mode (rebuild on file change)
npm run test -- Phase1BoundaryIntegration --watch
```

---

## Troubleshooting

### Traces Not Appearing in Database
- Check middleware is installed: `app.use('/api/governance', governanceTraceMiddleware)`
- Check lifecycle event endpoint is wired: `app.use('/api/governance/lifecycle', ...)`
- Check database is running and accessible
- Check INTENT_RECEIVED is being fired before mutation

### Trust Score Too Low (False Negatives)
- Check execution class matches mutation type
- Check all required stages are being recorded
- Check topology hash is being injected (should match SYSTEM_TOPOLOGY_HASH)
- Check for orphan spans (broken parent-child links)

### Cache Coherence Telemetry Not Appearing
- Check useCacheCoherenceMonitor is called
- Check /api/governance/telemetry/coherence endpoint exists
- Network failures are silent (by design)—check browser network tab
- Check timing window is correct (60000ms default)

### Topology Transition Causing Too Many DEGRADED
- This is normal during deployments (expect 2–5 minute window)
- If lasting longer, check SYSTEM_TOPOLOGY_HASH environment variable
- May need to adjust `topologyTransitionWindowMs` threshold

---

## Next: Phase 2

Once confident with Phase 1:
- Start Queue boundary (envelope serialization)
- Start SSE boundary (context restoration)
- Run multi-boundary integration tests
- Prepare for production rollout

---

**Questions?** Check `PHASE_0_AND_1_SUMMARY.md` for deeper context.
