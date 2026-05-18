/**
 * Governance Queue Context
 *
 * Phase 2A: Queue Boundary Envelope Serialization/Deserialization
 *
 * Responsibility: Preserve causal lineage across process boundaries.
 * Enforces:
 * - Trace ID continuity (same trace_id across retries)
 * - Span ID regeneration (new span per execution attempt)
 * - Parent linkage (retry chains maintain correct lineage)
 * - Retry tracking (retry_count, original_span_id)
 * - Idempotency (prevent duplicate mutations on redelivery)
 *
 * W3C Trace Context Extension for Queue Envelopes
 */

/**
 * Complete trace context for queue envelope
 * Serialized into job metadata, deserialized on consumer
 */
export interface QueueTraceContext {
  // W3C Trace Context (RFC standard)
  traceparent: string; // "00-{32char traceId}-{16char spanId}-{flags}"
  tracestate?: string;

  // Governance extensions
  correlationId: string;
  executionContext: 'PRODUCTION' | 'SANDBOX' | 'SIMULATION';
  executionClass: 'QUEUE_ASYNC' | 'DIRECT_MUTATION' | 'CACHE_INVALIDATING';

  // Retry semantics (critical for lineage)
  originalSpanId: string; // Root span of original mutation
  retryCount: number;
  retryScheduledAt?: number; // Timestamp retry was scheduled
  retryExecutedAt?: number; // Timestamp retry actually executed

  // Idempotency protection
  idempotencyKey: string; // hash(trace_id + execution_step)

  // Temporal validation
  enqueuedAt: number; // When job was enqueued
  deadlineAt?: number; // Job expiry time

  // Infrastructure state
  topologyHash: string; // Cluster state when enqueued
  producerServiceName: string; // Which service produced this job
}

/**
 * Job metadata envelope
 * Embedded in job body/metadata field
 */
export interface GovernanceQueueJobEnvelope {
  // Primary payload
  jobPayload: Record<string, any>;

  // Trace lineage (CRITICAL)
  trace: QueueTraceContext;

  // Execution context
  executionId: string; // Unique per execution (for deduplication)
  maxRetries: number;
  retryBackoffMs: number;
}

/**
 * Producer: Create envelope for job submission
 */
export function createQueueEnvelope(
  jobPayload: Record<string, any>,
  parentTraceContext: {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    correlationId: string;
    executionContext: 'PRODUCTION' | 'SANDBOX' | 'SIMULATION';
    executionClass: 'QUEUE_ASYNC' | 'DIRECT_MUTATION' | 'CACHE_INVALIDATING';
    topologyHash: string;
  },
  options: {
    producerServiceName: string;
    maxRetries?: number;
    retryBackoffMs?: number;
    deadlineMs?: number;
  }
): GovernanceQueueJobEnvelope {
  const now = Date.now();
  const enqueuedAt = now;
  const deadlineAt = options.deadlineMs ? now + options.deadlineMs : undefined;

  // Generate execution span for this enqueue operation
  const enqueueSpanId = `spn_${now}_enq`.substring(0, 16).padEnd(16, '0');

  // Idempotency key prevents duplicate processing
  const idempotencyKey = hashTraceExecution(
    parentTraceContext.traceId,
    'QUEUE_ENQUEUED'
  );

  const traceContext: QueueTraceContext = {
    // W3C standard
    traceparent: `00-${parentTraceContext.traceId.padEnd(32, '0')}-${enqueueSpanId}-00`,

    // Governance
    correlationId: parentTraceContext.correlationId,
    executionContext: parentTraceContext.executionContext,
    executionClass: parentTraceContext.executionClass,

    // Retry semantics (original mutation's span)
    originalSpanId: parentTraceContext.spanId,
    retryCount: 0,
    retryScheduledAt: now,

    // Idempotency
    idempotencyKey,

    // Temporal
    enqueuedAt,
    deadlineAt,

    // Infrastructure
    topologyHash: parentTraceContext.topologyHash,
    producerServiceName: options.producerServiceName
  };

  return {
    jobPayload,
    trace: traceContext,
    executionId: `exec_${parentTraceContext.traceId}_${enqueueSpanId}`,
    maxRetries: options.maxRetries ?? 3,
    retryBackoffMs: options.retryBackoffMs ?? 1000
  };
}

/**
 * Consumer: Extract and validate envelope on worker
 */
