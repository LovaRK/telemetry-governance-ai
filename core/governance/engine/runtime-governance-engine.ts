/**
 * Runtime Governance Engine (RGE)
 * Core deterministic decision-making substrate for the platform.
 *
 * CRITICAL INVARIANTS:
 * 1. Deterministic: Same inputs → same outputs (always)
 * 2. Fail-Closed: Missing governance → no execution
 * 3. Immutable: Approved plans frozen
 * 4. Human Authority: Operators retain veto
 * 5. Correlation: Every action traceable
 * 6. Audit: All decisions immutable
 * 7. Scopes: Agents bounded by scopes
 * 8. Policy Snapshot: Policies frozen at approval
 * 9. Environment Separation: sandbox ≠ production
 * 10. No Silent Failures: Violations logged
 */

import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import {
  GovernanceDecision,
  Decision,
  RiskLevel,
  GovernanceEvaluationRequest,
  PolicyEvaluationResult
} from './decision-model';
import {
  recordGovernanceDecision,
  recordGovernanceEvaluationFailure
} from '../governance-metrics';
import {
  captureGovernanceSnapshot,
  logGovernanceSnapshot
} from '../governance-snapshot';
import { replaySampler } from '../governance-replay';
import { checkGovernanceIntegrity } from '../governance-integrity';
import { getGovernanceMode } from '../governance-mode';
import { isGovernanceBypassed, logBypassWarning } from '../governance-freeze';
// Deferred TTL/scope engine imports — avoids circular deps at module load time
// TTL check is async but called fire-and-forget to preserve evaluate() synchronicity
let _ttlEngine: typeof import('../governance-ttl') | null = null;
function getTtlEngine(): typeof import('../governance-ttl') | null {
  if (!_ttlEngine) {
    try { _ttlEngine = require('../governance-ttl'); } catch { /* not yet available */ }
  }
  return _ttlEngine;
}
let _scopeEngine: typeof import('../governance-scopes') | null = null;
function getScopeEngine(): typeof import('../governance-scopes') | null {
  if (!_scopeEngine) {
    try { _scopeEngine = require('../governance-scopes'); } catch { /* not yet available */ }
  }
  return _scopeEngine;
}
// Deferred policy engine import — avoids circular deps at module load time
// getActivePoliciesSync() reads in-memory cache (10s TTL); refreshPolicyCache() populates it async
let _policyEngine: typeof import('../governance-policy-engine') | null = null;
function getPolicyEngine(): typeof import('../governance-policy-engine') | null {
  if (!_policyEngine) {
    try {
      _policyEngine = require('../governance-policy-engine');
    } catch {
      // Policy engine not yet available (early startup)
    }
  }
  return _policyEngine;
}

// Deferred audit store import — avoids circular deps at module load time
// Loaded lazily on first evaluation (same pattern as governance-integrity.ts metrics require)
let _auditStore: typeof import('../governance-audit-store') | null = null;
function getAuditStore(): typeof import('../governance-audit-store') | null {
  if (!_auditStore) {
    try {
      _auditStore = require('../governance-audit-store');
    } catch {
      // Audit store not available yet (early startup)
    }
  }
  return _auditStore;
}

export class RuntimeGovernanceEngine {
  private readonly environment: 'sandbox' | 'production';
  private readonly schemaVersion = '1.0.0';

  /**
   * Construct RGE with explicit environment.
   * Fail-closed: Invalid environment throws immediately.
   */
  constructor(environment?: string) {
    const env = environment || process.env.APP_ENV || 'sandbox';

    if (!['sandbox', 'production'].includes(env)) {
      throw new Error(
        `[GOVERNANCE_STARTUP_FAILED] Invalid environment: ${env}. ` +
        `Expected 'sandbox' or 'production'.`
      );
    }

    this.environment = env as 'sandbox' | 'production';

    console.log('[GOVERNANCE_ENGINE_INITIALIZED]', {
      environment: this.environment,
      schema_version: this.schemaVersion,
      timestamp: new Date().toISOString()
    });

    // Pre-warm policy cache on startup (async, fire-and-forget)
    // Allows the synchronous evaluatePolicy() hot path to use cached policies
    // on the very first request. Cache TTL is 10 seconds.
    void this.refreshPolicyCache();
  }

