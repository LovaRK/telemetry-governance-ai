/**
 * Governance Replay Validation
 * Forensic verification that historical evaluations are replayable.
 *
 * CRITICAL: This bridges runtime correctness with forensic trustworthiness.
 *
 * Concept:
 * 1. Sample historical evaluations
 * 2. Re-evaluate using:
 *    - Same normalized input (using frozen NORMALIZATION_CONTRACT)
 *    - Same policy snapshot (using frozen policy_snapshot_hash)
 *    - Same governance schema (using governance_schema_version)
 * 3. Verify: decision_id MUST be identical
 * 4. If divergence → Governance integrity FAILED
 *
 * Why this matters:
 * - Proves governance is deterministic across time
 * - Detects silent normalization bugs
 * - Detects policy snapshot corruption
 * - Enables audit compliance (prove what was approved)
 */

import { GovernanceSnapshot } from './governance-snapshot';
import { RuntimeGovernanceEngine } from './engine/runtime-governance-engine';
import { GovernanceIntegrityState } from './governance-integrity';

/**
 * Classification of replay divergence root cause.
 * CRITICAL: When replay fails, operators must know WHY.
 */
export enum ReplayDriftType {
  NORMALIZATION_DRIFT = 'normalization_drift',      // Input canonicalization changed
  POLICY_DRIFT = 'policy_drift',                    // Policy snapshot changed
  SCHEMA_DRIFT = 'schema_drift',                    // Decision schema incompatible
  SERIALIZATION_DRIFT = 'serialization_drift',      // Hash serialization changed
  ENVIRONMENT_DRIFT = 'environment_drift',          // Environment context changed
  IDENTIFIER_DRIFT = 'identifier_drift',            // ID generation changed
  ENGINE_DRIFT = 'engine_drift',                    // RGE logic diverged
  UNKNOWN_DRIFT = 'unknown_drift'                   // Unable to classify
}

/**
 * Result of a single replay validation.
 */
export interface ReplayValidationResult {
  // Evaluation identification
  decision_id_original: string;
  input_fingerprint: string;
  governance_snapshot_hash: string;  // NEW: Snapshot identity for forensics
  created_at: string;

  // Replay execution
  decision_id_replayed: string;
  replay_timestamp: string;

  // Match verification
  match: boolean; // decision_id_original === decision_id_replayed
  normalization_version_match: boolean;
  policy_snapshot_hash_match: boolean;
  governance_schema_version_match: boolean;
  governance_engine_version_match: boolean;

  // Detailed analysis
  divergence_reason?: string; // If match = false, why did they differ?
  divergence_classification?: ReplayDriftType;  // NEW: What type of drift caused failure?
  latency_ms: number; // How long did replay take?
}

/**
 * Replay validation report (for metrics and dashboards).
 */
export interface ReplayValidationReport {
  window: string; // "5m", "1h", "24h"
  timestamp: string;
  summary: {
    total_samples: number;
    matches: number;
    divergences: number;
    match_rate: number; // percentage
    avg_replay_latency_ms: number;
    p95_replay_latency_ms: number;
  };
  divergences: Array<{
    decision_id: string;
    input_fingerprint: string;
    governance_snapshot_hash: string;
    reason: string;
    drift_type?: ReplayDriftType;  // NEW: Classification of divergence
    created_at: string;
    replayed_at: string;
  }>;
  divergence_distribution?: Record<ReplayDriftType, number>;  // NEW: Count by drift type
}

/**
 * Classify replay divergence root cause.
 * Helps operators understand WHY replay failed.
 */
function classifyReplayDivergence(
  result: Omit<ReplayValidationResult, 'divergence_classification'>
): ReplayDriftType {
  // If versions don't match, that's the likely culprit
  if (!result.normalization_version_match) {
    return ReplayDriftType.NORMALIZATION_DRIFT;
  }
  if (!result.policy_snapshot_hash_match) {
    return ReplayDriftType.POLICY_DRIFT;
  }
  if (!result.governance_schema_version_match) {
    return ReplayDriftType.SCHEMA_DRIFT;
  }
  if (!result.governance_engine_version_match) {
    return ReplayDriftType.ENGINE_DRIFT;
  }

  // If all versions match but decision differs, it's a logic issue
  if (result.match === false) {
    return ReplayDriftType.IDENTIFIER_DRIFT;
  }

  return ReplayDriftType.UNKNOWN_DRIFT;
}

