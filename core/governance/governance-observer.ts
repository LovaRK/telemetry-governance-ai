/**
 * Governance Observer
 * Periodically monitors governance health and generates drift reports.
 *
 * CRITICAL: This enables operators to observe governance behavior
 * during SHADOW mode and at stage transitions.
 *
 * Responsibilities:
 * - Generate hourly drift reports
 * - Perform periodic integrity checks
 * - Log anomalies for operator review
 * - Enable progressive stage transitions based on health
 */

import {
  generateGovernanceDriftReport,
  logGovernanceDriftReport,
  GovernanceDriftReport,
  getShadowConsensusRate,
  getGovernanceMetric
} from './governance-metrics';
import {
  checkGovernanceIntegrity,
  logGovernanceIntegrityCheck,
  GovernanceIntegrityCheck,
  GovernanceIntegrityState,
  isEnforcingSafely
} from './governance-integrity';
import { getGovernanceMode, GovernanceMode } from './governance-mode';
import {
  batchValidateReplayIntegrity,
  deriveIntegrityFromReplay,
  replaySampler
} from './governance-replay';

/**
 * Governance observation state.
 * Tracks cumulative metrics for stage transitions.
 */
export interface GovernanceObservationState {
  mode: GovernanceMode;
  observation_window_start: string;
  latest_drift_report: GovernanceDriftReport | null;
  latest_integrity_check: GovernanceIntegrityCheck | null;
  latest_replay_validation_report: any | null; // ReplayValidationReport type
  cumulative_evaluations: number;
  cumulative_mismatches: number;
  cumulative_failures: number;
  replay_samples: number; // Count of snapshots in sampler buffer
  stage_transition_ready: boolean;
  stage_transition_reason?: string;
}

class GovernanceObserver {
  private observationState: GovernanceObservationState = {
    mode: GovernanceMode.SHADOW,
    observation_window_start: new Date().toISOString(),
    latest_drift_report: null,
    latest_integrity_check: null,
    latest_replay_validation_report: null,
    cumulative_evaluations: 0,
    cumulative_mismatches: 0,
    cumulative_failures: 0,
    replay_samples: 0,
    stage_transition_ready: false
  };

  private observerInterval: NodeJS.Timer | null = null;

