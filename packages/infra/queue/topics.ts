/**
 * EVENT BUS TOPICS
 * Central enum for all async job types
 * Single source of truth for event routing
 */

export enum Topics {
  // Core pipeline
  INGESTION_SCHEDULED = 'ingestion.scheduled',
  INGESTION_NORMALIZE = 'ingestion.normalize',

  SCORING_COMPUTE = 'scoring.compute',

  POLICY_VALIDATE = 'policy.validate',

  AGENT_REASONING = 'agent.reasoning',

  KPI_COMPUTE = 'kpi.compute',

  // Cross-cutting
  AUDIT_LOG = 'audit.log',
  WORKFLOW_APPROVE = 'workflow.approve',
  WORKFLOW_EXECUTE = 'workflow.execute',
}

/**
 * Job payload types (discriminated union)
 */
export type JobPayload =
  | { type: Topics.INGESTION_SCHEDULED; tenantId: string; snapshotDate: Date }
  | { type: Topics.INGESTION_NORMALIZE; snapshotId: string; tenantId: string; rawData: any }
  | { type: Topics.SCORING_COMPUTE; snapshotId: string; tenantId: string }
  | { type: Topics.POLICY_VALIDATE; snapshotId: string; tenantId: string; policyProfile: string }
  | { type: Topics.AGENT_REASONING; snapshotId: string; tenantId: string }
  | { type: Topics.KPI_COMPUTE; snapshotId: string; tenantId: string }
  | { type: Topics.AUDIT_LOG; snapshotId: string; tenantId: string; event: string; data: any }
  | { type: Topics.WORKFLOW_APPROVE; decisionId: string; tenantId: string; approver: string }
  | { type: Topics.WORKFLOW_EXECUTE; decisionId: string; tenantId: string };

/**
 * Job result for downstream consumption
 */
export interface JobResult {
  jobId: string;
  topic: Topics;
  tenantId: string;
  snapshotId?: string;
  status: 'success' | 'failed' | 'retry';
  data?: any;
  error?: string;
  duration: number;
  timestamp: Date;
}

/**
 * Get topic dependencies (for job chaining)
 */
export function getTopicDependencies(topic: Topics): Topics[] {
  const deps: Record<Topics, Topics[]> = {
    [Topics.INGESTION_SCHEDULED]: [],
    [Topics.INGESTION_NORMALIZE]: [Topics.INGESTION_SCHEDULED],
    [Topics.SCORING_COMPUTE]: [Topics.INGESTION_NORMALIZE],
    [Topics.POLICY_VALIDATE]: [Topics.SCORING_COMPUTE],
    [Topics.AGENT_REASONING]: [Topics.POLICY_VALIDATE],
    [Topics.KPI_COMPUTE]: [Topics.AGENT_REASONING],
    [Topics.AUDIT_LOG]: [],
    [Topics.WORKFLOW_APPROVE]: [],
    [Topics.WORKFLOW_EXECUTE]: [Topics.WORKFLOW_APPROVE],
  };
  return deps[topic] || [];
}

/**
 * Check if topic is critical (blocks pipeline)
 */
export function isTopicCritical(topic: Topics): boolean {
  const critical = [
    Topics.INGESTION_NORMALIZE,
    Topics.SCORING_COMPUTE,
    Topics.POLICY_VALIDATE,
  ];
  return critical.includes(topic);
}

/**
 * Get retry policy for topic
 */
export function getRetryPolicy(topic: Topics): {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier: number;
} {
  const critical: Record<Topics, { maxAttempts: number; delayMs: number; backoffMultiplier: number }> = {
    [Topics.INGESTION_SCHEDULED]: { maxAttempts: 3, delayMs: 5000, backoffMultiplier: 2 },
    [Topics.INGESTION_NORMALIZE]: { maxAttempts: 3, delayMs: 5000, backoffMultiplier: 2 },
    [Topics.SCORING_COMPUTE]: { maxAttempts: 2, delayMs: 3000, backoffMultiplier: 2 },
    [Topics.POLICY_VALIDATE]: { maxAttempts: 2, delayMs: 2000, backoffMultiplier: 1.5 },
    [Topics.AGENT_REASONING]: { maxAttempts: 3, delayMs: 10000, backoffMultiplier: 2 },
    [Topics.KPI_COMPUTE]: { maxAttempts: 2, delayMs: 2000, backoffMultiplier: 1.5 },
    [Topics.AUDIT_LOG]: { maxAttempts: 1, delayMs: 1000, backoffMultiplier: 1 },
    [Topics.WORKFLOW_APPROVE]: { maxAttempts: 1, delayMs: 1000, backoffMultiplier: 1 },
    [Topics.WORKFLOW_EXECUTE]: { maxAttempts: 3, delayMs: 5000, backoffMultiplier: 2 },
  };
  return critical[topic];
}
