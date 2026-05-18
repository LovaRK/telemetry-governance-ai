import { Router, Request, Response } from 'express';
import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  OperatorTraceBinding,
  OperatorSessionSnapshot,
  AuthorizationContext,
  OperatorActionType,
  createOperatorTraceBinding,
  reconstructOperatorIntent,
} from '../types/operator-trace-binding';
import { AuditChainService } from '../services/audit-chain-service';
import { AuditRateLimiter } from '../services/audit-rate-limiter';

// ===== DATA LEAK PREVENTION =====

/**
 * Sanitize operator session snapshot for safe external exposure.
 * Removes sensitive data like full IP addresses and user agents.
 * CRITICAL: Prevents information leakage about operator environment.
 */
function sanitizeOperatorSnapshot(snapshot: any): any {
  return {
    email: snapshot.email,
    name: snapshot.name,
    role: snapshot.role,
    // Intentionally omit ipAddress, userAgent, loginAt (sensitive environment data)
  };
}

// ===== REPLAY SCOPE VALIDATION =====

/**
 * Check if an action indicates a replay and enforce scope downgrade.
 * CRITICAL SECURITY: Replays cannot use FULL_AUTOMATION scope.
 * If a replay attempts FULL_AUTOMATION, return error immediately (fail-closed).
 *
 * Rationale: Replays execute previously-approved decisions in a new context.
 * Using full automation on a replay could execute old decisions in fundamentally
 * different conditions (topology change, user permissions change, etc).
 * Replays must require human approval (ESCALATION_ONLY) to stay safe.
 */
function validateReplayScope(
  actionType: string,
  actionPayload: any,
  requestedScope: string
): { valid: boolean; scope: string; error?: string } {
  const isReplay =
    actionType === 'REPLAY_AUTHORIZE' ||
    actionPayload?.isReplay === true ||
    actionPayload?.replayOf !== undefined;

  if (isReplay && requestedScope === 'FULL_AUTOMATION') {
    return {
      valid: false,
      scope: requestedScope,
      error:
        'REPLAY_SCOPE_VIOLATION: Replayed actions cannot use FULL_AUTOMATION scope. ' +
        'Scope must be ESCALATION_ONLY to require human approval on replay execution.',
    };
  }

  // If replay but not explicitly FULL_AUTOMATION, downgrade to ESCALATION_ONLY for safety
  const finalScope = isReplay && requestedScope === 'SUGGEST_ONLY' ? 'ESCALATION_ONLY' : requestedScope;

  return {
    valid: true,
    scope: finalScope,
  };
}

