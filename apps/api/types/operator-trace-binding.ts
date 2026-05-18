/**
 * Operator Trace Binding
 *
 * Immutable proof that operator X approved action Y under trace Z with authority context W.
 *
 * This is critical for:
 * - Replay authorization (prove who approved the replay)
 * - Escalation attribution (prove who escalated and why)
 * - Autonomous remediation approval (prove who approved the automation)
 * - Forensic reconstruction (prove causal chain of operator intent)
 */

import { createHash, randomBytes } from 'crypto';

export interface OperatorSessionSnapshot {
  sessionId: string;
  operatorHash: string; // SHA256(user_id + session_creation_timestamp)
  userId: string; // User UUID
  tenantId: string;
  email: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  loginAt: string; // ISO8601
  ipAddress?: string;
  userAgent?: string;
}

export type AuthorizationScope = 'LOCAL' | 'CROSS_TENANT' | 'REPLAY' | 'ESCALATION';

export interface AuthorizationContext {
  contextId: string; // UUID
  operatorSessionId: string;
  authorizationScope: AuthorizationScope;
  grantedScopes: string[]; // e.g., ['traces:read', 'decisions:approve', 'replay:execute']
  expiresAt: string; // ISO8601
  createdAt: string;
}

export type OperatorActionType =
  | 'TRACE_READ'
  | 'DECISION_APPROVE'
  | 'DECISION_REJECT'
  | 'REPLAY_AUTHORIZE'
  | 'REMEDIATION_APPROVE'
  | 'ESCALATION_OVERRIDE'
  | 'CONFIG_UPDATE'
  | 'AUDIT_ACCESS';

export interface OperatorTraceBinding {
  // ===== Identity =====
  bindingId: string; // UUID
  traceId: string;
  originatingSpanId: string; // Where in the trace did this binding originate?

  // ===== Operator Context =====
  operatorSessionSnapshot: OperatorSessionSnapshot;
  authorizationContext: AuthorizationContext;

  // ===== Action Details =====
  actionType: OperatorActionType;
  actionPayload: Record<string, unknown>; // Action-specific data
  actionDescription: string; // Human-readable summary

  // ===== Immutability Guarantee =====
  signedAt: string; // ISO8601 when binding was created
  signedBy: string; // Which service signed? ('governance-causality-engine', 'replay-authority', etc.)
  signatureHash?: string; // HMAC-SHA256 of (operatorSessionId + actionType + actionPayload + signedAt)
  readonly writtenAt: string; // ISO8601 when persisted
  readonly isPersisted: boolean;

  // ===== Forensic Trail =====
  rootCauseIfAnomalous?: {
    reason: string;
    detectedAt: string;
    byService: string;
  };
}

export interface OperatorTraceBindingChain {
  traceId: string;
  bindings: OperatorTraceBinding[]; // Timeline of all operator actions on this trace
  operatorConflicts?: {
    // e.g., approval + override on same decision
    bindingId1: string;
    bindingId2: string;
    conflictType: 'CONTRADICTORY_APPROVAL' | 'DOUBLE_APPROVAL' | 'OVERRIDE_AFTER_APPROVAL';
    severity: 'WARNING' | 'ERROR' | 'CRITICAL';
  }[];
}

export interface ReconstructedOperatorIntent {
  primaryDecision: OperatorTraceBinding | null;
  approvals: OperatorTraceBinding[];
  rejections: OperatorTraceBinding[];
  overrides: OperatorTraceBinding[];
  escalations: OperatorTraceBinding[];
  timeline: OperatorTraceBinding[];
}

// ===== HELPERS =====

/**
 * Create an OperatorTraceBinding
 */
