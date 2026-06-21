/**
 * Governance Audit Routes
 * REST endpoints for querying the immutable governance audit trail.
 *
 * All endpoints are read-only (audit is append-only by design).
 * Supports both in-memory buffer queries (fast, recent) and DB queries (historical).
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import {
  getByActor,
  getByAction,
  getByDecisionId,
  getByTimeRange,
  getDenyDecisions,
  getRecent,
  getBufferSize,
  getAuditHealthSummary,
  queryAuditEventsFromDB,
  AuditQueryOptions
} from '../../../core/governance/governance-audit-store';
import { Decision, RiskLevel } from '../../../core/governance/engine/decision-model';

export function createGovernanceAuditRouter(_pool: Pool): Router {
  const router = Router();

  /**
   * GET /api/governance/audit/health
   * Audit store health summary (write failures, buffer size, rates).
   */
  router.get('/health', (_req: Request, res: Response) => {
    try {
      const summary = getAuditHealthSummary();
      res.json({
        ok: summary.write_failures === 0,
        buffer_size: summary.buffer_size,
        write_failures: summary.write_failures,
        write_successes: summary.write_successes,
        write_failure_rate: summary.write_failure_rate,
        oldest_event: summary.oldest_event,
        newest_event: summary.newest_event,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * GET /api/governance/audit/recent?count=20
   * Get the N most recent audit events from in-memory buffer.
   */
  router.get('/recent', (req: Request, res: Response) => {
    try {
      const count = Math.min(parseInt(String(req.query.count ?? '20'), 10), 200);
      const events = getRecent(count);
      res.json({
        events,
        count: events.length,
        buffer_size: getBufferSize(),
        from_cache: true,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/governance/audit/actor/:actorId
   * Get all audit events for a specific actor.
   * Query params: limit (default 50)
   */
  router.get('/actor/:actorId', (req: Request, res: Response) => {
    try {
      const { actorId } = req.params;
      const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 500);

      if (!actorId) {
        return res.status(400).json({ error: 'actorId is required' });
      }

      const events = getByActor(actorId, limit);
      res.json({
        actorId,
        events,
        count: events.length,
        from_cache: true,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/governance/audit/action/:action
   * Get all audit events for a specific action type.
   * Query params: limit (default 50)
   */
  router.get('/action/:action', (req: Request, res: Response) => {
    try {
      const { action } = req.params;
      const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 500);

      if (!action) {
        return res.status(400).json({ error: 'action is required' });
      }

      const events = getByAction(action, limit);
      res.json({
        action,
        events,
        count: events.length,
        from_cache: true,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/governance/audit/decision/:decisionId
   * Get all audit events for a specific decision_id (forensic lookup).
   */
  router.get('/decision/:decisionId', (req: Request, res: Response) => {
    try {
      const { decisionId } = req.params;

      if (!decisionId) {
        return res.status(400).json({ error: 'decisionId is required' });
      }

      const events = getByDecisionId(decisionId);
      res.json({
        decisionId,
        events,
        count: events.length,
        from_cache: true,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/governance/audit/denials
   * Get all DENY decisions (for approval review workflow).
   * Query params: limit (default 100)
   */
  router.get('/denials', (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10), 500);
      const events = getDenyDecisions(limit);
      res.json({
        events,
        count: events.length,
        from_cache: true,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/governance/audit/search
   * Search audit events with flexible filters.
   *
   * Query params:
   *   from        ISO timestamp
   *   to          ISO timestamp
   *   actor       actor display name (partial match)
   *   actorId     exact actor ID
   *   action      action name (partial match)
   *   decision    ALLOW | DENY | REQUIRE_APPROVAL | ...
   *   riskLevel   LOW | MODERATE | HIGH | CRITICAL
   *   environment sandbox | production
   *   limit       max results (default 100, max 500)
   *   offset      pagination offset (default 0)
   *   source      buffer | db (default: buffer)
   */
  router.get('/search', async (req: Request, res: Response) => {
    try {
      const options: AuditQueryOptions = {
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        actor: req.query.actor ? String(req.query.actor) : undefined,
        actorId: req.query.actorId ? String(req.query.actorId) : undefined,
        action: req.query.action ? String(req.query.action) : undefined,
        decision: req.query.decision ? (String(req.query.decision) as Decision) : undefined,
        riskLevel: req.query.riskLevel ? (String(req.query.riskLevel) as RiskLevel) : undefined,
        environment: req.query.environment as 'sandbox' | 'production' | undefined,
        limit: Math.min(parseInt(String(req.query.limit ?? '100'), 10), 500),
        offset: parseInt(String(req.query.offset ?? '0'), 10)
      };

      const source = req.query.source === 'db' ? 'db' : 'buffer';

      let result;
      if (source === 'db') {
        result = await queryAuditEventsFromDB(options);
      } else {
        const { queryAuditEvents } = require('../../../core/governance/governance-audit-store');
        result = queryAuditEvents(options);
      }

      res.json({
        ...result,
        source,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/governance/audit/range
   * Get audit events within a time range.
   * Query params: from (required), to (required), limit (default 200)
   */
  router.get('/range', (req: Request, res: Response) => {
    try {
      const { from, to } = req.query;

      if (!from || !to) {
        return res.status(400).json({ error: 'from and to query parameters are required' });
      }

      const limit = Math.min(parseInt(String(req.query.limit ?? '200'), 10), 1000);
      const events = getByTimeRange(String(from), String(to), limit);

      res.json({
        from,
        to,
        events,
        count: events.length,
        from_cache: true,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * GET /api/governance/audit/summary
   * Aggregate summary: counts by decision, risk level, action, actor.
   * Useful for compliance dashboards.
   */
  router.get('/summary', (req: Request, res: Response) => {
    try {
      const { getRecent: getRecentEvents } = require('../../../core/governance/governance-audit-store');
      const events = getRecentEvents(500); // Up to 500 recent events

      const byDecision: Record<string, number> = {};
      const byRiskLevel: Record<string, number> = {};
      const byAction: Record<string, number> = {};
      const byActor: Record<string, number> = {};
      const byEnvironment: Record<string, number> = {};

      for (const e of events) {
        byDecision[String(e.decision)] = (byDecision[String(e.decision)] ?? 0) + 1;
        byRiskLevel[String(e.riskLevel)] = (byRiskLevel[String(e.riskLevel)] ?? 0) + 1;
        byAction[e.action] = (byAction[e.action] ?? 0) + 1;
        byActor[e.actorId] = (byActor[e.actorId] ?? 0) + 1;
        byEnvironment[e.environment] = (byEnvironment[e.environment] ?? 0) + 1;
      }

      res.json({
        total_events: events.length,
        by_decision: byDecision,
        by_risk_level: byRiskLevel,
        by_action: byAction,
        by_actor: byActor,
        by_environment: byEnvironment,
        audit_health: getAuditHealthSummary(),
        from_cache: true,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
