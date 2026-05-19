/**
 * POLICY ENGINE TYPES
 * Interfaces for rules, guardrails, and policy validation
 */

export type PolicyDecision = 'ELIMINATE' | 'RETAIN' | 'MONITOR' | 'ESCALATE' | 'REBALANCE';
export type RuleSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type RuleOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'in' | 'not_in' | 'contains';

/**
 * Deterministic input: scores from engine
 */
export interface ScoredInput {
  index: string;
  sourcetype?: string;
  utilizationScore: number;
  detectionScore: number;
  qualityScore: number;
  compositeScore: number;
  tier: string;
  annualCostUsd: number;
}

/**
 * Agent/LLM recommendation
 */
export interface AgentRecommendation {
  index: string;
  recommendedDecision: PolicyDecision;
  confidence: number;
  reasoning: string;
  suggestedActions?: string[];
}

/**
 * Single rule condition
 */
export interface RuleCondition {
  field: keyof ScoredInput;
  operator: RuleOperator;
  value: number | string | string[];
  description: string;
}

/**
 * Complete rule definition
 */
export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  severity: RuleSeverity;
  conditions: RuleCondition[];
  decision: PolicyDecision;
  blockedDecisions?: PolicyDecision[];
  allowedDecisions?: PolicyDecision[];
}

/**
 * Guardrail: hard constraint that blocks certain decisions
 */
export interface Guardrail {
  id: string;
  name: string;
  description: string;
  condition: (input: ScoredInput) => boolean;
  blockedDecision: PolicyDecision;
  violation: string;
}

/**
 * Policy config: all rules + guardrails
 */
export interface PolicyConfig {
  version: string;
  rules: PolicyRule[];
  guardrails: Guardrail[];
  defaultDecision: PolicyDecision;
  escalationThreshold: number;
}

/**
 * Validation violation
 */
export interface PolicyViolation {
  ruleId: string;
  severity: RuleSeverity;
  violation: string;
  appliesTo: PolicyDecision;
}

/**
 * Validation result
 */
export interface PolicyValidationResult {
  input: ScoredInput;
  recommendedDecision: PolicyDecision;
  validatedDecision: PolicyDecision;
  violations: PolicyViolation[];
  isValid: boolean;
  appliedRules: string[];
  appliedGuardrails: string[];
  warnings: string[];
}
