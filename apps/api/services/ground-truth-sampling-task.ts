import { PoolClient } from 'pg';
import { SplunkClient } from './splunk-client';
import { getRiskWeightedSamplingService } from './risk-weighted-sampling-service';
import { query, transaction } from '../../../core/database/connection';
import { v4 as uuidv4 } from 'uuid';

export interface GroundTruthSamplingResult {
  samplingRunId: string;
  samplingDate: Date;
  candidatesEvaluated: number;
  samplesSelected: number;
  totalRiskCovered: number;
  jobsEnqueued: number;
  explanation: string;
}

/**
 * Ground truth sampling task
 * Runs on a schedule (weekly recommended) to select high-risk decisions for human audit
 * Targets "stable hallucinations": high-confidence, deeply-reused, high-impact decisions
 * that are most likely to contain undetected drift
 */
export async function executeGroundTruthSamplingTask(
  splunk: SplunkClient,
  samplesPerRun: number = 10,
  minEffectiveConfidence: number = 0.7
): Promise<GroundTruthSamplingResult> {
  const samplingRunId = uuidv4();
  const samplingDate = new Date();

  console.log(`[Ground Truth Sampling] Starting sampling run ${samplingRunId}...`);

  try {
    const result = await transaction(async (client) => {
      const riskSamplingService = getRiskWeightedSamplingService();

      // Step 1: Identify high-risk candidates
      console.log(`[Ground Truth Sampling] Identifying sampling candidates (minConfidence=${minEffectiveConfidence})...`);
      const candidates = await riskSamplingService.selectSamplingCandidates(
        client,
        50, // max candidates to consider
        minEffectiveConfidence
      );

      console.log(`[Ground Truth Sampling] Identified ${candidates.length} candidates for potential sampling`);

      if (candidates.length === 0) {
        console.log(`[Ground Truth Sampling] No high-risk candidates found - sampling skipped`);
        return {
          samplingRunId,
          samplingDate,
          candidatesEvaluated: 0,
          samplesSelected: 0,
          totalRiskCovered: 0,
          jobsEnqueued: 0,
          explanation: 'No high-risk candidates identified for sampling',
        };
      }

      // Step 2: Select audit batch using risk-weighted probability
      console.log(`[Ground Truth Sampling] Selecting ${samplesPerRun} samples from candidates...`);
      const auditBatch = riskSamplingService.selectAuditBatch(candidates, samplesPerRun);

      console.log(`[Ground Truth Sampling] Selected ${auditBatch.samplingSize} indexes for human audit`);
      console.log(`[Ground Truth Sampling] Total risk covered: ${auditBatch.totalRiskCovered}`);

      // Step 3: Record sampling run
      await client.query(
        `INSERT INTO ground_truth_sampling_runs (
          sampling_run_id, sampling_date,
          candidates_evaluated, samples_selected,
          total_risk_covered, explanation
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          samplingRunId,
          samplingDate,
          candidates.length,
          auditBatch.samplingSize,
          auditBatch.totalRiskCovered,
          auditBatch.explanation,
        ]
      );

      // Step 4: Record individual samples
      for (const sample of auditBatch.candidates) {
        await client.query(
          `INSERT INTO ground_truth_samples (
            sampling_run_id, index_name,
            effective_confidence, reuse_depth, financial_impact_usd,
            policy_weight, sampling_probability, risk_score,
            human_review_status, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
          [
            samplingRunId,
            sample.indexName,
            sample.effectiveConfidence,
            sample.reuseDepth,
            sample.financialImpactUsd,
            sample.policyWeight,
            sample.samplingProbability,
            sample.riskScore,
            'PENDING_REVIEW',
          ]
        );
      }

      // Step 5: Enqueue sampling jobs
      console.log(`[Ground Truth Sampling] Enqueueing ${auditBatch.samplingSize} sampling jobs for reanalysis...`);
      const jobsEnqueued = await riskSamplingService.enqueueSamplingBatch(
        client,
        auditBatch,
        samplingRunId
      );

      console.log(`[Ground Truth Sampling] Enqueued ${jobsEnqueued} sampling jobs`);

      return {
        samplingRunId,
        samplingDate,
        candidatesEvaluated: candidates.length,
        samplesSelected: auditBatch.samplingSize,
        totalRiskCovered: auditBatch.totalRiskCovered,
        jobsEnqueued,
        explanation: auditBatch.explanation,
      };
    });

    console.log(`[Ground Truth Sampling] ✓ Sampling run complete: ${result.samplesSelected}/${result.candidatesEvaluated} selected, ${result.jobsEnqueued} jobs enqueued`);
    return result;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error(`[Ground Truth Sampling] ✗ Sampling run failed: ${errorMsg}`);

    // Record failed sampling run
    try {
      await query(
        `INSERT INTO ground_truth_sampling_runs (
          sampling_run_id, sampling_date,
          candidates_evaluated, samples_selected,
          total_risk_covered, explanation, execution_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          samplingRunId,
          samplingDate,
          0,
          0,
          0,
          `Sampling run failed: ${errorMsg}`,
          'FAILED',
        ]
      );
    } catch (recordError) {
      console.error('[Ground Truth Sampling] Failed to record sampling error:', recordError);
    }

    throw e;
  }
}

/**
 * Get sampling statistics for a time period
 */
export async function getSamplingStatistics(
  days: number = 30
): Promise<{
  totalSamplingRuns: number;
  totalSamplesCollected: number;
  averageSamplesPerRun: number;
  totalRiskAudited: number;
  humanReviewsCompleted: number;
  averageEffectiveConfidence: number;
  mostSampledIndexes: Array<{ indexName: string; sampleCount: number }>;
}> {
  try {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const runsResult = await query(
      `SELECT COUNT(*) as total, SUM(samples_selected) as total_samples, AVG(samples_selected) as avg_samples,
              SUM(total_risk_covered) as total_risk
       FROM ground_truth_sampling_runs
       WHERE sampling_date >= $1`,
      [cutoffDate]
    );

    const reviewsResult = await query(
      `SELECT COUNT(*) as completed FROM ground_truth_samples
       WHERE human_review_status = 'REVIEW_COMPLETE' AND created_at >= $1`,
      [cutoffDate]
    );

    const confidenceResult = await query(
      `SELECT AVG(effective_confidence) as avg_confidence FROM ground_truth_samples
       WHERE created_at >= $1`,
      [cutoffDate]
    );

    const topIndexesResult = await query(
      `SELECT index_name, COUNT(*) as sample_count
       FROM ground_truth_samples
       WHERE created_at >= $1
       GROUP BY index_name
       ORDER BY sample_count DESC
       LIMIT 10`,
      [cutoffDate]
    );

    const runsData = runsResult.rows[0];
    const reviewsData = reviewsResult.rows[0];
    const confidenceData = confidenceResult.rows[0];

    return {
      totalSamplingRuns: parseInt(runsData.total) || 0,
      totalSamplesCollected: parseInt(runsData.total_samples) || 0,
      averageSamplesPerRun: parseFloat(runsData.avg_samples) || 0,
      totalRiskAudited: parseFloat(runsData.total_risk) || 0,
      humanReviewsCompleted: parseInt(reviewsData.completed) || 0,
      averageEffectiveConfidence: parseFloat(confidenceData.avg_confidence) || 0,
      mostSampledIndexes: topIndexesResult.rows.map((row: any) => ({
        indexName: row.index_name,
        sampleCount: parseInt(row.sample_count),
      })),
    };
  } catch (e) {
    console.error('[Ground Truth Sampling] Error getting statistics:', e instanceof Error ? e.message : e);
    return {
      totalSamplingRuns: 0,
      totalSamplesCollected: 0,
      averageSamplesPerRun: 0,
      totalRiskAudited: 0,
      humanReviewsCompleted: 0,
      averageEffectiveConfidence: 0,
      mostSampledIndexes: [],
    };
  }
}

/**
 * Record human review outcome for a sample
 */
export async function recordSampleReviewOutcome(
  samplingRunId: string,
  indexName: string,
  reviewStatus: 'APPROVED' | 'NEEDS_REANALYSIS' | 'DRIFT_DETECTED' | 'DISCARDED',
  reviewerComments?: string
): Promise<void> {
  try {
    await query(
      `UPDATE ground_truth_samples
       SET human_review_status = $1,
           human_review_outcome = $2,
           human_review_comments = $3,
           human_review_completed_at = NOW()
       WHERE sampling_run_id = $4 AND index_name = $5`,
      [reviewStatus, reviewStatus === 'APPROVED' ? 'APPROVED' : 'FLAGGED', reviewerComments || null, samplingRunId, indexName]
    );

    console.log(`[Ground Truth Sampling] Recorded review outcome for ${indexName}: ${reviewStatus}`);
  } catch (e) {
    console.error(`[Ground Truth Sampling] Error recording review outcome:`, e instanceof Error ? e.message : e);
    throw e;
  }
}
