/**
 * Governance Telemetry Service
 *
 * Phase 6: Records all governance mutations, aggregates metrics, and tracks operator sessions.
 * Enables observability into mutation latency, failure patterns, version collisions, and operator behavior.
 *
 * Core responsibilities:
 * - Record immutable governance events (mutations, state changes, errors)
 * - Aggregate telemetry by index and time window
 * - Track operator sessions and behavior patterns
 * - Generate audit snapshots for time-travel queries
 */

import { Pool } from 'pg';

export interface GovernanceMutationEvent {
  indexName: string;
  eventType:
    | 'GOVERNANCE_REVIEW_SUBMITTED'
    | 'GOVERNANCE_STATE_TRANSITION'
    | 'GOVERNANCE_VERSION_COLLISION'
    | 'GOVERNANCE_RETRY_AFTER_REFRESH'
    | 'GOVERNANCE_CACHE_DESYNC'
    | 'GOVERNANCE_RATE_LIMITED'
    | 'GOVERNANCE_FORBIDDEN_TRANSITION'
    | 'GOVERNANCE_MUTATION_SUCCESS'
    | 'GOVERNANCE_MUTATION_ABANDONED'
    | 'GOVERNANCE_APPROVAL_EXPIRED'
    | 'GOVERNANCE_CAPABILITY_CHANGED'
    | 'CONFIDENCE_RECOVERY_MILESTONE';

  actionIntent?: 'approve_decision' | 'reject_decision' | 'escalate_decision' | 'request_reanalysis';
  fromState?: string;
  toState?: string;
  mutationId?: string;  // Idempotency key
  reviewerId?: string;
  clientInitiatedAt?: Date;
  clientMutationDurationMs?: number;
  apiResponseCode?: number;
  apiErrorCode?: string;
  apiResponseDurationMs?: number;
  effectiveConfidence?: number;
  confidenceBand?: string;
  governanceCap?: number;
  isCapped?: boolean;
  expectedVersion?: string;
  actualVersion?: string;
  recoveryScore?: number;
  consecutiveStableDays?: number;
  operatorSessionId?: string;
  blockingReason?: string;
}

export interface GovernanceAuditSnapshot {
  indexName: string;
  governanceState: string;
  approvalStateReason?: string;
  lastApproverId?: string;
  lastApprovalTimestamp?: Date;
  approvalExpiresAt?: Date;
  baseConfidence?: number;
  approvalFactor?: number;
  driftPenalty?: number;
  temporalDecay?: number;
  recoveryFactor?: number;
  oscillationMultiplier?: number;
  effectiveConfidence?: number;
  confidenceBand?: string;
  governanceCap?: number;
  isCapped?: boolean;
  recoveryScore?: number;
  consecutiveStableDays?: number;
  daysUntilNextMilestone?: number;
  driftDetected?: boolean;
  driftSeverity?: string;
  driftConfidencePenalty?: number;
  reanalysisPending?: boolean;
  reanalysisPreority?: string;
  reanalysisCooldownUntil?: Date;
  wasRecentlySampled?: boolean;
  lastSampleOutcome?: string;
  expectedVersion?: string;
  mutationCountSinceApproval?: number;
}

export interface OperatorSession {
  reviewerId: string;
  mutationAttempts: number;
  mutationSuccesses: number;
  mutationsAbandoned: number;
  versionCollisionsEncountered: number;
  refreshRetriesPerformed: number;
  indexesReviewed: string[];
  mostCommonAction?: string;
  operatorNotes?: string;
}

export interface TelemetryMetrics {
  indexName: string;
  measurementWindow: Date;
  mutationAttempts: number;
  mutationSuccesses: number;
  mutationFailures: number;
  versionCollisions: number;
  forbiddenTransitions: number;
  rateLimitHits: number;
  mutationsRequiringRefresh: number;
  postRefreshSuccessRate?: number;
  invalidationFailures: number;
  maxStaleDurationMinutes?: number;
  mutationsWithStaleState: number;
  trustInspectionQueries: number;
  avgInspectionLatencyMs?: number;
  trustInspectionErrors: number;
  uniqueReviewers: number;
  avgReviewerSessionDurationMinutes?: number;
  operationsAbandoned: number;
  abandonRatePct?: number;
  activeCooldownCounts: number;
  milestonesAchieved: number;
  recoveryVelocityPctPerDay?: number;
  isDegraded: boolean;
  alertLevel?: 'INFO' | 'WARNING' | 'CRITICAL';
}