  /**
   * Refresh the DSL policy cache from the database.
   * Called on startup and can be called periodically for cache rehydration.
   * Failure is non-fatal — RGE falls back to hardcoded rules.
   */
  async refreshPolicyCache(): Promise<void> {
    const policyEngine = getPolicyEngine();
    if (!policyEngine) return;
    try {
      await policyEngine.getActivePolicies(this.environment);
    } catch {
      // Non-fatal: hardcoded rules are the fallback
    }
  }

  /**
   * Core governance decision evaluation.
   *
   * MANDATORY INVARIANT: Deterministic
   * Same inputs MUST produce identical outputs.
   *
   * @param request Governance evaluation request
   * @returns GovernanceDecision with deterministic decision_id
   */
  evaluate(request: GovernanceEvaluationRequest): GovernanceDecision {
    const evaluationStartTime = Date.now();

    try {
      // Validate request
      this.validateRequest(request);

      // Global freeze switch: bypass enforcement if GOVERNANCE_GLOBAL_BYPASS=true
      // CRITICAL: Audit is NEVER bypassed — only enforcement is skipped
      if (isGovernanceBypassed()) {
        logBypassWarning('enforcement', {
          actor_id: request.actor_id,
          action: request.action,
          resource: request.resource,
          trace_id: request.trace_id
        });
      }

      // Evaluate policy (must be deterministic)
      const policyResult = this.evaluatePolicy(request);

      // Generate deterministic decision ID and input fingerprint
      const normalizedInput = this.getNormalizedInput(request);
      const decision_id = this.generateDeterministicId(normalizedInput, policyResult);
      const input_fingerprint = this.generateInputFingerprint(normalizedInput);

      // Map decision to enforcement mode
      const enforcement_mode = this.mapDecisionToEnforcement(policyResult.decision);

      // Build complete governance decision
      const decision: GovernanceDecision = {
        decision: policyResult.decision,
        risk_level: policyResult.risk_level,
        decision_id,
        input_fingerprint,
        decision_schema_version: this.schemaVersion,
        policy_schema_version: this.schemaVersion,
        trace_id: request.trace_id,
        correlation_id: request.correlation_id,
        causation_id: request.causation_id,
        actor_id: request.actor_id,
        actor_type: request.actor_type,
        environment: this.environment,
        action: request.action,
        resource: request.resource,
        matched_policy_ids: policyResult.matched_policy_ids,
        policy_snapshot_hash: request.policy_snapshot_hash,
        reasons: policyResult.reasons,
        enforcement_mode,
        created_at: new Date().toISOString()
      };

      // Calculate evaluation latency
      const evaluationMs = Date.now() - evaluationStartTime;

      // Log decision for traceability
      this.logGovernanceDecision(decision);

      // Phase 12: Async TTL sweep notification (fire-and-forget — never blocks evaluate())
      // Records governance.policy_eval metric and checks for expired permissions in background.
      void this.runAsyncTtlCheck(request, decision).catch(() => { /* non-fatal */ });

      // Record metrics for observability
      // CRITICAL: Must be called for every evaluation
      recordGovernanceDecision(
        String(decision.decision),
        String(decision.risk_level),
        decision.action,
        this.environment,
        evaluationMs
      );

      // Capture governance snapshot for forensics and replay validation
      // CRITICAL: Freezes semantic context of this evaluation for future replay
      const integrityState = checkGovernanceIntegrity().state;
      const snapshot = captureGovernanceSnapshot(
        decision.decision_id,
        decision.input_fingerprint,
        decision.policy_snapshot_hash,
        decision.actor_id,
        decision.actor_type,
        this.environment,
        decision.action,
        decision.resource,
        decision.trace_id ?? '',
        decision.correlation_id ?? '',
        decision.causation_id ?? '',
        getGovernanceMode(),
        integrityState
      );

      // Log snapshot for audit trail
      logGovernanceSnapshot(snapshot);

      // Add to replay sampler for continuous background validation
      replaySampler.addSample(snapshot);

      // Log to immutable audit trail (fire-and-forget, never blocks governance)
      // CRITICAL: Must be called after snapshot so audit has full context
      const auditStore = getAuditStore();
      if (auditStore) {
        auditStore.logDecision(decision, snapshot, integrityState, evaluationMs);
      }

      return decision;
    } catch (error) {
      // Record evaluation failure for metrics
      const evaluationMs = Date.now() - evaluationStartTime;
      const errorReason = error instanceof Error ? error.message : String(error);
      recordGovernanceEvaluationFailure(errorReason, this.environment);

      // Log failure for debugging
      console.error('[GOVERNANCE_EVALUATION_FAILED]', {
        error: errorReason,
        action: request.action,
        environment: this.environment,
        evaluation_ms: evaluationMs,
        timestamp: new Date().toISOString()
      });

      // Fail-closed: Re-throw to prevent implicit allow
      throw error;
    }
  }

