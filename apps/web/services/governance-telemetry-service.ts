/**
 * GovernanceTelemetryService
 *
 * Reads from real database tables:
 * - governance_telemetry (health metrics per index)
 * - governance_mutation_journal (event stream)
 *
 * NO mock data. NO fallback values. If DB is empty, returns empty.
 */

import { Pool } from 'pg';

export class GovernanceTelemetryService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Aggregate health summary across all indexes (last 24h)
   */
  async getHealthSummary(): Promise<{
    indexes_with_mutations_24h: number;
    version_collisions_24h: number;
    invalidation_failures_24h: number;
    operations_abandoned_24h: number;
    degraded_indexes: number;
    avg_post_refresh_success_rate: number;
    avg_operator_abandon_rate: number;
  }> {
    const result = await this.pool.query(`
      SELECT
        COUNT(DISTINCT index_name)                              AS indexes_with_mutations_24h,
        COALESCE(SUM(version_collisions), 0)                   AS version_collisions_24h,
        COALESCE(SUM(invalidation_failures), 0)                AS invalidation_failures_24h,
        COALESCE(SUM(operations_abandoned), 0)                 AS operations_abandoned_24h,
        COUNT(*) FILTER (WHERE is_degraded = true)             AS degraded_indexes,
        COALESCE(AVG(post_refresh_success_rate), 0)            AS avg_post_refresh_success_rate,
        COALESCE(AVG(abandon_rate_pct), 0)                     AS avg_operator_abandon_rate
      FROM governance_telemetry
      WHERE measurement_window >= NOW() - INTERVAL '24 hours'
    `);

    const row = result.rows[0] || {};
    return {
      indexes_with_mutations_24h: parseInt(row.indexes_with_mutations_24h || '0', 10),
      version_collisions_24h:     parseInt(row.version_collisions_24h || '0', 10),
      invalidation_failures_24h:  parseInt(row.invalidation_failures_24h || '0', 10),
      operations_abandoned_24h:   parseInt(row.operations_abandoned_24h || '0', 10),
      degraded_indexes:           parseInt(row.degraded_indexes || '0', 10),
      avg_post_refresh_success_rate: parseFloat(row.avg_post_refresh_success_rate || '0'),
      avg_operator_abandon_rate:     parseFloat(row.avg_operator_abandon_rate || '0'),
    };
  }

  /**
   * Per-index mutation statistics
   */
  async getMutationStats(indexName: string, windowHours: number = 24): Promise<{
    mutation_attempts: number;
    mutation_successes: number;
    mutation_failures: number;
    version_collisions: number;
    is_degraded: boolean;
    alert_level: string | null;
  }> {
    const result = await this.pool.query(
      `
      SELECT
        COALESCE(SUM(mutation_attempts), 0)   AS mutation_attempts,
        COALESCE(SUM(mutation_successes), 0)  AS mutation_successes,
        COALESCE(SUM(mutation_failures), 0)   AS mutation_failures,
        COALESCE(SUM(version_collisions), 0)  AS version_collisions,
        BOOL_OR(is_degraded)                  AS is_degraded,
        MAX(alert_level)                      AS alert_level
      FROM governance_telemetry
      WHERE index_name = $1
        AND measurement_window >= NOW() - INTERVAL '1 hour' * $2
      `,
      [indexName, windowHours]
    );

    const row = result.rows[0] || {};
    return {
      mutation_attempts:   parseInt(row.mutation_attempts || '0', 10),
      mutation_successes:  parseInt(row.mutation_successes || '0', 10),
      mutation_failures:   parseInt(row.mutation_failures || '0', 10),
      version_collisions:  parseInt(row.version_collisions || '0', 10),
      is_degraded:         row.is_degraded === true,
      alert_level:         row.alert_level || null,
    };
  }

  /**
   * Recent events stream from governance_mutation_journal
   */
  async getEventsStream(limit: number = 100): Promise<Array<{
    event_id: string;
    index_name: string;
    event_type: string;
    from_state: string | null;
    to_state: string | null;
    reviewer_id: string | null;
    api_response_code: number | null;
    api_error_code: string | null;
    blocking_reason: string | null;
    recorded_at: string;
    event_severity: 'ERROR' | 'COLLISION' | 'SUCCESS' | 'INFO';
  }>> {
    const result = await this.pool.query(
      `
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
        CASE
          WHEN event_type ILIKE '%error%'
            OR event_type ILIKE '%fail%'
            OR event_type ILIKE '%forbidden%'   THEN 'ERROR'
          WHEN event_type ILIKE '%collision%'   THEN 'COLLISION'
          WHEN event_type ILIKE '%success%'
            OR event_type ILIKE '%approved%'    THEN 'SUCCESS'
          ELSE 'INFO'
        END AS event_severity
      FROM governance_mutation_journal
      ORDER BY recorded_at DESC
      LIMIT $1
      `,
      [limit]
    );

    return result.rows.map(row => ({
      event_id:         row.event_id,
      index_name:       row.index_name,
      event_type:       row.event_type,
      from_state:       row.from_state,
      to_state:         row.to_state,
      reviewer_id:      row.reviewer_id,
      api_response_code: row.api_response_code,
      api_error_code:   row.api_error_code,
      blocking_reason:  row.blocking_reason,
      recorded_at:      row.recorded_at,
      event_severity:   row.event_severity,
    }));
  }

  /**
   * Audit history for a specific index
   */
  async getAuditHistory(indexName: string, startTime?: Date, endTime?: Date): Promise<{
    events: any[];
    mutations: { total: number; successful: number; failed: number; abandoned: number };
    errors: { versionCollisions: number; invalidationFailures: number };
  }> {
    const params: any[] = [indexName];
    let timeFilter = '';

    if (startTime) {
      params.push(startTime);
      timeFilter += ` AND recorded_at >= $${params.length}`;
    }
    if (endTime) {
      params.push(endTime);
      timeFilter += ` AND recorded_at <= $${params.length}`;
    }

    const eventsResult = await this.pool.query(
      `SELECT * FROM governance_mutation_journal
       WHERE index_name = $1 ${timeFilter}
       ORDER BY recorded_at DESC
       LIMIT 500`,
      params
    );

    const statsParams: any[] = [indexName];
    let statsTimeFilter = '';
    if (startTime) { statsParams.push(startTime); statsTimeFilter += ` AND measurement_window >= $${statsParams.length}`; }
    if (endTime)   { statsParams.push(endTime);   statsTimeFilter += ` AND measurement_window <= $${statsParams.length}`; }

    const statsResult = await this.pool.query(
      `SELECT
         COALESCE(SUM(mutation_attempts), 0)   AS total,
         COALESCE(SUM(mutation_successes), 0)  AS successful,
         COALESCE(SUM(mutation_failures), 0)   AS failed,
         COALESCE(SUM(operations_abandoned), 0) AS abandoned,
         COALESCE(SUM(version_collisions), 0)  AS version_collisions,
         COALESCE(SUM(invalidation_failures), 0) AS invalidation_failures
       FROM governance_telemetry
       WHERE index_name = $1 ${statsTimeFilter}`,
      statsParams
    );

    const stats = statsResult.rows[0] || {};
    return {
      events: eventsResult.rows,
      mutations: {
        total:     parseInt(stats.total || '0', 10),
        successful: parseInt(stats.successful || '0', 10),
        failed:    parseInt(stats.failed || '0', 10),
        abandoned: parseInt(stats.abandoned || '0', 10),
      },
      errors: {
        versionCollisions:    parseInt(stats.version_collisions || '0', 10),
        invalidationFailures: parseInt(stats.invalidation_failures || '0', 10),
      },
    };
  }
}
