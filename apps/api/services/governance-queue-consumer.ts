/**
 * Governance Queue Consumer
 *
 * Phase 2A: Queue Boundary - Consumer Side
 *
 * Responsibility: Consume jobs, restore trace context, and maintain causality.
 * Emits JOB_EXECUTION_START, JOB_EXECUTION_SUCCESS, RETRY_SCHEDULED lifecycle events.
 * Enforces idempotency to prevent duplicate mutations.
 * Validates temporal invariants (no time inversions).
 */

import { Worker, Job } from 'bullmq';
import { Pool } from 'pg';
import { AsyncLocalStorage } from 'async_hooks';
import {
  GovernanceQueueJobEnvelope,
  extractQueueTraceContext,
  createJobExecutionContext,
  prepareRetryEnvelope,
  validateTemporalInvariants,
  shouldRetryJob
} from './governance-queue-context';

/**
 * AsyncLocalStorage for queue workers
 * Maintains trace context across async boundaries
 */
export const queueWorkerStorage = new AsyncLocalStorage<{
  traceId: string;
  spanId: string;
  parentSpanId: string;
  correlationId: string;
  executionContext: 'PRODUCTION' | 'SANDBOX' | 'SIMULATION';
  retryCount: number;
  idempotencyKey: string;
}>();

/**
 * Job processor function signature
 */
export type JobProcessor = (
  jobData: Record<string, any>,
  traceContext: ReturnType<typeof createJobExecutionContext>
) => Promise<any>;

/**
 * Governance queue consumer
 * Wraps BullMQ worker with trace context restoration and lifecycle tracking
 */
export class GovernanceQueueConsumer {
  private worker: Worker;
  private pool: Pool;
  private serviceName: string;
  private processors: Map<string, JobProcessor>;
  private idempotencyCache: Map<string, { result: any; timestamp: number }>;

  constructor(
    queueName: string,
    redisConnection: { host: string; port: number },
    pool: Pool,
    serviceName: string
  ) {
    this.pool = pool;
    this.serviceName = serviceName;
    this.processors = new Map();
    this.idempotencyCache = new Map(); // In-memory cache for deduplication

    // Initialize BullMQ worker
    this.worker = new Worker(queueName, this.handleJob.bind(this), {
      connection: redisConnection,
      settings: {
        lockDuration: 30000,
        lockRenewTime: 5000,
        maxStalledCount: 2,
        stalledInterval: 5000
      },
      concurrency: 10 // Process up to 10 jobs concurrently
    });

    // Event handlers
    this.worker.on('completed', (job) => {
      this.handleJobCompleted(job);
    });

    this.worker.on('failed', (job, err) => {
      this.handleJobFailed(job, err);
    });
  }

  /**
   * Register a job processor for a named job type
   */
  registerProcessor(jobName: string, processor: JobProcessor): void {
    this.processors.set(jobName, processor);
  }

  /**
   * Main job handler
   * Called by BullMQ for each job
   */
  private async handleJob(job: Job): Promise<any> {
    const startTime = Date.now();
    const envelope = job.data as GovernanceQueueJobEnvelope;

    try {
      // Step 1: Validate envelope integrity
      const validationResult = extractQueueTraceContext(envelope);
      if (!validationResult.isValid) {
        throw new Error(`Invalid envelope: ${validationResult.errors.join('; ')}`);
      }

      // Step 2: Check idempotency
      const idempotencyKey = envelope.trace.idempotencyKey;
      if (this.idempotencyCache.has(idempotencyKey)) {
        const cached = this.idempotencyCache.get(idempotencyKey)!;
        console.log(`Job already processed (idempotent), returning cached result`);
        return cached.result;
      }

      // Step 3: Validate temporal invariants
      const temporalValidation = validateTemporalInvariants(envelope, startTime);
      if (!temporalValidation.valid) {
        throw new Error(`Temporal anomaly: ${temporalValidation.issues.join('; ')}`);
      }

      // Step 4: Create execution span
      const executionContext = createJobExecutionContext(
        validationResult.context,
        this.serviceName
      );

      // Step 5: Run job inside trace context
      const result = await this.runJobWithTraceContext(
        job,
        envelope,
        executionContext,
        startTime
      );

      // Step 6: Cache result for idempotency
      this.idempotencyCache.set(idempotencyKey, {
        result,
        timestamp: Date.now()
      });

      // Step 7: Emit JOB_EXECUTION_SUCCESS
      await this.recordJobExecutionSuccess(
        envelope,
        executionContext,
        startTime,
        result
      );

      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('Job execution failed:', error);

      // Check if should retry
      const retryDecision = shouldRetryJob(envelope, error, Date.now() - startTime);

      if (retryDecision.shouldRetry) {
        // Emit RETRY_SCHEDULED event
        await this.recordRetryScheduled(
          envelope,
          error,
          retryDecision.delayMs,
          startTime
        );

        // Prepare retry envelope (new span, same trace)
        const retryEnvelope = prepareRetryEnvelope(envelope, retryDecision.delayMs);

        // Throw to trigger BullMQ retry mechanism
        throw new Error(`Retryable error: ${error.message}`);
      } else {
        // Non-retryable: emit failure event
        await this.recordJobExecutionFailure(
          envelope,
          error,
          startTime,
          retryDecision.reason
        );

        // Don't retry
        throw error;
      }
    }
  }

