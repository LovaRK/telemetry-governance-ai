/**
 * Governance Approval Store
 *
 * Dual-write: in-memory ring buffer (fast queries) + DB persistence.
 * Follows the same architectural pattern as governance-audit-store.ts.
 *
 * CRITICAL:
 * - Write errors are tracked as metrics, never thrown (store must not block governance)
 * - Query methods return from in-memory buffer first, fall back to DB
 * - Every approval request is associated with a tenant_id (isolation)
 */

import * as crypto from 'crypto';
import {
  GovernanceApprovalRequest,
  CreateApprovalRequestInput,
  ApprovalState,
  ApprovalRecord,
  isExpired,
  getDefaultTtlSeconds,
  getRequiredApprovals,
  assertTransition,
  addApproval,
  hasReachedQuorum
} from './governance-approval';
import { RiskLevel } from './engine/decision-model';

// ─────────────────────────────────────────────
// In-memory ring buffer (500 requests max)
// ─────────────────────────────────────────────

const RING_BUFFER_MAX = 500;
const ringBuffer: GovernanceApprovalRequest[] = [];

function appendToBuffer(request: GovernanceApprovalRequest): void {
  // Update existing entry if present
  const idx = ringBuffer.findIndex(r => r.id === request.id);
  if (idx >= 0) {
    ringBuffer[idx] = request;
    return;
  }
  ringBuffer.push(request);
  if (ringBuffer.length > RING_BUFFER_MAX) {
    ringBuffer.shift();
  }
}

// ─────────────────────────────────────────────
// Write failure tracking
// ─────────────────────────────────────────────

let _writeFailureCount = 0;
let _writeSuccessCount = 0;

export function getApprovalWriteFailureCount(): number { return _writeFailureCount; }
export function getApprovalWriteSuccessCount(): number { return _writeSuccessCount; }

// ─────────────────────────────────────────────
// DB persistence (lazy require to avoid circular deps)
// ─────────────────────────────────────────────

async function persistToDB(request: GovernanceApprovalRequest): Promise<void> {
  try {
    const dbModule = require('../../core/database/connection');
    const queryFn = dbModule.query;
    if (!queryFn) throw new Error('query function not available');

    await queryFn(
      `INSERT INTO governance_approval_requests
         (id, decision_id, tenant_id, actor_id, actor_type, action, resource, risk_level,
          state, required_approvals, received_approvals, justification,
          created_at, expires_at, resolved_at, resolved_by, resolution_reason, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18::jsonb)
       ON CONFLICT (id) DO UPDATE
         SET state               = EXCLUDED.state,
             received_approvals  = EXCLUDED.received_approvals,
             resolved_at         = EXCLUDED.resolved_at,
             resolved_by         = EXCLUDED.resolved_by,
             resolution_reason   = EXCLUDED.resolution_reason`,
      [
        request.id,
        request.decision_id,
        request.tenant_id,
        request.actor_id,
        request.actor_type,
        request.action,
        request.resource,
        String(request.risk_level),
        request.state,
        request.required_approvals,
        JSON.stringify(request.received_approvals),
        request.justification ?? null,
        request.created_at,
        request.expires_at ?? null,
        request.resolved_at ?? null,
        request.resolved_by ?? null,
        request.resolution_reason ?? null,
        request.metadata ? JSON.stringify(request.metadata) : null
      ]
    );
    _writeSuccessCount++;
  } catch (error) {
    _writeFailureCount++;
    console.warn('[GOVERNANCE_APPROVAL_WRITE_FAILED]', {
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
      write_failures_total: _writeFailureCount,
      timestamp: new Date().toISOString()
    });
  }
}

// ─────────────────────────────────────────────
// Write API
// ─────────────────────────────────────────────

/**
 * Create a new approval request.
 * Called by the RGE when it returns Decision.REQUIRE_APPROVAL.
 */
export function create(input: CreateApprovalRequestInput): GovernanceApprovalRequest {
  const ttlSeconds = input.ttl_seconds ?? getDefaultTtlSeconds(input.risk_level);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const request: GovernanceApprovalRequest = {
    id: `approval-${crypto.randomBytes(8).toString('hex')}`,
    decision_id: input.decision_id,
    tenant_id: input.tenant_id,
    actor_id: input.actor_id,
    actor_type: input.actor_type,
    action: input.action,
    resource: input.resource,
    risk_level: input.risk_level,
    state: 'pending',
    required_approvals: input.required_approvals ?? getRequiredApprovals(input.risk_level),
    received_approvals: [],
    justification: input.justification,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    metadata: input.metadata
  };

  appendToBuffer(request);
  void persistToDB(request);

  console.log('[GOVERNANCE_APPROVAL_CREATED]', {
    id: request.id,
    decision_id: request.decision_id,
    tenant_id: request.tenant_id,
    actor_id: request.actor_id,
    action: request.action,
    risk_level: request.risk_level,
    required_approvals: request.required_approvals,
    expires_at: expiresAt,
    timestamp: new Date().toISOString()
  });

  return request;
}

/**
 * Record an approval for a request.
 * Automatically transitions to 'approved' when quorum is reached.
 */
