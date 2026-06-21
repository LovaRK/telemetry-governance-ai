/**
 * Governance Policy Routes
 * REST endpoints for the Policy DSL CRUD operations.
 *
 * All endpoints require tenant_id in X-Tenant-ID header.
 * Policy evaluation is handled internally by the RGE — these routes
 * are for operator management of the policy store only.
 *
 * Routes:
 *   POST   /api/governance/policies                 Create policy
 *   GET    /api/governance/policies                 List policies
 *   GET    /api/governance/policies/:policyId       Get by ID
 *   PUT    /api/governance/policies/:policyId       Update policy
 *   DELETE /api/governance/policies/:policyId       Delete policy
 *   POST   /api/governance/policies/:policyId/activate    Activate
 *   POST   /api/governance/policies/:policyId/deactivate  Deactivate
 *   POST   /api/governance/policies/evaluate        Test-evaluate a context against all active policies
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import {
  createPolicy,
  updatePolicy,
  deletePolicy,
  getPolicyById,
  listPolicies,
  getActivePolicies,
  evaluateAllPolicies,
  PolicyEvaluationContext,
  PolicyRule
} from '../../../core/governance/governance-policy-engine';
import { validateTenantId } from '../../api/middleware/assert-tenant-isolation';

export function createGovernancePolicyRouter(_pool: Pool): Router {
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
  // POST /api/governance/policies
  // Create a new policy
  // ─────────────────────────────────────────────

  router.post('/', async (req: Request, res: Response) => {
    try {
      const tenantId = extractTenantId(req);
      const { name, description, rule, priority, environment } = req.body;

      if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
      if (!rule || typeof rule !== 'object') return res.status(400).json({ error: 'rule must be a valid policy rule object' });
      if (!rule.type || !['AND', 'OR', 'NOT', 'CONDITION'].includes(rule.type)) {
        return res.status(400).json({ error: 'rule.type must be AND | OR | NOT | CONDITION' });
      }
      if (environment && !['sandbox', 'production', 'both'].includes(environment)) {
        return res.status(400).json({ error: 'environment must be sandbox | production | both' });
      }

      const policy = await createPolicy({
        name: name.trim(),
        description,
        rule: rule as PolicyRule,
        priority: priority ? Number(priority) : undefined,
        environment,
        created_by: tenantId
      });

      res.status(201).json({ policy, timestamp: new Date().toISOString() });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const status = msg.includes('unique') || msg.includes('duplicate') ? 409 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // ─────────────────────────────────────────────
  // GET /api/governance/policies
  // List all policies with optional filters
  // ─────────────────────────────────────────────

  router.get('/', async (req: Request, res: Response) => {
    try {
      const { environment, is_active, limit } = req.query;

      const validEnvs = ['sandbox', 'production', 'both', 'all'];
      if (environment && !validEnvs.includes(String(environment))) {
        return res.status(400).json({ error: `environment must be one of: ${validEnvs.join(', ')}` });
      }

      const policies = await listPolicies({
        environment: environment ? String(environment) : undefined,
        is_active: is_active !== undefined ? is_active === 'true' : undefined,
        limit: limit ? Number(limit) : 100
      });

      res.json({
        policies,
        count: policies.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ─────────────────────────────────────────────
  // POST /api/governance/policies/evaluate
  // Test-evaluate a context against active policies (operator tool)
  // NOTE: This must be before /:policyId to avoid route shadowing
  // ─────────────────────────────────────────────

  router.post('/evaluate', async (req: Request, res: Response) => {
    try {
      const { risk_level, actor_id, actor_type, action, resource, tenant_id, metadata } = req.body;

      if (!risk_level) return res.status(400).json({ error: 'risk_level is required' });
      if (!actor_id?.trim()) return res.status(400).json({ error: 'actor_id is required' });
      if (!action?.trim()) return res.status(400).json({ error: 'action is required' });
      if (!resource?.trim()) return res.status(400).json({ error: 'resource is required' });

      // Resolve evaluation environment from server context
      const IS_PRODUCTION = process.env.APP_ENV === 'production';
      const environment = IS_PRODUCTION ? 'production' : 'sandbox';

      const policies = await getActivePolicies(environment);
      const ctx: PolicyEvaluationContext = {
        risk_level,
        actor_id,
        actor_type: actor_type ?? 'human',
        action,
        resource,
        tenant_id: tenant_id ?? 'SYSTEM',
        metadata
      };

      const result = evaluateAllPolicies(policies, ctx);

      res.json({
        evaluation: result,
        policies_evaluated: policies.length,
        environment,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ─────────────────────────────────────────────
  // GET /api/governance/policies/:policyId
  // Get by ID
  // ─────────────────────────────────────────────

  router.get('/:policyId', async (req: Request, res: Response) => {
    try {
      const { policyId } = req.params;
      const policy = await getPolicyById(policyId);

      if (!policy) {
        return res.status(404).json({ error: `Policy not found: ${policyId}` });
      }

      res.json({ policy, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ─────────────────────────────────────────────
  // PUT /api/governance/policies/:policyId
  // Update policy fields
  // ─────────────────────────────────────────────

  router.put('/:policyId', async (req: Request, res: Response) => {
    try {
      const tenantId = extractTenantId(req);
      const { policyId } = req.params;
      const { name, description, rule, priority, environment, is_active } = req.body;

      if (rule && typeof rule === 'object' && rule.type &&
          !['AND', 'OR', 'NOT', 'CONDITION'].includes(rule.type)) {
        return res.status(400).json({ error: 'rule.type must be AND | OR | NOT | CONDITION' });
      }
      if (environment && !['sandbox', 'production', 'both'].includes(environment)) {
        return res.status(400).json({ error: 'environment must be sandbox | production | both' });
      }

      const updated = await updatePolicy(policyId, {
        name,
        description,
        rule: rule as PolicyRule | undefined,
        priority: priority !== undefined ? Number(priority) : undefined,
        environment,
        is_active,
        updated_by: tenantId
      });

      if (!updated) {
        return res.status(404).json({ error: `Policy not found: ${policyId}` });
      }

      res.json({ policy: updated, timestamp: new Date().toISOString() });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const status = msg.includes('unique') || msg.includes('duplicate') ? 409 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // ─────────────────────────────────────────────
  // DELETE /api/governance/policies/:policyId
  // ─────────────────────────────────────────────

  router.delete('/:policyId', async (req: Request, res: Response) => {
    try {
      const { policyId } = req.params;

      // Guard: prevent deletion of seed bootstrap policies
      if (policyId.startsWith('policy-require-approval-') || policyId.startsWith('policy-block-')) {
        return res.status(403).json({
          error: `Bootstrap policy ${policyId} cannot be deleted. Deactivate it instead.`
        });
      }

      const deleted = await deletePolicy(policyId);
      if (!deleted) {
        return res.status(404).json({ error: `Policy not found: ${policyId}` });
      }

      res.json({ deleted: true, policy_id: policyId, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ─────────────────────────────────────────────
  // POST /api/governance/policies/:policyId/activate
  // ─────────────────────────────────────────────

  router.post('/:policyId/activate', async (req: Request, res: Response) => {
    try {
      const { policyId } = req.params;
      const tenantId = extractTenantId(req);

      const updated = await updatePolicy(policyId, { is_active: true, updated_by: tenantId });
      if (!updated) {
        return res.status(404).json({ error: `Policy not found: ${policyId}` });
      }

      res.json({ policy: updated, activated: true, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ─────────────────────────────────────────────
  // POST /api/governance/policies/:policyId/deactivate
  // ─────────────────────────────────────────────

  router.post('/:policyId/deactivate', async (req: Request, res: Response) => {
    try {
      const { policyId } = req.params;
      const tenantId = extractTenantId(req);

      const updated = await updatePolicy(policyId, { is_active: false, updated_by: tenantId });
      if (!updated) {
        return res.status(404).json({ error: `Policy not found: ${policyId}` });
      }

      res.json({ policy: updated, deactivated: true, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
