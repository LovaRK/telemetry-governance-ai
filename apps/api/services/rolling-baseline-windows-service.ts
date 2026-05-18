import { PoolClient } from 'pg';

export type BaselineSensitivityTier = 'FAST' | 'STANDARD' | 'STABLE';
export type DriftMetric = 'volume' | 'utilization' | 'retention' | 'search_freq' | 'freshness';

export interface RollingBaseline {
  baselineId: string;
  indexName: string;
  sensitivityTier: BaselineSensitivityTier;
  volume: { ema: number; variance: number; lastUpdate: Date };
  utilization: { ema: number; variance: number; lastUpdate: Date };
  retention: { ema: number; variance: number; lastUpdate: Date };
  searchFreq: { ema: number; variance: number; lastUpdate: Date };
  freshness: { ema: number; variance: number; lastUpdate: Date };
  controlBandK: number;
}

export interface DriftEnvelopeViolation {
  violationId: string;
  indexName: string;
  snapshotDate: Date;
  violatedMetric: DriftMetric;
  currentValue: number;
  emaBaseline: number;
  varianceSigma: number;
  kFactor: number;
  lowerBound: number;
  upperBound: number;
  sigmaDist: number;
  triggeredDriftClassification: boolean;
  driftSeverity?: string;
}

// Smoothing factors (α values) by sensitivity tier
const SMOOTHING_FACTORS: Record<BaselineSensitivityTier, number> = {
  FAST: 0.26,      // 7-day effective window
  STANDARD: 0.12,  // 14-day effective window
  STABLE: 0.067,   // 30-day effective window
};

// Control band k-factor (number of standard deviations)
const DEFAULT_K_FACTOR = 3.0;

/**
 * Get or create rolling baseline for an index
 * Creates with default STABLE tier (30-day window) for production stability
 */
export async function getOrCreateBaseline(
  client: PoolClient,
  indexName: string,
  tier: BaselineSensitivityTier = 'STABLE'
): Promise<RollingBaseline> {
  const result = await client.query(
    `SELECT * FROM index_rolling_baselines WHERE index_name = $1`,
    [indexName]
  );

  if (result.rows.length > 0) {
    return parseBaseline(result.rows[0]);
  }

  // Create new baseline
  const newResult = await client.query(
    `INSERT INTO index_rolling_baselines (
      index_name, sensitivity_tier, control_band_k
    ) VALUES ($1, $2, $3)
    RETURNING *`,
    [indexName, tier, DEFAULT_K_FACTOR]
  );

  return parseBaseline(newResult.rows[0]);
}

/**
 * Update baseline with new data point and compute new EMA/variance
 * Returns updated baseline and any detected violations
 */