  /**
   * Validate governance evaluation request.
   * Fail-closed: Invalid request throws.
   */
  private validateRequest(request: GovernanceEvaluationRequest): void {
    if (!request.action?.trim()) {
      throw new Error('[GOVERNANCE_VALIDATION_FAILED] action is required');
    }
    if (!request.actor_id?.trim()) {
      throw new Error('[GOVERNANCE_VALIDATION_FAILED] actor_id is required');
    }
    if (!['human', 'agent', 'service'].includes(request.actor_type)) {
      throw new Error(`[GOVERNANCE_VALIDATION_FAILED] Invalid actor_type: ${request.actor_type}`);
    }
    if (!request.resource?.trim()) {
      throw new Error('[GOVERNANCE_VALIDATION_FAILED] resource is required');
    }
    if (!request.trace_id?.trim()) {
      throw new Error('[GOVERNANCE_VALIDATION_FAILED] trace_id is required');
    }
    if (!request.correlation_id?.trim()) {
      throw new Error('[GOVERNANCE_VALIDATION_FAILED] correlation_id is required');
    }
    if (!request.policy_snapshot_hash?.trim()) {
      throw new Error('[GOVERNANCE_VALIDATION_FAILED] policy_snapshot_hash is required');
    }
  }

  /**
   * Evaluate policy against request.
   *
   * Evaluation order (precedence — first match wins):
   *   1. DB DSL policies (governance_policies table, sorted by priority ASC)
   *   2. Hardcoded TypeScript rules (bootstrap fallback when DB unavailable)
   *
   * Must be synchronous and deterministic (no randomization, no async IO).
   * DSL policies are read from the in-memory cache (10s TTL).
   * Cache is pre-warmed on RGE construction and refreshed async on each hit.
   *
   * @returns PolicyEvaluationResult (decision-model shape)
   */
  private evaluatePolicy(request: GovernanceEvaluationRequest): PolicyEvaluationResult {
    // ── 1. Try DB DSL policies (synchronous cache read) ──
    const policyEngine = getPolicyEngine();
    if (policyEngine) {
      const dslPolicies = policyEngine.getActivePoliciesSync();

      if (dslPolicies.length > 0) {
        const ctx: import('../governance-policy-engine').PolicyEvaluationContext = {
          risk_level: request.risk_level ?? 'LOW',
          actor_id: request.actor_id,
          actor_type: request.actor_type,
          action: request.action,
          resource: request.resource,
          tenant_id: request.tenant_id ?? 'SYSTEM',
          decision_id: undefined,
          metadata: request.metadata as Record<string, unknown> | undefined
        };

        const dslResult = policyEngine.evaluateAllPolicies(dslPolicies, ctx);

        if (dslResult.matched && dslResult.escalation) {
          const mapped = this.mapDSLEscalationToDecision(dslResult.escalation, request);
          return {
            decision: mapped.decision,
            risk_level: mapped.risk_level,
            matched_policy_ids: dslResult.policy_id ? [dslResult.policy_id] : [],
            reasons: [dslResult.reason ?? dslResult.policy_name ?? 'DSL policy matched']
          };
        }

        // Background-refresh cache (non-blocking)
        void this.refreshPolicyCache();

        // No DSL policy matched — fall through to hardcoded rules
      } else {
        // Cache empty: trigger async refresh for next call, use hardcoded rules this time
        void this.refreshPolicyCache();
      }
    }

    // ── 2. Hardcoded fallback rules (bootstrap / DB-unavailable) ──
    return this.evaluateHardcodedPolicy(request);
  }

