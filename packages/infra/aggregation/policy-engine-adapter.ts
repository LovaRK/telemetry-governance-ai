/**
 * POLICY ENGINE ADAPTER
 * Safe integration layer for policy validation in aggregation-service.ts
 * Dual-path: deterministic scores + policy validation before agent stage
 */

import {
  PolicyEngine,
  createDefaultPolicyEngine,
  getPolicyByProfile,
  type PolicyValidationResult,
  type ScoredInput,
  type AgentRecommendation,
  type PolicyConfig,
} from '@core/policy';

/**
 * STEP 1: Create policy engine with selected profile
 * Profiles: cost_optimization | security_first | operations_focused | conservative | data_quality
 */
export async function initializePolicyEngine(profileName: string = 'operations_focused'): Promise<PolicyEngine> {
  console.log(`[Policy Adapter] Initializing engine with profile: ${profileName}`);

  try {
    const config = getPolicyByProfile(profileName as any);
    const engine = new PolicyEngine(config);
    console.log(`[Policy Adapter] ✅ Engine ready: ${config.rules.length} rules, ${config.guardrails.length} guardrails`);
    return engine;
  } catch (err) {
    console.error(`[Policy Adapter] ⚠️ Failed to load profile ${profileName}, falling back to default`);
    return createDefaultPolicyEngine();
  }
}

/**
 * STEP 2: Validate agent recommendations against policy
 * Input: scored data + agent recommendations
 * Output: validated decisions + violations
 */
export async function validateWithPolicy(
  engine: PolicyEngine,
  scored: ScoredInput[],
  recommendations: AgentRecommendation[]
): Promise<{
  validations: PolicyValidationResult[];
  validCount: number;
  violationCount: number;
  escalationCount: number;
}> {
  console.log(`[Policy Adapter] Validating ${scored.length} recommendations...`);

  const validations = engine.validateBatch(scored, recommendations);

  const validCount = validations.filter(v => v.isValid).length;
  const violationCount = validations.filter(v => !v.isValid && v.violations.length > 0).length;
  const escalationCount = validations.filter(v => v.validatedDecision === 'ESCALATE').length;

  console.log(`[Policy Adapter] ✅ Validation complete`, {
    valid: validCount,
    violations: violationCount,
    escalations: escalationCount,
  });

  return { validations, validCount, violationCount, escalationCount };
}

/**
 * STEP 3: Extract validated decisions for execution
 * Only returns final decisions (may differ from recommendations)
 */
export function extractValidatedDecisions(validations: PolicyValidationResult[]): Map<string, { decision: string; reasoning: string }> {
  const decisions = new Map<string, { decision: string; reasoning: string }>();

  for (const validation of validations) {
    const changed = validation.recommendedDecision !== validation.validatedDecision;
    const reasoning = changed
      ? `Policy override: ${validation.recommendedDecision} → ${validation.validatedDecision} (${validation.violations.length} violations)`
      : `Validated: ${validation.validatedDecision}`;

    decisions.set(`${validation.input.index}::${validation.input.sourcetype || '_'}`, {
      decision: validation.validatedDecision,
      reasoning,
    });
  }

  return decisions;
}

/**
 * STEP 4: Generate audit trail for compliance
 */
export function generatePolicyAuditTrail(
  validations: PolicyValidationResult[],
  engineProfile: string
): {
  timestamp: Date;
  profile: string;
  totalValidations: number;
  decisions: Record<string, any>;
  violations: Record<string, any[]>;
} {
  const violations: Record<string, any[]> = {};
  const decisions: Record<string, any> = {};

  for (const validation of validations) {
    const key = `${validation.input.index}::${validation.input.sourcetype || '_'}`;

    decisions[key] = {
      recommended: validation.recommendedDecision,
      validated: validation.validatedDecision,
      isValid: validation.isValid,
      appliedRules: validation.appliedRules,
    };

    if (validation.violations.length > 0) {
      violations[key] = validation.violations.map(v => ({
        ruleId: v.ruleId,
        severity: v.severity,
        violation: v.violation,
      }));
    }
  }

  return {
    timestamp: new Date(),
    profile: engineProfile,
    totalValidations: validations.length,
    decisions,
    violations,
  };
}

/**
 * STEP 5: Prepare execution payload (safe to send to agent layer)
 */
export function prepareExecutionPayload(
  validations: PolicyValidationResult[]
): Array<{
  index: string;
  sourcetype?: string;
  decision: string;
  tier: string;
  compositeScore: number;
  annualCostUsd: number;
  violations: number;
  requiresApproval: boolean;
}> {
  return validations.map(v => ({
    index: v.input.index,
    sourcetype: v.input.sourcetype,
    decision: v.validatedDecision,
    tier: v.input.tier,
    compositeScore: v.input.compositeScore,
    annualCostUsd: v.input.annualCostUsd,
    violations: v.violations.length,
    requiresApproval: v.validatedDecision === 'ESCALATE' || v.violations.length > 0,
  }));
}

/**
 * WORKFLOW: Full policy validation pipeline
 * Input: scored + recommendations
 * Output: validated decisions ready for execution
 */
export async function runPolicyValidationPipeline(
  scored: ScoredInput[],
  recommendations: AgentRecommendation[],
  profileName: string = 'operations_focused'
): Promise<{
  validations: PolicyValidationResult[];
  decisions: Map<string, { decision: string; reasoning: string }>;
  executionPayload: ReturnType<typeof prepareExecutionPayload>;
  auditTrail: ReturnType<typeof generatePolicyAuditTrail>;
}> {
  console.log(`[Policy Adapter] Starting full validation pipeline...`);

  // Initialize engine
  const engine = await initializePolicyEngine(profileName);

  // Validate all recommendations
  const { validations } = await validateWithPolicy(engine, scored, recommendations);

  // Extract decisions
  const decisions = extractValidatedDecisions(validations);

  // Prepare execution payload
  const executionPayload = prepareExecutionPayload(validations);

  // Generate audit trail
  const auditTrail = generatePolicyAuditTrail(validations, profileName);

  console.log(`[Policy Adapter] ✅ Pipeline complete`, {
    totalItems: scored.length,
    escalations: validations.filter(v => v.validatedDecision === 'ESCALATE').length,
    violations: validations.filter(v => !v.isValid).length,
  });

  return {
    validations,
    decisions,
    executionPayload,
    auditTrail,
  };
}

/**
 * RUNTIME CONFIG: Update policies without restart
 */
export function updatePolicyConfig(engine: PolicyEngine, newConfig: PolicyConfig): void {
  console.log(`[Policy Adapter] Updating policy configuration...`);
  engine.updateRules(newConfig.rules);
  engine.updateGuardrails(newConfig.guardrails);
  console.log(`[Policy Adapter] ✅ Configuration updated`);
}
