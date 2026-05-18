import { PoolClient } from 'pg';
import { getHardwareCapabilityService } from './hardware-capability-service';

export type GovernancePriorityTier = 'EMERGENCY' | 'CRITICAL' | 'STANDARD' | 'BACKGROUND' | 'DEFERRED';
export type ExecutionState = 'PENDING' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'DEFERRED';

export interface ReanalysisJob {
  jobId: string;
  indexName: string;
  sourcetype?: string;
  triggerSource: string;
  priorityTier: GovernancePriorityTier;
  executionState: ExecutionState;
  executionAttemptCount: number;
  queuedAt: Date;
  executionDueAt?: Date;
  estimatedInferenceCostMs?: number;
  lastErrorMessage?: string;
  willRetry: boolean;
  driftSeverity?: string;
  humanReviewRequired: boolean;
}

export interface ReanalysisBudget {
  budgetId: string;
  budgetDate: Date;
  totalIndexesInCorpus: number;
  budgetMaxReanalyses: number;
  reanalysesCompletedToday: number;
  budgetRemaining: number;
  emergencyJobsExecuted: number;
  criticalJobsExecuted: number;
  standardJobsExecuted: number;
  backgroundJobsDeferred: number;
  budgetExhaustedAt?: Date;
  budgetStatus: 'AVAILABLE' | 'WARNING' | 'EXHAUSTED';
}

export interface RateLimitConfig {
  tier: GovernancePriorityTier;
  maxJobsPerHour: number;
  maxConcurrentJobs: number;
  retryBackoffMinutes: number;
}

export interface QueueHealthSnapshot {
  snapshotId: string;
  snapshotDate: Date;
  pendingEmergency: number;
  pendingCritical: number;
  pendingStandard: number;
  pendingBackground: number;
  pendingDeferred: number;
  totalPending: number;
  jobsCompletedToday: number;
  avgProcessingTimeMs?: number;
  jobsFailedToday: number;
  queueBacklogHours?: number;
  queueHealthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL_BACKLOG';
  lastFullClear?: Date;
}

// Rate limit matrix
const RATE_LIMITS: Record<GovernancePriorityTier, RateLimitConfig> = {
  EMERGENCY: { tier: 'EMERGENCY', maxJobsPerHour: 999, maxConcurrentJobs: 10, retryBackoffMinutes: 5 },
  CRITICAL: { tier: 'CRITICAL', maxJobsPerHour: 30, maxConcurrentJobs: 5, retryBackoffMinutes: 10 },
  STANDARD: { tier: 'STANDARD', maxJobsPerHour: 10, maxConcurrentJobs: 2, retryBackoffMinutes: 30 },
  BACKGROUND: { tier: 'BACKGROUND', maxJobsPerHour: 3, maxConcurrentJobs: 1, retryBackoffMinutes: 60 },
  DEFERRED: { tier: 'DEFERRED', maxJobsPerHour: 1, maxConcurrentJobs: 1, retryBackoffMinutes: 120 },
};

// 5% corpus budget per day
const BUDGET_PERCENTAGE = 0.05;

/**
 * Enqueue a reanalysis job
 * Returns job if budget available, or DEFERRED if budget exhausted
 */
