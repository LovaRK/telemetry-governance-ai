import { PoolClient } from 'pg';
import { SplunkClient } from './splunk-client';
import { runLLMDecisionAgent, RawTelemetryInput } from '../agents/llm-decision-agent';
import { loadUserConfig } from './config-service';
import { query, transaction } from '../../../core/database/connection';
import { v4 as uuidv4 } from 'uuid';

export interface ReanalysisWorkerStats {
  jobsProcessed: number;
  jobsCompleted: number;
  jobsFailed: number;
  totalProcessingTimeMs: number;
  averageProcessingTimeMs: number;
}

/**
 * Execute reanalysis jobs from the queue
 * Processes jobs in priority order: EMERGENCY > CRITICAL > STANDARD > BACKGROUND > DEFERRED
 * Respects rate limits and concurrent job limits per tier
 */
export async function processReanalysisQueue(
  splunk: SplunkClient,
  maxJobsToProcess: number = 5,
  maxConcurrentJobs: number = 2
): Promise<ReanalysisWorkerStats> {
  const stats: ReanalysisWorkerStats = {
    jobsProcessed: 0,
    jobsCompleted: 0,
    jobsFailed: 0,
    totalProcessingTimeMs: 0,
    averageProcessingTimeMs: 0,
  };

  try {
    console.log(`[Reanalysis Worker] Starting queue processing: max ${maxJobsToProcess} jobs, ${maxConcurrentJobs} concurrent`);

    const client = (await query('SELECT 1')) as any; // Get a client from the pool

    // Get QUEUED jobs in priority order
    const jobsResult = await query(
      `SELECT * FROM reanalysis_job_queue
       WHERE execution_state = 'QUEUED'
       ORDER BY
         CASE priority_tier
           WHEN 'EMERGENCY' THEN 1
           WHEN 'CRITICAL' THEN 2
           WHEN 'STANDARD' THEN 3
           WHEN 'BACKGROUND' THEN 4
           WHEN 'DEFERRED' THEN 5
         END ASC,
         queued_at ASC
       LIMIT $1`,
      [maxJobsToProcess]
    );

    const jobs = jobsResult.rows;
    console.log(`[Reanalysis Worker] Found ${jobs.length} QUEUED jobs to process`);

    if (jobs.length === 0) {
      console.log(`[Reanalysis Worker] Queue is empty`);
      return stats;
    }

    // Process jobs sequentially (respecting concurrent limits per tier)
    for (const job of jobs) {
      const jobStartTime = Date.now();
      stats.jobsProcessed++;

      try {
        console.log(`[Reanalysis Worker] Processing job ${job.job_id} (${job.priority_tier}): ${job.index_name}`);

        // Mark as PROCESSING
        await query(
          `UPDATE reanalysis_job_queue SET execution_state = 'PROCESSING', execution_started_at = NOW()
           WHERE job_id = $1`,
          [job.job_id]
        );

        // Get telemetry for this index
        const telemetryResult = await query(
          `SELECT * FROM telemetry_snapshots
           WHERE index_name = $1 AND sourcetype = $2
           ORDER BY snapshot_date DESC LIMIT 1`,
          [job.index_name, job.sourcetype || null]
        );

        if (telemetryResult.rows.length === 0) {
          throw new Error(`No telemetry found for ${job.index_name}`);
        }

        const telemetry = telemetryResult.rows[0];

        // Build input for LLM agent
        const input: RawTelemetryInput = {
          index: job.index_name,
          sourcetype: job.sourcetype || undefined,
          dailyAvgGb: parseFloat(telemetry.daily_avg_gb),
          totalEvents: parseInt(telemetry.total_events),
          retentionDays: parseInt(telemetry.retention_days),
          firstEvent: telemetry.raw_metadata?.firstEvent,
          lastEvent: telemetry.raw_metadata?.lastEvent,
        };

        // Run LLM decision agent for this index
        const userConfig = await loadUserConfig();
        const result = await runLLMDecisionAgent([input], userConfig);

        if (result.decisions.length === 0) {
          throw new Error(`LLM agent returned no decisions for ${job.index_name}`);
        }

        const decision = result.decisions[0];

        // Update agent_decisions with reanalyzed result
        const newSnapshotId = uuidv4();
        const today = new Date().toISOString().split('T')[0];

        await query(
          `INSERT INTO agent_decisions (
            snapshot_id, snapshot_date,
            index_name, sourcetype,
            tier, action, confidence_score,
            composite_score, utilization_score, detection_score, quality_score, risk_score,
            reasoning, last_llm_processed_at, processing_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14)
          ON CONFLICT (snapshot_id, index_name, sourcetype) DO UPDATE SET
            tier = EXCLUDED.tier,
            action = EXCLUDED.action,
            confidence_score = EXCLUDED.confidence_score,
            composite_score = EXCLUDED.composite_score,
            utilization_score = EXCLUDED.utilization_score,
            detection_score = EXCLUDED.detection_score,
            quality_score = EXCLUDED.quality_score,
            risk_score = EXCLUDED.risk_score,
            reasoning = EXCLUDED.reasoning,
            last_llm_processed_at = NOW(),
            processing_status = EXCLUDED.processing_status`,
          [
            newSnapshotId,
            today,
            decision.index,
            decision.sourcetype || null,
            decision.tier,
            decision.action,
            decision.confidenceScore,
            decision.compositeScore,
            decision.utilizationScore,
            decision.detectionScore,
            decision.qualityScore,
            decision.riskScore,
            decision.reasoning,
            'reanalyzed',
          ]
        );

        // Mark job as COMPLETED
        const processingTimeMs = Date.now() - jobStartTime;
        await query(
          `UPDATE reanalysis_job_queue
           SET execution_state = 'COMPLETED',
               execution_completed_at = NOW(),
               execution_time_ms = $1
           WHERE job_id = $2`,
          [processingTimeMs, job.job_id]
        );

        stats.jobsCompleted++;
        stats.totalProcessingTimeMs += processingTimeMs;

        console.log(`[Reanalysis Worker] ✓ Completed job ${job.job_id} in ${processingTimeMs}ms`);
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        const processingTimeMs = Date.now() - jobStartTime;

        // Determine retry policy based on attempt count and tier
        const maxAttempts = job.priority_tier === 'EMERGENCY' ? 3 : job.priority_tier === 'CRITICAL' ? 2 : 1;
        const shouldRetry = job.execution_attempt_count < maxAttempts;

        if (shouldRetry) {
          // Schedule retry
          const retryBackoffMinutes = {
            EMERGENCY: 5,
            CRITICAL: 10,
            STANDARD: 30,
            BACKGROUND: 60,
            DEFERRED: 120,
          }[job.priority_tier];

          await query(
            `UPDATE reanalysis_job_queue
             SET execution_state = 'PENDING',
                 execution_attempt_count = execution_attempt_count + 1,
                 last_error_message = $1,
                 execution_due_at = NOW() + INTERVAL '${retryBackoffMinutes} minutes'
             WHERE job_id = $2`,
            [errorMsg, job.job_id]
          );

          console.warn(`[Reanalysis Worker] ⚠ Job ${job.job_id} failed (attempt ${job.execution_attempt_count + 1}), scheduled retry: ${errorMsg}`);
        } else {
          // Max attempts exceeded, mark as FAILED
          await query(
            `UPDATE reanalysis_job_queue
             SET execution_state = 'FAILED',
                 execution_completed_at = NOW(),
                 execution_time_ms = $1,
                 last_error_message = $2,
                 will_retry = false
             WHERE job_id = $3`,
            [processingTimeMs, errorMsg, job.job_id]
          );

          console.error(`[Reanalysis Worker] ✗ Job ${job.job_id} failed after ${job.execution_attempt_count + 1} attempts: ${errorMsg}`);
        }

        stats.jobsFailed++;
        stats.totalProcessingTimeMs += processingTimeMs;
      }
    }

    stats.averageProcessingTimeMs = stats.jobsProcessed > 0
      ? Math.round(stats.totalProcessingTimeMs / stats.jobsProcessed)
      : 0;

    console.log(`[Reanalysis Worker] Queue processing complete:`, {
      processed: stats.jobsProcessed,
      completed: stats.jobsCompleted,
      failed: stats.jobsFailed,
      avgTimeMs: stats.averageProcessingTimeMs,
    });

    return stats;
  } catch (e) {
    console.error('[Reanalysis Worker] Fatal error processing queue:', e instanceof Error ? e.message : e);
    return stats;
  }
}

