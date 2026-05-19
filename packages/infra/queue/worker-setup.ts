/**
 * WORKER SETUP
 * Initialize and register all pipeline workers
 * Called once at application startup
 */

import { getEventBus } from './event-bus';
import { Topics } from './topics';
import {
  handleIngestionScheduled,
  handleIngestionNormalize,
  handleScoringCompute,
  handlePolicyValidate,
  handleAgentReasoning,
  handleKPICompute,
  handleAuditLog,
  handleWorkflowApprove,
  handleWorkflowExecute,
} from './job-consumer';

/**
 * Initialize all workers
 */
export async function initializeWorkers(): Promise<void> {
  console.log('[WorkerSetup] Initializing all workers...');

  const bus = getEventBus();

  // INGESTION → NORMALIZE
  bus.registerWorker(Topics.INGESTION_SCHEDULED, handleIngestionScheduled, {
    concurrency: 2, // Rate limit Splunk API
  });

  // NORMALIZE → SCORING
  bus.registerWorker(Topics.INGESTION_NORMALIZE, handleIngestionNormalize, {
    concurrency: 5,
  });

  // SCORING → POLICY
  bus.registerWorker(Topics.SCORING_COMPUTE, handleScoringCompute, {
    concurrency: 10,
  });

  // POLICY → AGENT
  bus.registerWorker(Topics.POLICY_VALIDATE, handlePolicyValidate, {
    concurrency: 10,
  });

  // AGENT → KPI
  bus.registerWorker(Topics.AGENT_REASONING, handleAgentReasoning, {
    concurrency: 5,
  });

  // KPI COMPUTE
  bus.registerWorker(Topics.KPI_COMPUTE, handleKPICompute, {
    concurrency: 5,
  });

  // AUDIT LOGGING (non-blocking)
  bus.registerWorker(Topics.AUDIT_LOG, handleAuditLog, {
    concurrency: 20,
  });

  // WORKFLOW (manual approval)
  bus.registerWorker(Topics.WORKFLOW_APPROVE, handleWorkflowApprove, {
    concurrency: 1,
  });

  // WORKFLOW (execution)
  bus.registerWorker(Topics.WORKFLOW_EXECUTE, handleWorkflowExecute, {
    concurrency: 2,
  });

  console.log('[WorkerSetup] ✅ All workers initialized');
}

/**
 * Setup job chaining (on-completion triggers next stage)
 */
export async function setupJobChaining(): Promise<void> {
  console.log('[WorkerSetup] Setting up job chaining...');

  const bus = getEventBus();

  // INGESTION_SCHEDULED → INGESTION_NORMALIZE
  // (handled in consumer: handleIngestionScheduled publishes next)

  // INGESTION_NORMALIZE → SCORING_COMPUTE
  // (handled in consumer: handleIngestionNormalize publishes next)

  // SCORING_COMPUTE → POLICY_VALIDATE
  // (handled in consumer: handleScoringCompute publishes next)

  // POLICY_VALIDATE → AGENT_REASONING
  // (handled in consumer: handlePolicyValidate publishes next)

  // AGENT_REASONING → KPI_COMPUTE
  // (handled in consumer: handleAgentReasoning publishes next)

  // Note: Each handler explicitly publishes the next job
  // This gives us full control over error handling and intermediate storage

  console.log('[WorkerSetup] ✅ Job chaining configured');
}

/**
 * Start worker monitoring
 */
export async function startWorkerMonitoring(): Promise<void> {
  console.log('[WorkerSetup] Starting worker monitoring...');

  const bus = getEventBus();

  // Periodically log queue stats
  setInterval(async () => {
    const stats = await bus.getQueueStats();
    console.log('[WorkerSetup] Queue stats:', stats);
  }, 60000); // Every minute

  console.log('[WorkerSetup] ✅ Worker monitoring started');
}

/**
 * Full startup sequence
 */
export async function startPipeline(redisUrl?: string): Promise<void> {
  console.log('[WorkerSetup] 🚀 Starting pipeline...');

  try {
    // Initialize bus
    getEventBus();

    // Initialize workers
    await initializeWorkers();

    // Setup chaining
    await setupJobChaining();

    // Start monitoring
    await startWorkerMonitoring();

    console.log('[WorkerSetup] ✅ Pipeline ready');
  } catch (err) {
    console.error('[WorkerSetup] ❌ Startup failed:', err);
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
export async function shutdownPipeline(): Promise<void> {
  console.log('[WorkerSetup] Shutting down pipeline...');

  const bus = getEventBus();
  await bus.shutdown();

  console.log('[WorkerSetup] ✅ Pipeline shutdown complete');
}

// Graceful shutdown on process signals
process.on('SIGINT', async () => {
  console.log('[WorkerSetup] Received SIGINT, shutting down...');
  await shutdownPipeline();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[WorkerSetup] Received SIGTERM, shutting down...');
  await shutdownPipeline();
  process.exit(0);
});
