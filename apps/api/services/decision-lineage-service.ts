import { PoolClient } from 'pg';
import { RawTelemetryInput } from '../agents/llm-decision-agent';
import { validateDeterministicSignals, validateCognitiveSignals } from './governance-constants';
import { computeCalibratedConfidence, updateReviewCalibration, isBlacklistedFingerprint } from './stability-calibration-service';
import { calculateEffectiveConfidence, persistConfidenceDecayLog, getProvenianceLabel, getProvenanceColor } from './trust-decay-service';

export interface DeterministicSignals {
  daily_avg_gb_change_pct: number;
  cost_per_year_usd: number;
  retention_days: number;
  days_since_last_event: number;
  utilization_pct: number;
  search_count_30d: number;
  volume_bucket: string;
  utilization_bucket: string;
  freshness_bucket: string;
  signal_source: 'DETERMINISTIC'; // Always deterministic for this type
}

export interface CognitiveSignals {
  model: string;
  model_version: string;
  prompt_hash: string;
  temperature: number;
  confidence_score: number;
  reasoning: string;
  inference_tokens: number;
  latency_ms: number;
  signal_source: 'AI'; // Always AI for this type
}

export interface DecisionLineageRecord {
  id?: string;
  snapshot_id: string;
  index_name: string;
  sourcetype: string | null;
  deterministic_signals: DeterministicSignals;
  cognitive_signals?: CognitiveSignals;
  decision_status: 'PROPOSED' | 'REVIEW_QUEUE' | 'APPLIED' | 'DISMISSED';
  reviewed_by?: string;
  reviewed_at?: Date;
  applied_at?: Date;
  dismissal_reason?: string;
  fingerprint_version?: string; // Track fingerprinting schema version to detect drift
  processingTier?: 'TIER_A' | 'TIER_B'; // Tier A: reuse with calibration, Tier B: full re-analysis
  calibratedConfidence?: number; // Confidence after human review calibration
}

export interface DecisionWithCalibration extends DecisionLineageRecord {
  rawStability: number;
  calibrationVector: number;
  reviewStatus: 'UNREVIEWED' | 'APPROVED' | 'REJECTED';
  isCapped: boolean;
  isBlacklisted: boolean;
  effectiveConfidence?: number;
  approvalStatus?: 'FRESH' | 'STALE' | 'EXPIRED';
  provenanceLabel?: string;
  provenanceColor?: string;
  daysSinceReview?: number;
  decayReason?: string;
}

// Compute deterministic signals from input metadata
export function computeDeterministicSignals(
  metadata: RawTelemetryInput,
  previousMetadata: RawTelemetryInput | undefined,
  costPerGbPerDay: number
): DeterministicSignals {
  const currentGb = metadata.dailyAvgGb || 0;
  const previousGb = previousMetadata?.dailyAvgGb || currentGb;
  const changePercent = previousGb > 0 ? ((currentGb - previousGb) / previousGb) * 100 : 0;

  const costPerYear = currentGb * costPerGbPerDay * 365;

  let daysSinceLastEvent = 999;
  if (metadata.lastEvent) {
    try {
      const lastEventDate = new Date(metadata.lastEvent);
      const now = new Date();
      daysSinceLastEvent = Math.floor((now.getTime() - lastEventDate.getTime()) / (1000 * 60 * 60 * 24));
    } catch {
      daysSinceLastEvent = 999;
    }
  }

  // Compute buckets for consistent hashing
  const volumeBucket = computeVolumeBucket(currentGb);
  const utilizationBucket = computeUtilizationBucket(0); // TODO: derive from actual utilization
  const freshnessBucket = computeFreshnessBucket(daysSinceLastEvent);

  return {
    daily_avg_gb_change_pct: Math.round(changePercent * 100) / 100,
    cost_per_year_usd: Math.round(costPerYear * 100) / 100,
    retention_days: metadata.retentionDays || 30,
    days_since_last_event: daysSinceLastEvent,
    utilization_pct: 0, // TODO: derive from SearchAudit
    search_count_30d: 0, // TODO: derive from SearchAudit
    volume_bucket: volumeBucket,
    utilization_bucket: utilizationBucket,
    freshness_bucket: freshnessBucket,
    signal_source: 'DETERMINISTIC',
  };
}

function computeVolumeBucket(gb: number): string {
  if (gb < 1) return 'TINY';
  if (gb < 10) return 'SMALL';
  if (gb < 100) return 'MEDIUM';
  return 'LARGE';
}

function computeUtilizationBucket(utilPercent: number): string {
  if (utilPercent < 5) return 'VERY_LOW';
  if (utilPercent < 20) return 'LOW';
  if (utilPercent < 60) return 'MEDIUM';
  return 'HIGH';
}

