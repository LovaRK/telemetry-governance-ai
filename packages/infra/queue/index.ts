/**
 * EVENT BUS & WORKER QUEUE
 * Async, fault-tolerant pipeline using Redis/BullMQ
 * Enables horizontal scaling and audit lineage
 */

// Core event bus
export { EventBus, getEventBus } from './event-bus';

// Job topics and types
export { Topics, type JobPayload, type JobResult, getTopicDependencies, isTopicCritical, getRetryPolicy } from './topics';

// Job producer (publish events)
export { JobProducer, getJobProducer } from './job-producer';

// Job consumer (handle events)
export {
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

// Worker setup and lifecycle
export { initializeWorkers, setupJobChaining, startWorkerMonitoring, startPipeline, shutdownPipeline } from './worker-setup';
