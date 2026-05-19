/**
 * EVENT BUS
 * Redis/BullMQ-backed async job queue
 * Single point for publishing and monitoring all pipeline events
 */

import { Queue, Worker, QueueScheduler } from 'bullmq';
import Redis from 'ioredis';
import { Topics, JobPayload, JobResult, getRetryPolicy, isTopicCritical } from './topics';

/**
 * Event bus singleton
 */
export class EventBus {
  private redis: Redis;
  private queues: Map<Topics, Queue>;
  private workers: Map<Topics, Worker> = new Map();

  private constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
    this.queues = new Map();

    // Initialize queue for each topic
    for (const topic of Object.values(Topics)) {
      this.queues.set(
        topic,
        new Queue(topic, {
          connection: this.redis,
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: false,
          },
        })
      );
    }

    console.log(`[EventBus] Initialized with ${this.queues.size} topics`);
  }

  static instance: EventBus;

  /**
   * Initialize singleton
   */
  static initialize(redisUrl: string = 'redis://127.0.0.1:6379'): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus(redisUrl);
    }
    return EventBus.instance;
  }

  /**
   * Publish event to bus
   */
  async publish<T extends Topics>(topic: T, payload: Extract<JobPayload, { type: T }>): Promise<string> {
    const queue = this.queues.get(topic);
    if (!queue) {
      throw new Error(`Unknown topic: ${topic}`);
    }

    const jobId = await this.generateJobId(topic, (payload as any).snapshotId || (payload as any).tenantId);
    const retryPolicy = getRetryPolicy(topic);

    const job = await queue.add(topic, payload, {
      jobId,
      attempts: retryPolicy.maxAttempts,
      backoff: {
        type: 'exponential',
        delay: retryPolicy.delayMs,
      },
      priority: isTopicCritical(topic) ? 10 : 5,
    });

    console.log(`[EventBus] Published: ${topic} (jobId: ${jobId})`);
    return jobId;
  }

  /**
   * Register worker for topic
   */
  registerWorker(
    topic: Topics,
    handler: (payload: JobPayload) => Promise<any>,
    options?: { concurrency?: number; lockDuration?: number }
  ): Worker {
    const queue = this.queues.get(topic);
    if (!queue) {
      throw new Error(`Unknown topic: ${topic}`);
    }

    const worker = new Worker(topic, handler, {
      connection: this.redis,
      concurrency: options?.concurrency || 5,
      lockDuration: options?.lockDuration || 30000,
    });

    worker.on('completed', (job) => {
      console.log(`[EventBus] ✅ Completed: ${topic} (jobId: ${job.id})`);
    });

    worker.on('failed', (job, err) => {
      console.error(`[EventBus] ❌ Failed: ${topic} (jobId: ${job?.id}):`, err.message);
    });

    worker.on('error', (err) => {
      console.error(`[EventBus] 🔥 Worker error for ${topic}:`, err.message);
    });

    this.workers.set(topic, worker);
    console.log(`[EventBus] Worker registered: ${topic}`);

    return worker;
  }

  /**
   * Chain jobs: job1 completes → triggers job2
   * Critical for ensuring pipeline order
   */
  async chainJob(
    parentTopic: Topics,
    childTopic: Topics,
    payloadBuilder: (parentResult: any) => Extract<JobPayload, { type: typeof childTopic }>
  ): Promise<void> {
    const queue = this.queues.get(parentTopic);
    if (!queue) {
      throw new Error(`Unknown topic: ${parentTopic}`);
    }

    // On completion, publish child job
    queue.on('completed', async (job) => {
      try {
        const childPayload = payloadBuilder(job.data);
        await this.publish(childTopic, childPayload as any);
      } catch (err) {
        console.error(`[EventBus] Chain failed ${parentTopic} → ${childTopic}:`, err);
      }
    });

    console.log(`[EventBus] Chained: ${parentTopic} → ${childTopic}`);
  }

  /**
   * Get job status
   */
  async getJobStatus(topic: Topics, jobId: string): Promise<any> {
    const queue = this.queues.get(topic);
    if (!queue) return null;

    const job = await queue.getJob(jobId);
    if (!job) return null;

    return {
      id: job.id,
      topic,
      state: await job.getState(),
      progress: job.progress(),
      attempts: job.attempts,
      failedReason: job.failedReason,
    };
  }

  /**
   * Get queue stats
   */
  async getQueueStats(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};

    for (const [topic, queue] of this.queues) {
      const counts = await queue.getJobCounts();
      stats[topic] = counts;
    }

    return stats;
  }

  /**
   * Clear failed jobs (DLQ management)
   */
  async clearFailedJobs(topic: Topics): Promise<number> {
    const queue = this.queues.get(topic);
    if (!queue) return 0;

    const failed = await queue.getFailed();
    for (const job of failed) {
      await job.remove();
    }

    console.log(`[EventBus] Cleared ${failed.length} failed jobs from ${topic}`);
    return failed.length;
  }

  /**
   * Shutdown gracefully
   */
  async shutdown(): Promise<void> {
    console.log('[EventBus] Shutting down...');

    for (const worker of this.workers.values()) {
      await worker.close();
    }

    for (const queue of this.queues.values()) {
      await queue.close();
    }

    await this.redis.quit();
    console.log('[EventBus] ✅ Shut down complete');
  }

  /**
   * Generate idempotent job ID (prevents duplicates)
   */
  private async generateJobId(topic: Topics, key: string): Promise<string> {
    const timestamp = Date.now();
    const hash = Buffer.from(`${topic}:${key}:${timestamp}`).toString('base64').slice(0, 8);
    return `${topic}:${hash}:${timestamp}`;
  }
}

/**
 * Export initialized bus
 */
export function getEventBus(): EventBus {
  return EventBus.instance || EventBus.initialize();
}