function computeFreshnessBucket(daysSinceLastEvent: number): string {
  if (daysSinceLastEvent <= 7) return 'FRESH_0_7D';
  if (daysSinceLastEvent <= 30) return 'FRESH_7_30D';
  if (daysSinceLastEvent <= 90) return 'STALE_30_90D';
  return 'STALE_90PLUS_D';
}

// Record a decision with full lineage
export async function recordDecisionLineage(
  client: PoolClient,
  record: DecisionLineageRecord
): Promise<string> {
  // Validate provenance: ensure signals are properly tagged
  validateDeterministicSignals(record.deterministic_signals);
  if (record.cognitive_signals) {
    validateCognitiveSignals(record.cognitive_signals);
  }

  const result = await client.query(
    `INSERT INTO decision_lineage (
      snapshot_id, index_name, sourcetype,
      deterministic_signals, cognitive_signals,
      decision_status
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (snapshot_id, index_name, sourcetype) DO UPDATE SET
      deterministic_signals = EXCLUDED.deterministic_signals,
      cognitive_signals = EXCLUDED.cognitive_signals,
      decision_status = EXCLUDED.decision_status,
      updated_at = NOW()
    RETURNING id`,
    [
      record.snapshot_id,
      record.index_name,
      record.sourcetype || null,
      JSON.stringify(record.deterministic_signals),
      record.cognitive_signals ? JSON.stringify(record.cognitive_signals) : null,
      record.decision_status,
    ]
  );

  return result.rows[0].id;
}

// Update decision status (governance workflow)
export async function updateDecisionStatus(
  client: PoolClient,
  lineageId: string,
  newStatus: 'REVIEW_QUEUE' | 'APPLIED' | 'DISMISSED',
  reviewedBy?: string,
  dismissalReason?: string
): Promise<void> {
  const now = new Date();
  const appliedAt = newStatus === 'APPLIED' ? now : null;

  await client.query(
    `UPDATE decision_lineage
     SET decision_status = $1,
         reviewed_by = $2,
         reviewed_at = NOW(),
         applied_at = $3,
         dismissal_reason = $4,
         updated_at = NOW()
     WHERE id = $5`,
    [newStatus, reviewedBy || null, appliedAt, dismissalReason || null, lineageId]
  );
}

// Update decision with human calibration (approval/rejection)
export async function updateDecisionWithCalibration(
  client: PoolClient,
  lineageId: string,
  factId: string,
  reviewAction: 'APPROVE' | 'REJECT',
  reviewedBy: string,
  dismissalReason?: string
): Promise<void> {
  const reviewStatus = reviewAction === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const decisionStatus = reviewAction === 'APPROVE' ? 'APPLIED' : 'DISMISSED';

  // Update calibration in human_review_ledger
  await updateReviewCalibration(client, factId, reviewStatus, reviewedBy, dismissalReason);

  // Update decision lineage status
  await updateDecisionStatus(client, lineageId, decisionStatus as 'APPLIED' | 'DISMISSED', reviewedBy, dismissalReason);
}

// Get decision status summary for dashboard
export async function getDecisionStatusSummary(
  client: PoolClient,
  snapshotId: string
): Promise<{ status: string; count: number; avgConfidence: number }[]> {
  const result = await client.query(
    `SELECT
       decision_status as status,
       COUNT(*) as count,
       ROUND(AVG((cognitive_signals->>'confidence_score')::NUMERIC), 2) as avg_confidence
     FROM decision_lineage
     WHERE snapshot_id = $1
     GROUP BY decision_status
     ORDER BY decision_status`,
    [snapshotId]
  );

  return result.rows.map((row: any) => ({
    status: row.status,
    count: row.count,
    avgConfidence: parseFloat(row.avg_confidence) || 0,
  }));
}

