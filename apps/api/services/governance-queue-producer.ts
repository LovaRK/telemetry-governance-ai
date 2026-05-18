/**
 * Governance Queue Producer
 *
 * Phase 2A: Queue Boundary - Producer Side
 *
 * Responsibility: Enqueue jobs with complete trace context preservation.
 * Emits QUEUE_ENQUEUED lifecycle event.
 * Handles idempotency at enqueue time.
 */

import { Queue, Job } from 'bullmq';
import { Pool } from 'pg';
import {
  createQueueEnvelope,
  GovernanceQueueJobEnvelope,
  QueueTraceContext
} from './governance-queue-context';

/**
 * Governance queue producer
 * Wraps BullMQ queue with trace context propagation
 */
export class GovernanceQueueProducer {
  private queue: Queue;
  private pool: Pool;
  private serviceName: string;

  constructor(queue: Queue, pool: Pool, serviceName: string) {
    this.queue = queue;
    this.pool = pool;
    this.serviceName = serviceName;
  }

  /**
   * Enqueue a job with full trace context
   *
   * Emits QUEUE_ENQUEUED lifecycle event
   * Creates envelope with idempotency key
   */
  async enqueueJob(
    jobName: string,
    jobPayload: Record<string, any>,
    traceContext: {
      traceId: string;
      spanId: string;
      correlationId: string;
      executionContext: 'PRODUCTION' | 'SANDBOX' | 'SIMULATION';
      executionClass: 'QUEUE_ASYNC' | 'DIRECT_MUTATION' | 'CACHE_INVALIDATING';
      topologyHash: string;
    },
    options?: {
      maxRetries?: number;
      retryBackoffMs?: number;
      deadlineMs?: number;
      priorityHint?: 'high' | 'normal' | 'low';
    }
  ): Promise<{
    jobId: string;
    envelope: GovernanceQueueJobEnvelope;
    enqueueSpanId: string;
  }> {
    const enqueuedAt = Date.now();

    // Create envelope with W3C trace context
    const envelope = createQueueEnvelope(jobPayload, traceContext, {
      producerServiceName: this.serviceName,
      maxRetries: options?.maxRetries,
      retryBackoffMs: options?.retryBackoffMs,
      deadlineMs: options?.deadlineMs
    });

    // Extract enqueue span ID from envelope
    const enqueueSpanId = envelope.trace.traceparent.split('-')[2];

    // Submit to BullMQ with idempotency key
    // BullMQ will prevent duplicate processing on redelivery
    const job = await this.queue.add(jobName, envelope, {
      jobId: envelope.executionId, // Use deterministic ID for idempotency
      attempts: 1, // BullMQ retries; we handle them in consumer with trace context
      backoff: {
        type: 'exponential',
        delay: options?.retryBackoffMs || 1000
      },
      removeOnComplete: {
        age: 3600 // Keep successful jobs for 1 hour
      },
      removeOnFail: {
        age: 86400 // Keep failed jobs for 24 hours
      }
    });

    // Record QUEUE_ENQUEUED lifecycle event
    await this.recordQueueEnqueuedEvent(
      envelope,
      enqueueSpanId,
      enqueuedAt,
      job.id
    );

    return {
      jobId: job.id!,
      envelope,
      enqueueSpanId
    };
  }

