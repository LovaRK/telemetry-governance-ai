/**
 * Governance Approval Routes
 * REST endpoints for the approval workflow.
 *
 * All state mutations are idempotent (ON CONFLICT DO UPDATE in DB).
 * All endpoints require tenant_id in X-Tenant-ID header.
 *
 * Routes:
 *   POST   /api/governance/approvals                   Create approval request
 *   GET    /api/governance/approvals                   List (filtered by state, actor)
 *   GET    /api/governance/approvals/:requestId        Get by ID
 *   POST   /api/governance/approvals/:requestId/approve  Approve
 *   POST   /api/governance/approvals/:requestId/deny     Deny
 *   POST   /api/governance/approvals/:requestId/revoke   Revoke
 *   GET    /api/governance/approvals/pending           All pending (operator view)
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import {
  create,
  approve,
  deny,
  revoke,
  getById,
  getPending,
  getByActor,
  getByState,
  getByDecisionId,
  getBufferSize
} from '../../../core/governance/governance-approval-store';
import { RiskLevel } from '../../../core/governance/engine/decision-model';
import { validateTenantId } from '../../api/middleware/assert-tenant-isolation';

export function createGovernanceApprovalRouter(_pool: Pool): Router {
  const router = Router();

  // ─────────────────────────────────────────────
  // Tenant extraction helper
  // ─────────────────────────────────────────────

  function extractTenantId(req: Request): string {
    const tenantId =
      (req.headers['x-tenant-id'] as string) ||
      (req as any).tenantId ||
      'SYSTEM';

    const validation = validateTenantId(tenantId);
    if (!validation.valid) {
      throw new Error(`Invalid tenant_id: ${validation.error}`);
    }
    return validation.tenantId!;
  }

  // ─────────────────────────────────────────────
  // POST /api/governance/approvals
  // Create a new approval request
  // ─────────────────────────────────────────────

  router.post('/', (req: Request, res: Response) => {
    try {
      const tenantId = extractTenantId(req);
      const {
        decision_id, actor_id, actor_type,
        action, resource, risk_level,
        required_approvals, justification, ttl_seconds, metadata
      } = req.body;

      if (!decision_id?.trim()) return res.status(400).json({ error: 'decision_id is required' });
      if (!actor_id?.trim()) return res.status(400).json({ error: 'actor_id is required' });
      if (!action?.trim()) return res.status(400).json({ error: 'action is required' });
      if (!resource?.trim()) return res.status(400).json({ error: 'resource is required' });
      if (!risk_level) return res.status(400).json({ error: 'risk_level is required' });
      if (!['human', 'agent', 'service'].includes(actor_type)) {
        return res.status(400).json({ error: 'actor_type must be human | agent | service' });
      }

      const request = create({
        decision_id, actor_id, actor_type, action, resource,
        tenant_id: tenantId,
        risk_level: risk_level as RiskLevel,
        required_approvals,
        justification,
        ttl_seconds,
        metadata
      });

      res.status(201).json({
        request,
        buffer_size: getBufferSize(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ─────────────────────────────────────────────
  // GET /api/governance/approvals/pending
  // All pending requests (operator approval queue)
  // ─────────────────────────────────────────────

  router.get('/pending', (req: Request, res: Response) => {
    try {
      const tenantId = req.query.all_tenants === 'true'
        ? undefined
        : extractTenantId(req);

      const pending = getPending(tenantId);
      res.json({
        requests: pending,
        count: pending.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ─────────────────────────────────────────────
  // GET /api/governance/approvals
  // List with optional filters
  // ─────────────────────────────────────────────

  router.get('/', (req: Request, res: Response) => {
    try {
      const tenantId = extractTenantId(req);
      const { state, actor_id, decision_id } = req.query;

      let requests;
      if (decision_id) {
        const r = getByDecisionId(String(decision_id));
        requests = r ? [r] : [];
      } else if (actor_id) {
        requests = getByActor(String(actor_id), tenantId);
      } else if (state) {
        const validStates = ['pending', 'approved', 'denied', 'revoked', 'expired'];
        if (!validStates.includes(String(state))) {
          return res.status(400).json({ error: `state must be one of: ${validStates.join(', ')}` });
        }
        requests = getByState(String(state) as any, tenantId);
      } else {
        requests = getPending(tenantId);
      }

      res.json({
        requests,
        count: requests.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ─────────────────────────────────────────────
  // GET /api/governance/approvals/:requestId
  // Get by ID
  // ─────────────────────────────────────────────

  router.get('/:requestId', (req: Request, res: Response) => {
    try {
      const { requestId } = req.params;
      const request = getById(requestId);

      if (!request) {
        return res.status(404).json({ error: `Approval request not found: ${requestId}` });
      }

      res.json({ request, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ─────────────────────────────────────────────
  // POST /api/governance/approvals/:requestId/approve
  // ─────────────────────────────────────────────

  router.post('/:requestId/approve', (req: Request, res: Response) => {
    try {
      const { requestId } = req.params;
      const { approver_id, approver_type = 'human', notes } = req.body;

      if (!approver_id?.trim()) {
        return res.status(400).json({ error: 'approver_id is required' });
      }

      const updated = approve(requestId, approver_id, approver_type, notes);
      res.json({
        request: updated,
        quorum_reached: updated.state === 'approved',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const status = msg.includes('not found') ? 404 : msg.includes('INVALID_TRANSITION') ? 409 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // ─────────────────────────────────────────────
  // POST /api/governance/approvals/:requestId/deny
  // ─────────────────────────────────────────────

  router.post('/:requestId/deny', (req: Request, res: Response) => {
    try {
      const { requestId } = req.params;
      const { denied_by, reason } = req.body;

      if (!denied_by?.trim()) return res.status(400).json({ error: 'denied_by is required' });
      if (!reason?.trim()) return res.status(400).json({ error: 'reason is required' });

      const updated = deny(requestId, denied_by, reason);
      res.json({ request: updated, timestamp: new Date().toISOString() });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const status = msg.includes('not found') ? 404 : msg.includes('INVALID_TRANSITION') ? 409 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // ─────────────────────────────────────────────
  // POST /api/governance/approvals/:requestId/revoke
  // ─────────────────────────────────────────────

  router.post('/:requestId/revoke', (req: Request, res: Response) => {
    try {
      const { requestId } = req.params;
      const { revoked_by, reason } = req.body;

      if (!revoked_by?.trim()) return res.status(400).json({ error: 'revoked_by is required' });
      if (!reason?.trim()) return res.status(400).json({ error: 'reason is required' });

      const updated = revoke(requestId, revoked_by, reason);
      res.json({ request: updated, timestamp: new Date().toISOString() });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const status = msg.includes('not found') ? 404 : msg.includes('INVALID_TRANSITION') ? 409 : 500;
      res.status(status).json({ error: msg });
    }
  });

  return router;
}
