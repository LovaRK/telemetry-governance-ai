/**
 * Governance Global Freeze Switch
 *
 * Emergency recovery mechanism for operator lockout scenarios.
 * When GOVERNANCE_GLOBAL_BYPASS=true:
 *   - Bypass enforcement
 *   - Bypass approval requirements
 *   - Bypass TTL checks
 *   - Bypass revocation checks
 *   - Bypass scope enforcement
 *
 * CRITICAL: Even in bypass mode, ALL decisions are still AUDITED.
 * Audit is NEVER bypassed. The bypass only affects enforcement, not observation.
 *
 * SECURITY MODEL:
 * - This is an emergency break-glass mechanism
 * - Every bypass evaluation logs a [GOVERNANCE_BYPASS_ACTIVE] warning
 * - The audit trail shows the bypass was active during the decision
 * - Operators can review all decisions made during a bypass window
 *
 * Usage:
 * ```typescript
 * if (isGovernanceBypassed()) {
 *   // Log warning + continue with reduced enforcement
 *   return bypassedDecision(request);
 * }
 * // Normal enforcement path
 * ```
 */

// ─────────────────────────────────────────────
// Bypass State
// ─────────────────────────────────────────────

/**
 * Whether the global governance bypass is active.
 * Read from environment variable at module load time.
 *
 * To activate: set GOVERNANCE_GLOBAL_BYPASS=true in environment
 * To deactivate: unset or set to any other value, restart
 *
 * NOTE: This intentionally does NOT support runtime toggle.
 * Changing bypass state requires an environment change + restart,
 * which creates a clear audit boundary in the deployment logs.
 */
export const GOVERNANCE_GLOBAL_BYPASS: boolean =
  process.env.GOVERNANCE_GLOBAL_BYPASS === 'true';

// Track when bypass was activated (for audit duration reporting)
const bypassActivatedAt: string | null = GOVERNANCE_GLOBAL_BYPASS
  ? new Date().toISOString()
  : null;

// Count bypass evaluations for the operational metrics system
let _bypassEvaluationCount = 0;

// ─────────────────────────────────────────────
// Core API
// ─────────────────────────────────────────────

/**
 * Check if governance is globally bypassed.
 * Call this at the TOP of every enforcement check.
 */
export function isGovernanceBypassed(): boolean {
  return GOVERNANCE_GLOBAL_BYPASS;
}

/**
 * Log a bypass warning for a specific governance operation.
 * MUST be called every time bypass causes enforcement to be skipped.
 *
 * @param operation - Which governance check was bypassed
 * @param context   - Actor, action, resource context for audit
 */
export function logBypassWarning(
  operation: 'enforcement' | 'approval' | 'ttl' | 'revocation' | 'scope',
  context: {
    actor_id?: string;
    action?: string;
    resource?: string;
    trace_id?: string;
  }
): void {
  _bypassEvaluationCount++;

  console.warn('[GOVERNANCE_BYPASS_ACTIVE]', {
    operation,
    bypass_evaluation_count: _bypassEvaluationCount,
    bypass_activated_at: bypassActivatedAt,
    actor_id: context.actor_id,
    action: context.action,
    resource: context.resource,
    trace_id: context.trace_id,
    timestamp: new Date().toISOString(),
    note: 'AUDIT IS STILL ACTIVE — bypass only affects enforcement'
  });
}

/**
 * Get bypass statistics for the governance self-observability system.
 */
export function getBypassStats(): {
  active: boolean;
  activated_at: string | null;
  evaluation_count: number;
} {
  return {
    active: GOVERNANCE_GLOBAL_BYPASS,
    activated_at: bypassActivatedAt,
    evaluation_count: _bypassEvaluationCount,
  };
}

/**
 * Reset bypass evaluation counter.
 * For testing only — never call in production.
 */
export function _resetBypassCounterForTesting(): void {
  _bypassEvaluationCount = 0;
}

// ─────────────────────────────────────────────
// Startup Log
// ─────────────────────────────────────────────

if (GOVERNANCE_GLOBAL_BYPASS) {
  console.warn('[GOVERNANCE_GLOBAL_BYPASS_ACTIVATED]', {
    message: 'EMERGENCY BYPASS ACTIVE: Governance enforcement is disabled. Audit remains active.',
    activated_at: bypassActivatedAt,
    env_var: 'GOVERNANCE_GLOBAL_BYPASS=true',
    to_deactivate: 'Unset GOVERNANCE_GLOBAL_BYPASS and restart',
    timestamp: new Date().toISOString()
  });
} else {
  console.log('[GOVERNANCE_FREEZE_CHECK]', {
    bypass_active: false,
    timestamp: new Date().toISOString()
  });
}
