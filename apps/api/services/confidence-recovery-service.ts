import { PoolClient } from 'pg';

export interface DecisionStabilityRun {
  runId: string;
  decisionId: string;
  indexName: string;
  consecutiveCleanSnapshots: number;
  lastCleanSnapshotDate: Date;
  driftFreeDays: number;
  originalConfidence: number;
  currentPenalizedConfidence: number;
  confidenceRecoveryApplied: number;
  confidenceAfterRecovery: number;
  recoveryVelocityFactor: number;
  lastPenaltyEventDate?: Date;
  // Asymmetric recovery controls
  historicalDriftCount: number; // Total drift events ever
  recoveryCooldownUntil?: Date; // When recovery lock expires
  oscillationMultiplier: number; // 1.0 / (1.0 + historicalDriftCount)
}

export interface ConfidenceRecoveryMilestone {
  milestoneId: string;
  runId: string;
  indexName: string;
  stableDaysThreshold: number;
  milestoneReachedAt: Date;
  confidenceBefore: number;
  recoveryAmount: number;
  confidenceAfter: number;
  milestoneType: 'PARTIAL_14_DAY' | 'FULL_30_DAY' | 'ACCELERATED_RECOVERY';
}

export interface OscillationDetectorState {
  detectorId: string;
  indexName: string;
  totalDriftEvents30d: number;
  totalRecoveryEvents30d: number;
  oscillationRatio: number;
  isOscillating: boolean;
  oscillationSeverity?: 'LOW' | 'MEDIUM' | 'HIGH';
  lastOscillationDetected?: Date;
  confidenceFreezeUntil?: Date;
  isConfidenceFrozen: boolean;
}

// Recovery schedule: stable days -> recovery percentage
const RECOVERY_SCHEDULE: Record<number, { percentage: number; type: string }> = {
  7: { percentage: 0.10, type: 'MINOR' },
  14: { percentage: 0.25, type: 'PARTIAL' },
  30: { percentage: 0.50, type: 'SUBSTANTIAL' },
  60: { percentage: 0.75, type: 'MAJOR' },
  90: { percentage: 1.00, type: 'FULL' },
};

const STABLE_DAYS_THRESHOLDS = [7, 14, 30, 60, 90];

/**
 * Get or create stability run for a decision
 */
export async function getOrCreateStabilityRun(
  client: PoolClient,
  decisionId: string,
  indexName: string,
  originalConfidence: number
): Promise<DecisionStabilityRun> {
  const result = await client.query(
    `SELECT * FROM decision_stability_runs WHERE decision_id = $1`,
    [decisionId]
  );

  if (result.rows.length > 0) {
    return parseStabilityRun(result.rows[0]);
  }

  // Create new run
  const today = new Date();
  const newResult = await client.query(
    `INSERT INTO decision_stability_runs (
      decision_id, index_name,
      consecutive_clean_snapshots, last_clean_snapshot_date, drift_free_days,
      original_confidence, current_penalized_confidence,
      confidence_recovery_applied, confidence_after_recovery,
      recovery_velocity_factor,
      historical_drift_count, recovery_cooldown_until, oscillation_multiplier
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *`,
    [
      decisionId,
      indexName,
      0,
      today,
      0,
      originalConfidence,
      originalConfidence,
      0,
      originalConfidence,
      1.0,
      0, // historical_drift_count starts at 0
      null, // recovery_cooldown_until is null initially
      1.0, // oscillation_multiplier starts at 1.0
    ]
  );

  return parseStabilityRun(newResult.rows[0]);
}

/**
 * Record a clean snapshot (no drift detected) and update stability metrics
 * Respects asymmetric recovery: fast penalty, slow recovery with cooldowns
 */