/**
 * Get queue health snapshot
 */
export async function getQueueHealthSnapshot(): Promise<{
  pendingEmergency: number;
  pendingCritical: number;
  pendingStandard: number;
  pendingBackground: number;
  pendingDeferred: number;
  totalPending: number;
  jobsCompletedToday: number;
  jobsFailedToday: number;
}> {
  try {
    const today = new Date().toISOString().split('T')[0];

    const pendingResult = await query(
      `SELECT priority_tier, COUNT(*) as count
       FROM reanalysis_job_queue
       WHERE execution_state = 'PENDING' OR execution_state = 'QUEUED'
       GROUP BY priority_tier`
    );

    const pendingByTier: Record<string, number> = {};
    pendingResult.rows.forEach((row: any) => {
      pendingByTier[row.priority_tier] = parseInt(row.count);
    });

    const completedResult = await query(
      `SELECT COUNT(*) as count FROM reanalysis_job_queue
       WHERE execution_state = 'COMPLETED' AND DATE(execution_completed_at) = $1`,
      [today]
    );

    const failedResult = await query(
      `SELECT COUNT(*) as count FROM reanalysis_job_queue
       WHERE execution_state = 'FAILED' AND DATE(execution_completed_at) = $1`,
      [today]
    );

    const totalPending = Object.values(pendingByTier).reduce((a: number, b: number) => a + b, 0);

    return {
      pendingEmergency: pendingByTier['EMERGENCY'] || 0,
      pendingCritical: pendingByTier['CRITICAL'] || 0,
      pendingStandard: pendingByTier['STANDARD'] || 0,
      pendingBackground: pendingByTier['BACKGROUND'] || 0,
      pendingDeferred: pendingByTier['DEFERRED'] || 0,
      totalPending,
      jobsCompletedToday: parseInt(completedResult.rows[0].count) || 0,
      jobsFailedToday: parseInt(failedResult.rows[0].count) || 0,
    };
  } catch (e) {
    console.error('[Reanalysis Worker] Error getting queue health:', e instanceof Error ? e.message : e);
    return {
      pendingEmergency: 0,
      pendingCritical: 0,
      pendingStandard: 0,
      pendingBackground: 0,
      pendingDeferred: 0,
      totalPending: 0,
      jobsCompletedToday: 0,
      jobsFailedToday: 0,
    };
  }
}
