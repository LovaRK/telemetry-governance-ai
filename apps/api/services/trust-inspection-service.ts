import { PoolClient } from 'pg';
import { query } from '../../../core/database/connection';

export interface GovernanceState {
  internal_workflow: 'PROPOSED' | 'APPROVED' | 'CONDITIONAL' | 'REJECTED' | 'UNDER_INVESTIGATION' | 'QUARANTINED' | 'ESCALATED';
  ui_trust_level: 'Trusted' | 'Caution' | 'Unverified' | 'Invalid' | 'Risky' | 'Frozen';
  last_reviewed_by: string | null;
  last_reviewed_at: string | null;
  expires_at: string | null;
  is_stale: boolean;
}

export interface DriftTelemetry {
  status: 'STABLE' | 'NOISE' | 'METRIC_DRIFT' | 'SEMANTIC_DRIFT' | 'POLICY_DRIFT';
  severity_score: number;
  human_readable_reason: string;
  evaluated_at: string;
}

export interface ConfidenceDecomposition {
  base_confidence: number;
  stability_factor: number;
  drift_penalty: number;
  temporal_decay_factor: number;
  oscillation_multiplier: number;
  final_effective_confidence: number;
}

export interface ReanalysisMetadata {
  is_queued: boolean;
  trigger_source: string | null;
  priority_tier: string | null;
  scheduled_at: string | null;
  estimated_completion_seconds: number | null;
}

export interface SamplingAudit {
  was_sample_selected: boolean;
  sampling_method: string | null;
  trigger_metrics: {
    financial_weight: number;
    cache_reuse_depth: number;
    policy_sensitivity_multiplier: number;
  };
}

export interface TrustInspectionPayload {
  index_name: string;
  governance_state: GovernanceState;
  drift_telemetry: DriftTelemetry;
  confidence_decomposition: ConfidenceDecomposition;
  reanalysis_metadata: ReanalysisMetadata;
  sampling_audit: SamplingAudit;
}

const WORKFLOW_STATE_TO_TRUST_LEVEL: Record<string, string> = {
  'APPROVED': 'Trusted',
  'CONDITIONAL': 'Caution',
  'PROPOSED': 'Unverified',
  'REJECTED': 'Invalid',
  'QUARANTINED': 'Risky',
  'UNDER_INVESTIGATION': 'Frozen',
  'ESCALATED': 'Frozen',
};

