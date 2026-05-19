/**
 * POLICY ENGINE — Rule-based validation layer
 * Validates agent decisions against hard guardrails + configurable rules
 * Prevents unsafe decisions before they reach execution
 */

// Core types
export type {
  PolicyDecision,
  RuleSeverity,
  RuleOperator,
  ScoredInput,
  AgentRecommendation,
  RuleCondition,
  PolicyRule,
  Guardrail,
  PolicyConfig,
  PolicyViolation,
  PolicyValidationResult,
} from './types';

// Rules validator
export { evaluateCondition, evaluateRule, findMatchingRules, resolveDecisionFromRules, isDecisionBlockedByRule } from './rules-validator';

// Guardrails
export { createDefaultGuardrails, checkGuardrailViolations, getBlockingGuardrails, createCustomGuardrail } from './guardrails';

// Policy engine
export { PolicyEngine, createDefaultPolicyEngine } from './policy-engine';

// Configurations
export { COST_OPTIMIZATION_POLICY, SECURITY_FIRST_POLICY, OPERATIONS_FOCUSED_POLICY, CONSERVATIVE_POLICY, DATA_QUALITY_POLICY, POLICY_PROFILES, getPolicyByProfile } from './policies.config';