export class GovernanceTelemetryService {
  constructor(private pool: Pool) {}

  /**
   * Record a governance mutation event
   * Immutable append-only log of all governance actions
   */
  async recordMutationEvent(event: GovernanceMutationEvent): Promise<string> {
    const query = `
      INSERT INTO governance_mutation_journal (
        index_name, event_type, action_intent, from_state, to_state,
        mutation_id, reviewer_id, client_initiated_at, client_mutation_duration_ms,
        api_response_code, api_error_code, api_response_duration_ms,
        effective_confidence, confidence_band, governance_cap, is_capped,
        expected_version, actual_version, recovery_score, consecutive_stable_days,
        operator_session_id, blocking_reason
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22
      )
      RETURNING event_id;
    `;

    const values = [
      event.indexName,
      event.eventType,
      event.actionIntent || null,
      event.fromState || null,
      event.toState || null,
      event.mutationId || null,
      event.reviewerId || null,
      event.clientInitiatedAt || null,
      event.clientMutationDurationMs || null,
      event.apiResponseCode || null,
      event.apiErrorCode || null,
      event.apiResponseDurationMs || null,
      event.effectiveConfidence || null,
      event.confidenceBand || null,
      event.governanceCap || null,
      event.isCapped || null,
      event.expectedVersion || null,
      event.actualVersion || null,
      event.recoveryScore || null,
      event.consecutiveStableDays || null,
      event.operatorSessionId || null,
      event.blockingReason || null,
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0].event_id;
  }

  /**
   * Create a point-in-time audit snapshot
   * Captures complete governance state at a specific moment
   */
  async createAuditSnapshot(snapshot: GovernanceAuditSnapshot): Promise<string> {
    const query = `
      INSERT INTO governance_audit_snapshots (
        index_name, snapshot_timestamp,
        governance_state, approval_state_reason, last_approver_id, last_approval_timestamp,
        approval_expires_at, base_confidence, approval_factor, drift_penalty,
        temporal_decay, recovery_factor, oscillation_multiplier, effective_confidence,
        confidence_band, governance_cap, is_capped, recovery_score, consecutive_stable_days,
        days_until_next_milestone, drift_detected, drift_severity, drift_confidence_penalty,
        reanalysis_pending, reanalysis_priority_tier, reanalysis_cooldown_until,
        was_recently_sampled, last_sample_outcome, expected_version, mutation_count_since_approval
      ) VALUES (
        $1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
      )
      RETURNING snapshot_id;
    `;

    const values = [
      snapshot.indexName,
      snapshot.governanceState,
      snapshot.approvalStateReason || null,
      snapshot.lastApproverId || null,
      snapshot.lastApprovalTimestamp || null,
      snapshot.approvalExpiresAt || null,
      snapshot.baseConfidence || null,
      snapshot.approvalFactor || null,
      snapshot.driftPenalty || null,
      snapshot.temporalDecay || null,
      snapshot.recoveryFactor || null,
      snapshot.oscillationMultiplier || null,
      snapshot.effectiveConfidence || null,
      snapshot.confidenceBand || null,
      snapshot.governanceCap || null,
      snapshot.isCapped || null,
      snapshot.recoveryScore || null,
      snapshot.consecutiveStableDays || null,
      snapshot.daysUntilNextMilestone || null,
      snapshot.driftDetected || null,
      snapshot.driftSeverity || null,
      snapshot.driftConfidencePenalty || null,
      snapshot.reanalysisPending || null,
      snapshot.reanalysisPreority || null,
      snapshot.reanalysisCooldownUntil || null,
      snapshot.wasRecentlySampled || null,
      snapshot.lastSampleOutcome || null,
      snapshot.expectedVersion || null,
      snapshot.mutationCountSinceApproval || null,
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0].snapshot_id;
  }