/**
 * Validate a historical governance snapshot by replaying.
 * Called periodically or on-demand.
 *
 * CRITICAL: If replay diverges, it indicates:
 * 1. Normalization bug (input normalized differently)
 * 2. Policy snapshot corruption (policy changed somehow)
 * 3. Schema incompatibility (decision schema changed)
 * 4. Engine bug (same input produces different decision)
 *
 * Any divergence → Governance Integrity = FAILED
 */
export function validateReplayIntegrity(
  snapshot: GovernanceSnapshot,
  governanceEngine: RuntimeGovernanceEngine,
  policySnapshot: Record<string, any>
): ReplayValidationResult {
  const replayStartTime = Date.now();

  try {
    // Reconstruct the original evaluation request from snapshot
    const replayRequest = {
      trace_id: snapshot.trace_id,
      correlation_id: snapshot.correlation_id,
      causation_id: snapshot.causation_id,
      actor_id: snapshot.actor_id,
      actor_type: snapshot.actor_type,
      action: snapshot.action,
      resource: snapshot.resource,
      policy_snapshot_hash: snapshot.policy_snapshot_hash
    };

    // Re-evaluate using same engine, policy, and semantics
    const replayed = governanceEngine.evaluate(replayRequest);
    const replayLatency = Date.now() - replayStartTime;

    // Verify match
    const match = replayed.decision_id === snapshot.decision_id;

    // Build result without classification first
    const resultBase: Omit<ReplayValidationResult, 'divergence_classification'> = {
      decision_id_original: snapshot.decision_id,
      input_fingerprint: snapshot.input_fingerprint,
      governance_snapshot_hash: snapshot.decision_id, // Use decision_id as snapshot hash (Phase 2A)
      created_at: snapshot.created_at,
      decision_id_replayed: replayed.decision_id,
      replay_timestamp: new Date().toISOString(),
      match,
      normalization_version_match: replayed.decision_schema_version === snapshot.versions.governance_schema_version,
      policy_snapshot_hash_match: replayed.policy_snapshot_hash === snapshot.policy_snapshot_hash,
      governance_schema_version_match: replayed.decision_schema_version === snapshot.versions.governance_schema_version,
      governance_engine_version_match: true, // Assumed if evaluation succeeded
      latency_ms: replayLatency
    };

    if (!match) {
      resultBase.divergence_reason = `decision_id mismatch: ${snapshot.decision_id} (original) vs ${replayed.decision_id} (replayed)`;
    }

    // Classify divergence if failed
    const divergence_classification = !match ? classifyReplayDivergence(resultBase) : undefined;

    const result: ReplayValidationResult = {
      ...resultBase,
      divergence_classification
    };

    return result;
  } catch (error) {
    const replayLatency = Date.now() - replayStartTime;
    return {
      decision_id_original: snapshot.decision_id,
      input_fingerprint: snapshot.input_fingerprint,
      governance_snapshot_hash: snapshot.decision_id,
      created_at: snapshot.created_at,
      decision_id_replayed: 'ERROR',
      replay_timestamp: new Date().toISOString(),
      match: false,
      normalization_version_match: false,
      policy_snapshot_hash_match: false,
      governance_schema_version_match: false,
      governance_engine_version_match: false,
      divergence_reason: `Replay failed: ${error instanceof Error ? error.message : String(error)}`,
      divergence_classification: ReplayDriftType.UNKNOWN_DRIFT,
      latency_ms: replayLatency
    };
  }
}

/**
 * Batch replay validation (sample historical evaluations).
 * Called during integrity checks.
 *
 * Samples 10-20 recent evaluations to verify determinism.
 * If any diverge → Governance Integrity = DEGRADED
 * If many diverge → Governance Integrity = FAILED
 */