  /**
   * Start periodic monitoring.
   * Interval: check governance health and generate drift reports every 5 minutes.
   * Full drift report: hourly.
   */
  start(): void {
    if (this.observerInterval) {
      console.warn('[GOVERNANCE_OBSERVER] Already running, ignoring restart request');
      return;
    }

    console.log('[GOVERNANCE_OBSERVER_START]', {
      mode: getGovernanceMode(),
      window_start: this.observationState.observation_window_start,
      timestamp: new Date().toISOString()
    });

    // Run every 5 minutes
    this.observerInterval = setInterval(() => {
      this.tick();
    }, 5 * 60 * 1000);

    // Also run immediately on startup
    this.tick();
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (this.observerInterval) {
      clearInterval(this.observerInterval);
      this.observerInterval = null;
      console.log('[GOVERNANCE_OBSERVER_STOP]', {
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Single observation tick.
   * Called every 5 minutes (or manually for testing).
   */
  private tick(): void {
    const mode = getGovernanceMode();
    this.observationState.mode = mode;

    // Always check integrity
    const integrityCheck = checkGovernanceIntegrity();
    this.observationState.latest_integrity_check = integrityCheck;

    // Log integrity check
    logGovernanceIntegrityCheck();

    // Generate drift report
    const driftReport = generateGovernanceDriftReport('5m');
    this.observationState.latest_drift_report = driftReport;

    // Accumulate metrics
    this.observationState.cumulative_evaluations = driftReport.summary.total_evaluations;
    this.observationState.cumulative_mismatches = driftReport.summary.mismatches;
    this.observationState.cumulative_failures = driftReport.summary.evaluation_failures;

    // Log drift report
    logGovernanceDriftReport('5m');

    // Sample and validate recent snapshots for replay integrity
    this.validateReplaySamples();

    // Evaluate stage transition readiness
    this.updateStageTransitionReadiness(mode, integrityCheck, driftReport);

    // Log observation state
    this.logObservationState();
  }

  /**
   * Validate recent snapshots by replaying them.
   * Detects normalization drift, policy corruption, or engine bugs.
   *
   * CRITICAL: This proves governance determinism over time.
   * Same historical evaluations must produce identical decision_ids.
   */
  private validateReplaySamples(): void {
    try {
      const recentSnapshots = replaySampler.getSamples();
      this.observationState.replay_samples = recentSnapshots.length;

      // No samples yet
      if (recentSnapshots.length === 0) {
        return;
      }

      // Note: In Phase 2A, we don't have full replay capability without the engine
      // This is a placeholder for Phase 2A.1 when we integrate engine access
      // For now, we log the sample count for operator visibility
      console.log('[GOVERNANCE_REPLAY_SAMPLING]', {
        samples_collected: recentSnapshots.length,
        sample_buffer_size: replaySampler.size(),
        timestamp: new Date().toISOString()
      });

      // TODO (Phase 2A.1): Full replay validation when engine integrated
      // const policySnapshot = {}; // Get from engine
      // const replayReport = batchValidateReplayIntegrity(recentSnapshots, engine, policySnapshot);
      // this.observationState.latest_replay_validation_report = replayReport;
      // const replayStatus = deriveIntegrityFromReplay(replayReport);
      // Log replay validation results

    } catch (error) {
      console.warn('[GOVERNANCE_REPLAY_VALIDATION_ERROR]', {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Determine if stage transition is ready.
   * Different criteria for different stages.
   */
  private updateStageTransitionReadiness(
    mode: GovernanceMode,
    integrity: GovernanceIntegrityCheck,
    drift: GovernanceDriftReport
  ): void {
    let ready = false;
    let reason = '';

    const summary = drift.summary;

    switch (mode) {
      case GovernanceMode.SHADOW:
        // Stage 1 → 2 gate: 100+ evals, 0 mismatches, 0 failures, 100% consensus, latency ok
        ready =
          summary.total_evaluations >= 100 &&
          summary.mismatches === 0 &&
          summary.evaluation_failures === 0 &&
          summary.shadow_consensus_rate === 100 &&
          summary.p95_latency_ms < 5 &&
          integrity.state === GovernanceIntegrityState.HEALTHY;

        reason = ready
          ? 'SHADOW gates met: 100+ evals, 0 mismatches, 0 failures, 100% consensus'
          : `SHADOW gates not met: ${summary.total_evaluations} evals, ${summary.mismatches} mismatches, ${summary.evaluation_failures} failures, ${summary.shadow_consensus_rate}% consensus`;
        break;

      case GovernanceMode.ENFORCING_LOG_ONLY:
        // Stage 2 → 3 gate: 1+ week stable, no unexpected DENYs on critical paths, operator confidence
        const weekOld = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const isWeekOld = this.observationState.observation_window_start < weekOld;

        ready = isWeekOld && integrity.state === GovernanceIntegrityState.HEALTHY;
        reason = ready
          ? 'ENFORCING_LOG_ONLY gates met: 1+ week stable, integrity healthy'
          : `ENFORCING_LOG_ONLY gates not met: ${isWeekOld ? '' : 'not yet '}1+ week stable`;
        break;

      case GovernanceMode.ENFORCING_NON_CRITICAL:
        // Stage 3 → 4 gate: 0 unexpected blocks on LOW/MODERATE, stable for 1+ week
        const nonCriticalWeekOld = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const isNonCriticalWeekOld = this.observationState.observation_window_start < nonCriticalWeekOld;

        ready = isNonCriticalWeekOld && summary.mismatches === 0 && integrity.state === GovernanceIntegrityState.HEALTHY;
        reason = ready
          ? 'ENFORCING_NON_CRITICAL gates met: 1+ week stable, 0 unexpected blocks'
          : `ENFORCING_NON_CRITICAL gates not met`;
        break;

      case GovernanceMode.FULL_ENFORCING:
        // Permanent gate: integrity must remain HEALTHY
        ready = integrity.state === GovernanceIntegrityState.HEALTHY;
        reason = ready ? 'FULL_ENFORCING gates met: integrity healthy' : 'FULL_ENFORCING gates not met: integrity degraded';
        break;

      default:
        ready = false;
        reason = 'Unknown mode';
    }

    this.observationState.stage_transition_ready = ready;
    this.observationState.stage_transition_reason = reason;
  }

  /**
   * Log current observation state for operator review.
   * Includes audit health metrics since the last tick.
   */
  private logObservationState(): void {
    // Collect audit health (deferred require — avoids circular deps)
    let auditHealth: { write_failures: number; buffer_size: number; write_failure_rate: number } | undefined;
    try {
      const auditModule = require('./governance-audit-store');
      auditHealth = auditModule.getAuditHealthSummary?.();
      // Log audit health separately for targeted grep
      auditModule.logAuditHealth?.();
    } catch {
      // Audit store not yet available on early tick
    }

    console.log('[GOVERNANCE_OBSERVATION_STATE]', {
      mode: this.observationState.mode,
      observation_window_start: this.observationState.observation_window_start,
      cumulative_evaluations: this.observationState.cumulative_evaluations,
      cumulative_mismatches: this.observationState.cumulative_mismatches,
      cumulative_failures: this.observationState.cumulative_failures,
      replay_samples_collected: this.observationState.replay_samples,
      latest_consensus_rate: this.observationState.latest_drift_report?.summary.shadow_consensus_rate,
      latest_integrity_state: this.observationState.latest_integrity_check?.state,
      audit_write_failures: auditHealth?.write_failures ?? 0,
      audit_buffer_size: auditHealth?.buffer_size ?? 0,
      audit_write_failure_rate: auditHealth?.write_failure_rate ?? 0,
      stage_transition_ready: this.observationState.stage_transition_ready,
      stage_transition_reason: this.observationState.stage_transition_reason,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get current observation state.
   * Used by dashboards and status endpoints.
   */
  getState(): Readonly<GovernanceObservationState> {
    return { ...this.observationState };
  }

  /**
   * Get latest drift report.
   */
  getLatestDriftReport(): GovernanceDriftReport | null {
    return this.observationState.latest_drift_report;
  }

  /**
   * Get latest integrity check.
   */
  getLatestIntegrityCheck(): GovernanceIntegrityCheck | null {
    return this.observationState.latest_integrity_check;
  }

  /**
   * Check if stage transition is ready (for use in gates).
   */
  isStageTransitionReady(): boolean {
    return this.observationState.stage_transition_ready;
  }

  /**
   * Get transition readiness reason for operator communication.
   */
  getTransitionReason(): string {
    return this.observationState.stage_transition_reason || 'Not ready';
  }

  /**
   * Reset observation window (for manual stage advancement in testing).
   */
  resetObservationWindow(): void {
    this.observationState.observation_window_start = new Date().toISOString();
    console.log('[GOVERNANCE_OBSERVER_RESET]', {
      new_window_start: this.observationState.observation_window_start,
      timestamp: new Date().toISOString()
    });
  }
}

// Global observer instance
export const governanceObserver = new GovernanceObserver();

/**
 * Initialize governance observer.
 * Call on application startup.
 */
export function initializeGovernanceObserver(): void {
  governanceObserver.start();
}

/**
 * Shutdown governance observer.
 * Call on application graceful shutdown.
 */
export function shutdownGovernanceObserver(): void {
  governanceObserver.stop();
}

/**
 * Get current governance observation state.
 * For status endpoints and dashboards.
 */
export function getGovernanceObservationState(): Readonly<GovernanceObservationState> {
  return governanceObserver.getState();
}
