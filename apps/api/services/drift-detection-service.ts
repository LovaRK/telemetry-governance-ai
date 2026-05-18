import { PoolClient } from 'pg';
import * as math from 'mathjs';

export type DriftSeverity = 'NONE' | 'NOISE' | 'METRIC' | 'SEMANTIC' | 'POLICY';

export interface DriftVector {
  vol_drift_pct: number; // Volume change relative to baseline
  util_delta_pct: number; // Utilization shift
  freshness_changed: boolean; // Data aging or new patterns
  retention_changed: boolean; // Retention policy shift
}

export interface DriftDetectionResult {
  driftVector: DriftVector;
  driftSeverity: DriftSeverity;
  confidencePenalty: number; // 0.0 to 1.0
  confidenceEffective: number; // original_confidence * (1 - penalty)
  wasInvalidated: boolean;
  reanalysisTriggered: boolean;
  invalidationReason?: string;
}

// Production drift thresholds
const DRIFT_THRESHOLDS = {
  // Volume drift: >25% change triggers METRIC
  VOL_DRIFT_NOISE: 0.05,       // ±5% = NOISE
  VOL_DRIFT_METRIC: 0.25,      // ±25% = METRIC
  VOL_DRIFT_SEMANTIC: 0.50,    // ±50% = SEMANTIC

  // Utilization delta: >10ppt shift triggers METRIC
  UTIL_DELTA_NOISE: 0.05,      // ±5ppt = NOISE
  UTIL_DELTA_METRIC: 0.10,     // ±10ppt = METRIC
  UTIL_DELTA_SEMANTIC: 0.25,   // ±25ppt = SEMANTIC

  // Freshness: aged data or new patterns = SEMANTIC
  FRESHNESS_THRESHOLD_DAYS: 7,

  // Retention: policy change = POLICY drift
  RETENTION_DELTA_DAYS: 30,
};

// Confidence penalty matrix
const PENALTY_MATRIX: Record<DriftSeverity, { min: number; max: number; invalidate: boolean; reanalyze: boolean }> = {
  NONE: { min: 0.00, max: 0.00, invalidate: false, reanalyze: false },
  NOISE: { min: 0.05, max: 0.15, invalidate: false, reanalyze: false },
  METRIC: { min: 0.25, max: 0.50, invalidate: false, reanalyze: true },
  SEMANTIC: { min: 0.50, max: 0.80, invalidate: true, reanalyze: true },
  POLICY: { min: 0.80, max: 1.00, invalidate: true, reanalyze: true },
};

/**
 * Evaluate semantic drift in a decision by comparing current metrics to approval baseline
 * Returns drift classification and confidence impact
 */
export async function evaluateSemanticDrift(
  client: PoolClient,
  decisionId: string,
  currentSnapshot: {
    indexName: string;
    totalEventsNow: number;
    utilizationPctNow: number;
    retentionDaysNow: number;
    snapshotDateNow: Date;
  },
  baselineSnapshot: {
    totalEventsBaseline: number;
    utilizationPctBaseline: number;
    retentionDaysBaseline: number;
    snapshotDateBaseline: Date;
  },
  originalConfidence: number
): Promise<DriftDetectionResult> {
  // Compute drift vector
  const driftVector = computeDriftVector(currentSnapshot, baselineSnapshot);

  // Classify severity
  const severity = classifyDriftSeverity(driftVector);

  // Determine penalty and actions
  const penaltyConfig = PENALTY_MATRIX[severity];
  const confidencePenalty = Math.min(penaltyConfig.max, Math.max(penaltyConfig.min, driftVector.vol_drift_pct / 100));
  const confidenceEffective = originalConfidence * (1 - confidencePenalty);

  const result: DriftDetectionResult = {
    driftVector,
    driftSeverity: severity,
    confidencePenalty: parseFloat(confidencePenalty.toFixed(2)),
    confidenceEffective: parseFloat(confidenceEffective.toFixed(2)),
    wasInvalidated: penaltyConfig.invalidate,
    reanalysisTriggered: penaltyConfig.reanalyze,
  };

  if (penaltyConfig.invalidate) {
    result.invalidationReason = `Decision invalidated due to ${severity} drift in metrics (vol: ${driftVector.vol_drift_pct.toFixed(1)}%, util: ${driftVector.util_delta_pct.toFixed(1)}ppt)`;
  }

  // Persist to decision_drift_history
  await persistDriftHistory(client, decisionId, currentSnapshot, result);

  return result;
}

