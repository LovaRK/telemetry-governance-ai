/**
 * POLICY ENGINE
 * Validates deterministic scores + agent recommendations against rules & guardrails
 * Single responsibility: transform decision → validated decision + violations
 */

import type {
  ScoredInput,
  AgentRecommendation,
  PolicyConfig,
  PolicyValidationResult,
  PolicyDecision,
  Guardrail,
} from './types';
import { evaluateRule, resolveDecisionFromRules, isDecisionBlockedByRule } from './rules-validator';
import { checkGuardrailViolations } from './guardrails';

/**
 * Main policy engine
 */
export class PolicyEngine {
  private config: PolicyConfig;

  constructor(config: PolicyConfig) {
    this.config = config;
  }

  /**
   * CORE: Validate recommendation against rules & guardrails
   * Returns: validated decision (may differ from recommendation) + violations + applied rules
   */
  validateRecommendation(
    scored: ScoredInput,
    recommendation: AgentRecommendation
  ): PolicyValidationResult {
    console.log(`[Policy] Validating ${scored.index}::${scored.sourcetype || '_'} (recommended: ${recommendation.recommendedDecision})`);

    const violations = checkGuardrailViolations(
      scored,
      recommendation.recommendedDecision,
      this.config.guardrails
    );

    if (violations.length > 0) {
      console.warn(`[Policy] ⚠️ Guardrail violations detected for ${recommendation.recommendedDecision}:`, violations.length);
    }

    // Step 1: Check guardrails
    if (violations.length > 0) {
      // Recommended decision is blocked — find alternative
      const alternative = this.findFallbackDecision(scored, recommendation.recommendedDecision);

      return {
        input: scored,
        recommendedDecision: recommendation.recommendedDecision,
        validatedDecision: alternative,
        violations,
        isValid: false,
        appliedRules: [],
        appliedGuardrails: violations.map(v => v.ruleId),
        warnings: [
          `Recommended decision (${recommendation.recommendedDecision}) blocked by guardrails`,
          `Falling back to: ${alternative}`,
        ],
      };
    }

    // Step 2: Check rules
    const ruleResult = resolveDecisionFromRules(scored, this.config.rules);
    const appliedRules = ruleResult.appliedRules;

    let finalDecision = ruleResult.decision || recommendation.recommendedDecision;

    // Step 3: Validate final decision against guardrails (double-check)
    const finalViolations = checkGuardrailViolations(scored, finalDecision, this.config.guardrails);

    if (finalViolations.length > 0) {
      // Rule forced a blocked decision — escalate
      const escalated = this.findFallbackDecision(scored, finalDecision);
      console.warn(
        `[Policy] Rules forced blocked decision (${finalDecision}), escalating to ${escalated}`
      );

      return {
        input: scored,
        recommendedDecision: recommendation.recommendedDecision,
        validatedDecision: escalated,
        violations: finalViolations,
        isValid: false,
        appliedRules,
        appliedGuardrails: finalViolations.map(v => v.ruleId),
        warnings: [`Rule-based decision (${finalDecision}) violated guardrails, escalating`],
      };
    }

    // Step 4: Validate against rule-level blockers
    const ruleBlockers = isDecisionBlockedByRule(finalDecision, this.config.rules);
    if (ruleBlockers.isBlocked) {
      console.warn(`[Policy] Decision ${finalDecision} blocked by rules:`, ruleBlockers.blockedBy);

      const escalated = this.findFallbackDecision(scored, finalDecision);
      return {
        input: scored,
        recommendedDecision: recommendation.recommendedDecision,
        validatedDecision: escalated,
        violations: finalViolations,
        isValid: false,
        appliedRules: [...appliedRules, ...ruleBlockers.blockedBy],
        appliedGuardrails: [],
        warnings: [`Decision ${finalDecision} blocked by rule constraints`],
      };
    }

    console.log(`[Policy] ✅ Validated: ${finalDecision} (confidence: ${recommendation.confidence})`);

    return {
      input: scored,
      recommendedDecision: recommendation.recommendedDecision,
      validatedDecision: finalDecision,
      violations: [],
      isValid: true,
      appliedRules,
      appliedGuardrails: [],
      warnings: [],
    };
  }

  /**
   * Validate batch of recommendations
   */
  validateBatch(
    scored: ScoredInput[],
    recommendations: AgentRecommendation[]
  ): PolicyValidationResult[] {
    return scored.map(input => {
      const rec = recommendations.find(r => r.index === input.index);
      if (!rec) {
        console.warn(`[Policy] No recommendation found for ${input.index}, using default`);
        return this.validateRecommendation(input, {
          index: input.index,
          recommendedDecision: this.config.defaultDecision,
          confidence: 0,
          reasoning: 'No recommendation provided, using default policy',
        });
      }
      return this.validateRecommendation(input, rec);
    });
  }

  /**
   * Find fallback decision when primary is blocked
   * Priority: MONITOR > RETAIN > ESCALATE > REBALANCE
   */
  private findFallbackDecision(
    scored: ScoredInput,
    primaryDecision: PolicyDecision
  ): PolicyDecision {
    const fallbackPriority: PolicyDecision[] = ['MONITOR', 'RETAIN', 'ESCALATE', 'REBALANCE'];

    for (const candidate of fallbackPriority) {
      const violations = checkGuardrailViolations(scored, candidate, this.config.guardrails);
      if (violations.length === 0) {
        return candidate;
      }
    }

    // All fallbacks blocked — force ESCALATE (safest)
    console.warn(`[Policy] All fallbacks blocked for ${scored.index}, forcing ESCALATE`);
    return 'ESCALATE';
  }

  /**
   * Export current config (for audit trail)
   */
  exportConfig(): PolicyConfig {
    return this.config;
  }

  /**
   * Update rules (runtime reconfiguration)
   */
  updateRules(rules: PolicyConfig['rules']): void {
    this.config.rules = rules;
    console.log(`[Policy] Rules updated: ${rules.length} rules loaded`);
  }

  /**
   * Update guardrails (runtime reconfiguration)
   */
  updateGuardrails(guardrails: Guardrail[]): void {
    this.config.guardrails = guardrails;
    console.log(`[Policy] Guardrails updated: ${guardrails.length} guardrails loaded`);
  }
}

/**
 * Factory: create engine with default policies
 */
export function createDefaultPolicyEngine(overrides?: Partial<PolicyConfig>): PolicyEngine {
  const { createDefaultGuardrails } = require('./guardrails');

  const defaultConfig: PolicyConfig = {
    version: '1.0.0',
    rules: [],
    guardrails: createDefaultGuardrails(),
    defaultDecision: 'MONITOR',
    escalationThreshold: 0.5, // Escalate if violations > 50% of guardrails
    ...overrides,
  };

  return new PolicyEngine(defaultConfig);
}
