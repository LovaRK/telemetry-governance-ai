# Event Bus & Async Pipeline

## Overview

The event bus is the backbone of the production agentic platform. It transforms the synchronous pipeline into a fully async, fault-tolerant, scalable system.

```
┌──────────────┐
│ API Controller
└──────┬───────┘
       │
       ▼
┌─────────────────────┐
│ Event Bus (Redis)   │
├─────────────────────┤
│ INGESTION_SCHEDULED │ ◄─── Published event
│ INGESTION_NORMALIZE │
│ SCORING_COMPUTE     │
│ POLICY_VALIDATE     │
│ AGENT_REASONING     │
│ KPI_COMPUTE         │
│ AUDIT_LOG           │
└─────────┬───────────┘
          │
      ┌───┴────┬─────┬─────┬──────┬──────┐
      ▼        ▼     ▼     ▼      ▼      ▼
   Worker1  Worker2 W3    W4     W5     W6
   (5 tasks)(10 t) (15t) (20t)  (8t)   (40t)
      │        │     │     │      │      │
      └────────┴─────┴─────┴──────┴──────┘
             │
             ▼
         Database
         (idempotent by snapshotId)
```

## Architecture

### Topics (9 job types)

| Topic | Stage | Input | Output | Retries |
|-------|-------|-------|--------|---------|
| `INGESTION_SCHEDULED` | 1. Fetch | tenantId | rawData | 3x |
| `INGESTION_NORMALIZE` | 2. Normalize | rawData | goldData | 3x |
| `SCORING_COMPUTE` | 3. Score | goldData | scored[] | 2x |
| `POLICY_VALIDATE` | 4. Policy | scored[] | validations[] | 2x |
| `AGENT_REASONING` | 5. LLM | validations[] | decisions[] | 3x |
| `KPI_COMPUTE` | 6. Metrics | scored[], decisions[] | kpis | 2x |
| `AUDIT_LOG` | ~. Audit | event, data | logged | 1x (non-blocking) |
| `WORKFLOW_APPROVE` | ⚙. Approval | decisionId | approved | 1x |
| `WORKFLOW_EXECUTE` | ⚙. Execute | decisionId | executed | 3x |

### Worker Concurrency

Each worker processes multiple jobs in parallel:

```
Topic                Concurrency  Max Duration  Retry Policy
INGESTION_SCHEDULED  2            30s           exp backoff 5s
INGESTION_NORMALIZE  5            45s           exp backoff 5s
SCORING_COMPUTE      10           30s           exp backoff 3s
POLICY_VALIDATE      10           20s           exp backoff 2s
AGENT_REASONING      5            60s           exp backoff 10s
KPI_COMPUTE          5            20s           exp backoff 2s
AUDIT_LOG            20           5s            no retry
WORKFLOW_APPROVE     1            unlimited     no retry
WORKFLOW_EXECUTE     2            45s           exp backoff 5s
```

**Rationale:**
- Bottlenecks (INGESTION, AGENT) have lower concurrency
- Fast operations (KPI, AUDIT) have high concurrency
- API-dependent (INGESTION) rate-limited
- Critical paths (SCORING, POLICY) have exponential backoff

## Usage

### Start Pipeline

```typescript
import { startPipeline } from '@infra/queue';

// In your application startup (e.g., main.ts or api/index.ts)
await startPipeline('redis://127.0.0.1:6379');
```

### Trigger Full Run

```typescript
import { getJobProducer } from '@infra/queue';

const producer = getJobProducer();

// Triggers INGESTION → NORMALIZE → SCORING → POLICY → AGENT → KPI
const { snapshotId, ingestionJobId } = await producer.triggerFullPipeline(
  'tenant123',
  'cost_optimization'  // Policy profile
);

console.log(`Pipeline started: ${snapshotId}`);
```

### Check Status

```typescript
import { getEventBus } from '@infra/queue';

const bus = getEventBus();

const status = await bus.getJobStatus(Topics.SCORING_COMPUTE, jobId);
console.log(status); // { state: 'completed', progress: 100, ... }

const stats = await bus.getQueueStats();
console.log(stats); // { INGESTION_SCHEDULED: { active: 2, completed: 15, ... }, ... }
```

## Idempotency

Critical guarantee: **Each job is idempotent by snapshotId**.

If a job fails and retries:
1. Retrieve data by snapshotId from database
2. If already exists → return cached result
3. If not → process and store
4. No duplicates, no side effects

```typescript
// In each worker handler
async function handleScoringCompute(payload) {
  const snapshotId = payload.snapshotId;
  
  // Check if already processed
  const cached = await retrieveScores(snapshotId);
  if (cached) {
    console.log('Already processed, returning cached');
    return cached;
  }
  
  // Process
  const scores = await computeScores(goldData);
  
  // Store with snapshotId as key
  await storeScores(snapshotId, scores);
  
  return scores;
}
```

## Error Handling

### Retry Policy

Each topic has a retry policy (topics.ts → `getRetryPolicy()`):

```typescript
{
  maxAttempts: 3,           // Total tries
  delayMs: 5000,            // Initial delay
  backoffMultiplier: 2      // Exponential: 5s → 10s → 20s
}
```

**Example:** SCORING_COMPUTE fails
1. Attempt 1 fails immediately
2. Scheduled: 3s delay
3. Attempt 2 fails
4. Scheduled: 6s delay
5. Attempt 3 succeeds ✅

### Dead Letter Queue (DLQ)