/**
 * Compute relative metric drift as a vector
 */
function computeDriftVector(
  current: {
    indexName: string;
    totalEventsNow: number;
    utilizationPctNow: number;
    retentionDaysNow: number;
    snapshotDateNow: Date;
  },
  baseline: {
    totalEventsBaseline: number;
    utilizationPctBaseline: number;
    retentionDaysBaseline: number;
    snapshotDateBaseline: Date;
  }
): DriftVector {
  // Volume drift: percent change in events
  const volDriftPct = baseline.totalEventsBaseline === 0
    ? 0
    : ((current.totalEventsNow - baseline.totalEventsBaseline) / baseline.totalEventsBaseline) * 100;

  // Utilization delta: percentage point shift
  const utilDeltaPct = current.utilizationPctNow - baseline.utilizationPctBaseline;

  // Freshness: has the dataset aged significantly (data gap indicator)?
  const daysSinceBaseline = Math.floor(
    (current.snapshotDateNow.getTime() - baseline.snapshotDateBaseline.getTime()) / (1000 * 60 * 60 * 24)
  );
  const freshnessChanged = daysSinceBaseline > DRIFT_THRESHOLDS.FRESHNESS_THRESHOLD_DAYS;

  // Retention: has policy changed?
  const retentionChanged = Math.abs(current.retentionDaysNow - baseline.retentionDaysBaseline) > DRIFT_THRESHOLDS.RETENTION_DELTA_DAYS;

  return {
    vol_drift_pct: parseFloat(Math.abs(volDriftPct).toFixed(1)),
    util_delta_pct: parseFloat(Math.abs(utilDeltaPct).toFixed(1)),
    freshness_changed: freshnessChanged,
    retention_changed: retentionChanged,
  };
}

/**
 * Classify drift severity based on metric changes
 * Production rule: evaluate in order of increasing severity
 */
function classifyDriftSeverity(driftVector: DriftVector): DriftSeverity {
  // POLICY: retention changed
  if (driftVector.retention_changed) {
    return 'POLICY';
  }

  // SEMANTIC: significant volume shift + freshness shift
  if (
    driftVector.vol_drift_pct > DRIFT_THRESHOLDS.VOL_DRIFT_SEMANTIC ||
    driftVector.util_delta_pct > DRIFT_THRESHOLDS.UTIL_DELTA_SEMANTIC ||
    (driftVector.freshness_changed && driftVector.vol_drift_pct > DRIFT_THRESHOLDS.VOL_DRIFT_METRIC)
  ) {
    return 'SEMANTIC';
  }

  // METRIC: moderate volume or utilization shift
  if (
    driftVector.vol_drift_pct > DRIFT_THRESHOLDS.VOL_DRIFT_METRIC ||
    driftVector.util_delta_pct > DRIFT_THRESHOLDS.UTIL_DELTA_METRIC
  ) {
    return 'METRIC';
  }

  // NOISE: minor fluctuations
  if (
    driftVector.vol_drift_pct > DRIFT_THRESHOLDS.VOL_DRIFT_NOISE ||
    driftVector.util_delta_pct > DRIFT_THRESHOLDS.UTIL_DELTA_NOISE
  ) {
    return 'NOISE';
  }

  // NONE: stable metrics
  return 'NONE';
}

