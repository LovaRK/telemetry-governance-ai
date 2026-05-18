/**
 * SystemicAggregator
 *
 * Cross-trace anomaly correlation engine.
 * Runs every 10 seconds to detect systemic failures across multiple traces.
 *
 * Prevents remediation storms by distinguishing:
 * - Individual trace issues (trace-level verdict applies)
 * - Systemic infrastructure failures (single orchestrated response required)
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  SystemicFailureSignal,
  SystemicTrustLevel,
  RootCauseType,
  classifySystemicTrustLevel,
  getRemediationPolicy,
  SYSTEMIC_THRESHOLDS,
} from '../types/systemic-failure-signal';

export class SystemicAggregator {
  private pool: Pool;
  private aggregationIntervalMs = 10000; // 10 seconds
  private running = false;

  constructor(pool: Pool, aggregationIntervalMs?: number) {
    this.pool = pool;
    if (aggregationIntervalMs) {
      this.aggregationIntervalMs = aggregationIntervalMs;
    }
  }

  /**
   * Start the aggregation loop (runs in background)
   */
  start(): void {
    if (this.running) {
      console.warn('SystemicAggregator already running');
      return;
    }

    this.running = true;
    console.log('[SYSTEMIC_AGGREGATOR] Started (interval: ' + this.aggregationIntervalMs + 'ms)');

    // Run aggregation on interval
    setInterval(() => {
      this.aggregateAndPersist().catch((err) => {
        console.error('[SYSTEMIC_AGGREGATOR_ERROR]', err);
      });
    }, this.aggregationIntervalMs);

    // Run once immediately
    this.aggregateAndPersist().catch((err) => {
      console.error('[SYSTEMIC_AGGREGATOR_STARTUP_ERROR]', err);
    });
  }

  /**
   * Stop the aggregation loop
   */
  stop(): void {
    this.running = false;
    console.log('[SYSTEMIC_AGGREGATOR] Stopped');
  }

  /**
   * Main aggregation logic
   */
  private async aggregateAndPersist(): Promise<void> {
    if (!this.running) {
      return;
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Get all tenants with recent traces
      const tenants = await client.query(`
        SELECT DISTINCT tenant_id
        FROM mutation_lifecycle_events
        WHERE recorded_at > NOW() - INTERVAL '2 minutes'
      `);

      for (const { tenant_id } of tenants.rows) {
        await this.aggregateForTenant(client, tenant_id);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Aggregate systemic signals for a single tenant
   */
  private async aggregateForTenant(client: any, tenantId: string): Promise<void> {
    // Get traces from the last 30 seconds grouped by topology
    const topologyGroups = await client.query(
      `
      WITH trace_summary AS (
        SELECT
          mle.trace_id,
          mle.metadata->>'topology' as topology_hash,
          COUNT(*) FILTER (WHERE mle.parent_span_id IS NOT NULL AND NOT EXISTS(
            SELECT 1 FROM mutation_lifecycle_events mle2
            WHERE mle2.trace_id = mle.trace_id
              AND mle2.span_id = mle.parent_span_id
              AND mle2.tenant_id = mle.tenant_id
          )) as orphan_count,
          COUNT(*) FILTER (WHERE mle.span_type = 'RETRY') as retry_count,
          COUNT(*) FILTER (WHERE mle.event_type = 'ORDERING_VIOLATION') as coherence_failures,
          COUNT(*) FILTER (WHERE ABS(EXTRACT(EPOCH FROM (mle.recorded_at - mle.occurred_at))) > 60) as temporal_anomalies,
          COUNT(DISTINCT mle.span_id) as span_count
        FROM mutation_lifecycle_events mle
        WHERE mle.tenant_id = $1
          AND mle.recorded_at > NOW() - INTERVAL '30 seconds'
        GROUP BY mle.trace_id, mle.metadata->>'topology'
      )
      SELECT
        topology_hash,
        COUNT(DISTINCT trace_id) as affected_trace_count,
        ARRAY_AGG(DISTINCT trace_id ORDER BY trace_id LIMIT 10) as sampled_trace_ids,
        AVG(CASE WHEN orphan_count > 0 THEN 1 ELSE 0 END) as orphan_rate,
        AVG(CASE WHEN retry_count > 5 THEN 1 ELSE 0 END) as retry_storm_rate,
        AVG(CASE WHEN coherence_failures > 0 THEN 1 ELSE 0 END) as coherence_failure_rate,
        AVG(CASE WHEN temporal_anomalies > 0 THEN 1 ELSE 0 END) as temporal_anomaly_rate,
        AVG(CASE WHEN span_count > 1000 THEN 1 ELSE 0 END) as cardinality_explosion_rate
      FROM trace_summary
      WHERE topology_hash IS NOT NULL
      GROUP BY topology_hash
      HAVING COUNT(DISTINCT trace_id) >= $2
    `,
      [tenantId, SYSTEMIC_THRESHOLDS.MIN_AFFECTED_TRACES]
    );

    // Process each topology group
    for (const group of topologyGroups.rows) {
      await this.createOrUpdateSignal(client, tenantId, group);
    }
  }

  /**
   * Create or update systemic failure signal
   */
  private async createOrUpdateSignal(
    client: any,
    tenantId: string,
    group: {
      topology_hash: string;
      affected_trace_count: number;
      sampled_trace_ids: string[];
      orphan_rate: number;
      retry_storm_rate: number;
      coherence_failure_rate: number;
      temporal_anomaly_rate: number;
      cardinality_explosion_rate: number;
    }
  ): Promise<void> {
    const trustLevel = classifySystemicTrustLevel(
      group.orphan_rate || 0,
      group.retry_storm_rate || 0,
      group.coherence_failure_rate || 0,
      group.temporal_anomaly_rate || 0,
      group.cardinality_explosion_rate || 0
    );

    const policy = getRemediationPolicy(trustLevel);

    // Determine root cause (heuristic)
    let rootCause: RootCauseType = 'UNKNOWN';
    if (group.coherence_failure_rate > 0.2) {
      rootCause = 'INFRASTRUCTURE'; // Ordering violations suggest infrastructure issues
    } else if (group.cardinality_explosion_rate > 0.2) {
      rootCause = 'DEPLOYMENT'; // Cardinality spikes suggest topology changes
    }

    const signalId = uuidv4();
    const now = new Date();
    const timeWindowStart = new Date(now.getTime() - 30000); // 30 seconds ago

    await client.query(
      `
      INSERT INTO systemic_failure_signals (
        signal_id, tenant_id, topology_hash, time_window_start,
        time_window_duration_seconds, affected_trace_count, sampled_trace_ids,
        orphan_rate, retry_storm_rate, coherence_failure_rate,
        temporal_anomaly_rate, cardinality_explosion_rate,
        systemic_trust_level, allow_local_remediation, escalation_required,
        root_cause, observed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `,
      [
        signalId,
        tenantId,
        group.topology_hash,
        timeWindowStart,
        30, // 30-second aggregation window
        group.affected_trace_count,
        group.sampled_trace_ids || [],
        group.orphan_rate || 0,
        group.retry_storm_rate || 0,
        group.coherence_failure_rate || 0,
        group.temporal_anomaly_rate || 0,
        group.cardinality_explosion_rate || 0,
        trustLevel,
        policy.allowLocalRemediation,
        policy.escalationRequired,
        rootCause,
        now,
      ]
    );

    // Log the signal
    console.log('[SYSTEMIC_SIGNAL_CREATED]', {
      signalId,
      tenantId,
      topologyHash: group.topology_hash,
      affectedTraces: group.affected_trace_count,
      trustLevel,
      orphanRate: (group.orphan_rate || 0).toFixed(3),
      retryStormRate: (group.retry_storm_rate || 0).toFixed(3),
      escalationRequired: policy.escalationRequired,
    });

    // Emit incident alert if escalation required
    if (policy.escalationRequired) {
      await this.emitEscalation(tenantId, signalId, trustLevel, group);
    }
  }

  /**
   * Emit escalation alert to incident management system
   */
  private async emitEscalation(
    tenantId: string,
    signalId: string,
    trustLevel: SystemicTrustLevel,
    group: {
      topology_hash: string;
      affected_trace_count: number;
      sampled_trace_ids: string[];
      orphan_rate: number;
      retry_storm_rate: number;
      coherence_failure_rate: number;
      temporal_anomaly_rate: number;
      cardinality_explosion_rate: number;
    }
  ): Promise<void> {
    const severity = trustLevel === 'COLLAPSED' ? 'SEV-2' : 'SEV-3';

    console.log('[ESCALATION_ALERT]', {
      severity,
      signalId,
      tenantId,
      topologyHash: group.topology_hash,
      title: `Systemic trace coherence ${trustLevel} in ${group.topology_hash}`,
      affectedTraces: group.affected_trace_count,
      sampledTraceIds: group.sampled_trace_ids.slice(0, 5),
      metrics: {
        orphanRate: group.orphan_rate,
        retryStormRate: group.retry_storm_rate,
        coherenceFailureRate: group.coherence_failure_rate,
      },
      automationStatus: 'PAUSED',
      recommendedAction:
        trustLevel === 'COLLAPSED' ? 'INVESTIGATE_IMMEDIATELY' : 'INVESTIGATE_TOPOLOGY_CHANGE',
    });

    // In production, this would call PagerDuty, Opsgenie, or similar
    // For now, just log (integration pending)
  }

  /**
   * Get latest signal for a topology (for remediation gate checks)
   */
  async getLatestSignal(
    tenantId: string,
    topologyHash: string
  ): Promise<SystemicFailureSignal | null> {
    const result = await this.pool.query(
      `
      SELECT
        signal_id, tenant_id, topology_hash, time_window_start,
        time_window_duration_seconds, affected_trace_count, sampled_trace_ids,
        orphan_rate, retry_storm_rate, coherence_failure_rate,
        temporal_anomaly_rate, cardinality_explosion_rate,
        systemic_trust_level, allow_local_remediation, escalation_required,
        root_cause, observed_at
      FROM systemic_failure_signals
      WHERE tenant_id = $1 AND topology_hash = $2
      ORDER BY observed_at DESC
      LIMIT 1
      `,
      [tenantId, topologyHash]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return this.rowToSignal(row);
  }

  /**
   * Convert database row to SystemicFailureSignal
   */
  private rowToSignal(row: any): SystemicFailureSignal {
    return {
      signalId: row.signal_id,
      tenantId: row.tenant_id,
      topologyHash: row.topology_hash,
      timeWindow: {
        startedAt: new Date(row.time_window_start).toISOString(),
        duration_seconds: row.time_window_duration_seconds,
      },
      affectedTraceCount: row.affected_trace_count,
      sampledTraceIds: row.sampled_trace_ids || [],
      orphanRate: parseFloat(row.orphan_rate),
      retryStormRate: parseFloat(row.retry_storm_rate),
      coherenceFailureRate: parseFloat(row.coherence_failure_rate),
      temporalAnomalyRate: parseFloat(row.temporal_anomaly_rate),
      cardinalityExplosionRate: parseFloat(row.cardinality_explosion_rate),
      systemicTrustLevel: row.systemic_trust_level,
      allowLocalRemediation: row.allow_local_remediation,
      escalationRequired: row.escalation_required,
      rootCause: row.root_cause as RootCauseType | null,
      observedAt: new Date(row.observed_at).toISOString(),
      correlatedEvents: row.correlated_events || [],
    };
  }
}