export async function getTrustInspectionPayload(
  indexName: string
): Promise<TrustInspectionPayload> {
  // Get latest decision for this index
  const decisionResult = await query(
    `SELECT
      ad.index_name,
      ad.confidence_score,
      ad.drift_detected,
      ad.drift_severity,
      ad.drift_confidence_adjusted,
      ds.consistency_ratio,
      ds.avg_confidence,
      ds.decision_flip_rate,
      ds.historical_drift_count,
      ds.recovery_cooldown_until,
      ds.oscillation_multiplier,
      hrl.review_status,
      hrl.calibration_vector,
      hrl.reviewed_by_user_id,
      hrl.reviewed_at,
      hrl.expires_at,
      cd.created_at as decay_calculated_at,
      cd.decay_factor
    FROM agent_decisions ad
    LEFT JOIN decision_stability_runs ds ON ad.index_name = ds.index_name
    LEFT JOIN human_review_ledger hrl ON ad.index_name = hrl.index_name
    LEFT JOIN confidence_decay_log cd ON ad.index_name = cd.index_name
    WHERE ad.index_name = $1
    ORDER BY ad.snapshot_date DESC
    LIMIT 1`,
    [indexName]
  );

  if (decisionResult.rows.length === 0) {
    throw new Error(`No decision found for index: ${indexName}`);
  }

  const decision = decisionResult.rows[0];

  // Get reanalysis queue status
  const queueResult = await query(
    `SELECT
      job_id,
      priority_tier,
      execution_state,
      queued_at,
      execution_due_at,
      reason_for_reanalysis
    FROM reanalysis_job_queue
    WHERE index_name = $1 AND execution_state IN ('QUEUED', 'PENDING', 'PROCESSING')
    ORDER BY queued_at DESC
    LIMIT 1`,
    [indexName]
  );

  // Get drift history
  const driftResult = await query(
    `SELECT
      drift_severity,
      drift_confidence_penalty,
      evaluated_at,
      drift_reason
    FROM decision_drift_history
    WHERE index_name = $1
    ORDER BY evaluated_at DESC
    LIMIT 1`,
    [indexName]
  );

  // Get sampling audit
  const samplingResult = await query(
    `SELECT
      gs.sample_id,
      gs.effective_confidence,
      gs.reuse_depth,
      gs.financial_impact_usd,
      gs.policy_weight,
      gs.sampling_probability,
      gsr.sampling_date
    FROM ground_truth_samples gs
    JOIN ground_truth_sampling_runs gsr ON gs.sampling_run_id = gsr.sampling_run_id
    WHERE gs.index_name = $1
    ORDER BY gsr.sampling_date DESC
    LIMIT 1`,
    [indexName]
  );

  // Build governance state
  const reviewStatus = decision.review_status || 'PROPOSED';
  const uiTrustLevel = WORKFLOW_STATE_TO_TRUST_LEVEL[reviewStatus] || 'Unverified';
  const isStale = decision.expires_at && new Date(decision.expires_at) < new Date();

  const governanceState: GovernanceState = {
    internal_workflow: reviewStatus,
    ui_trust_level: uiTrustLevel as any,
    last_reviewed_by: decision.reviewed_by_user_id || null,
    last_reviewed_at: decision.reviewed_at || null,
    expires_at: decision.expires_at || null,
    is_stale: isStale || false,
  };

  // Build drift telemetry
  let driftStatus = 'STABLE';
  let driftSeverityScore = 0;
  let driftReason = 'No drift detected.';

  if (driftResult.rows.length > 0) {
    const driftEvent = driftResult.rows[0];
    const severityMap: Record<string, string> = {
      'NONE': 'STABLE',
      'NOISE': 'NOISE',
      'METRIC': 'METRIC_DRIFT',
      'SEMANTIC': 'SEMANTIC_DRIFT',
      'POLICY': 'POLICY_DRIFT',
    };
    driftStatus = severityMap[driftEvent.drift_severity] || 'STABLE';
    driftSeverityScore = driftEvent.drift_confidence_penalty || 0;
    driftReason = driftEvent.drift_reason || 'Drift detected but reason not recorded.';
  }

  const driftTelemetry: DriftTelemetry = {
    status: driftStatus as any,
    severity_score: driftSeverityScore,
    human_readable_reason: driftReason,
    evaluated_at: driftResult.rows.length > 0 ? driftResult.rows[0].evaluated_at : new Date().toISOString(),
  };

  // Build confidence decomposition
  const baseConfidence = decision.confidence_score || 0.5;
  const stabilityFactor = decision.consistency_ratio || 0.7;
  const driftPenalty = decision.drift_confidence_adjusted ? 1.0 - decision.drift_confidence_adjusted : 1.0;
  const temporalDecayFactor = decision.decay_factor || 1.0;
  const oscillationMultiplier = decision.oscillation_multiplier || 1.0;
  const finalConfidence = baseConfidence * stabilityFactor * driftPenalty * temporalDecayFactor * oscillationMultiplier;

  const confidenceDecomposition: ConfidenceDecomposition = {
    base_confidence: baseConfidence,
    stability_factor: stabilityFactor,
    drift_penalty: driftPenalty,
    temporal_decay_factor: temporalDecayFactor,
    oscillation_multiplier: oscillationMultiplier,
    final_effective_confidence: Math.max(0, Math.min(1, finalConfidence)),
  };

  // Build reanalysis metadata
  let isQueued = false;
  let triggerSource = null;
  let priorityTier = null;
  let scheduledAt = null;
  let estimatedCompletionSeconds = null;

  if (queueResult.rows.length > 0) {
    const job = queueResult.rows[0];
    isQueued = ['QUEUED', 'PENDING', 'PROCESSING'].includes(job.execution_state);
    triggerSource = job.reason_for_reanalysis || 'UNKNOWN';
    priorityTier = job.priority_tier || 'STANDARD';
    scheduledAt = job.execution_due_at || job.queued_at;

    // Estimate completion: assuming 4 minutes per CRITICAL, 8 minutes per STANDARD, etc.
    if (isQueued) {
      const tierToMinutes: Record<string, number> = {
        'EMERGENCY': 2,
        'CRITICAL': 4,
        'STANDARD': 8,
        'BACKGROUND': 15,
        'DEFERRED': 30,
      };
      estimatedCompletionSeconds = (tierToMinutes[priorityTier] || 8) * 60;
    }
  }

  const reanalysisMetadata: ReanalysisMetadata = {
    is_queued: isQueued,
    trigger_source: triggerSource,
    priority_tier: priorityTier,
    scheduled_at: scheduledAt,
    estimated_completion_seconds: estimatedCompletionSeconds,
  };

  // Build sampling audit
  let wasSampled = false;
  let samplingMethod = null;
  let triggerMetrics = {
    financial_weight: 0,
    cache_reuse_depth: 0,
    policy_sensitivity_multiplier: 1.0,
  };

  if (samplingResult.rows.length > 0) {
    const sample = samplingResult.rows[0];
    wasSampled = true;
    samplingMethod = 'RISK_WEIGHTED';
    triggerMetrics = {
      financial_weight: sample.financial_impact_usd / 1000,
      cache_reuse_depth: sample.reuse_depth || 0,
      policy_sensitivity_multiplier: sample.policy_weight || 1.0,
    };
  }

  const samplingAudit: SamplingAudit = {
    was_sample_selected: wasSampled,
    sampling_method: samplingMethod,
    trigger_metrics: triggerMetrics,
  };

  return {
    index_name: indexName,
    governance_state: governanceState,
    drift_telemetry: driftTelemetry,
    confidence_decomposition: confidenceDecomposition,
    reanalysis_metadata: reanalysisMetadata,
    sampling_audit: samplingAudit,
  };
}

export function mapWorkflowStateToTrustLevel(workflowState: string): string {
  return WORKFLOW_STATE_TO_TRUST_LEVEL[workflowState] || 'Unverified';
}