export function approve(
  requestId: string,
  approverId: string,
  approverType: 'human' | 'agent' | 'service' = 'human',
  notes?: string
): GovernanceApprovalRequest {
  const request = getById(requestId);
  if (!request) throw new Error(`Approval request not found: ${requestId}`);

  // Check expiry lazily
  if (isExpired(request)) {
    return expire(requestId);
  }

  assertTransition(request, 'approved');

  const updatedApprovals = addApproval(request, approverId, approverType, notes);
  const reachedQuorum = updatedApprovals.length >= request.required_approvals;

  const updated: GovernanceApprovalRequest = {
    ...request,
    received_approvals: updatedApprovals,
    state: reachedQuorum ? 'approved' : 'pending',
    ...(reachedQuorum ? {
      resolved_at: new Date().toISOString(),
      resolved_by: approverId,
      resolution_reason: 'Approved — quorum reached'
    } : {})
  };

  appendToBuffer(updated);
  void persistToDB(updated);

  if (reachedQuorum) {
    console.log('[GOVERNANCE_APPROVAL_APPROVED]', {
      id: requestId,
      approved_by: approverId,
      approvals: updatedApprovals.length,
      required: request.required_approvals,
      timestamp: new Date().toISOString()
    });
  }

  return updated;
}

/**
 * Deny an approval request.
 */
export function deny(
  requestId: string,
  deniedBy: string,
  reason: string
): GovernanceApprovalRequest {
  const request = getById(requestId);
  if (!request) throw new Error(`Approval request not found: ${requestId}`);

  if (isExpired(request)) return expire(requestId);
  assertTransition(request, 'denied');

  const updated: GovernanceApprovalRequest = {
    ...request,
    state: 'denied',
    resolved_at: new Date().toISOString(),
    resolved_by: deniedBy,
    resolution_reason: reason
  };

  appendToBuffer(updated);
  void persistToDB(updated);

  console.log('[GOVERNANCE_APPROVAL_DENIED]', {
    id: requestId,
    denied_by: deniedBy,
    reason,
    timestamp: new Date().toISOString()
  });

  return updated;
}

/**
 * Revoke a previously approved request.
 */
export function revoke(
  requestId: string,
  revokedBy: string,
  reason: string
): GovernanceApprovalRequest {
  const request = getById(requestId);
  if (!request) throw new Error(`Approval request not found: ${requestId}`);

  assertTransition(request, 'revoked');

  const updated: GovernanceApprovalRequest = {
    ...request,
    state: 'revoked',
    resolved_at: new Date().toISOString(),
    resolved_by: revokedBy,
    resolution_reason: `REVOKED: ${reason}`
  };

  appendToBuffer(updated);
  void persistToDB(updated);

  console.log('[GOVERNANCE_APPROVAL_REVOKED]', {
    id: requestId,
    revoked_by: revokedBy,
    reason,
    timestamp: new Date().toISOString()
  });

  return updated;
}

/**
 * Expire a pending request that has passed its TTL.
 */
function expire(requestId: string): GovernanceApprovalRequest {
  const request = getById(requestId);
  if (!request) throw new Error(`Approval request not found: ${requestId}`);

  const updated: GovernanceApprovalRequest = {
    ...request,
    state: 'expired',
    resolved_at: new Date().toISOString(),
    resolution_reason: 'Auto-expired: TTL elapsed without resolution'
  };

  appendToBuffer(updated);
  void persistToDB(updated);

  console.warn('[GOVERNANCE_APPROVAL_EXPIRED]', {
    id: requestId,
    expires_at: request.expires_at,
    timestamp: new Date().toISOString()
  });

  return updated;
}

// ─────────────────────────────────────────────
// Query API
// ─────────────────────────────────────────────

export function getById(id: string): GovernanceApprovalRequest | null {
  const found = ringBuffer.find(r => r.id === id);
  if (!found) return null;
  // Lazy expiry check on read
  if (isExpired(found)) return expire(found.id);
  return found;
}

export function getPending(tenantId?: string): GovernanceApprovalRequest[] {
  return ringBuffer
    .filter(r => r.state === 'pending' && (!tenantId || r.tenant_id === tenantId))
    .map(r => isExpired(r) ? expire(r.id) : r)
    .filter(r => r.state === 'pending');
}

export function getByActor(actorId: string, tenantId?: string): GovernanceApprovalRequest[] {
  return ringBuffer.filter(r =>
    r.actor_id === actorId && (!tenantId || r.tenant_id === tenantId)
  );
}

export function getByDecisionId(decisionId: string): GovernanceApprovalRequest | null {
  return ringBuffer.find(r => r.decision_id === decisionId) ?? null;
}

export function getByState(state: ApprovalState, tenantId?: string): GovernanceApprovalRequest[] {
  return ringBuffer.filter(r =>
    r.state === state && (!tenantId || r.tenant_id === tenantId)
  );
}

export function getBufferSize(): number {
  return ringBuffer.length;
}

/** For testing only */
export function _clearBuffer(): void {
  ringBuffer.length = 0;
  _writeFailureCount = 0;
  _writeSuccessCount = 0;
}
