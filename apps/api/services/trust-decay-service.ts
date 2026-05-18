import { PoolClient } from 'pg';
import * as math from 'mathjs';

export interface EffectiveConfidenceResult {
  initialConfidence: number;
  daysSinceEvaluation: number;
  decayFactor: number;
  effectiveConfidence: number;
  isHumanApproved: boolean;
  lastReviewDate?: Date;
  approvalStatus: 'FRESH' | 'STALE' | 'EXPIRED';
  label: string;
  systemLabel: string;
  decayReason?: string;
  driftPenalty?: number;
  stabilityFactor?: number;
}

export interface ModelHealthScore {
  snapshotDate: string;
  totalReviews30d: number;
  totalRejections30d: number;
  modelTrustScore: number;
  systemHealthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  alertMessage?: string;
  staleApprovalsCount: number;
  expiredApprovalsCount: number;
  fingerprintChangesDetected: number;
}

// 30-day half-life decay constant: ln(2) / 30 ≈ 0.0231
const DECAY_CONSTANT = 0.02310585;

// Approval expiry threshold
const APPROVAL_EXPIRY_DAYS = 90;
const STALE_APPROVAL_THRESHOLD = 90;
const STALE_CONFIDENCE_MULTIPLIER = 0.7;

// Model trust thresholds
const HEALTHY_TRUST_THRESHOLD = 0.80;
const DEGRADED_TRUST_THRESHOLD = 0.70;

export function calculateExponentialDecay(
  initialConfidence: number,
  daysSinceEvaluation: number
): number {
  // C(t) = C₀ * e^(-λt)
  // Where λ = 0.0231 (30-day half-life)
  const decayFactor = Math.exp(-DECAY_CONSTANT * daysSinceEvaluation);
  const decayed = initialConfidence * decayFactor;
  return Math.max(decayed, 0.0);
}