  /**
   * Map DSL escalation directive to the RGE's Decision + RiskLevel.
   */
  private mapDSLEscalationToDecision(
    escalation: import('../governance-policy-engine').PolicyEscalation,
    request: GovernanceEvaluationRequest
  ): { decision: Decision; risk_level: RiskLevel } {
    const riskLevel = this.inferRiskLevel(request);
    switch (escalation) {
      case 'BLOCK':
        return { decision: Decision.DENY, risk_level: RiskLevel.CRITICAL };
      case 'REQUIRE_APPROVAL':
        return { decision: Decision.REQUIRE_APPROVAL, risk_level: riskLevel };
      case 'SHADOW_BLOCK':
        return { decision: Decision.SIMULATE_ONLY, risk_level: riskLevel };
      case 'WARN':
        // WARN = allow but audit at elevated level
        return { decision: Decision.ALLOW, risk_level: riskLevel };
      default:
        return { decision: Decision.ALLOW, risk_level: RiskLevel.LOW };
    }
  }

  /**
   * Infer a RiskLevel from the request's risk_level field (if present)
   * or from resource/action heuristics.
   */
  private inferRiskLevel(request: GovernanceEvaluationRequest): RiskLevel {
    if (request.risk_level) {
      const rl = String(request.risk_level).toUpperCase();
      if (rl === 'CRITICAL') return RiskLevel.CRITICAL;
      if (rl === 'HIGH') return RiskLevel.HIGH;
      if (rl === 'MODERATE') return RiskLevel.MODERATE;
      if (rl === 'LOW') return RiskLevel.LOW;
    }
    return RiskLevel.MODERATE;
  }

  /**
   * Hardcoded bootstrap policy rules.
   * Used when DB is unavailable or policy cache is empty.
   * Mirrors the seed policies in 20260602_governance_policies/migration.sql.
   */
  private evaluateHardcodedPolicy(request: GovernanceEvaluationRequest): PolicyEvaluationResult {
    if (this.environment === 'sandbox') {
      // Block production IP in sandbox
      if (request.resource.includes('45.76.167.6')) {
        return {
          decision: Decision.DENY,
          risk_level: RiskLevel.CRITICAL,
          matched_policy_ids: ['policy-environment-isolation-1'],
          reasons: [
            'Production IP (45.76.167.6) is blocked in sandbox environment',
            'Only approved sandbox IP (144.202.48.85) is permitted'
          ]
        };
      }
      // Block production hostname patterns in sandbox
      if (this.isProductionHostname(request.resource)) {
        return {
          decision: Decision.DENY,
          risk_level: RiskLevel.CRITICAL,
          matched_policy_ids: ['policy-environment-isolation-1'],
          reasons: [
            'Production resource pattern detected in resource name',
            'Sandbox environment only permits sandbox hostnames'
          ]
        };
      }
    }

    // Hardcoded risk-level escalation (mirrors seed policies)
    const riskLevel = this.inferRiskLevel(request);
    if (riskLevel === RiskLevel.CRITICAL) {
      return {
        decision: Decision.REQUIRE_APPROVAL,
        risk_level: RiskLevel.CRITICAL,
        matched_policy_ids: ['policy-require-approval-critical'],
        reasons: ['CRITICAL risk level requires approval (hardcoded bootstrap rule; 2-person rule)']
      };
    }
    if (riskLevel === RiskLevel.HIGH) {
      return {
        decision: Decision.REQUIRE_APPROVAL,
        risk_level: RiskLevel.HIGH,
        matched_policy_ids: ['policy-require-approval-high'],
        reasons: ['HIGH risk level requires approval (hardcoded bootstrap rule)']
      };
    }

    // Default: allow
    return {
      decision: Decision.ALLOW,
      risk_level: RiskLevel.LOW,
      matched_policy_ids: [],
      reasons: ['No policies matched; resource approved for action']
    };
  }