export function extractQueueTraceContext(
  envelope: GovernanceQueueJobEnvelope
): {
  context: QueueTraceContext;
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Validate required fields
  if (!envelope.trace.traceparent) {
    errors.push('Missing traceparent header');
  }
  if (!envelope.trace.correlationId) {
    errors.push('Missing correlationId');
  }
  if (!envelope.trace.originalSpanId) {
    errors.push('Missing originalSpanId (retry lineage broken)');
  }
  if (envelope.trace.idempotencyKey === undefined) {
    errors.push('Missing idempotencyKey (deduplication impossible)');
  }

  // Validate temporal ordering
  if (envelope.trace.deadlineAt && envelope.trace.deadlineAt < Date.now()) {
    errors.push('Job exceeded deadline (expired in queue)');
  }

  // Validate retry count is reasonable
  if (envelope.trace.retryCount > envelope.maxRetries) {
    errors.push(`Retry count (${envelope.trace.retryCount}) exceeds max (${envelope.maxRetries})`);
  }

  return {
    context: envelope.trace,
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Consumer: Create child span for job execution
 * Links back to original mutation via originalSpanId
 */
export function createJobExecutionContext(
  envelopeContext: QueueTraceContext,
  workerServiceName: string
): {
  traceId: string;
  parentSpanId: string;
  spanId: string;
  correlationId: string;
  lifecycleState: 'JOB_EXECUTION_START';
} {
  const now = Date.now();
  const executionSpanId = `spn_${now}_job`.substring(0, 16).padEnd(16, '0');

  // Parent span is the original enqueue operation
  // This creates the lineage chain:
  // INTENT_RECEIVED (root)
  //   → QUEUE_ENQUEUED (producer)
  //     → JOB_EXECUTION_START (consumer, parent = producer)
  //       → JOB_EXECUTION_SUCCESS

  return {
    traceId: envelopeContext.traceparent.split('-')[1], // Extract from W3C header
    parentSpanId: envelopeContext.originalSpanId, // Link to original mutation
    spanId: executionSpanId,
    correlationId: envelopeContext.correlationId,
    lifecycleState: 'JOB_EXECUTION_START'
  };
}

/**
 * On retry: Update envelope while preserving trace_id
 */
export function prepareRetryEnvelope(
  originalEnvelope: GovernanceQueueJobEnvelope,
  retryDelayAppliedMs: number
): GovernanceQueueJobEnvelope {
  const now = Date.now();

  // Generate NEW span ID for this retry attempt
  const retrySpanId = `spn_${now}_ret${originalEnvelope.trace.retryCount + 1}`
    .substring(0, 16)
    .padEnd(16, '0');

  // NEW idempotency key for this retry execution
  const newIdempotencyKey = hashTraceExecution(
    originalEnvelope.trace.traceparent.split('-')[1],
    `RETRY_${originalEnvelope.trace.retryCount + 1}`
  );

  return {
    ...originalEnvelope,
    trace: {
      ...originalEnvelope.trace,
      traceparent: `00-${originalEnvelope.trace.traceparent.split('-')[1]}-${retrySpanId}-00`,
      retryCount: originalEnvelope.trace.retryCount + 1,
      retryScheduledAt: now,
      idempotencyKey: newIdempotencyKey
    },
    executionId: `exec_${originalEnvelope.trace.traceparent.split('-')[1]}_${retrySpanId}`
  };
}

/**
 * Validation: Ensure no time inversions
 */
export function validateTemporalInvariants(
  envelope: GovernanceQueueJobEnvelope,
  executionStartedAt: number
): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (executionStartedAt < envelope.trace.enqueuedAt) {
    issues.push(
      `Time inversion: execution started (${executionStartedAt}) before enqueue (${envelope.trace.enqueuedAt})`
    );
  }

  if (envelope.trace.retryScheduledAt && envelope.trace.retryScheduledAt > executionStartedAt) {
    issues.push(
      `Retry scheduled after execution started (impossible timing)`
    );
  }

  if (envelope.trace.deadlineAt && envelope.trace.deadlineAt < executionStartedAt) {
    issues.push(`Job deadline (${envelope.trace.deadlineAt}) passed at execution start (${executionStartedAt})`);
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Hash function for idempotency keys
 * Prevents duplicate processing on redelivery
 */
function hashTraceExecution(traceId: string, executionStep: string): string {
  const input = `${traceId}::${executionStep}`;
  // Deterministic hash for consistency
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `idempotent_${Math.abs(hash).toString(16).substring(0, 12)}`;
}

/**
 * Retry decision logic
 * Determines if job should be retried based on error type and retry count
 */
export function shouldRetryJob(
  envelope: GovernanceQueueJobEnvelope,
  error: Error | null,
  executionDurationMs: number
): {
  shouldRetry: boolean;
  delayMs: number;
  reason: string;
} {
  const maxRetries = envelope.maxRetries;
  const currentRetry = envelope.trace.retryCount;
  const baseBackoffMs = envelope.retryBackoffMs;

  // Hard limit: don't retry if max exceeded
  if (currentRetry >= maxRetries) {
    return {
      shouldRetry: false,
      delayMs: 0,
      reason: `Max retries (${maxRetries}) exhausted`
    };
  }

  // Deadline check: don't retry if deadline passed
  if (envelope.trace.deadlineAt && Date.now() > envelope.trace.deadlineAt) {
    return {
      shouldRetry: false,
      delayMs: 0,
      reason: 'Job deadline exceeded'
    };
  }

  // Error classification: determine if error is retryable
  const isRetryableError = error && isRetryable(error);

  if (!isRetryableError && error) {
    return {
      shouldRetry: false,
      delayMs: 0,
      reason: `Non-retryable error: ${error.message}`
    };
  }

  // Exponential backoff with jitter
  const exponentialDelay = baseBackoffMs * Math.pow(2, currentRetry);
  const jitter = Math.random() * 0.1 * exponentialDelay;
  const delayMs = exponentialDelay + jitter;

  return {
    shouldRetry: true,
    delayMs: Math.floor(delayMs),
    reason: `Retrying (attempt ${currentRetry + 1}/${maxRetries}) after ${delayMs.toFixed(0)}ms`
  };
}

/**
 * Error classification for retry decisions
 */
function isRetryable(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Retryable error patterns
  const retryablePatterns = [
    'timeout',
    'econnrefused',
    'enotfound',
    'eagain',
    'econnreset',
    'deadlock',
    'temporarily unavailable',
    'rate limited',
    '429', // HTTP Too Many Requests
    '503', // HTTP Service Unavailable
    '504', // HTTP Gateway Timeout
  ];

  // Non-retryable patterns
  const nonRetryablePatterns = [
    'syntax error',
    'validation failed',
    'unauthorized',
    'forbidden',
    '401', // HTTP Unauthorized
    '403', // HTTP Forbidden
    '404', // HTTP Not Found
  ];

  if (nonRetryablePatterns.some(p => message.includes(p))) {
    return false;
  }

  if (retryablePatterns.some(p => message.includes(p))) {
    return true;
  }

  // Unknown errors: retry by default (fail open)
  return true;
}