/**
 * Persist drift detection result to database
 */
async function persistDriftHistory(
  client: PoolClient,
  decisionId: string,
  snapshot: { indexName: string; snapshotDateNow: Date },
  result: DriftDetectionResult
): Promise<void> {
  const snapshotDate = snapshot.snapshotDateNow.toISOString().split('T')[0];

  await client.query(
    `INSERT INTO decision_drift_history (
      decision_id, snapshot_date, index_name,
      drift_vector, drift_severity,
      confidence_penalty, confidence_effective,
      was_invalidated, reanalysis_triggered, invalidation_reason
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT DO NOTHING`,
    [
      decisionId,
      snapshotDate,
      snapshot.indexName,
      JSON.stringify(result.driftVector),
      result.driftSeverity,
      result.confidencePenalty,
      result.confidenceEffective,
      result.wasInvalidated,
      result.reanalysisTriggered,
      result.invalidationReason || null,
    ]
  );

  // Also update agent_decisions with drift info
  await client.query(
    `UPDATE agent_decisions
     SET drift_detected = TRUE,
         drift_severity = $1,
         drift_confidence_adjusted = $2
     WHERE snapshot_id = $3`,
    [result.driftSeverity, result.confidenceEffective, decisionId]
  );
}

/**
 * Get all drifted decisions since a specific date
 * Used for reanalysis queue population
 */
export async function getDriftedDecisions(
  client: PoolClient,
  sinceDate: Date,
  minSeverity: DriftSeverity = 'METRIC'
): Promise<Array<{ decisionId: string; indexName: string; severity: DriftSeverity; confidenceAdjusted: number }>> {
  const severityOrder: Record<DriftSeverity, number> = {
    NONE: 0,
    NOISE: 1,
    METRIC: 2,
    SEMANTIC: 3,
    POLICY: 4,
  };

  const minSeverityOrder = severityOrder[minSeverity];

  const result = await client.query(
    `SELECT
       d.drift_id,
       d.decision_id,
       d.index_name,
       d.drift_severity,
       d.confidence_effective
     FROM decision_drift_history d
     WHERE d.created_at >= $1
       AND (d.drift_severity::text = ANY($2))
       AND d.reanalysis_triggered = TRUE
     ORDER BY d.created_at DESC`,
    [sinceDate, Object.keys(severityOrder).filter(k => severityOrder[k as DriftSeverity] >= minSeverityOrder)]
  );

  return result.rows.map(row => ({
    decisionId: row.decision_id,
    indexName: row.index_name,
    severity: row.drift_severity,
    confidenceAdjusted: parseFloat(row.confidence_effective),
  }));
}

/**
 * Explain drift for UI presentation
 */
export function explainDrift(result: DriftDetectionResult): string {
  const lines = [
    `Drift Classification: ${result.driftSeverity}`,
    ``,
    `Metric Changes:`,
    `  • Volume Drift: ${result.driftVector.vol_drift_pct.toFixed(1)}%`,
    `  • Utilization Shift: ${result.driftVector.util_delta_pct.toFixed(1)} percentage points`,
    `  • Freshness Changed: ${result.driftVector.freshness_changed ? 'Yes' : 'No'}`,
    `  • Retention Changed: ${result.driftVector.retention_changed ? 'Yes' : 'No'}`,
    ``,
    `Confidence Impact:`,
    `  • Penalty: ${(result.confidencePenalty * 100).toFixed(0)}%`,
    `  • Effective: ${(result.confidenceEffective * 100).toFixed(1)}%`,
    ``,
  ];

  if (result.wasInvalidated) {
    lines.push(`⚠️  Decision Invalidated: ${result.invalidationReason || 'Metrics changed significantly'}`);
  }

  if (result.reanalysisTriggered) {
    lines.push(`🔄 Reanalysis Queued: Index will be re-evaluated with updated metrics`);
  }

  return lines.join('\n');
}