export function calculateEffectiveConfidence(
  initialConfidence: number,
  evaluatedAt: Date,
  isHumanApproved: boolean,
  lastReviewDate?: Date
): EffectiveConfidenceResult {
  const now = new Date();
  const daysSinceEvaluation = Math.floor(
    (now.getTime() - evaluatedAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  // If human approved, check expiry status
  if (isHumanApproved && lastReviewDate) {
    const daysSinceReview = Math.floor(
      (now.getTime() - lastReviewDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceReview > STALE_APPROVAL_THRESHOLD) {
      // Expired approval: confidence degrades and forces re-review
      const degradedConfidence = Math.max(initialConfidence * STALE_CONFIDENCE_MULTIPLIER, 0.3);
      return {
        initialConfidence,
        daysSinceEvaluation,
        decayFactor: STALE_CONFIDENCE_MULTIPLIER,
        effectiveConfidence: degradedConfidence,
        isHumanApproved: true,
        lastReviewDate,
        approvalStatus: 'EXPIRED',
        label: '⏳ STALE (Expired)',
        systemLabel: 'APPROVAL_EXPIRED',
        decayReason: `Approval expired ${daysSinceReview - STALE_APPROVAL_THRESHOLD} days ago`,
      };
    }

    // Fresh approval: full confidence, no decay
    return {
      initialConfidence,
      daysSinceEvaluation,
      decayFactor: 1.0,
      effectiveConfidence: initialConfidence,
      isHumanApproved: true,
      lastReviewDate,
      approvalStatus: 'FRESH',
      label: '👤 APPROVED',
      systemLabel: 'HUMAN_APPROVED',
    };
  }

  // Unreviewed AI proposal: exponential decay
  const decayFactor = Math.exp(-DECAY_CONSTANT * daysSinceEvaluation);
  const effectiveConfidence = initialConfidence * decayFactor;

  // Determine approval status based on decay
  let approvalStatus: 'FRESH' | 'STALE' | 'EXPIRED' = 'FRESH';
  if (daysSinceEvaluation > STALE_APPROVAL_THRESHOLD) {
    approvalStatus = 'EXPIRED';
  } else if (daysSinceEvaluation > 30) {
    approvalStatus = 'STALE';
  }

  const label =
    effectiveConfidence < 0.4 ? '⚠ LOW CONF (Expired)' : '🤖 AI (Decaying)';
  const systemLabel = effectiveConfidence < 0.4 ? 'LOW_CONFIDENCE' : 'AI_UNREVIEWED';

  return {
    initialConfidence,
    daysSinceEvaluation,
    decayFactor: parseFloat(decayFactor.toFixed(4)),
    effectiveConfidence: parseFloat(effectiveConfidence.toFixed(2)),
    isHumanApproved: false,
    approvalStatus,
    label,
    systemLabel,
    decayReason: `Unreviewed decision decayed from ${(initialConfidence * 100).toFixed(0)}% → ${(effectiveConfidence * 100).toFixed(0)}% over ${daysSinceEvaluation} days`,
  };
}

export async function calculateModelTrustScore(
  client: PoolClient,
  snapshotDate: string
): Promise<ModelHealthScore> {
  // Calculate 30-day rejection rate
  const thirtyDaysAgo = new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000);

  const reviewStats = await client.query(
    `SELECT
       COUNT(*) as total_reviews,
       SUM(CASE WHEN is_disagreement THEN 1 ELSE 0 END) as total_rejections
     FROM human_review_ledger
     WHERE reviewed_at >= $1`,
    [thirtyDaysAgo]
  );

  const stats = reviewStats.rows[0];
  const totalReviews = parseInt(stats.total_reviews) || 0;
  const totalRejections = parseInt(stats.total_rejections) || 0;

  const modelTrustScore =
    totalReviews === 0 ? 1.0 : 1.0 - totalRejections / totalReviews;

  // Count stale and expired approvals
  const staleResult = await client.query(
    `SELECT
       COUNT(CASE WHEN is_disagreement = false AND days_since_review > 30 THEN 1 END) as stale_count,
       COUNT(CASE WHEN is_disagreement = false AND days_since_review > 90 THEN 1 END) as expired_count
     FROM human_review_ledger
     WHERE review_status = 'APPROVED'`
  );

  const staleData = staleResult.rows[0];
  const staleApprovalsCount = parseInt(staleData.stale_count) || 0;
  const expiredApprovalsCount = parseInt(staleData.expired_count) || 0;

  // Determine system health status based on trust score
  let systemHealthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = 'HEALTHY';
  let alertMessage: string | undefined;

  if (modelTrustScore < DEGRADED_TRUST_THRESHOLD) {
    systemHealthStatus = 'CRITICAL';
    alertMessage = `🚨 SYSTEM DISAGREEMENT RISK: Model trust score ${(modelTrustScore * 100).toFixed(0)}% (${totalRejections}/${totalReviews} rejections). All pending Tier B reasoning workers entered high-scrutiny mode.`;
  } else if (modelTrustScore < HEALTHY_TRUST_THRESHOLD) {
    systemHealthStatus = 'DEGRADED';
    alertMessage = `⚠️  Model health degraded: Trust score ${(modelTrustScore * 100).toFixed(0)}%. Monitor rejection patterns and consider prompt recalibration.`;
  }

  // Persist to model_health_ledger
  await client.query(
    `INSERT INTO model_health_ledger (
      snapshot_date, total_reviews_30d, total_rejections_30d,
      stale_approvals_count, expired_approvals_count,
      system_health_status, alert_message
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (snapshot_date) DO UPDATE SET
      total_reviews_30d = EXCLUDED.total_reviews_30d,
      total_rejections_30d = EXCLUDED.total_rejections_30d,
      stale_approvals_count = EXCLUDED.stale_approvals_count,
      expired_approvals_count = EXCLUDED.expired_approvals_count,
      system_health_status = EXCLUDED.system_health_status,
      alert_message = EXCLUDED.alert_message`,
    [
      snapshotDate,
      totalReviews,
      totalRejections,
      staleApprovalsCount,
      expiredApprovalsCount,
      systemHealthStatus,
      alertMessage || null,
    ]
  );

  return {
    snapshotDate,
    totalReviews30d: totalReviews,
    totalRejections30d: totalRejections,
    modelTrustScore: parseFloat(modelTrustScore.toFixed(2)),
    systemHealthStatus,
    alertMessage,
    staleApprovalsCount,
    expiredApprovalsCount,
    fingerprintChangesDetected: 0, // Populated by snapshot-diff-service
  };
}

export async function persistConfidenceDecayLog(
  client: PoolClient,
  factId: string,
  result: EffectiveConfidenceResult,
  enrichmentId?: string
): Promise<void> {
  await client.query(
    `INSERT INTO confidence_decay_log (
      fact_id, enrichment_id,
      initial_confidence, current_effective_confidence,
      days_since_evaluation, decay_factor,
      is_human_approved, approval_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (decay_id) DO UPDATE SET
      current_effective_confidence = EXCLUDED.current_effective_confidence,
      days_since_evaluation = EXCLUDED.days_since_evaluation,
      updated_at = NOW()`,
    [
      factId,
      enrichmentId || null,
      result.initialConfidence,
      result.effectiveConfidence,
      result.daysSinceEvaluation,
      result.decayFactor,
      result.isHumanApproved,
      result.approvalStatus,
    ]
  );
}

export function getProvenianceLabel(result: EffectiveConfidenceResult): string {
  if (result.systemLabel === 'APPROVAL_EXPIRED') {
    return '⏳ STALE';
  }
  if (result.systemLabel === 'HUMAN_APPROVED') {
    return '👤 APPROVED';
  }
  if (result.systemLabel === 'LOW_CONFIDENCE') {
    return '⚠ LOW CONF';
  }
  return '🤖 AI';
}

export function getProvenanceColor(result: EffectiveConfidenceResult): string {
  switch (result.systemLabel) {
    case 'APPROVAL_EXPIRED':
      return '#D35400'; // Amber
    case 'HUMAN_APPROVED':
      return '#27AE60'; // Green
    case 'LOW_CONFIDENCE':
      return '#E74C3C'; // Red
    case 'AI_UNREVIEWED':
    default:
      return '#8E44AD'; // Purple
  }
}

export function explainDecay(result: EffectiveConfidenceResult): string {
  const lines = [
    `Confidence Origin: ${result.systemLabel}`,
    `Initial Value: ${(result.initialConfidence * 100).toFixed(1)}%`,
    `Days Since Evaluation: ${result.daysSinceEvaluation}`,
    `Decay Factor: ${(result.decayFactor * 100).toFixed(1)}%`,
    `Effective Confidence: ${(result.effectiveConfidence * 100).toFixed(1)}%`,
    `Status: ${result.approvalStatus}`,
    ``,
    result.label,
  ];

  if (result.driftPenalty && result.driftPenalty > 0) {
    lines.push(``, `Drift Penalty: ${(result.driftPenalty * 100).toFixed(1)}%`);
  }

  if (result.decayReason) {
    lines.push(``, `Reason: ${result.decayReason}`);
  }

  return lines.join('\n');
}

/**
 * Apply drift penalty to effective confidence
 * Formula: C_effective = C_initial × (1 - driftPenalty) × temporalDecayFactor × approvalFactor
 */
export function applyDriftPenalty(
  result: EffectiveConfidenceResult,
  driftPenalty: number
): EffectiveConfidenceResult {
  const stabilityFactor = 1.0 - driftPenalty;
  const adjustedConfidence = result.effectiveConfidence * stabilityFactor;

  return {
    ...result,
    effectiveConfidence: Math.max(adjustedConfidence, 0.0),
    driftPenalty,
    stabilityFactor,
    label: adjustedConfidence < 0.4 ? '⚠ LOW CONF (Drift)' : result.label,
    systemLabel: adjustedConfidence < 0.4 ? 'DRIFT_PENALIZED' : result.systemLabel,
  };
}