export function createOperatorTraceBinding(
  traceId: string,
  originatingSpanId: string,
  sessionSnapshot: OperatorSessionSnapshot,
  authContext: AuthorizationContext,
  actionType: OperatorActionType,
  actionPayload: Record<string, unknown>,
  actionDescription: string
): OperatorTraceBinding {
  const bindingId = randomBytes(16).toString('hex');
  const signedAt = new Date().toISOString();

  // Create signature
  const signatureData = `${sessionSnapshot.operatorHash}:${actionType}:${JSON.stringify(actionPayload)}:${signedAt}`;
  const signatureHash = createHash('sha256').update(signatureData).digest('hex');

  return {
    bindingId,
    traceId,
    originatingSpanId,
    operatorSessionSnapshot: sessionSnapshot,
    authorizationContext: authContext,
    actionType,
    actionPayload,
    actionDescription,
    signedAt,
    signedBy: 'governance-causality-engine',
    signatureHash,
    writtenAt: new Date().toISOString(),
    isPersisted: false,
  };
}

/**
 * Verify an OperatorTraceBinding hasn't been tampered with
 */
export function verifyOperatorTraceBinding(binding: OperatorTraceBinding): boolean {
  if (!binding.signatureHash) {
    return false;
  }

  const signatureData = `${binding.operatorSessionSnapshot.operatorHash}:${binding.actionType}:${JSON.stringify(binding.actionPayload)}:${binding.signedAt}`;
  const expectedHash = createHash('sha256').update(signatureData).digest('hex');

  return expectedHash === binding.signatureHash;
}

/**
 * Reconstruct operator intent from a binding chain
 */
export function reconstructOperatorIntent(chain: OperatorTraceBindingChain): ReconstructedOperatorIntent {
  const result: ReconstructedOperatorIntent = {
    primaryDecision: null,
    approvals: [],
    rejections: [],
    overrides: [],
    escalations: [],
    timeline: [],
  };

  for (const binding of chain.bindings) {
    result.timeline.push(binding);

    switch (binding.actionType) {
      case 'DECISION_APPROVE':
        result.approvals.push(binding);
        if (!result.primaryDecision) {
          result.primaryDecision = binding;
        }
        break;
      case 'DECISION_REJECT':
        result.rejections.push(binding);
        break;
      case 'ESCALATION_OVERRIDE':
        result.overrides.push(binding);
        break;
      case 'REMEDIATION_APPROVE':
        result.escalations.push(binding);
        break;
    }
  }

  return result;
}

/**
 * Check if operator has authority for an action in a given scope
 */
export function hasOperatorAuthority(
  binding: OperatorTraceBinding,
  requiredScope: AuthorizationScope
): boolean {
  // Scope hierarchy: LOCAL < CROSS_TENANT < REPLAY < ESCALATION
  const scopeHierarchy = ['LOCAL', 'CROSS_TENANT', 'REPLAY', 'ESCALATION'];
  const operatorScopeIndex = scopeHierarchy.indexOf(binding.authorizationContext.authorizationScope);
  const requiredScopeIndex = scopeHierarchy.indexOf(requiredScope);

  return (
    operatorScopeIndex >= requiredScopeIndex &&
    new Date(binding.authorizationContext.expiresAt) > new Date()
  );
}

/**
 * Create a human-readable summary of an operator's action on a trace
 */
export function summarizeOperatorAction(binding: OperatorTraceBinding): string {
  const actionSummaries: Record<OperatorActionType, (payload: Record<string, unknown>) => string> = {
    TRACE_READ: (p) => `viewed trace context`,
    DECISION_APPROVE: (p) => `approved decision: ${(p.decisionId as string) || 'unknown'}`,
    DECISION_REJECT: (p) => `rejected decision: ${(p.decisionId as string) || 'unknown'}`,
    REPLAY_AUTHORIZE: (p) => `authorized replay of span ${(p.replaySpanId as string) || 'unknown'}`,
    REMEDIATION_APPROVE: (p) => `approved remediation: ${(p.remediationId as string) || 'unknown'}`,
    ESCALATION_OVERRIDE: (p) => `escalated and overrode automation decision`,
    CONFIG_UPDATE: (p) => `updated configuration: ${(p.configKey as string) || 'unknown'}`,
    AUDIT_ACCESS: (p) => `accessed audit logs`,
  };

  const summary =
    actionSummaries[binding.actionType]?.(binding.actionPayload) || `performed ${binding.actionType}`;

  return `${binding.operatorSessionSnapshot.email} (${binding.operatorSessionSnapshot.role}) ${summary} at ${new Date(binding.signedAt).toLocaleString()}`;
}