export async function enqueueReanalysisJob(
  client: PoolClient,
  indexName: string,
  triggerSource: string,
  priorityTier: GovernancePriorityTier,
  options?: {
    sourcetype?: string;
    estimatedInferenceCostMs?: number;
    driftSeverity?: string;
    humanReviewRequired?: boolean;
  }
): Promise<{ job: ReanalysisJob; budgetState: ReanalysisBudget; enqueued: boolean }> {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];

  // Get or create today's budget
  let budgetResult = await client.query(
    `SELECT * FROM reanalysis_budget_ledger WHERE budget_date = $1`,
    [dateStr]
  );

  let budget: ReanalysisBudget;
  if (budgetResult.rows.length === 0) {
    // Get total corpus size
    const corpusResult = await client.query(`SELECT COUNT(DISTINCT index_name) as total FROM agent_decisions`);
    const totalIndexes = corpusResult.rows[0].total;

    // Calculate baseline budget (5% of corpus)
    const baselineBudget = Math.ceil(totalIndexes * BUDGET_PERCENTAGE);

    // Get current queue depth for adaptive budgeting
    const queueDepthResult = await client.query(
      `SELECT COUNT(*) as pending FROM reanalysis_job_queue WHERE execution_state = 'PENDING'`
    );
    const currentQueueDepth = queueDepthResult.rows[0].pending;

    // Apply adaptive budgeting based on hardware capabilities
    const hwService = getHardwareCapabilityService();
    const adaptiveBudgetResult = await hwService.getAdaptiveBudget(
      baselineBudget,
      totalIndexes,
      currentQueueDepth
    );

    const budgetMax = adaptiveBudgetResult.effectiveBudget;

    // Create new budget entry with hardware-aware constraints
    const newBudgetResult = await client.query(
      `INSERT INTO reanalysis_budget_ledger (
        budget_date, total_indexes_in_corpus, budget_max_reanalyses,
        reanalyses_completed_today, budget_remaining, budget_status
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [today, totalIndexes, budgetMax, 0, budgetMax, 'AVAILABLE']
    );
    budget = parseBudget(newBudgetResult.rows[0]);
  } else {
    budget = parseBudget(budgetResult.rows[0]);
  }

  // Determine execution state based on budget
  let executionState: ExecutionState = 'PENDING';
  let executionDueAt: Date | undefined;

  if (priorityTier === 'EMERGENCY') {
    // Emergency jobs always execute immediately
    executionState = 'QUEUED';
    executionDueAt = new Date();
  } else if (budget.budgetStatus === 'EXHAUSTED') {
    // No budget: defer the job
    executionState = 'DEFERRED';
    executionDueAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
  } else if (budget.budgetRemaining <= 0) {
    // Out of budget for today
    executionState = 'DEFERRED';
    executionDueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  } else {
    executionState = 'PENDING';
    executionDueAt = calculateExecutionDueAt(priorityTier);
  }

  // Create job
  const jobResult = await client.query(
    `INSERT INTO reanalysis_job_queue (
      index_name, sourcetype, trigger_source, priority_tier,
      execution_state, execution_due_at, estimated_inference_cost_ms,
      drift_severity, human_review_required, will_retry
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      indexName,
      options?.sourcetype || null,
      triggerSource,
      priorityTier,
      executionState,
      executionDueAt,
      options?.estimatedInferenceCostMs || null,
      options?.driftSeverity || null,
      options?.humanReviewRequired || false,
      true,
    ]
  );

  const job = parseJob(jobResult.rows[0]);

  // Update budget if job will execute today
  if (executionState !== 'DEFERRED') {
    const newRemaining = Math.max(0, budget.budgetRemaining - 1);
    const newStatus = newRemaining === 0 ? 'EXHAUSTED' : budget.budgetStatus;

    const updatedBudgetResult = await client.query(
      `UPDATE reanalysis_budget_ledger SET
        budget_remaining = $1,
        budget_status = $2
      WHERE budget_date = $3
      RETURNING *`,
      [newRemaining, newStatus, dateStr]
    );
    budget = parseBudget(updatedBudgetResult.rows[0]);
  }

  return {
    job,
    budgetState: budget,
    enqueued: executionState !== 'DEFERRED',
  };
}

/**
 * Get next job to execute respecting rate limits
 */
export async function getNextJobToExecute(
  client: PoolClient
): Promise<ReanalysisJob | null> {
  const now = new Date();
  const tiers: GovernancePriorityTier[] = ['EMERGENCY', 'CRITICAL', 'STANDARD', 'BACKGROUND', 'DEFERRED'];

  for (const tier of tiers) {
    const config = RATE_LIMITS[tier];

    // Check how many are currently executing
    const executingResult = await client.query(
      `SELECT COUNT(*) as count FROM reanalysis_job_queue
       WHERE priority_tier = $1 AND execution_state = 'PROCESSING'`,
      [tier]
    );
    const executingCount = executingResult.rows[0].count;

    if (executingCount >= config.maxConcurrentJobs) {
      // Max concurrent reached for this tier, try next tier
      continue;
    }

    // Check jobs executed in last hour
    const hourAgoResult = await client.query(
      `SELECT COUNT(*) as count FROM reanalysis_job_queue
       WHERE priority_tier = $1 AND execution_state IN ('PROCESSING', 'COMPLETED')
       AND queued_at > NOW() - INTERVAL '1 hour'`,
      [tier]
    );
    const executedLastHour = hourAgoResult.rows[0].count;

    if (executedLastHour >= config.maxJobsPerHour) {
      // Rate limit reached for this tier
      continue;
    }

    // Get next pending job for this tier
    const jobResult = await client.query(
      `SELECT * FROM reanalysis_job_queue
       WHERE priority_tier = $1
       AND execution_state = 'PENDING'
       AND (execution_due_at IS NULL OR execution_due_at <= $2)
       ORDER BY queued_at ASC
       LIMIT 1`,
      [tier, now]
    );

    if (jobResult.rows.length > 0) {
      return parseJob(jobResult.rows[0]);
    }
  }

  return null;
}

