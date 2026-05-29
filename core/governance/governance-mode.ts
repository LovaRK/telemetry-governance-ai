/**
 * Governance Mode Configuration
 * Controls how governance decisions are enforced.
 *
 * CRITICAL: This replaces commented-out code blocks.
 * Feature flag enables safe rollout and emergency rollback.
 *
 * Staged Enforcement Strategy:
 * Stage 1: SHADOW (observational)
 * Stage 2: ENFORCING_LOG_ONLY (internal authority, not yet blocking)
 * Stage 3: ENFORCING_NON_CRITICAL (block LOW/MODERATE only)
 * Stage 4: FULL_ENFORCING (all decisions blocking)
 *
 * This dramatically reduces rollout risk.
 */

export enum GovernanceMode {
  /**
   * DISABLED: Governance evaluation is not performed.
   * No RGE calls, no decision logging, no enforcement.
   * Fallback for emergency or legacy paths.
   */
  DISABLED = 'DISABLED',

  /**
   * SHADOW: Governance evaluation runs in parallel with old validator.
   * RGE decisions logged but NOT enforced.
   * Old validator remains authoritative.
   * Enables decision comparison and mismatch detection.
   * Safe for observational monitoring.
   *
   * Use: Initial 24-48 hour monitoring window
   */
  SHADOW = 'SHADOW',

  /**
   * ENFORCING_LOG_ONLY: RGE is authoritative internally.
   * Violations logged but execution still allowed.
   * No actual blocking happens.
   * Useful for: canary governance, staged rollout
   *
   * Use: After SHADOW validation, before actual enforcement
   */
  ENFORCING_LOG_ONLY = 'ENFORCING_LOG_ONLY',

  /**
   * ENFORCING_NON_CRITICAL: RGE blocks only LOW and MODERATE risk decisions.
   * HIGH and CRITICAL are logged but not enforced.
   * Reduces blast radius during early enforcement phase.
   * Useful for: non-critical production paths
   *
   * Use: Stage 3 of rollout, only on non-critical resources
   */
  ENFORCING_NON_CRITICAL = 'ENFORCING_NON_CRITICAL',

  /**
   * FULL_ENFORCING: RGE blocks all decisions (full authority).
   * DENY, REQUIRE_APPROVAL, etc. all block execution.
   * No fallback: fail-closed semantics in effect.
   * Requires pre-cutover validation (100+ evals, 0 mismatches).
   *
   * Use: After ENFORCING_LOG_ONLY and ENFORCING_NON_CRITICAL proven stable
   */
  FULL_ENFORCING = 'FULL_ENFORCING'
}

/**
 * Get current governance mode.
 * Configurable via APP_GOVERNANCE_MODE environment variable.
 * Default: SHADOW (safe, observational)
 */
export function getGovernanceMode(): GovernanceMode {
  const envMode = process.env.APP_GOVERNANCE_MODE?.toUpperCase();

  // Map string input to enum
  const modeMap: Record<string, GovernanceMode> = {
    DISABLED: GovernanceMode.DISABLED,
    SHADOW: GovernanceMode.SHADOW,
    ENFORCING_LOG_ONLY: GovernanceMode.ENFORCING_LOG_ONLY,
    ENFORCING_NON_CRITICAL: GovernanceMode.ENFORCING_NON_CRITICAL,
    FULL_ENFORCING: GovernanceMode.FULL_ENFORCING,
    // Legacy aliases
    ENFORCING: GovernanceMode.FULL_ENFORCING // ENFORCING → FULL_ENFORCING
  };

  if (!envMode || envMode === 'SHADOW') {
    return GovernanceMode.SHADOW;
  }

  const mode = modeMap[envMode];

  if (mode) {
    return mode;
  }

  // Fail-closed: invalid mode defaults to SHADOW (observational, safe)
  console.warn(
    `[GOVERNANCE_MODE_INVALID] Invalid mode: ${envMode}. Defaulting to SHADOW. ` +
    `Valid modes: DISABLED, SHADOW, ENFORCING_LOG_ONLY, ENFORCING_NON_CRITICAL, FULL_ENFORCING`
  );
  return GovernanceMode.SHADOW;
}

/**
 * Determine if any enforcement is active (including LOG_ONLY).
 */
export function isGovernanceEnforcingAny(): boolean {
  const mode = getGovernanceMode();
  return mode !== GovernanceMode.DISABLED && mode !== GovernanceMode.SHADOW;
}

/**
 * Determine if full enforcement is active.
 * Used to guard fail-closed behavior.
 */
export function isGovernanceEnforcing(): boolean {
  return getGovernanceMode() === GovernanceMode.FULL_ENFORCING;
}

/**
 * Determine if enforcement is active for a given risk level.
 * Enables staged rollout (e.g., only enforce LOW/MODERATE initially).
 */
export function shouldEnforceRiskLevel(riskLevel: string): boolean {
  const mode = getGovernanceMode();

  switch (mode) {
    case GovernanceMode.DISABLED:
      return false;

    case GovernanceMode.SHADOW:
      return false;

    case GovernanceMode.ENFORCING_LOG_ONLY:
      // Violations logged but not enforced
      return false;

    case GovernanceMode.ENFORCING_NON_CRITICAL:
      // Only enforce LOW and MODERATE; HIGH and CRITICAL are logged
      return riskLevel === 'LOW' || riskLevel === 'MODERATE';

    case GovernanceMode.FULL_ENFORCING:
      // Enforce all risk levels
      return true;

    default:
      return false;
  }
}

/**
 * Determine if governance evaluation should run.
 * Returns false only if explicitly DISABLED.
 */
export function isGovernanceActive(): boolean {
  return getGovernanceMode() !== GovernanceMode.DISABLED;
}

/**
 * Log governance mode on startup.
 * Ensures mode is visible in logs.
 */
export function logGovernanceModeStartup(): void {
  const mode = getGovernanceMode();
  console.log('[GOVERNANCE_MODE_STARTUP]', {
    mode,
    enforcing: isGovernanceEnforcing(),
    active: isGovernanceActive(),
    timestamp: new Date().toISOString()
  });
}