export async function recordCleanSnapshot(
  client: PoolClient,
  decisionId: string,
  snapshotDate: Date
): Promise<{ run: DecisionStabilityRun; milestonesReached: ConfidenceRecoveryMilestone[]; recoveryCooledDown: boolean }> {
  const run = await getOrCreateStabilityRun(client, decisionId, '', 0.5);
  const milestonesReached: ConfidenceRecoveryMilestone[] = [];

  // Check if recovery cooldown is still active
  const now = new Date();
  const recoveryCooledDown = !run.recoveryCooldownUntil || now > run.recoveryCooldownUntil;

  // Increment consecutive clean snapshots
  const newConsecutive = run.consecutiveCleanSnapshots + 1;
  const daysSinceOriginal = Math.floor(
    (snapshotDate.getTime() - run.lastCleanSnapshotDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Only attempt recovery if cooldown has expired
  if (recoveryCooledDown) {
    // Check which recovery milestones have been reached
    for (const threshold of STABLE_DAYS_THRESHOLDS) {
      if (daysSinceOriginal >= threshold && daysSinceOriginal > run.driftFreeDays) {
        // Reached new milestone
        const recovery = RECOVERY_SCHEDULE[threshold];
        let recoveryAmount = run.originalConfidence * recovery.percentage;

        // Apply oscillation multiplier to throttle recovery on repeated drift systems
        recoveryAmount *= run.oscillationMultiplier;

        const newConfidence = run.currentPenalizedConfidence + recoveryAmount;

        const milestone: ConfidenceRecoveryMilestone = {
          milestoneId: `${decisionId}-${threshold}d`,
          runId: run.runId,
          indexName: run.indexName,
          stableDaysThreshold: threshold,
          milestoneReachedAt: new Date(),
          confidenceBefore: run.confidenceAfterRecovery,
          recoveryAmount,
          confidenceAfter: Math.min(newConfidence, run.originalConfidence),
          milestoneType: getMilestoneType(threshold),
        };

        milestonesReached.push(milestone);

        // Persist milestone
        await client.query(
          `INSERT INTO confidence_recovery_milestones (
            run_id, index_name,
            stable_days_threshold, milestone_reached_at,
            confidence_before, recovery_amount, confidence_after,
            milestone_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT DO NOTHING`,
          [
            run.runId,
            run.indexName,
            threshold,
            milestone.milestoneReachedAt,
            milestone.confidenceBefore,
            milestone.recoveryAmount,
            milestone.confidenceAfter,
            milestone.milestoneType,
          ]
        );

        // Update run with new confidence
        run.confidenceAfterRecovery = milestone.confidenceAfter;
        run.confidenceRecoveryApplied += recoveryAmount;
      }
    }
  }

  // Update stability run
  const velocityFactor = 0.05 * Math.log(newConsecutive + 1) * run.oscillationMultiplier;
  const updatedRun = await client.query(
    `UPDATE decision_stability_runs SET
      consecutive_clean_snapshots = $1,
      last_clean_snapshot_date = $2,
      drift_free_days = $3,
      confidence_recovery_applied = $4,
      confidence_after_recovery = $5,
      recovery_velocity_factor = $6
    WHERE decision_id = $7
    RETURNING *`,
    [
      newConsecutive,
      snapshotDate,
      daysSinceOriginal,
      run.confidenceRecoveryApplied,
      run.confidenceAfterRecovery,
      velocityFactor,
      decisionId,
    ]
  );

  return {
    run: parseStabilityRun(updatedRun.rows[0]),
    milestonesReached,
    recoveryCooledDown,
  };
}

/**
 * Record a drift event (penalty) and implement asymmetric recovery cooldown
 * Asymmetric: penalties are immediate, recovery is slow and gets slower with repeated drift
 */
export async function recordDriftEvent(
  client: PoolClient,
  decisionId: string,
  newPenalizedConfidence: number,
  penaltyAmount: number
): Promise<DecisionStabilityRun> {
  const run = await getOrCreateStabilityRun(client, decisionId, '', 0.5);

  // Increment historical drift count
  const newDriftCount = run.historicalDriftCount + 1;

  // Calculate recovery cooldown: each drift adds 7 days to the lock
  // Formula: cooldownUntil = NOW + (historicalDriftCount * 7 days)
  const cooldownMs = newDriftCount * 7 * 24 * 60 * 60 * 1000;
  const recoveryCooldownUntil = new Date(Date.now() + cooldownMs);

  // Calculate oscillation multiplier: 1.0 / (1.0 + historicalDriftCount)
  // This throttles recovery velocity: first drift allows recovery, subsequent drifts throttle it
  // Pattern: 1.0 → 0.5 → 0.33 → 0.25 → ...
  const oscillationMultiplier = 1.0 / (1.0 + newDriftCount);

  // Reset consecutive clean snapshots
  const updatedRun = await client.query(
    `UPDATE decision_stability_runs SET
      consecutive_clean_snapshots = 0,
      current_penalized_confidence = $1,
      last_penalty_event_date = $2,
      historical_drift_count = $3,
      recovery_cooldown_until = $4,
      oscillation_multiplier = $5
    WHERE decision_id = $6
    RETURNING *`,
    [
      newPenalizedConfidence,
      new Date(),
      newDriftCount,
      recoveryCooldownUntil,
      oscillationMultiplier,
      decisionId,
    ]
  );

  return parseStabilityRun(updatedRun.rows[0]);
}

/**
 * Get or create oscillation detector for an index
 */
export async function getOrCreateOscillationDetector(
  client: PoolClient,
  indexName: string
): Promise<OscillationDetectorState> {
  const result = await client.query(
    `SELECT * FROM decision_oscillation_detector WHERE index_name = $1`,
    [indexName]
  );

  if (result.rows.length > 0) {
    return parseOscillationDetector(result.rows[0]);
  }

  // Create new detector
  const newResult = await client.query(
    `INSERT INTO decision_oscillation_detector (
      index_name, total_drift_events_30d, total_recovery_events_30d,
      oscillation_ratio, is_oscillating, is_confidence_frozen
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    [indexName, 0, 0, 0, false, false]
  );

  return parseOscillationDetector(newResult.rows[0]);
}

/**
 * Check for oscillation and update detector state
 * Oscillation ratio = total_drift_events / max(total_recovery_events, 1)
 * High oscillation (ratio > 3) freezes confidence to prevent ping-pong decisions
 */
export async function checkAndUpdateOscillation(
  client: PoolClient,
  indexName: string,
  driftEventOccurred: boolean
): Promise<{ detector: OscillationDetectorState; frozenUntil?: Date }> {
  const detector = await getOrCreateOscillationDetector(client, indexName);

  // Update 30-day rolling counts
  const driftCount = driftEventOccurred ? detector.totalDriftEvents30d + 1 : detector.totalDriftEvents30d;
  const recoveryCount = !driftEventOccurred ? detector.totalRecoveryEvents30d + 1 : detector.totalRecoveryEvents30d;
  const oscillationRatio = driftCount / Math.max(recoveryCount, 1);

  let isOscillating = oscillationRatio > 2.0;
  let oscillationSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | undefined;
  let frozenUntil: Date | undefined;

  if (oscillationRatio > 4.0) {
    oscillationSeverity = 'HIGH';
    isOscillating = true;
    // Freeze confidence for 7 days on high oscillation
    frozenUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  } else if (oscillationRatio > 2.5) {
    oscillationSeverity = 'MEDIUM';
    isOscillating = true;
    // Freeze confidence for 3 days on medium oscillation
    frozenUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  } else if (oscillationRatio > 2.0) {
    oscillationSeverity = 'LOW';
    isOscillating = true;
  }

  // Update detector
  const updatedDetector = await client.query(
    `UPDATE decision_oscillation_detector SET
      total_drift_events_30d = $1,
      total_recovery_events_30d = $2,
      oscillation_ratio = $3,
      is_oscillating = $4,
      oscillation_severity = $5,
      last_oscillation_detected = $6,
      confidence_freeze_until = $7,
      is_confidence_frozen = $8
    WHERE index_name = $9
    RETURNING *`,
    [
      driftCount,
      recoveryCount,
      oscillationRatio,
      isOscillating,
      oscillationSeverity || null,
      isOscillating ? new Date() : null,
      frozenUntil || null,
      !!frozenUntil,
      indexName,
    ]
  );

  return {
    detector: parseOscillationDetector(updatedDetector.rows[0]),
    frozenUntil,
  };
}

/**
 * Check if confidence is frozen for an index
 */
export async function isConfidenceFrozen(
  client: PoolClient,
  indexName: string
): Promise<boolean> {
  const detector = await getOrCreateOscillationDetector(client, indexName);

  if (!detector.isConfidenceFrozen || !detector.confidenceFreezeUntil) {
    return false;
  }

  // Check if freeze window has expired
  if (new Date() > detector.confidenceFreezeUntil) {
    // Unfreeze
    await client.query(
      `UPDATE decision_oscillation_detector SET
        is_confidence_frozen = FALSE,
        confidence_freeze_until = NULL
      WHERE index_name = $1`,
      [indexName]
    );
    return false;
  }

  return true;
}

/**
 * Get milestones for a stability run
 */
export async function getMilestonesForRun(
  client: PoolClient,
  runId: string
): Promise<ConfidenceRecoveryMilestone[]> {
  const result = await client.query(
    `SELECT * FROM confidence_recovery_milestones WHERE run_id = $1 ORDER BY stable_days_threshold ASC`,
    [runId]
  );

  return result.rows.map(row => ({
    milestoneId: row.milestone_id,
    runId: row.run_id,
    indexName: row.index_name,
    stableDaysThreshold: row.stable_days_threshold,
    milestoneReachedAt: new Date(row.milestone_reached_at),
    confidenceBefore: parseFloat(row.confidence_before),
    recoveryAmount: parseFloat(row.recovery_amount),
    confidenceAfter: parseFloat(row.confidence_after),
    milestoneType: row.milestone_type,
  }));
}

/**
 * Get recovery schedule
 */
export function getRecoverySchedule(): Record<
  number,
  { percentage: number; type: string }
> {
  return RECOVERY_SCHEDULE;
}

/**
 * Determine milestone type from threshold days
 */
function getMilestoneType(days: number): 'PARTIAL_14_DAY' | 'FULL_30_DAY' | 'ACCELERATED_RECOVERY' {
  if (days === 14) return 'PARTIAL_14_DAY';
  if (days === 30) return 'FULL_30_DAY';
  return 'ACCELERATED_RECOVERY';
}

/**
 * Parse database row into DecisionStabilityRun
 */
function parseStabilityRun(row: any): DecisionStabilityRun {
  return {
    runId: row.run_id,
    decisionId: row.decision_id,
    indexName: row.index_name,
    consecutiveCleanSnapshots: row.consecutive_clean_snapshots,
    lastCleanSnapshotDate: new Date(row.last_clean_snapshot_date),
    driftFreeDays: row.drift_free_days,
    originalConfidence: parseFloat(row.original_confidence),
    currentPenalizedConfidence: parseFloat(row.current_penalized_confidence),
    confidenceRecoveryApplied: parseFloat(row.confidence_recovery_applied),
    confidenceAfterRecovery: parseFloat(row.confidence_after_recovery),
    recoveryVelocityFactor: parseFloat(row.recovery_velocity_factor),
    lastPenaltyEventDate: row.last_penalty_event_date ? new Date(row.last_penalty_event_date) : undefined,
    historicalDriftCount: row.historical_drift_count || 0,
    recoveryCooldownUntil: row.recovery_cooldown_until ? new Date(row.recovery_cooldown_until) : undefined,
    oscillationMultiplier: parseFloat(row.oscillation_multiplier || '1.0'),
  };
}

/**
 * Parse database row into OscillationDetectorState
 */
function parseOscillationDetector(row: any): OscillationDetectorState {
  return {
    detectorId: row.detector_id,
    indexName: row.index_name,
    totalDriftEvents30d: row.total_drift_events_30d,
    totalRecoveryEvents30d: row.total_recovery_events_30d,
    oscillationRatio: parseFloat(row.oscillation_ratio),
    isOscillating: row.is_oscillating,
    oscillationSeverity: row.oscillation_severity,
    lastOscillationDetected: row.last_oscillation_detected ? new Date(row.last_oscillation_detected) : undefined,
    confidenceFreezeUntil: row.confidence_freeze_until ? new Date(row.confidence_freeze_until) : undefined,
    isConfidenceFrozen: row.is_confidence_frozen,
  };
}