/**
 * Mark job as processing
 */
export async function startJobExecution(
  client: PoolClient,
  jobId: string
): Promise<ReanalysisJob> {
  const result = await client.query(
    `UPDATE reanalysis_job_queue SET
      execution_state = 'PROCESSING',
      execution_attempt_count = execution_attempt_count + 1,
      last_attempt_at = NOW()
    WHERE job_id = $1
    RETURNING *`,
    [jobId]
  );

  return parseJob(result.rows[0]);
}

/**
 * Mark job as completed
 */
export async function completeJobExecution(
  client: PoolClient,
  jobId: string
): Promise<ReanalysisJob> {
  const result = await client.query(
    `UPDATE reanalysis_job_queue SET
      execution_state = 'COMPLETED'
    WHERE job_id = $1
    RETURNING *`,
    [jobId]
  );

  // Increment budget counter
  const today = new Date().toISOString().split('T')[0];
  await client.query(
    `UPDATE reanalysis_budget_ledger SET
      reanalyses_completed_today = reanalyses_completed_today + 1
    WHERE budget_date = $1`,
    [today]
  );

  return parseJob(result.rows[0]);
}

/**
 * Mark job as failed and schedule retry
 */
export async function failJobExecution(
  client: PoolClient,
  jobId: string,
  errorMessage: string
): Promise<ReanalysisJob> {
  const job = await getJob(client, jobId);

  // If exceeded max retries, mark as failed permanently
  const maxRetries = 3;
  if (job.executionAttemptCount >= maxRetries) {
    const result = await client.query(
      `UPDATE reanalysis_job_queue SET
        execution_state = 'FAILED',
        last_error_message = $1,
        will_retry = FALSE
      WHERE job_id = $2
      RETURNING *`,
      [errorMessage, jobId]
    );
    return parseJob(result.rows[0]);
  }

  // Schedule retry
  const config = RATE_LIMITS[job.priorityTier];
  const nextRetry = new Date(Date.now() + config.retryBackoffMinutes * 60 * 1000);

  const result = await client.query(
    `UPDATE reanalysis_job_queue SET
      execution_state = 'PENDING',
      execution_due_at = $1,
      last_error_message = $2,
      will_retry = TRUE
    WHERE job_id = $3
    RETURNING *`,
    [nextRetry, errorMessage, jobId]
  );

  return parseJob(result.rows[0]);
}

/**
 * Get a single job
 */
export async function getJob(client: PoolClient, jobId: string): Promise<ReanalysisJob> {
  const result = await client.query(`SELECT * FROM reanalysis_job_queue WHERE job_id = $1`, [jobId]);

  if (result.rows.length === 0) {
    throw new Error(`Job not found: ${jobId}`);
  }

  return parseJob(result.rows[0]);
}

/**
 * Get queue health snapshot
 */