  /**
   * Record QUEUE_ENQUEUED lifecycle event
   *
   * Critical for trace continuity verification
   */
  private async recordQueueEnqueuedEvent(
    envelope: GovernanceQueueJobEnvelope,
    spanId: string,
    enqueuedAt: number,
    jobId: string | undefined
  ): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO mutation_lifecycle_events
         (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
          status, duration_in_state_ms, execution_context, metadata, recorded_at)
         VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10 / 1000.0))`,
        [
          envelope.trace.traceparent.split('-')[1], // Extract trace ID
          spanId,
          envelope.trace.originalSpanId, // Link to original mutation
          envelope.trace.correlationId,
          'QUEUE_ENQUEUED',
          'success',
          0, // Duration in this state
          envelope.trace.executionContext,
          JSON.stringify({
            executionClass: envelope.trace.executionClass,
            jobId,
            queueName: this.queue.name,
            producerService: this.serviceName,
            idempotencyKey: envelope.trace.idempotencyKey,
            maxRetries: envelope.maxRetries,
            deadline: envelope.trace.deadlineAt
          }),
          enqueuedAt
        ]
      );
    } catch (err) {
      console.error('Failed to record QUEUE_ENQUEUED event:', err);
      // Non-blocking: lifecycle recording failure doesn't fail job submission
    }
  }

  /**
   * Check job status by trace ID
   * Useful for monitoring job progression
   */
  async getJobsByTraceId(traceId: string): Promise<Job[]> {
    const jobs = await this.queue.getJobs(['active', 'waiting', 'completed', 'failed']);
    return jobs.filter(job => {
      const envelope = job.data as GovernanceQueueJobEnvelope;
      return envelope.trace?.traceparent?.includes(traceId);
    });
  }

  /**
   * Bulk enqueue with trace correlation
   * Useful for batch operations
   */
  async enqueueBatch(
    jobs: Array<{
      name: string;
      payload: Record<string, any>;
      traceContext: {
        traceId: string;
        spanId: string;
        correlationId: string;
        executionContext: 'PRODUCTION' | 'SANDBOX' | 'SIMULATION';
        executionClass: 'QUEUE_ASYNC' | 'DIRECT_MUTATION' | 'CACHE_INVALIDATING';
        topologyHash: string;
      };
    }>,
    options?: {
      maxRetries?: number;
      retryBackoffMs?: number;
      deadlineMs?: number;
    }
  ): Promise<Array<{ jobId: string; traceId: string }>> {
    const results: Array<{ jobId: string; traceId: string }> = [];

    for (const job of jobs) {
      try {
        const result = await this.enqueueJob(
          job.name,
          job.payload,
          job.traceContext,
          options
        );

        results.push({
          jobId: result.jobId,
          traceId: job.traceContext.traceId
        });
      } catch (err) {
        console.error(`Failed to enqueue job for trace ${job.traceContext.traceId}:`, err);
        // Continue with remaining jobs
      }
    }

    return results;
  }

  /**
   * Get producer health metrics
   */
  async getProducerMetrics(): Promise<{
    queueName: string;
    serviceName: string;
    waitingJobs: number;
    activeJobs: number;
    completedJobs: number;
    failedJobs: number;
    avgJobSize: number;
  }> {
    const counts = await this.queue.getJobCounts('wait', 'active', 'completed', 'failed');

    // Sample jobs to calculate average size
    const sampleSize = Math.min(10, counts.active + counts.wait);
    const sampleJobs = await this.queue.getJobs(
      ['active', 'waiting'],
      0,
      sampleSize
    );

    const totalSize = sampleJobs.reduce(
      (sum, job) => sum + JSON.stringify(job.data).length,
      0
    );
    const avgJobSize = sampleJobs.length > 0 ? totalSize / sampleJobs.length : 0;

    return {
      queueName: this.queue.name,
      serviceName: this.serviceName,
      waitingJobs: counts.wait || 0,
      activeJobs: counts.active || 0,
      completedJobs: counts.completed || 0,
      failedJobs: counts.failed || 0,
      avgJobSize: Math.round(avgJobSize)
    };
  }
}

/**
 * Factory function to create producer with defaults
 */
export async function createGovernanceQueueProducer(
  queueName: string,
  redisConnection: { host: string; port: number },
  pool: Pool,
  serviceName: string
): Promise<GovernanceQueueProducer> {
  const queue = new Queue(queueName, {
    connection: redisConnection,
    settings: {
      // Acknowledge jobs only after completion (prevent loss)
      lockDuration: 30000,
      lockRenewTime: 5000,
      maxStalledCount: 2,
      stalledInterval: 5000,
      retryProcessDelay: 5000
    }
  });

  return new GovernanceQueueProducer(queue, pool, serviceName);
}