// Get recent decisions awaiting review
export async function getPendingReviewDecisions(
  client: PoolClient,
  limit: number = 20
): Promise<DecisionLineageRecord[]> {
  const result = await client.query(
    `SELECT
       id, snapshot_id, index_name, sourcetype,
       deterministic_signals, cognitive_signals,
       decision_status, reviewed_by, reviewed_at,
       applied_at, dismissal_reason
     FROM decision_lineage
     WHERE decision_status IN ('PROPOSED', 'REVIEW_QUEUE')
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    snapshot_id: row.snapshot_id,
    index_name: row.index_name,
    sourcetype: row.sourcetype,
    deterministic_signals: row.deterministic_signals,
    cognitive_signals: row.cognitive_signals,
    decision_status: row.decision_status,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    applied_at: row.applied_at,
    dismissal_reason: row.dismissal_reason,
  }));
}

// Get pending decisions with calibration data for review queue
export async function getPendingReviewDecisionsWithCalibration(
  client: PoolClient,
  limit: number = 20
): Promise<DecisionWithCalibration[]> {
  const result = await client.query(
    `SELECT
       dl.id, dl.snapshot_id, dl.index_name, dl.sourcetype,
       dl.deterministic_signals, dl.cognitive_signals,
       dl.decision_status, dl.reviewed_by, dl.reviewed_at,
       dl.applied_at, dl.dismissal_reason, dl.created_at,
       COALESCE(hrl.review_status, 'UNREVIEWED') as review_status,
       COALESCE(hrl.calibration_vector, 0.5) as calibration_vector,
       COALESCE(hrl.days_since_review, 0) as days_since_review
     FROM decision_lineage dl
     LEFT JOIN human_review_ledger hrl ON dl.id = hrl.fact_id
     WHERE dl.decision_status IN ('PROPOSED', 'REVIEW_QUEUE')
     ORDER BY dl.created_at DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map((row: any) => {
    const cognitiveSignals = row.cognitive_signals || {};
    const rawStability = cognitiveSignals.confidence_score || 0;
    const calibrationVector = row.calibration_vector || 0.5;
    const reviewStatus = row.review_status || 'UNREVIEWED';
    const calibratedConfidence = rawStability * calibrationVector;
    const isCapped = reviewStatus === 'UNREVIEWED' && rawStability > 0.5;

    // Calculate effective confidence with decay
    const decayResult = calculateEffectiveConfidence(
      calibratedConfidence,
      new Date(row.created_at),
      reviewStatus === 'APPROVED',
      row.reviewed_at ? new Date(row.reviewed_at) : undefined
    );

    return {
      id: row.id,
      snapshot_id: row.snapshot_id,
      index_name: row.index_name,
      sourcetype: row.sourcetype,
      deterministic_signals: row.deterministic_signals,
      cognitive_signals: row.cognitive_signals,
      decision_status: row.decision_status,
      reviewed_by: row.reviewed_by,
      reviewed_at: row.reviewed_at,
      applied_at: row.applied_at,
      dismissal_reason: row.dismissal_reason,
      rawStability,
      calibrationVector,
      reviewStatus: reviewStatus as 'UNREVIEWED' | 'APPROVED' | 'REJECTED',
      calibratedConfidence: Math.min(calibratedConfidence, 1.0),
      effectiveConfidence: decayResult.effectiveConfidence,
      approvalStatus: decayResult.approvalStatus,
      provenanceLabel: getProvenianceLabel(decayResult),
      provenanceColor: getProvenanceColor(decayResult),
      decayReason: decayResult.decayReason,
      daysSinceReview: row.days_since_review,
      isCapped,
      isBlacklisted: false,
      processingTier: reviewStatus === 'REJECTED' ? 'TIER_B' : 'TIER_A',
    };
  });
}

// Persist queue health metrics for observability
export async function persistQueueHealthMetrics(
  client: PoolClient,
  snapshotId: string,
  snapshotDate: string,
  metrics: {
    unchangedIndexes: number;
    totalIndexes: number;
    candidatesSentToAi: number;
    highConfidenceProposals: number;
    mediumConfidenceProposals: number;
    lowConfidenceProposals: number;
  }
): Promise<void> {
  const reuseRatio = metrics.unchangedIndexes / metrics.totalIndexes;
  const filteringEfficiencyPct = (metrics.candidatesSentToAi / metrics.totalIndexes) * 100;

  await client.query(
    `INSERT INTO queue_health_metrics (
      snapshot_id, snapshot_date,
      reuse_ratio, unchanged_indexes, total_indexes,
      queue_depth, queue_depth_max_observed, processing_time_p95_ms,
      decision_flip_rate, flip_count, unstable_decisions,
      candidates_sent_to_ai, filtering_efficiency_pct,
      avg_inference_latency_ms, worker_memory_peak_mb, worker_count_active,
      high_confidence_proposals, medium_confidence_proposals, low_confidence_proposals
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    ON CONFLICT (snapshot_date) DO UPDATE SET
      reuse_ratio = $3,
      unchanged_indexes = $4,
      total_indexes = $5,
      queue_depth = $6,
      candidates_sent_to_ai = $12,
      filtering_efficiency_pct = $13,
      high_confidence_proposals = $17,
      medium_confidence_proposals = $18,
      low_confidence_proposals = $19,
      snapshot_id = $1`,
    [
      snapshotId, snapshotDate,
      reuseRatio, metrics.unchangedIndexes, metrics.totalIndexes,
      0, 0, 0,  // queue_depth, queue_depth_max_observed, processing_time_p95_ms (not yet tracked)
      0, 0, 0,  // decision_flip_rate, flip_count, unstable_decisions (computed separately)
      metrics.candidatesSentToAi, filteringEfficiencyPct,
      0, 0, 0,  // avg_inference_latency_ms, worker_memory_peak_mb, worker_count_active (system metrics)
      metrics.highConfidenceProposals, metrics.mediumConfidenceProposals, metrics.lowConfidenceProposals,
    ]
  );
}
