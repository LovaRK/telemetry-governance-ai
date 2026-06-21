/**
 * Governance Approval
 *
 * State machine for governance enforcement approval requests.
 * Triggered when the Runtime Governance Engine returns Decision.REQUIRE_APPROVAL.
 *
 * State machine:
 *   pending → approved  (operator approves)
 *   pending → denied    (operator denies, or auto-deny on expiry)
 *   pending → expired   (TTL elapsed without resolution)
 *   approved → revoked  (operator revokes a previously approved request)
 *
 * CRITICAL INVARIANTS:
 * - tenant_id is required on every approval request (isolation)
 * - Every state transition is recorded to the governance audit store
 * - Approval store is fire-and-forget (never blocks governance hot path)
 * - Expiry is enforced lazily (checked on read) — no background sweeper required
 */

import { Decision, RiskLevel } from './engine/decision-model';

// ─────────────────────────────────────────────
// State Machine Types
// ─────────────────────────────────────────────

export type ApprovalState = 'pending' | 'approved' | 'denied' | 'revoked' | 'expired';

export interface ApprovalRecord {
  approver_id: string;
  approver_type: 'human' | 'agent' | 'service';
  approved_at: string;
  notes?: string;
}

export interface GovernanceApprovalRequest {
  id: string;
  decision_id: string;
  tenant_id: string;
  actor_id: string;
  actor_type: 'human' | 'agent' | 'service';
  action: string;
  resource: string;
  risk_level: RiskLevel;
  state: ApprovalState;
  required_approvals: number;
  received_approvals: ApprovalRecord[];
  justification?: string;
  created_at: string;
  expires_at?: string;
  resolved_at?: string;
  resolved_by?: string;
  resolution_reason?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateApprovalRequestInput {
  decision_id: string;
  tenant_id: string;
  actor_id: string;
  actor_type: 'human' | 'agent' | 'service';
  action: string;
  resource: string;
  risk_level: RiskLevel;
  required_approvals?: number;
  justification?: string;
  ttl_seconds?: number;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// State Transition Guards
// ─────────────────────────────────────────────

/**
 * Allowed state transitions (from → to).
 */
const ALLOWED_TRANSITIONS: Record<ApprovalState, ApprovalState[]> = {
  pending:  ['approved', 'denied', 'expired'],
  approved: ['revoked'],
  denied:   [],          // terminal
  revoked:  [],          // terminal
  expired:  [],          // terminal
};

export function canTransition(from: ApprovalState, to: ApprovalState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(
  request: GovernanceApprovalRequest,
  to: ApprovalState
): void {
  if (!canTransition(request.state, to)) {
    throw new Error(
      `[APPROVAL_INVALID_TRANSITION] Cannot transition from "${request.state}" to "${to}". ` +
      `Request: ${request.id}`
    );
  }
}

// ─────────────────────────────────────────────
// Expiry Logic
// ─────────────────────────────────────────────

/**
 * Check if a pending request has expired.
 * Expiry is enforced lazily — call this before returning a request to any caller.
 */
export function isExpired(request: GovernanceApprovalRequest): boolean {
  if (request.state !== 'pending') return false;
  if (!request.expires_at) return false;
  return new Date(request.expires_at).getTime() < Date.now();
}

/**
 * Get the default TTL for a risk level.
 * Higher risk = shorter TTL (more urgent decision required).
 */
export function getDefaultTtlSeconds(risk_level: RiskLevel): number {
  switch (risk_level) {
    case RiskLevel.CRITICAL: return 4 * 60 * 60;    // 4 hours
    case RiskLevel.HIGH:     return 24 * 60 * 60;   // 24 hours
    case RiskLevel.MODERATE: return 72 * 60 * 60;   // 3 days
    case RiskLevel.LOW:      return 7 * 24 * 60 * 60; // 7 days
    default:                 return 24 * 60 * 60;   // 24 hours default
  }
}

// ─────────────────────────────────────────────
// Quorum Logic
// ─────────────────────────────────────────────

/**
 * Check if enough approvals have been received to reach quorum.
 */
export function hasReachedQuorum(request: GovernanceApprovalRequest): boolean {
  return request.received_approvals.length >= request.required_approvals;
}

/**
 * Add an approval record to a request.
 * Returns the updated received_approvals array.
 */
export function addApproval(
  request: GovernanceApprovalRequest,
  approverId: string,
  approverType: 'human' | 'agent' | 'service',
  notes?: string
): ApprovalRecord[] {
  // Prevent duplicate approvals from same approver
  if (request.received_approvals.some(a => a.approver_id === approverId)) {
    throw new Error(
      `[APPROVAL_DUPLICATE] Approver "${approverId}" has already approved request ${request.id}`
    );
  }

  return [
    ...request.received_approvals,
    {
      approver_id: approverId,
      approver_type: approverType,
      approved_at: new Date().toISOString(),
      notes
    }
  ];
}

// ─────────────────────────────────────────────
// Required approvals by risk level
// ─────────────────────────────────────────────

export function getRequiredApprovals(risk_level: RiskLevel): number {
  switch (risk_level) {
    case RiskLevel.CRITICAL: return 2;  // Two-person rule for critical
    case RiskLevel.HIGH:     return 1;
    case RiskLevel.MODERATE: return 1;
    case RiskLevel.LOW:      return 1;
    default:                 return 1;
  }
}