  /**
   * Record or update telemetry metrics for a time window
   * Aggregates event counts, latencies, and failure rates
   */
  async recordTelemetry(metrics: TelemetryMetrics): Promise<string> {
    const query = `
      INSERT INTO governance_telemetry (
        index_name, measurement_window,
        mutation_attempts, mutation_successes, mutation_failures,
        version_collisions, forbidden_transitions, rate_limit_hits,
        mutations_requiring_refresh, post_refresh_success_rate,
        invalidation_failures, max_stale_duration_minutes, mutations_with_stale_state,
        trust_inspection_queries, avg_inspection_latency_ms, trust_inspection_errors,
        unique_reviewers, avg_reviewer_session_duration_minutes, operations_abandoned,
        abandon_rate_pct, active_cooldown_counts, milestones_achieved,
        recovery_velocity_pct_per_day, is_degraded, alert_level
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25
      )
      RETURNING telemetry_id;
    `;

    const values = [
      metrics.indexName,
      metrics.measurementWindow,
      metrics.mutationAttempts,
      metrics.mutationSuccesses,
      metrics.mutationFailures,
      metrics.versionCollisions,
      metrics.forbiddenTransitions,
      metrics.rateLimitHits,
      metrics.mutationsRequiringRefresh,
      metrics.postRefreshSuccessRate || null,
      metrics.invalidationFailures,
      metrics.maxStaleDurationMinutes || null,
      metrics.mutationsWithStaleState,
      metrics.trustInspectionQueries,
      metrics.avgInspectionLatencyMs || null,
      metrics.trustInspectionErrors,
      metrics.uniqueReviewers,
      metrics.avgReviewerSessionDurationMinutes || null,
      metrics.operationsAbandoned,
      metrics.abandonRatePct || null,
      metrics.activeCooldownCounts,
      metrics.milestonesAchieved,
      metrics.recoveryVelocityPctPerDay || null,
      metrics.isDegraded,
      metrics.alertLevel || null,
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0].telemetry_id;
  }

  /**
   * Start an operator session
   * Tracks a user's interactions during a governance workflow
   */
  async startOperatorSession(reviewerId: string): Promise<string> {
    const query = `
      INSERT INTO operator_sessions (reviewer_id)
      VALUES ($1)
      RETURNING session_id;
    `;

    const result = await this.pool.query(query, [reviewerId]);
    return result.rows[0].session_id;
  }

  /**
   * End an operator session and record statistics
   */
  async endOperatorSession(
    sessionId: string,
    session: Partial<OperatorSession>
  ): Promise<void> {
    const query = `
      UPDATE operator_sessions
      SET
        ended_at = NOW(),
        session_duration_minutes = EXTRACT(EPOCH FROM (NOW() - started_at)) / 60,
        mutation_attempts = $2,
        mutation_successes = $3,
        mutations_abandoned = $4,
        version_collisions_encountered = $5,
        refresh_retries_performed = $6,
        indexes_reviewed = $7,
        most_common_action = $8,
        operator_notes = $9
      WHERE session_id = $1;
    `;

    await this.pool.query(query, [
      sessionId,
      session.mutationAttempts || 0,
      session.mutationSuccesses || 0,
      session.mutationsAbandoned || 0,
      session.versionCollisionsEncountered || 0,
      session.refreshRetriesPerformed || 0,
      session.indexesReviewed || [],
      session.mostCommonAction || null,
      session.operatorNotes || null,
    ]);
  }

  /**
   * Get audit history for an index within a time range
   * Supports time-travel trust score reconstruction
   */
  async getAuditHistory(
    indexName: string,
    startTime: Date,
    endTime: Date
  ): Promise<any[]> {
    const query = `
      SELECT
        event_id,
        index_name,
        event_time,
        event_source,
        event_type,
        action_intent,
        from_state,
        to_state,
        effective_confidence,
        confidence_band,
        governance_cap,
        api_response_code,
        api_error_code,
        client_mutation_duration_ms,
        api_response_duration_ms,
        reviewer_id,
        blocking_reason
      FROM governance_history_timeline
      WHERE index_name = $1
        AND event_time >= $2
        AND event_time <= $3
      ORDER BY event_time DESC;
    `;

    const result = await this.pool.query(query, [indexName, startTime, endTime]);
    return result.rows;
  }

  /**
   * Get governance health summary
   * Real-time indicators of system health
   */
  async getHealthSummary(): Promise<any> {
    const query = `SELECT * FROM governance_health_summary;`;
    const result = await this.pool.query(query);
    return result.rows[0] || {};
  }

  /**
   * Get events stream for real-time monitoring
   */
  async getEventsStream(limit: number = 100): Promise<any[]> {
    const query = `
      SELECT
        event_id,
        index_name,
        event_type,
        from_state,
        to_state,
        reviewer_id,
        api_response_code,
        api_error_code,
        blocking_reason,
        recorded_at,
        event_severity
      FROM governance_events_stream
      LIMIT $1;
    `;

    const result = await this.pool.query(query, [limit]);
    return result.rows;
  }