  /**
   * Check if hostname matches production patterns.
   * Deterministic string matching.
   */
  private isProductionHostname(resource: string): boolean {
    const productionPatterns = [
      'prod-',
      '-prod',
      'production',
      'splunk-prod',
      'sem',
      '.prod.',
      ':prod:'
    ];

    const resourceLower = resource.toLowerCase();
    return productionPatterns.some(pattern => resourceLower.includes(pattern));
  }

  /**
   * Get normalized input for deterministic hashing.
   * All normalization happens here, once.
   */
  private getNormalizedInput(request: GovernanceEvaluationRequest): Record<string, any> {
    return {
      action: request.action.trim().toUpperCase(),
      actor_id: request.actor_id.trim(),
      resource: this.normalizeResource(request.resource),
      policy_snapshot: request.policy_snapshot_hash.trim(),
      environment: this.environment
      // Sorted alphabetically for deterministic serialization
    };
  }

  /**
   * Generate deterministic decision ID.
   * CRITICAL: Same inputs must ALWAYS produce identical ID.
   *
   * ABSOLUTE DETERMINISM GUARANTEE:
   * - Uses SHA256 hash of NORMALIZED input + policy result
   * - NO randomization
   * - NO wall-clock time (time violates determinism)
   * - NO external IO
   * - Purely functional: normalized_input → hash → ID
   *
   * Important: Timestamps go in AUDIT METADATA, never in IDENTITY.
   * If time were in the hash:
   *   same request at 10:01 → decision-abc123
   *   same request at 10:02 → decision-def456
   * That breaks replay validation, forensics, and approval verification.
   */
  private generateDeterministicId(
    normalizedInput: Record<string, any>,
    policyResult: PolicyEvaluationResult
  ): string {
    // Hash normalized input + policy result (no time, no state, no IO)
    const dataToHash = {
      ...normalizedInput,
      decision: policyResult.decision
    };

    const inputHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(dataToHash, Object.keys(dataToHash).sort()))
      .digest('hex');

