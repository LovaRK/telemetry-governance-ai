/**
 * Governance Lifecycle Event Routes
 *
 * Endpoints for recording mutation lifecycle state machine progression.
 * These are the primary observability hook for causal chain reconstruction.
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

export function createGovernanceLifecycleRouter(pool: Pool): Router {
  const router = Router();

  /**
   * POST /api/governance/lifecycle-event
   *
   * Record a single lifecycle state transition
   * Called by both frontend (INTENT_RECEIVED, UI_RECONCILED)
   * and backend (all intermediate states)
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const {
        traceId,
        spanId,
        parentSpanId,
        correlationId,
        lifecycleState,
        executionClass,
        executionContext,
        durationInStateMs,
        status,
        errorCode,
        errorMessage,
        indexName,
        payloadHash
      } = req.body;

      // Validate required fields
      if (!traceId || !lifecycleState) {
        return res.status(400).json({
          error: 'Missing required fields: traceId, lifecycleState'
        });
      }

      // Get topology from request if available
      const topologyHash = (req as any).topologyHash || 'unknown';

      // Insert lifecycle event
      await pool.query(
        `INSERT INTO mutation_lifecycle_events
         (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
          status, duration_in_state_ms, error_code, error_message,
          execution_context, metadata, recorded_at)
         VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
        [
          traceId,
          spanId || null,
          parentSpanId || null,
          correlationId || null,
          lifecycleState,
          status || 'success',
          durationInStateMs || 0,
          errorCode || null,
          errorMessage || null,
          executionContext || 'PRODUCTION',
          JSON.stringify({
            executionClass,
            indexName,
            payloadHash,
            topologyHash
          })
        ]
      );

      res.json({
        recorded: true,
        traceId,
        lifecycleState
      });
    } catch (err) {
      console.error('Lifecycle event error:', err);
      res.status(500).json({
        error: 'Failed to record lifecycle event',
        details: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/governance/trace/:traceId/timeline
   *
   * Retrieve complete lifecycle timeline for a trace
   */
  router.get('/trace/:traceId/timeline', async (req: Request, res: Response) => {
    try {
      const { traceId } = req.params;

      const result = await pool.query(
        `SELECT
           trace_id, span_id, parent_span_id, correlation_id,
           lifecycle_state, status, duration_in_state_ms,
           error_code, error_message, recorded_at,
           metadata
         FROM mutation_lifecycle_events
         WHERE trace_id = $1
         ORDER BY recorded_at ASC`,
        [traceId]
      );

      res.json({
        traceId,
        events: result.rows,
        eventCount: result.rows.length,
        durationMs: result.rows.length > 0
          ? new Date(result.rows[result.rows.length - 1].recorded_at).getTime() -
            new Date(result.rows[0].recorded_at).getTime()
          : 0
      });
    } catch (err) {
      console.error('Timeline retrieval error:', err);
      res.status(500).json({ error: 'Failed to retrieve timeline' });
    }
  });

  /**
   * GET /api/governance/trace/:traceId/status
   *
   * Quick status check for a trace (terminal state, error count, etc.)
   */
  router.get('/trace/:traceId/status', async (req: Request, res: Response) => {
    try {
      const { traceId } = req.params;

      const result = await pool.query(
        `SELECT
           COUNT(*) as event_count,
           COUNT(DISTINCT lifecycle_state) as stage_count,
           COUNT(CASE WHEN status = 'error' THEN 1 END) as error_count,
           MAX(recorded_at) as latest_event,
           array_agg(DISTINCT lifecycle_state ORDER BY lifecycle_state) as observed_states
         FROM mutation_lifecycle_events
         WHERE trace_id = $1`,
        [traceId]
      );

      const stats = result.rows[0];

      res.json({
        traceId,
        eventCount: parseInt(stats.event_count),
        stageCount: parseInt(stats.stage_count),
        errorCount: parseInt(stats.error_count),
        latestEvent: stats.latest_event,
        observedStates: stats.observed_states,
        isComplete: stats.event_count > 0
      });
    } catch (err) {
      console.error('Status check error:', err);
      res.status(500).json({ error: 'Failed to check trace status' });
    }
  });

  return router;
}