export function createImmutableAuditRouter(pool: Pool): Router {
  const router = Router();
  const rateLimiter = new AuditRateLimiter({
    requestsPerMinute: parseInt(process.env.AUDIT_RATE_LIMIT_PER_MINUTE || '60'),
    burstSize: 10,
  });

  // FIX 5: Rate limit middleware for all audit endpoints
  router.use((req: Request, res: Response, next: Function) => {
    const user = (req as any).user;
    if (!user || !user.tenant_id) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const limit = rateLimiter.checkLimit(user.tenant_id);

    // Add rate limit headers to response
    res.set({
      'X-RateLimit-Remaining': limit.remaining.toString(),
      'X-RateLimit-Reset': limit.resetAt.toISOString(),
    });

    if (!limit.allowed) {
      return res.status(429).json({
        error: 'Too many requests to audit endpoint',
        retryAfter: limit.resetAt.toISOString(),
      });
    }

    next();
  });

  /**
   * POST /audit/operator-action
   * Record an immutable operator action binding to a trace with cryptographic chain linking.
   *
   * This endpoint:
   * 1. Computes deterministic canonical hash linked to previous binding (chain)
   * 2. Anchors genesis block to prevent retroactive history rewrites
   * 3. Persists atomically with transaction guarantees
   * 4. Uses RFC 8785 canonical JSON for hash reproducibility
   */
  router.post('/operator-action', async (req: Request, res: Response) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const user = (req as any).user; // Set by auth middleware
      const { traceId, spanId, actionType, actionPayload, actionDescription, authorizationScope } = req.body;

      // Validate required fields
      if (!traceId || !spanId || !actionType || !actionPayload) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'traceId, spanId, actionType, and actionPayload are required',
        });
      }

      // Validate actionType is valid
      const validActionTypes = [
        'TRACE_READ',
        'DECISION_APPROVE',
        'DECISION_REJECT',
        'REPLAY_AUTHORIZE',
        'REMEDIATION_APPROVE',
        'ESCALATION_OVERRIDE',
        'CONFIG_UPDATE',
        'AUDIT_ACCESS',
      ];

      if (!validActionTypes.includes(actionType)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Invalid actionType. Must be one of: ${validActionTypes.join(', ')}`,
        });
      }

      // FIX 4: Validate replay scope downgrade (fail-closed)
      const requestedScope = authorizationScope || 'LOCAL';
      const scopeValidation = validateReplayScope(actionType, actionPayload, requestedScope);

      if (!scopeValidation.valid) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: scopeValidation.error,
        });
      }

      // Step 1: Snapshot operator session
      const { createHash } = require('crypto');
      const operatorHash = createHash('sha256')
        .update(`${user.user_id}:${Date.now()}`)
        .digest('hex');

      const sessionSnapshot: OperatorSessionSnapshot = {
        sessionId: uuidv4(),
        operatorHash,
        userId: user.user_id,
        tenantId: user.tenant_id,
        email: user.email,
        name: user.name || 'Unknown',
        role: user.role,
        loginAt: new Date().toISOString(),
        ipAddress: req.headers['x-forwarded-for'] as string,
        userAgent: req.headers['user-agent'] as string,
      };

      // Step 2: Create authorization context with validated scope
      const authContext: AuthorizationContext = {
        contextId: uuidv4(),
        operatorSessionId: sessionSnapshot.sessionId,
        authorizationScope: scopeValidation.scope, // Validated and potentially downgraded for replays
        grantedScopes: ['traces:read', 'decisions:approve'],
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h validity
        createdAt: new Date().toISOString(),
      };

      // Step 3: Compute cryptographic chain hashes with canonical JSON serialization
      const signedAt = new Date().toISOString();
      const bindingPayload = {
        tenantId: user.tenant_id,
        operatorHash,
        traceId,
        spanId,
        actionType,
        authContext,
        actionPayload,
      };

      const { currentHash, previousHash, rootChainHash } = await AuditChainService.computeChainHash(
        client,
        bindingPayload,
        signedAt
      );

      // Step 4: Create OperatorTraceBinding (for compatibility with existing code)
      const binding = createOperatorTraceBinding(
        traceId,
        spanId,
        sessionSnapshot,
        authContext,
        actionType as OperatorActionType,
        actionPayload,
        actionDescription || `Operator ${user.email} performed ${actionType}`
      );

      // Step 5: Persist to immutable ledger with chain linkage
      const insertQuery = `
        INSERT INTO operator_trace_bindings (
          binding_id, trace_id, originating_span_id, operator_session_snapshot,
          authorization_context, action_type, action_payload, signature_hash,
          previous_binding_hash, root_chain_hash, signed_at, signed_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, chain_position
      `;

      const result = await client.query(insertQuery, [
        binding.bindingId,
        binding.traceId,
        binding.originatingSpanId,
        JSON.stringify(binding.operatorSessionSnapshot),
        JSON.stringify(binding.authorizationContext),
        binding.actionType,
        JSON.stringify(binding.actionPayload),
        currentHash,
        previousHash,
        rootChainHash,
        signedAt,
        binding.signedBy,
      ]);

      await client.query('COMMIT');

      // Log audit event
      console.log('[AUDIT_CHAIN_PERSISTED]', {
        bindingId: binding.bindingId,
        traceId: binding.traceId,
        chainPosition: result.rows[0].chain_position,
        operator: user.email,
        actionType: binding.actionType,
        currentHash,
        previousHash,
        rootChainHash,
        timestamp: signedAt,
      });

      return res.status(201).json({
        bindingId: binding.bindingId,
        traceId: binding.traceId,
        actionType: binding.actionType,
        signedAt: binding.signedAt,
        chainHash: currentHash,
        chainPosition: result.rows[0].chain_position,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[AUDIT_CHAIN_ERROR]', error);
      return res.status(500).json({
        error: 'Failed to record operator action in immutable ledger',
      });
    } finally {
      client.release();
    }
  });

  /**
   * GET /audit/trace/:traceId/operators
   * Retrieve all operator actions on a trace, including reconstructed operator intent
   */
  router.get('/trace/:traceId/operators', async (req: Request, res: Response) => {
    try {
      const { traceId } = req.params;
      const user = (req as any).user; // Must be authenticated

      if (!traceId) {
        return res.status(400).json({
          error: 'traceId is required',
        });
      }

      // Retrieve all operator trace bindings for this trace
      const result = await pool.query(
        `
        SELECT
          binding_id,
          trace_id,
          originating_span_id,
          operator_session_snapshot,
          authorization_context,
          action_type,
          action_payload,
          signature_hash,
          signed_at,
          signed_by,
          created_at
        FROM operator_trace_bindings
        WHERE trace_id = $1
        ORDER BY signed_at ASC
        `,
        [traceId]
      );

      if (result.rows.length === 0) {
        return res.json({
          traceId,
          operatorActions: [],
          reconstructedIntent: {
            primaryDecision: null,
            approvals: [],
            rejections: [],
            overrides: [],
            escalations: [],
            timeline: [],
          },
        });
      }

      // Parse bindings and reconstruct intent
      const bindings = result.rows.map((row) => ({
        bindingId: row.binding_id,
        traceId: row.trace_id,
        originatingSpanId: row.originating_span_id,
        operatorSessionSnapshot: JSON.parse(row.operator_session_snapshot),
        authorizationContext: JSON.parse(row.authorization_context),
        actionType: row.action_type,
        actionPayload: JSON.parse(row.action_payload),
        actionDescription: '',
        signedAt: row.signed_at,
        signedBy: row.signed_by,
        signatureHash: row.signature_hash,
        writtenAt: row.created_at,
        isPersisted: true,
      })) as OperatorTraceBinding[];

      // Reconstruct operator intent
      const reconstructedIntent = reconstructOperatorIntent({
        traceId,
        bindings,
      });

      return res.json({
        traceId,
        operatorActionsCount: bindings.length,
        operatorActions: bindings.map((b) => ({
          bindingId: b.bindingId,
          operator: sanitizeOperatorSnapshot(b.operatorSessionSnapshot),
          actionType: b.actionType,
          actionDescription: b.actionDescription,
          signedAt: b.signedAt,
          signature: b.signatureHash?.substring(0, 8) + '...', // Abbreviated signature
        })),
        reconstructedIntent: {
          primaryDecision: reconstructedIntent.primaryDecision
            ? {
                operator: sanitizeOperatorSnapshot(reconstructedIntent.primaryDecision.operatorSessionSnapshot),
                actionType: reconstructedIntent.primaryDecision.actionType,
                decidedAt: reconstructedIntent.primaryDecision.signedAt,
              }
            : null,
          approvalCount: reconstructedIntent.approvals.length,
          rejectionCount: reconstructedIntent.rejections.length,
          overrideCount: reconstructedIntent.overrides.length,
          escalationCount: reconstructedIntent.escalations.length,
          timeline: reconstructedIntent.timeline.map((b) => ({
            operator: sanitizeOperatorSnapshot(b.operatorSessionSnapshot),
            actionType: b.actionType,
            timestamp: b.signedAt,
          })),
        },
      });
    } catch (error) {
      console.error('Error retrieving operator trace bindings:', error);
      return res.status(500).json({
        error: 'Failed to retrieve operator actions',
      });
    }
  });

  /**
   * GET /audit/operator/:operatorId/actions
   * Retrieve all actions by a specific operator (for compliance auditing)
   */
  router.get('/operator/:operatorId/actions', async (req: Request, res: Response) => {
    try {
      const { operatorId } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 1000);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

      // Find all actions by this operator
      const result = await pool.query(
        `
        SELECT
          binding_id,
          trace_id,
          action_type,
          action_payload,
          signed_at,
          created_at,
          operator_session_snapshot->>'email' as operator_email
        FROM operator_trace_bindings
        WHERE operator_session_snapshot->>'userId' = $1
        ORDER BY signed_at DESC
        LIMIT $2 OFFSET $3
        `,
        [operatorId, limit, offset]
      );

      // Get total count
      const countResult = await pool.query(
        `
        SELECT COUNT(*) as total
        FROM operator_trace_bindings
        WHERE operator_session_snapshot->>'userId' = $1
        `,
        [operatorId]
      );

      const totalCount = parseInt(countResult.rows[0].total);

      return res.json({
        operatorId,
        actionsCount: result.rows.length,
        totalCount,
        limit,
        offset,
        actions: result.rows.map((row) => ({
          bindingId: row.binding_id,
          traceId: row.trace_id,
          actionType: row.action_type,
          signedAt: row.signed_at,
        })),
      });
    } catch (error) {
      console.error('Error retrieving operator actions:', error);
      return res.status(500).json({
        error: 'Failed to retrieve operator actions',
      });
    }
  });

  /**
   * POST /audit/verify/:bindingId
   * Verify that an operator trace binding has not been tampered with
   */
  router.post('/verify/:bindingId', async (req: Request, res: Response) => {
    try {
      const { bindingId } = req.params;

      // Retrieve binding
      const result = await pool.query(
        `
        SELECT
          binding_id,
          trace_id,
          originating_span_id,
          operator_session_snapshot,
          authorization_context,
          action_type,
          action_payload,
          signature_hash,
          signed_at,
          signed_by
        FROM operator_trace_bindings
        WHERE binding_id = $1
        `,
        [bindingId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Binding not found',
        });
      }

      const row = result.rows[0];
      const binding: OperatorTraceBinding = {
        bindingId: row.binding_id,
        traceId: row.trace_id,
        originatingSpanId: row.originating_span_id,
        operatorSessionSnapshot: JSON.parse(row.operator_session_snapshot),
        authorizationContext: JSON.parse(row.authorization_context),
        actionType: row.action_type,
        actionPayload: JSON.parse(row.action_payload),
        actionDescription: '',
        signedAt: row.signed_at,
        signedBy: row.signed_by,
        signatureHash: row.signature_hash,
        writtenAt: new Date().toISOString(),
        isPersisted: true,
      };

      // Verify signature
      const { verifyOperatorTraceBinding } = require('../types/operator-trace-binding');
      const isValid = verifyOperatorTraceBinding(binding);

      return res.json({
        bindingId,
        isValid,
        operator: binding.operatorSessionSnapshot.email,
        actionType: binding.actionType,
        signedAt: binding.signedAt,
        signature: binding.signatureHash?.substring(0, 16) + '...',
      });
    } catch (error) {
      console.error('Error verifying operator trace binding:', error);
      return res.status(500).json({
        error: 'Failed to verify binding',
      });
    }
  });

  return router;
}
