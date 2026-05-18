/**
 * SystemicFailureSignal
 *
 * Represents cross-trace anomaly correlation within a time window.
 * Used by Phase 2A.1 to prevent automation remediation storms during systemic failures.
 *
 * Example: Worker pool topology change affects 50 traces simultaneously.
 * Without this: 50 independent "DEGRADED" verdicts → 50 concurrent remediations
 * With this: 1 "SYSTEMIC_DEGRADED" signal → automation gate blocks aggressive actions
 */

export type SystemicTrustLevel = 'HEALTHY' | 'DEGRADED' | 'COLLAPSED';
export type RootCauseType = 'DEPLOYMENT' | 'INFRASTRUCTURE' | 'UNKNOWN';
export type CorrelatedEventType = 'TOPOLOGY_CHANGE' | 'NETWORK_PARTITION' | 'RESOURCE_EXHAUSTION';

export interface CorrelatedEvent {
  type: CorrelatedEventType;
  evidence: string[]; // Human-readable evidence (e.g., ["topology version changed from v1 to v2"])
}

export interface TimeWindow {
  startedAt: string; // ISO8601
  duration_seconds: number; // Aggregation window size
}

export interface SystemicFailureSignal {
  // Identity
  signalId: string; // UUID for deduplication
  tenantId: string;
  observedAt: string; // ISO8601 when signal was detected

  // Scope
  topologyHash: string; // Hash of deployment topology (worker pool, version, etc)
  timeWindow: TimeWindow;

  // Prevalence Metrics
  affectedTraceCount: number; // How many traces show this anomaly
  sampledTraceIds: string[]; // Representative sample (up to 10) for investigation

  // Failure Signature Rates (0-1 scale)
  orphanRate: number; // % of traces with orphan spans (no parent)
  retryStormRate: number; // % of traces with >5 retries
  coherenceFailureRate: number; // % of traces with ordering violations
  temporalAnomalyRate: number; // % with clock skew or impossible latencies
  cardinalityExplosionRate: number; // % exceeding span cardinality threshold

  // Automation Gate Decision
  systemicTrustLevel: SystemicTrustLevel;
  allowLocalRemediation: boolean; // Can Phase 6.2 act on individual traces?
  escalationRequired: boolean; // Does this need SRE investigation?

  // Root Cause Analysis
  rootCause: RootCauseType | null;
  correlatedEvents: CorrelatedEvent[]; // Events that may have triggered this signal
}

/**
 * Thresholds for classifying systemic trust level
 */
export const SYSTEMIC_THRESHOLDS = {
  // Minimum affected traces before considering something "systemic"
  MIN_AFFECTED_TRACES: 5,

  // Healthy baseline rates (things that happen naturally)
  HEALTHY_ORPHAN_RATE: 0.02, // 2%
  HEALTHY_RETRY_RATE: 0.10, // 10%
  HEALTHY_COHERENCE_FAILURE_RATE: 0.01, // 1%
  HEALTHY_TEMPORAL_ANOMALY_RATE: 0.02, // 2%
  HEALTHY_CARDINALITY_EXPLOSION_RATE: 0.01, // 1%

  // Degraded thresholds (something is wrong, but not total failure)
  DEGRADED_ORPHAN_RATE: 0.15, // 15%
  DEGRADED_RETRY_RATE: 0.30, // 30%
  DEGRADED_COHERENCE_FAILURE_RATE: 0.10, // 10%
  DEGRADED_TEMPORAL_ANOMALY_RATE: 0.10, // 10%
  DEGRADED_CARDINALITY_EXPLOSION_RATE: 0.15, // 15%

  // Collapsed thresholds (system-wide failure)
  COLLAPSED_ORPHAN_RATE: 0.50, // 50%
  COLLAPSED_RETRY_RATE: 0.60, // 60%
  COLLAPSED_COHERENCE_FAILURE_RATE: 0.40, // 40%
  COLLAPSED_TEMPORAL_ANOMALY_RATE: 0.50, // 50%
  COLLAPSED_CARDINALITY_EXPLOSION_RATE: 0.50, // 50%

  // Aggregation window
  AGGREGATION_WINDOW_SECONDS: 30,
};

/**
 * Classify systemic trust level based on failure signature rates
 */
export function classifySystemicTrustLevel(
  orphanRate: number,
  retryStormRate: number,
  coherenceFailureRate: number,
  temporalAnomalyRate: number,
  cardinalityExplosionRate: number
): SystemicTrustLevel {
  // Check for COLLAPSED first (highest severity)
  if (
    orphanRate > SYSTEMIC_THRESHOLDS.COLLAPSED_ORPHAN_RATE ||
    retryStormRate > SYSTEMIC_THRESHOLDS.COLLAPSED_RETRY_RATE ||
    coherenceFailureRate > SYSTEMIC_THRESHOLDS.COLLAPSED_COHERENCE_FAILURE_RATE ||
    temporalAnomalyRate > SYSTEMIC_THRESHOLDS.COLLAPSED_TEMPORAL_ANOMALY_RATE ||
    cardinalityExplosionRate > SYSTEMIC_THRESHOLDS.COLLAPSED_CARDINALITY_EXPLOSION_RATE
  ) {
    return 'COLLAPSED';
  }

  // Check for DEGRADED
  if (
    orphanRate > SYSTEMIC_THRESHOLDS.DEGRADED_ORPHAN_RATE ||
    retryStormRate > SYSTEMIC_THRESHOLDS.DEGRADED_RETRY_RATE ||
    coherenceFailureRate > SYSTEMIC_THRESHOLDS.DEGRADED_COHERENCE_FAILURE_RATE ||
    temporalAnomalyRate > SYSTEMIC_THRESHOLDS.DEGRADED_TEMPORAL_ANOMALY_RATE ||
    cardinalityExplosionRate > SYSTEMIC_THRESHOLDS.DEGRADED_CARDINALITY_EXPLOSION_RATE
  ) {
    return 'DEGRADED';
  }

  // Otherwise HEALTHY
  return 'HEALTHY';
}

/**
 * Determine remediation gate decision based on systemic trust level
 */
export function getRemediationPolicy(
  trustLevel: SystemicTrustLevel
): { allowLocalRemediation: boolean; escalationRequired: boolean; allowedActions: string[] } {
  switch (trustLevel) {
    case 'COLLAPSED':
      return {
        allowLocalRemediation: false,
        escalationRequired: true,
        allowedActions: [], // No automation allowed
      };

    case 'DEGRADED':
      return {
        allowLocalRemediation: true,
        escalationRequired: false,
        allowedActions: ['CACHE_INVALIDATE', 'RETRY_BACKOFF', 'LOG_ONLY'],
      };

    case 'HEALTHY':
    default:
      return {
        allowLocalRemediation: true,
        escalationRequired: false,
        allowedActions: ['CACHE_INVALIDATE', 'RETRY_BACKOFF', 'CIRCUIT_BREAKER', 'TOPOLOGY_FAILOVER'],
      };
  }
}
