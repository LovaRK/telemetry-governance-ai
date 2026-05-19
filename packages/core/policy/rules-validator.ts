/**
 * RULES VALIDATOR
 * Evaluates policy rules against scored inputs
 */

import type {
  PolicyRule,
  RuleCondition,
  ScoredInput,
  PolicyDecision,
} from './types';

/**
 * Evaluate single condition
 */
export function evaluateCondition(input: ScoredInput, condition: RuleCondition): boolean {
  const value = input[condition.field];

  switch (condition.operator) {
    case 'gt':
      return typeof value === 'number' && typeof condition.value === 'number' && value > condition.value;
    case 'gte':
      return typeof value === 'number' && typeof condition.value === 'number' && value >= condition.value;
    case 'lt':
      return typeof value === 'number' && typeof condition.value === 'number' && value < condition.value;
    case 'lte':
      return typeof value === 'number' && typeof condition.value === 'number' && value <= condition.value;
    case 'eq':
      return value === condition.value;
    case 'neq':
      return value !== condition.value;
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(value as string);
    case 'not_in':
      return Array.isArray(condition.value) && !condition.value.includes(value as string);
    case 'contains':
      return typeof value === 'string' && typeof condition.value === 'string' && value.includes(condition.value);
    default:
      return false;
  }
}

/**
 * Evaluate all conditions in rule (AND logic)
 */
export function evaluateRule(input: ScoredInput, rule: PolicyRule): boolean {
  return rule.conditions.every(condition => evaluateCondition(input, condition));
}

/**
 * Get all matching rules
 */
export function findMatchingRules(input: ScoredInput, rules: PolicyRule[]): PolicyRule[] {
  return rules.filter(rule => evaluateRule(input, rule));
}

/**
 * Determine decision from matching rules (priority by severity)
 */
export function resolveDecisionFromRules(input: ScoredInput, rules: PolicyRule[]): {
  decision: PolicyDecision | null;
  appliedRules: string[];
} {
  const matching = findMatchingRules(input, rules);

  if (matching.length === 0) {
    return { decision: null, appliedRules: [] };
  }

  // Priority: CRITICAL > HIGH > MEDIUM > LOW
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sorted = matching.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const primary = sorted[0];

  return {
    decision: primary.decision,
    appliedRules: sorted.map(r => r.id),
  };
}

/**
 * Check if decision is blocked by rule constraints
 */
export function isDecisionBlockedByRule(
  decision: PolicyDecision,
  rules: PolicyRule[]
): { isBlocked: boolean; blockedBy: string[] } {
  const blockedBy: string[] = [];

  for (const rule of rules) {
    if (rule.blockedDecisions?.includes(decision)) {
      blockedBy.push(rule.id);
    }
    if (rule.allowedDecisions && !rule.allowedDecisions.includes(decision)) {
      blockedBy.push(rule.id);
    }
  }

  return { isBlocked: blockedBy.length > 0, blockedBy };
}