export async function updateBaseline(
  client: PoolClient,
  indexName: string,
  metrics: {
    volumeGb: number;
    utilizationPct: number;
    retentionDays: number;
    searchFreqPerDay: number;
    freshnessAgeDay: number;
  }
): Promise<{ baseline: RollingBaseline; violations: DriftEnvelopeViolation[] }> {
  const baseline = await getOrCreateBaseline(client, indexName);
  const alpha = SMOOTHING_FACTORS[baseline.sensitivityTier];
  const violations: DriftEnvelopeViolation[] = [];

  // Update each metric's EMA and variance
  const updated = { ...baseline };
  const now = new Date();

  // Volume update
  const volUpdate = updateEmaMetric(
    baseline.volume,
    metrics.volumeGb,
    alpha
  );
  updated.volume = volUpdate;
  const volViolation = checkEnvelopeViolation(
    client,
    indexName,
    now,
    'volume',
    metrics.volumeGb,
    volUpdate,
    baseline.controlBandK
  );
  if (volViolation) violations.push(volViolation);

  // Utilization update
  const utilUpdate = updateEmaMetric(
    baseline.utilization,
    metrics.utilizationPct,
    alpha
  );
  updated.utilization = utilUpdate;
  const utilViolation = checkEnvelopeViolation(
    client,
    indexName,
    now,
    'utilization',
    metrics.utilizationPct,
    utilUpdate,
    baseline.controlBandK
  );
  if (utilViolation) violations.push(utilViolation);

  // Retention update
  const retUpdate = updateEmaMetric(
    baseline.retention,
    metrics.retentionDays,
    alpha
  );
  updated.retention = retUpdate;
  const retViolation = checkEnvelopeViolation(
    client,
    indexName,
    now,
    'retention',
    metrics.retentionDays,
    retUpdate,
    baseline.controlBandK
  );
  if (retViolation) violations.push(retViolation);

  // Search freq update
  const searchUpdate = updateEmaMetric(
    baseline.searchFreq,
    metrics.searchFreqPerDay,
    alpha
  );
  updated.searchFreq = searchUpdate;
  const searchViolation = checkEnvelopeViolation(
    client,
    indexName,
    now,
    'search_freq',
    metrics.searchFreqPerDay,
    searchUpdate,
    baseline.controlBandK
  );
  if (searchViolation) violations.push(searchViolation);

  // Freshness update
  const freshUpdate = updateEmaMetric(
    baseline.freshness,
    metrics.freshnessAgeDay,
    alpha
  );
  updated.freshness = freshUpdate;
  const freshViolation = checkEnvelopeViolation(
    client,
    indexName,
    now,
    'freshness',
    metrics.freshnessAgeDay,
    freshUpdate,
    baseline.controlBandK
  );
  if (freshViolation) violations.push(freshViolation);

  // Persist updated baseline
  await client.query(
    `UPDATE index_rolling_baselines SET
      volume_ema_gb = $1,
      volume_variance_gb = $2,
      volume_last_update = $3,
      utilization_ema_pct = $4,
      utilization_variance_pct = $5,
      utilization_last_update = $6,
      retention_ema_days = $7,
      retention_variance_days = $8,
      retention_last_update = $9,
      search_freq_ema = $10,
      search_freq_variance = $11,
      search_freq_last_update = $12,
      freshness_ema_days = $13,
      freshness_variance_days = $14,
      freshness_last_update = $15
    WHERE index_name = $16`,
    [
      updated.volume.ema,
      updated.volume.variance,
      updated.volume.lastUpdate,
      updated.utilization.ema,
      updated.utilization.variance,
      updated.utilization.lastUpdate,
      updated.retention.ema,
      updated.retention.variance,
      updated.retention.lastUpdate,
      updated.searchFreq.ema,
      updated.searchFreq.variance,
      updated.searchFreq.lastUpdate,
      updated.freshness.ema,
      updated.freshness.variance,
      updated.freshness.lastUpdate,
      indexName,
    ]
  );

  // Persist violations
  for (const violation of violations) {
    await persistViolation(client, violation);
  }

  return { baseline: updated, violations };
}

/**
 * Compute new EMA and variance for a metric
 * EMA_t = α·X_t + (1-α)·EMA_{t-1}
 * Variance tracks squared deviations from EMA
 */
function updateEmaMetric(
  current: { ema: number; variance: number; lastUpdate: Date },
  newValue: number,
  alpha: number
): { ema: number; variance: number; lastUpdate: Date } {
  const newEma = alpha * newValue + (1 - alpha) * current.ema;
  const deviation = newValue - newEma;
  const newVariance = alpha * (deviation * deviation) + (1 - alpha) * current.variance;

  return {
    ema: parseFloat(newEma.toFixed(4)),
    variance: parseFloat(newVariance.toFixed(4)),
    lastUpdate: new Date(),
  };
}

/**
 * Check if current value violates the control band
 * Violation: X_t > EMA_t + k·σ_t or X_t < EMA_t - k·σ_t
 */
function checkEnvelopeViolation(
  client: PoolClient,
  indexName: string,
  snapshotDate: Date,
  metric: DriftMetric,
  currentValue: number,
  baseline: { ema: number; variance: number },
  kFactor: number
): DriftEnvelopeViolation | null {
  const sigma = Math.sqrt(baseline.variance);
  const lowerBound = baseline.ema - kFactor * sigma;
  const upperBound = baseline.ema + kFactor * sigma;

  // Check if within bounds
  if (currentValue >= lowerBound && currentValue <= upperBound) {
    return null;
  }

  // Compute how many sigma away
  const sigmaDist = Math.abs(currentValue - baseline.ema) / (sigma > 0 ? sigma : 1);

  // Determine drift severity: 3σ=normal, 4σ=metric, 5σ+=semantic
  let driftSeverity = 'NOISE';
  if (sigmaDist > 5) driftSeverity = 'SEMANTIC';
  else if (sigmaDist > 4) driftSeverity = 'METRIC';

  return {
    violationId: `${indexName}-${snapshotDate.toISOString().split('T')[0]}-${metric}`,
    indexName,
    snapshotDate,
    violatedMetric: metric,
    currentValue,
    emaBaseline: baseline.ema,
    varianceSigma: sigma,
    kFactor,
    lowerBound,
    upperBound,
    sigmaDist: parseFloat(sigmaDist.toFixed(2)),
    triggeredDriftClassification: sigmaDist > 3.5,
    driftSeverity: sigmaDist > 3.5 ? driftSeverity : undefined,
  };
}