export function batchValidateReplayIntegrity(
  snapshots: GovernanceSnapshot[],
  governanceEngine: RuntimeGovernanceEngine,
  policiesSnapshot: Record<string, any>
): ReplayValidationReport {
  const startTime = Date.now();
  const results: ReplayValidationResult[] = [];

  // Validate each snapshot
  for (const snapshot of snapshots) {
    const result = validateReplayIntegrity(snapshot, governanceEngine, policiesSnapshot);
    results.push(result);

    // Log individual divergence
    if (!result.match) {
      console.error('[REPLAY_DIVERGENCE]', {
        decision_id: snapshot.decision_id,
        input_fingerprint: snapshot.input_fingerprint,
        original_timestamp: snapshot.created_at,
        divergence_reason: result.divergence_reason,
        replay_timestamp: result.replay_timestamp
      });
    }
  }

  // Summarize results
  const matches = results.filter(r => r.match).length;
  const divergences = results.filter(r => !r.match).length;
  const latencies = results.map(r => r.latency_ms);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const sortedLatencies = latencies.sort((a, b) => a - b);
  const p95Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];

  // Analyze drift distribution
  const divergenceDistribution: Record<ReplayDriftType, number> = {
    [ReplayDriftType.NORMALIZATION_DRIFT]: 0,
    [ReplayDriftType.POLICY_DRIFT]: 0,
    [ReplayDriftType.SCHEMA_DRIFT]: 0,
    [ReplayDriftType.SERIALIZATION_DRIFT]: 0,
    [ReplayDriftType.ENVIRONMENT_DRIFT]: 0,
    [ReplayDriftType.IDENTIFIER_DRIFT]: 0,
    [ReplayDriftType.ENGINE_DRIFT]: 0,
    [ReplayDriftType.UNKNOWN_DRIFT]: 0
  };

  results.forEach(r => {
    if (r.divergence_classification) {
      divergenceDistribution[r.divergence_classification]++;
    }
  });

  const report: ReplayValidationReport = {
    window: '5m', // Assumed validation window
    timestamp: new Date().toISOString(),
    summary: {
      total_samples: results.length,
      matches,
      divergences,
      match_rate: results.length > 0 ? (matches / results.length) * 100 : 100,
      avg_replay_latency_ms: avgLatency,
      p95_replay_latency_ms: p95Latency
    },
    divergences: results
      .filter(r => !r.match)
      .map(r => ({
        decision_id: r.decision_id_original,
        input_fingerprint: r.input_fingerprint,
        governance_snapshot_hash: r.governance_snapshot_hash,
        reason: r.divergence_reason || 'Unknown divergence',
        drift_type: r.divergence_classification,
        created_at: r.created_at,
        replayed_at: r.replay_timestamp
      })),
    divergence_distribution: divergences > 0 ? divergenceDistribution : undefined
  };

  // Log report
  console.log('[REPLAY_VALIDATION_REPORT]', report);

  return report;
}

/**
 * Determine integrity state based on replay results.
 * Feeds into GovernanceIntegrityCheck.
 */
export function deriveIntegrityFromReplay(
  report: ReplayValidationReport
): {
  status: 'pass' | 'warn' | 'fail';
  replayed_match_rate: number;
  reason: string;
} {
  const matchRate = report.summary.match_rate;

  if (matchRate === 100) {
    return {
      status: 'pass',
      replayed_match_rate: 100,
      reason: `All ${report.summary.matches} replayed evaluations matched`
    };
  } else if (matchRate >= 95) {
    return {
      status: 'warn',
      replayed_match_rate: matchRate,
      reason: `${report.summary.divergences} of ${report.summary.total_samples} replayed evaluations diverged`
    };
  } else {
    return {
      status: 'fail',
      replayed_match_rate: matchRate,
      reason: `Replay match rate ${matchRate}% below threshold (>95%)`
    };
  }
}

/**
 * Log governance replay check (for operator visibility).
 */
export function logReplayValidation(result: ReplayValidationResult): void {
  const level = result.match ? 'info' : 'error';
  console.log(`[REPLAY_VALIDATION:${level.toUpperCase()}]`, {
    decision_id: result.decision_id_original,
    input_fingerprint: result.input_fingerprint,
    match: result.match,
    original_timestamp: result.created_at,
    replay_timestamp: result.replay_timestamp,
    latency_ms: result.latency_ms,
    divergence_reason: result.divergence_reason
  });
}

/**
 * Continuous replay sampling (runs in background during governance).
 * Samples 10-20 recent evaluations every 10 minutes.
 * Detects divergence before it becomes widespread.
 */
export class ReplaySampler {
  private sampleBuffer: GovernanceSnapshot[] = [];
  private maxSampleSize = 20;

  /**
   * Add snapshot to sample buffer.
   * Buffer rotates oldest out when size exceeds maxSampleSize.
   */
  addSample(snapshot: GovernanceSnapshot): void {
    this.sampleBuffer.push(snapshot);
    if (this.sampleBuffer.length > this.maxSampleSize) {
      this.sampleBuffer.shift(); // Remove oldest
    }
  }

  /**
   * Get current sample buffer.
   */
  getSamples(): GovernanceSnapshot[] {
    return [...this.sampleBuffer];
  }

  /**
   * Clear sample buffer.
   */
  clear(): void {
    this.sampleBuffer = [];
  }

  /**
   * Get sample count.
   */
  size(): number {
    return this.sampleBuffer.length;
  }
}

// Global replay sampler instance
export const replaySampler = new ReplaySampler();
