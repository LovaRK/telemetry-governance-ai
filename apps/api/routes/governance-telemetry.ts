/**
 * Governance Telemetry Routes
 *
 * Endpoints for recording subsystem health metrics (cache coherence, queue reliability, etc.)
 * These feed the multi-dimensional trust evaluation in Phase 0.
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

export function createGovernanceTelemetryRouter(pool: Pool): Router {
  const router = Router();

  /**
   * POST /api/governance/telemetry/coherence
   *
   * Record cache coherence measurement
   * Called by useCacheCoherenceMonitor on every cache update
   */
  router.post('/coherence', async (req: Request, res: Response) => {
    try {
      const {
        traceId,
        correlationId,
        indexName,
        invalidationLatencyMs,
        staleRenderDurationMs,
        coherenceTier,
        targetStateHash,
        actualStateHash,
        recordedAt
      } = req.body;

      // Validate required fields
      if (!traceId || !indexName || invalidationLatencyMs === undefined) {
        return res.status(400).json({
          error: 'Missing required fields'
        });
      }

      const topologyHash = (req as any).topologyHash || 'unknown';

      // Determine if hashes match
      const stateVerified = targetStateHash === actualStateHash;

      // Insert coherence telemetry
      await pool.query(
        `INSERT INTO cache_coherence_telemetry
         (trace_id, correlation_id, index_name, invalidation_latency_ms,
          stale_render_duration_ms, coherence_tier, target_state_hash,
          actual_state_hash, state_verified, topology_hash, recorded_at)
         VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT DO NOTHING`,
        [
          traceId,
          correlationId || null,
          indexName,
          invalidationLatencyMs,
          staleRenderDurationMs || 0,
          coherenceTier || 'NOMINAL',
          targetStateHash || 'UNKNOWN',
          actualStateHash || 'UNVERIFIED',
          stateVerified,
          topologyHash,
          new Date(recordedAt || Date.now())
        ]
      );

      res.json({ recorded: true });
    } catch (err) {
      console.error('Coherence telemetry error:', err);
      res.status(500).json({
        error: 'Failed to record coherence telemetry',
        details: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/governance/metrics/coherence
   *
   * Retrieve coherence metrics for an index
   * Optional window parameter (default 60000ms = 1 minute)
   */
  router.get('/coherence', async (req: Request, res: Response) => {
    try {
      const { indexName, windowMs = 60000 } = req.query;

      if (!indexName) {
        return res.status(400).json({ error: 'indexName required' });
      }

      const windowSeconds = parseInt(windowMs as string) / 1000;

      const result = await pool.query(
        `SELECT
           COUNT(*) as event_count,
           ROUND(AVG(invalidation_latency_ms)::numeric, 2) as average_latency_ms,
           ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY invalidation_latency_ms)::numeric, 2) as p95_latency_ms,
           COUNT(CASE WHEN state_verified THEN 1 END)::float / NULLIF(COUNT(*), 0) as verification_success_rate,
           COUNT(CASE WHEN coherence_tier = 'NOMINAL' THEN 1 END) as nominal_count,
           COUNT(CASE WHEN coherence_tier = 'DEGRADED' THEN 1 END) as degraded_count,
           COUNT(CASE WHEN coherence_tier = 'STALE' THEN 1 END) as stale_count,
           COUNT(CASE WHEN coherence_tier = 'SEVERE' THEN 1 END) as severe_count
         FROM cache_coherence_telemetry
         WHERE index_name = $1
         AND recorded_at > NOW() - INTERVAL '1 second' * $2`,
        [indexName, windowSeconds]
      );

      const metrics = result.rows[0];

      res.json({
        indexName,
        windowMs,
        metrics: {
          eventCount: parseInt(metrics.event_count),
          averageLatencyMs: parseFloat(metrics.average_latency_ms || 0),
          p95LatencyMs: parseFloat(metrics.p95_latency_ms || 0),
          verificationSuccessRate: parseFloat(metrics.verification_success_rate || 0),
          coherenceTierDistribution: {
            nominal: parseInt(metrics.nominal_count),
            degraded: parseInt(metrics.degraded_count),
            stale: parseInt(metrics.stale_count),
            severe: parseInt(metrics.severe_count)
          }
        }
      });
    } catch (err) {
      console.error('Coherence metrics error:', err);
      res.status(500).json({ error: 'Failed to retrieve coherence metrics' });
    }
  });

  /**
   * POST /api/governance/telemetry/als-reliability
   *
   * Record AsyncLocalStorage reliability measurements
   * Part of the ASYNC_STORAGE subsystem domain
   */
  router.post('/als-reliability', async (req: Request, res: Response) => {
    try {
      const {
        boundary, // 'http' | 'queue' | 'sse' | 'retry'
        traceId,
        orphanCount,
        totalSpans,
        recoveryCount,
        unexpectedRootCount,
        windowStartMs,
        windowEndMs
      } = req.body;

      if (!boundary || !traceId) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Calculate reliability score
      const reliability =
        1 -
        (orphanCount * 1.0 + recoveryCount * 0.5 + unexpectedRootCount * 1.5) / totalSpans;

      await pool.query(
        `INSERT INTO governance_mutation_journal
         (trace_id, correlation_id, lifecycle_state, topology_hash,
          execution_class, status, duration_in_state_ms, recorded_at, execution_context, metadata)
         VALUES
         ($1, $2, $3, $4, $5, $6, $7, NOW(), $8,
          jsonb_build_object(
            'telemetryType', 'als_reliability',
            'boundary', $9,
            'orphanCount', $10,
            'totalSpans', $11,
            'recoveryCount', $12,
            'unexpectedRootCount', $13,
            'reliability', $14
          ))`,
        [
          traceId,
          null,
          'ALS_RELIABILITY_RECORDED',
          'unknown',
          'ASYNC_STORAGE',
          'success',
          windowEndMs - windowStartMs,
          'PRODUCTION',
          boundary,
          orphanCount,
          totalSpans,
          recoveryCount,
          unexpectedRootCount,
          Math.max(0, Math.min(1, reliability))
        ]
      );

      res.json({
        recorded: true,
        boundary,
        reliability: Math.max(0, Math.min(1, reliability))
      });
    } catch (err) {
      console.error('ALS reliability telemetry error:', err);
      res.status(500).json({
        error: 'Failed to record ALS reliability'
      });
    }
  });

  /**
   * GET /api/governance/metrics/als-reliability
   *
   * Retrieve AsyncLocalStorage reliability for a boundary
   */
  router.get('/als-reliability/:boundary', async (req: Request, res: Response) => {
    try {
      const { boundary } = req.params;
      const { windowMs = 600000 } = req.query; // Default 10 minutes

      const windowSeconds = parseInt(windowMs as string) / 1000;

      const result = await pool.query(
        `SELECT
           (metadata->>'boundary') as boundary,
           COUNT(*) as measurement_count,
           ROUND(AVG((metadata->>'reliability')::numeric)::numeric, 4) as average_reliability,
           ROUND(PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY (metadata->>'reliability')::numeric)::numeric, 4) as p05_reliability,
           (metadata->>'orphanCount')::int as typical_orphan_count
         FROM governance_mutation_journal
         WHERE metadata->>'telemetryType' = 'als_reliability'
         AND metadata->>'boundary' = $1
         AND recorded_at > NOW() - INTERVAL '1 second' * $2
         GROUP BY boundary, typical_orphan_count`,
        [boundary, windowSeconds]
      );

      const metrics = result.rows[0];

      if (!metrics) {
        return res.json({
          boundary,
          windowMs,
          metrics: {
            measurementCount: 0,
            averageReliability: 1.0,
            p05Reliability: 1.0,
            status: 'NO_DATA'
          }
        });
      }

      res.json({
        boundary,
        windowMs,
        metrics: {
          measurementCount: parseInt(metrics.measurement_count),
          averageReliability: parseFloat(metrics.average_reliability),
          p05Reliability: parseFloat(metrics.p05_reliability),
          typicalOrphanCount: metrics.typical_orphan_count,
          healthStatus:
            parseFloat(metrics.average_reliability) > 0.99
              ? 'EXCELLENT'
              : parseFloat(metrics.average_reliability) > 0.95
              ? 'GOOD'
              : parseFloat(metrics.average_reliability) > 0.90
              ? 'ACCEPTABLE'
              : 'DEGRADED'
        }
      });
    } catch (err) {
      console.error('ALS reliability metrics error:', err);
      res.status(500).json({
        error: 'Failed to retrieve ALS reliability metrics'
      });
    }
  });

  return router;
}