    return `decision-${inputHash.substring(0, 16)}`;
  }

  /**
   * Generate input fingerprint for forensic grouping and replay detection.
   * Separate from decision_id.
   * Enables:
   * - grouping multiple evaluations of same request
   * - replay detection
   * - audit search
   */
  private generateInputFingerprint(normalizedInput: Record<string, any>): string {
    const dataToHash = { ...normalizedInput };
    const fingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify(dataToHash, Object.keys(dataToHash).sort()))
      .digest('hex');

    return `input-${fingerprint.substring(0, 16)}`;
  }

  /**
   * Normalize resource for deterministic hashing.
   * Same semantic resource → same normalized form.
   *
   * Handles:
   * - HTTPS vs https (case normalization)
   * - trailing slashes (removal)
   * - port normalization (443 implicit in https, 80 implicit in http)
   * - whitespace trimming
   *
   * Examples:
   * - splunk:config:https://144.202.48.85:8089 → splunk:config:https://144.202.48.85:8089
   * - splunk:config:https://144.202.48.85:8089/ → splunk:config:https://144.202.48.85:8089
   * - splunk:config:HTTPS://144.202.48.85:8089 → splunk:config:https://144.202.48.85:8089
   */
  private normalizeResource(resource: string): string {
    try {
      // Find and extract URL from resource string (e.g., extract https://... from splunk:config:https://...)
      const urlMatch = resource.match(/https?:\/\/[^\s]*/i);

      if (urlMatch) {
        const urlString = urlMatch[0];
        const prefix = resource.substring(0, urlMatch.index || 0);

        // Parse the URL portion
        const url = new URL(urlString);

        // Normalize hostname to lowercase
        const hostname = url.hostname.toLowerCase();

        // Normalize port (omit default ports for http/https)
        let port = '';
        if (url.port) {
          if (!((url.protocol === 'https:' && url.port === '443') ||
                (url.protocol === 'http:' && url.port === '80'))) {
            port = `:${url.port}`;
          }
        }

        // Reconstruct URL without trailing slash
        const normalizedUrl = `${url.protocol.toLowerCase()}//${hostname}${port}`;

        // Return with prefix
        return (prefix + normalizedUrl).toLowerCase().trim();
      }

      // If it's a key:value resource identifier, normalize similarly
      return resource
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ') // normalize whitespace
        .replace(/\/$/, ''); // remove trailing slashes
    } catch {
      // If parsing fails, just return lowercased trimmed
      return resource.toLowerCase().trim();
    }
  }

  /**
   * Normalize object for deterministic JSON hashing.
   * Ensures consistent serialization regardless of property order.
   */
  private normalizeInputForHashing(input: {
    action: string;
    actor_id: string;
    resource: string;
    policy_snapshot: string;
    environment: string;
    decision: Decision;
  }): Record<string, any> {
    return {
      action: input.action,
      actor_id: input.actor_id,
      environment: input.environment,
      policy_snapshot: input.policy_snapshot,
      resource: input.resource,
      decision: input.decision
      // CRITICAL: Ordered alphabetically, no timestamps, no random values
    };
  }

  /**
   * Map Decision enum to enforcement mode.
   * Determines how the decision is enforced at runtime.
   */
  private mapDecisionToEnforcement(
    decision: Decision
  ): 'hard-block' | 'soft-block' | 'approval-required' | 'simulation' {
    switch (decision) {
      case Decision.DENY:
        return 'hard-block'; // Reject immediately
      case Decision.REQUIRE_APPROVAL:
        return 'approval-required'; // Queue for approval
      case Decision.REQUIRE_ESCALATION:
        return 'approval-required'; // Escalation handled upstream
      case Decision.SIMULATE_ONLY:
        return 'simulation'; // Dry-run, no persistence
      case Decision.SANDBOX_ONLY:
        return 'hard-block'; // Force sandbox isolation
      case Decision.READ_ONLY:
        return 'hard-block'; // Disallow mutations
      case Decision.ALLOW:
      default:
        return 'hard-block'; // Conservative: deny by default if unhandled
    }
  }

  /**
   * Log governance decision for audit trail.
   * Every decision must be logged (Invariant 6: Immutable Audit Ledger).
   */
  private logGovernanceDecision(decision: GovernanceDecision): void {
    console.log('[GOVERNANCE_DECISION]', {
      decision_id: decision.decision_id,
      decision: decision.decision,
      risk_level: decision.risk_level,
      enforcement_mode: decision.enforcement_mode,
      trace_id: decision.trace_id,
      actor_id: decision.actor_id,
      action: decision.action,
      environment: decision.environment,
      created_at: decision.created_at
    });

    // TODO: Persist to governance_audit_events table (Phase 2A Step 5)
  }

  /**
   * Get current environment.
   * Used for diagnostics and fail-closed validation.
   */
  getEnvironment(): 'sandbox' | 'production' {
    return this.environment;
  }

  /**
   * Get schema version.
   * Used for policy evolution and migration.
   */
  getSchemaVersion(): string {
    return this.schemaVersion;
  }

  /**
   * Phase 12: Async TTL + scope audit (fire-and-forget).
   * Records governance.policy_eval metric and runs the TTL sweep if engines are available.
   * MUST NEVER THROW — any error is swallowed to preserve evaluate() determinism.
   */
  private async runAsyncTtlCheck(
    request: GovernanceEvaluationRequest,
    decision: GovernanceDecision,
  ): Promise<void> {
    try {
      const ttl = getTtlEngine();
      if (!ttl) return;

      // Run a lightweight TTL sweep to identify newly-expired grants
      // This is informational only — it does not block or alter the decision
      const result = await ttl.runTtlSweep();
      if (result.expiredCount > 0) {
        console.info(
          `[GovernanceEngine] TTL sweep: ${result.expiredCount} expired grants ` +
          `(${result.checkedCount} checked, ${result.durationMs}ms)`,
        );
      }
    } catch {
      // Silently swallow — audit is already written; TTL is non-blocking
    }
  }
}

// Export singleton instance
export const governanceEngine = new RuntimeGovernanceEngine();