/**
 * Persist violation to database
 */
async function persistViolation(
  client: PoolClient,
  violation: DriftEnvelopeViolation
): Promise<void> {
  const snapshotDate = violation.snapshotDate.toISOString().split('T')[0];

  await client.query(
    `INSERT INTO drift_envelope_violations (
      index_name, snapshot_date, violated_metric,
      current_value, ema_baseline, variance_sigma, k_factor,
      lower_bound, upper_bound, sigma_distance,
      triggered_drift_classification, drift_severity
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT DO NOTHING`,
    [
      violation.indexName,
      snapshotDate,
      violation.violatedMetric,
      violation.currentValue,
      violation.emaBaseline,
      violation.varianceSigma,
      violation.kFactor,
      violation.lowerBound,
      violation.upperBound,
      violation.sigmaDist,
      violation.triggeredDriftClassification,
      violation.driftSeverity || null,
    ]
  );
}

/**
 * Get violations for an index in a time window
 */
export async function getViolations(
  client: PoolClient,
  indexName: string,
  sinceDate: Date,
  triggeredDriftOnly: boolean = false
): Promise<DriftEnvelopeViolation[]> {
  const snapshotDate = sinceDate.toISOString().split('T')[0];
  const whereClause = triggeredDriftOnly
    ? 'AND triggered_drift_classification = TRUE'
    : '';

  const result = await client.query(
    `SELECT * FROM drift_envelope_violations
     WHERE index_name = $1 AND snapshot_date >= $2 ${whereClause}
     ORDER BY snapshot_date DESC`,
    [indexName, snapshotDate]
  );

  return result.rows.map(row => ({
    violationId: `${row.index_name}-${row.snapshot_date}-${row.violated_metric}`,
    indexName: row.index_name,
    snapshotDate: new Date(row.snapshot_date),
    violatedMetric: row.violated_metric,
    currentValue: parseFloat(row.current_value),
    emaBaseline: parseFloat(row.ema_baseline),
    varianceSigma: parseFloat(row.variance_sigma),
    kFactor: parseFloat(row.k_factor),
    lowerBound: parseFloat(row.lower_bound),
    upperBound: parseFloat(row.upper_bound),
    sigmaDist: parseFloat(row.sigma_distance),
    triggeredDriftClassification: row.triggered_drift_classification,
    driftSeverity: row.drift_severity,
  }));
}

/**
 * Get smoothing factor for a sensitivity tier
 */
export function getSmoothingFactor(tier: BaselineSensitivityTier): number {
  return SMOOTHING_FACTORS[tier];
}

/**
 * Parse database row into RollingBaseline object
 */
function parseBaseline(row: any): RollingBaseline {
  return {
    baselineId: row.baseline_id,
    indexName: row.index_name,
    sensitivityTier: row.sensitivity_tier,
    volume: {
      ema: parseFloat(row.volume_ema_gb),
      variance: parseFloat(row.volume_variance_gb),
      lastUpdate: new Date(row.volume_last_update),
    },
    utilization: {
      ema: parseFloat(row.utilization_ema_pct),
      variance: parseFloat(row.utilization_variance_pct),
      lastUpdate: new Date(row.utilization_last_update),
    },
    retention: {
      ema: parseFloat(row.retention_ema_days),
      variance: parseFloat(row.retention_variance_days),
      lastUpdate: new Date(row.retention_last_update),
    },
    searchFreq: {
      ema: parseFloat(row.search_freq_ema),
      variance: parseFloat(row.search_freq_variance),
      lastUpdate: new Date(row.search_freq_last_update),
    },
    freshness: {
      ema: parseFloat(row.freshness_ema_days),
      variance: parseFloat(row.freshness_variance_days),
      lastUpdate: new Date(row.freshness_last_update),
    },
    controlBandK: parseFloat(row.control_band_k),
  };
}