Jobs that fail after max retries go to DLQ:

```typescript
// View failed jobs
const failedJobs = await bus.queues.get(Topics.SCORING_COMPUTE).getFailed();

// Clear DLQ
await bus.clearFailedJobs(Topics.SCORING_COMPUTE);

// Manually retry
for (const job of failedJobs) {
  await job.retry();
}
```

### Critical vs Non-Critical

**Critical topics** block pipeline:
- `INGESTION_NORMALIZE` — no data, no scores
- `SCORING_COMPUTE` — no scores, no decisions
- `POLICY_VALIDATE` — unsafe without validation

**Non-critical topics** don't block:
- `AUDIT_LOG` — observability only
- `WORKFLOW_APPROVE` — manual process

## Job Chaining

Jobs automatically trigger the next stage:

```
INGESTION_SCHEDULED
  ↓
  handleIngestionScheduled()
    ↓
    producer.normalizeIngestion()  ← publishes next
      ↓
      INGESTION_NORMALIZE
        ↓
        handleIngestionNormalize()
          ↓
          producer.computeScores()  ← publishes next
```

No explicit chaining in event bus; each handler explicitly publishes next job. This gives full control over:
- Conditional branching
- Error handling
- Data transformation between stages

## Monitoring

### Real-Time Metrics

```typescript
const stats = await bus.getQueueStats();
// Output:
// {
//   INGESTION_SCHEDULED: { active: 1, completed: 247, failed: 3, ... },
//   SCORING_COMPUTE: { active: 8, completed: 245, failed: 0, ... },
//   ...
// }
```

### Logging

All workers log:
- ✅ Completion: `[Worker:SCORING_COMPUTE] ✅ Complete`
- ❌ Errors: `[Worker:SCORING_COMPUTE] ❌ Error: connection timeout`
- 🔥 Critical: `[EventBus] 🔥 Worker error for INGESTION_NORMALIZE`

### Audit Trail

Every pipeline run creates audit events:

```typescript
await producer.logAuditEvent(snapshotId, tenantId, 'pipeline.started', {
  policyProfile: 'cost_optimization',
  timestamp: new Date()
});

// Later:
await producer.logAuditEvent(snapshotId, tenantId, 'policy.validated', {
  violations: 3,
  escalations: 1
});

await producer.logAuditEvent(snapshotId, tenantId, 'pipeline.completed', {
  kpis: { roiScore: 0.68, ... }
});
```

## Integration with API

### Controller Example

```typescript
// apps/api/routes/governance/trigger.ts
import { getJobProducer } from '@infra/queue';

export async function POST(req) {
  const { tenantId, policyProfile } = req.body;
  
  const producer = getJobProducer();
  const { snapshotId, ingestionJobId } = await producer.triggerFullPipeline(
    tenantId,
    policyProfile
  );
  
  // Return immediately (async in background)
  return {
    snapshotId,
    jobId: ingestionJobId,
    status: 'queued',
    estimatedDuration: '5-10 minutes'
  };
}

export async function GET(req) {
  const { snapshotId } = req.query;
  
  // Poll job status
  const stats = await bus.getQueueStats();
  const jobStatus = await bus.getJobStatus(...);
  
  return {
    snapshotId,
    piplineProgress: calculateProgress(stats),
    ...jobStatus
  };
}
```

## Database Integration

Each worker **retrieves** and **stores** data idempotently:

```typescript
// Retrieve (idempotent read)
const goldData = await db.normalizedData.findUnique({
  where: { snapshotId }
});

// Store (upsert, never duplicate)
await db.scores.upsert({
  where: { snapshotId },
  create: { snapshotId, tenantId, data: scores },
  update: { data: scores, updatedAt: now }
});
```

All tables should have unique index on `(snapshotId, tenantId)` to prevent duplicates.

## Scaling

### Horizontal

Run multiple worker instances:

```bash
# Worker instance 1
node dist/worker-setup.js

# Worker instance 2
node dist/worker-setup.js

# Worker instance 3
node dist/worker-setup.js
```

Redis automatically distributes jobs across instances. No coordination needed.

### Vertical

Adjust concurrency per worker:

```typescript
bus.registerWorker(Topics.SCORING_COMPUTE, handler, {
  concurrency: 20  // Increased from 10
});
```

## Troubleshooting

### Jobs Stuck in Queue

```typescript
// Check active jobs
const activeJobs = await queue.getJobs(['active']);

// Check job details
const job = await queue.getJob(jobId);
console.log(job.progress());  // 0-100

// Force retry
await job.retry();

// Remove stuck job
await job.remove();
```

### Worker Not Processing

```typescript
// Verify worker is registered
const workers = bus.workers;
console.log(workers.has(Topics.SCORING_COMPUTE));  // true?

// Check logs for errors
// Look for: "[EventBus] 🔥 Worker error"

// Restart worker
await bus.workers.get(Topics.SCORING_COMPUTE)?.close();
bus.registerWorker(Topics.SCORING_COMPUTE, handler);
```

### High Retry Rate

1. Check worker logs for error messages
2. Verify database connectivity
3. Verify external API availability (Splunk, LLM)
4. Check queue stats for patterns
5. Increase retry delay in `topics.ts`

## Next Steps

1. **Integrate with API** → Controller publishes events
2. **Add observability** → Prometheus metrics, OTEL tracing
3. **Multi-tenant isolation** → Per-tenant queues
4. **Workflow UI** → Real-time job status dashboard
5. **Dead letter queue management** → Automated alerting