  /**
   * Execute job while maintaining trace context
   */
  private async runJobWithTraceContext(
    job: Job,
    envelope: GovernanceQueueJobEnvelope,
    executionContext: ReturnType<typeof createJobExecutionContext>,
    startTime: number
  ): Promise<any> {
    // Extract trace ID from W3C header
    const [, traceId, , ] = envelope.trace.traceparent.split('-');

    // Create storage context
    const storageContext = {
      traceId,
      spanId: executionContext.spanId,
      parentSpanId: executionContext.parentSpanId,
      correlationId: executionContext.correlationId,
      executionContext: envelope.trace.executionContext,
      retryCount: envelope.trace.retryCount,
      idempotencyKey: envelope.trace.idempotencyKey
    };

    // Run inside AsyncLocalStorage boundary
    return queueWorkerStorage.run(storageContext, async () => {
      // Emit JOB_EXECUTION_START
      await this.recordJobExecutionStart(
        envelope,
        executionContext,
        startTime
      );

      // Get processor for this job type
      const processor = this.processors.get(job.name);
      if (!processor) {
        throw new Error(`No processor registered for job type: ${job.name}`);
      }

      // Execute job with full trace context available
      return processor(envelope.jobPayload, executionContext);
    });
  }

  /**
   * Record JOB_EXECUTION_START lifecycle event
   */
  private async recordJobExecutionStart(
    envelope: GovernanceQueueJobEnvelope,
    executionContext: ReturnType<typeof createJobExecutionContext>,
    startTime: number
  ): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO mutation_lifecycle_events
         (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
          status, duration_in_state_ms, execution_context, metadata, recorded_at)
         VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10 / 1000.0))`,
        [
          executionContext.traceId,
          executionContext.spanId,
          executionContext.parentSpanId,
          executionContext.correlationId,
          'JOB_EXECUTION_START',
          'success',
          0,
          envelope.trace.executionContext,
          JSON.stringify({
            executionClass: envelope.trace.executionClass,
            consumerService: this.serviceName,
            retryCount: envelope.trace.retryCount,
            topologyHash: envelope.trace.topologyHash,
            enqueuedAt: envelope.trace.enqueuedAt,
            dequeuedAt: startTime,
            queueLatencyMs: startTime - envelope.trace.enqueuedAt
          }),
          startTime
        ]
      );
    } catch (err) {
      console.error('Failed to record JOB_EXECUTION_START:', err);
    }
  }

  /**
   * Record JOB_EXECUTION_SUCCESS lifecycle event
   */
  private async recordJobExecutionSuccess(
    envelope: GovernanceQueueJobEnvelope,
    executionContext: ReturnType<typeof createJobExecutionContext>,
    startTime: number,
    result: any
  ): Promise<void> {
    try {
      const completionTime = Date.now();
      await this.pool.query(
        `INSERT INTO mutation_lifecycle_events
         (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
          status, duration_in_state_ms, execution_context, metadata, recorded_at)
         VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10 / 1000.0))`,
        [
          executionContext.traceId,
          executionContext.spanId,
          executionContext.parentSpanId,
          executionContext.correlationId,
          'JOB_EXECUTION_SUCCESS',
          'success',
          completionTime - startTime,
          envelope.trace.executionContext,
          JSON.stringify({
            executionDurationMs: completionTime - startTime,
            resultSize: JSON.stringify(result).length,
            retryCount: envelope.trace.retryCount
          }),
          completionTime
        ]
      );
    } catch (err) {
      console.error('Failed to record JOB_EXECUTION_SUCCESS:', err);
    }
  }

  /**
   * Record JOB_EXECUTION_FAILURE lifecycle event
   */
  private async recordJobExecutionFailure(
    envelope: GovernanceQueueJobEnvelope,
    error: Error,
    startTime: number,
    reason: string
  ): Promise<void> {
    try {
      const failureTime = Date.now();
      const [, traceId, spanId] = envelope.trace.traceparent.split('-');

      await this.pool.query(
        `INSERT INTO mutation_lifecycle_events
         (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
          status, duration_in_state_ms, error_code, error_message, execution_context, metadata, recorded_at)
         VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_timestamp($12 / 1000.0))`,
        [
          traceId,
          spanId,
          envelope.trace.originalSpanId,
          envelope.trace.correlationId,
          'JOB_EXECUTION_FAILURE',
          'error',
          failureTime - startTime,
          error.name,
          error.message,
          envelope.trace.executionContext,
          JSON.stringify({
            reason,
            retryCount: envelope.trace.retryCount,
            maxRetries: envelope.maxRetries
          }),
          failureTime
        ]
      );
    } catch (err) {
      console.error('Failed to record JOB_EXECUTION_FAILURE:', err);
    }
  }

  /**
   * Record RETRY_SCHEDULED lifecycle event
   */
  private async recordRetryScheduled(
    envelope: GovernanceQueueJobEnvelope,
    error: Error,
    delayMs: number,
    startTime: number
  ): Promise<void> {
    try {
      const [, traceId, spanId] = envelope.trace.traceparent.split('-');

      await this.pool.query(
        `INSERT INTO mutation_lifecycle_events
         (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
          status, duration_in_state_ms, error_code, error_message, execution_context, metadata, recorded_at)
         VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_timestamp($12 / 1000.0))`,
        [
          traceId,
          spanId,
          envelope.trace.originalSpanId,
          envelope.trace.correlationId,
          'RETRY_SCHEDULED',
          'success',
          Date.now() - startTime,
          null,
          null,
          envelope.trace.executionContext,
          JSON.stringify({
            nextRetryMs: delayMs,
            currentRetryCount: envelope.trace.retryCount,
            maxRetries: envelope.maxRetries,
            error: error.message
          }),
          Date.now()
        ]
      );
    } catch (err) {
      console.error('Failed to record RETRY_SCHEDULED:', err);
    }
  }

  /**
   * Handle job completion (called by BullMQ)
   */
  private async handleJobCompleted(job: Job): Promise<void> {
    console.log(`✓ Job ${job.id} completed successfully`);
  }

  /**
   * Handle job failure (called by BullMQ)
   */
  private async handleJobFailed(job: Job, err: Error): Promise<void> {
    console.error(`✗ Job ${job.id} failed:`, err.message);
  }

  /**
   * Get consumer health metrics
   */
  async getConsumerMetrics(): Promise<{
    serviceName: string;
    isRunning: boolean;
    processedJobs: number;
    failedJobs: number;
    retryCount: number;
    avgProcessingTimeMs: number;
  }> {
    const isPaused = await this.worker.isPaused();
    return {
      serviceName: this.serviceName,
      isRunning: !isPaused,
      processedJobs: this.worker.childProcess?.exitCode === null ? 0 : 0, // Placeholder
      failedJobs: 0, // Placeholder
      retryCount: 0, // Placeholder
      avgProcessingTimeMs: 0 // Placeholder
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    await this.worker.close();
    // Clean old idempotency cache entries (older than 24 hours)
    const oneDay = 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [key, value] of this.idempotencyCache.entries()) {
      if (now - value.timestamp > oneDay) {
        this.idempotencyCache.delete(key);
      }
    }
  }
}

/**
 * Factory function to create consumer with defaults
 */
export async function createGovernanceQueueConsumer(
  queueName: string,
  redisConnection: { host: string; port: number },
  pool: Pool,
  serviceName: string
): Promise<GovernanceQueueConsumer> {
  return new GovernanceQueueConsumer(
    queueName,
    redisConnection,
    pool,
    serviceName
  );
}