export async function captureQueueHealthSnapshot(client: PoolClient): Promise<QueueHealthSnapshot> {
  const today = new Date();

  // Get queue depth by tier
  const depthResult = await client.query(
    `SELECT
      priority_tier,
      COUNT(*) as count
    FROM reanalysis_job_queue
    WHERE execution_state = 'PENDING'
    GROUP BY priority_tier`
  );

  const depthByTier: Record<GovernancePriorityTier, number> = {
    EMERGENCY: 0,
    CRITICAL: 0,
    STANDARD: 0,
    BACKGROUND: 0,
    DEFERRED: 0,
  };

  let totalPending = 0;
  depthResult.rows.forEach((row: any) => {
    depthByTier[row.priority_tier] = row.count;
    totalPending += row.count;
  });

  // Get job metrics
  const metricsResult = await client.query(
    `SELECT
      COUNT(CASE WHEN execution_state = 'COMPLETED' THEN 1 END) as completed,
      COUNT(CASE WHEN execution_state = 'FAILED' THEN 1 END) as failed,
      AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000)::int as avg_ms
    FROM reanalysis_job_queue
    WHERE created_at::date = $1`,
    [today]
  );

  const metrics = metricsResult.rows[0];

  // Determine health
  let healthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL_BACKLOG' = 'HEALTHY';
  if (totalPending > 100) {
    healthStatus = 'CRITICAL_BACKLOG';
  } else if (totalPending > 20) {
    healthStatus = 'DEGRADED';
  }

  const backlogHours = totalPending > 0 ? (totalPending / 10) : 0; // Assume 10 jobs per hour

  const snapshotResult = await client.query(
    `INSERT INTO queue_health_snapshot (
      snapshot_date,
      pending_emergency, pending_critical, pending_standard,
      pending_background, pending_deferred, total_pending,
      jobs_completed_today, avg_processing_time_ms, jobs_failed_today,
      queue_backlog_hours, queue_health_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *`,
    [
      today,
      depthByTier.EMERGENCY,
      depthByTier.CRITICAL,
      depthByTier.STANDARD,
      depthByTier.BACKGROUND,
      depthByTier.DEFERRED,
      totalPending,
      metrics.completed || 0,
      metrics.avg_ms,
      metrics.failed || 0,
      backlogHours,
      healthStatus,
    ]
  );

  return parseHealthSnapshot(snapshotResult.rows[0]);
}

/**
 * Calculate execution due time based on priority tier and rate limits
 */
function calculateExecutionDueAt(tier: GovernancePriorityTier): Date {
  const config = RATE_LIMITS[tier];
  const now = new Date();

  // Schedule based on max jobs per hour
  const intervalMinutes = 60 / config.maxJobsPerHour;
  const dueAt = new Date(now.getTime() + intervalMinutes * 60 * 1000);

  return dueAt;
}

/**
 * Parse database row into ReanalysisJob
 */
function parseJob(row: any): ReanalysisJob {
  return {
    jobId: row.job_id,
    indexName: row.index_name,
    sourcetype: row.sourcetype,
    triggerSource: row.trigger_source,
    priorityTier: row.priority_tier,
    executionState: row.execution_state,
    executionAttemptCount: row.execution_attempt_count,
    queuedAt: new Date(row.queued_at),
    executionDueAt: row.execution_due_at ? new Date(row.execution_due_at) : undefined,
    estimatedInferenceCostMs: row.estimated_inference_cost_ms,
    lastErrorMessage: row.last_error_message,
    willRetry: row.will_retry,
    driftSeverity: row.drift_severity,
    humanReviewRequired: row.human_review_required,
  };
}

/**
 * Parse database row into ReanalysisBudget
 */
function parseBudget(row: any): ReanalysisBudget {
  return {
    budgetId: row.budget_id,
    budgetDate: new Date(row.budget_date),
    totalIndexesInCorpus: row.total_indexes_in_corpus,
    budgetMaxReanalyses: row.budget_max_reanalyses,
    reanalysesCompletedToday: row.reanalyses_completed_today,
    budgetRemaining: row.budget_remaining,
    emergencyJobsExecuted: row.emergency_jobs_executed,
    criticalJobsExecuted: row.critical_jobs_executed,
    standardJobsExecuted: row.standard_jobs_executed,
    backgroundJobsDeferred: row.background_jobs_deferred,
    budgetExhaustedAt: row.budget_exhausted_at ? new Date(row.budget_exhausted_at) : undefined,
    budgetStatus: row.budget_status,
  };
}

/**
 * Parse database row into QueueHealthSnapshot
 */
function parseHealthSnapshot(row: any): QueueHealthSnapshot {
  return {
    snapshotId: row.snapshot_id,
    snapshotDate: new Date(row.snapshot_date),
    pendingEmergency: row.pending_emergency,
    pendingCritical: row.pending_critical,
    pendingStandard: row.pending_standard,
    pendingBackground: row.pending_background,
    pendingDeferred: row.pending_deferred,
    totalPending: row.total_pending,
    jobsCompletedToday: row.jobs_completed_today,
    avgProcessingTimeMs: row.avg_processing_time_ms,
    jobsFailedToday: row.jobs_failed_today,
    queueBacklogHours: row.queue_backlog_hours,
    queueHealthStatus: row.queue_health_status,
    lastFullClear: row.last_full_clear ? new Date(row.last_full_clear) : undefined,
  };
}