  /**
   * Get mutation statistics for an index
   */
  async getMutationStats(indexName: string, windowHours: number = 24): Promise<any> {
    const query = `
      SELECT
        COUNT(*) as total_mutations,
        SUM(CASE WHEN event_type = 'GOVERNANCE_MUTATION_SUCCESS' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN api_response_code >= 400 THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN event_type = 'GOVERNANCE_VERSION_COLLISION' THEN 1 ELSE 0 END) as version_collisions,
        SUM(CASE WHEN event_type = 'GOVERNANCE_CACHE_DESYNC' THEN 1 ELSE 0 END) as invalidation_failures,
        AVG(client_mutation_duration_ms) as avg_client_latency_ms,
        AVG(api_response_duration_ms) as avg_api_latency_ms,
        COUNT(DISTINCT reviewer_id) as unique_reviewers,
        MAX(recorded_at) as most_recent_mutation
      FROM governance_mutation_journal
      WHERE index_name = $1
        AND recorded_at > NOW() - INTERVAL '1 hour' * $2;
    `;

    const result = await this.pool.query(query, [indexName, windowHours]);
    return result.rows[0] || {};
  }

  /**
   * Detect degraded governance health
   * Identifies patterns indicating systemic issues
   */
  async detectDegradedHealth(thresholds: {
    versionCollisionsPerHour?: number;
    invalidationFailuresPerHour?: number;
    abandonRateThreshold?: number;
  }): Promise<{ degradedIndexes: string[]; alerts: any[] }> {
    const versionThreshold = thresholds.versionCollisionsPerHour || 5;
    const invalidationThreshold = thresholds.invalidationFailuresPerHour || 3;
    const abandonThreshold = thresholds.abandonRateThreshold || 0.3;

    const query = `
      SELECT DISTINCT
        gt.index_name,
        gt.version_collisions,
        gt.invalidation_failures,
        gt.abandon_rate_pct,
        CASE
          WHEN gt.version_collisions > $1 THEN 'HIGH_COLLISION_RATE'
          WHEN gt.invalidation_failures > $2 THEN 'INVALIDATION_FLOOD'
          WHEN gt.abandon_rate_pct > $3 THEN 'HIGH_OPERATOR_ABANDON'
          ELSE 'DEGRADED'
        END as alert_type
      FROM governance_telemetry gt
      WHERE gt.is_degraded = TRUE
        AND gt.measurement_window > NOW() - INTERVAL '1 hour'
      ORDER BY gt.measurement_window DESC;
    `;

    const result = await this.pool.query(query, [
      versionThreshold,
      invalidationThreshold,
      abandonThreshold,
    ]);

    const degradedIndexes = [...new Set(result.rows.map((r) => r.index_name))];
    return {
      degradedIndexes,
      alerts: result.rows,
    };
  }

  /**
   * Export audit trail for compliance
   */
  async exportAuditTrail(indexName: string, format: 'json' | 'csv' = 'json'): Promise<string> {
    const query = `
      SELECT
        event_id,
        index_name,
        event_type,
        action_intent,
        from_state,
        to_state,
        reviewer_id,
        api_response_code,
        api_error_code,
        recorded_at
      FROM governance_mutation_journal
      WHERE index_name = $1
      ORDER BY recorded_at ASC;
    `;

    const result = await this.pool.query(query, [indexName]);

    if (format === 'json') {
      return JSON.stringify(result.rows, null, 2);
    } else {
      // CSV format
      const headers = Object.keys(result.rows[0] || {}).join(',');
      const rows = result.rows
        .map((row: any) =>
          Object.values(row)
            .map((v) => (typeof v === 'string' && v.includes(',') ? `"${v}"` : v))
            .join(',')
        )
        .join('\n');
      return `${headers}\n${rows}`;
    }
  }
}

/**
 * Factory function to create a singleton instance
 */
let telemetryServiceInstance: GovernanceTelemetryService | null = null;

export function getGovernanceTelemetryService(pool: Pool): GovernanceTelemetryService {
  if (!telemetryServiceInstance) {
    telemetryServiceInstance = new GovernanceTelemetryService(pool);
  }
  return telemetryServiceInstance;
}
