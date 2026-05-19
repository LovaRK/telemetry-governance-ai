/**
 * GUARDRAILS ENGINE
 * Hard constraints that block invalid decisions
 * These are non-negotiable: violations block recommendations
 */

import type {
  ScoredInput,
  PolicyDecision,
  Guardrail,
  PolicyViolation,
} from './types';

/**
 * Default guardrails: hard business rules
 */
export function createDefaultGuardrails(): Guardrail[] {
  return [
    {
      id: 'guardrail-detection-threshold',
      name: 'Detection Coverage Threshold',
      description: 'Cannot eliminate sources with detection > 60 (missed threats)',
      condition: (input: ScoredInput) => input.detectionScore > 60,
      blockedDecision: 'ELIMINATE',
      violation: `Detection score ${input => input.detectionScore.toFixed(1)} exceeds threshold (60) — eliminating would create blind spot`,
    },
    {
      id: 'guardrail-critical-utilization',
      name: 'Critical Utilization Protection',
      description: 'Cannot eliminate sources in use by critical systems (alerts/dashboards)',
      condition: (input: ScoredInput) => input.utilizationScore > 70,
      blockedDecision: 'ELIMINATE',
      violation: `Utilization score ${input => input.utilizationScore.toFixed(1)} is critical (>70) — in use by active systems`,
    },
    {
      id: 'guardrail-quality-unresolved',
      name: 'Quality Issues Must Be Addressed',
      description: 'Cannot eliminate sources with unresolved quality issues without remediation',
      condition: (input: ScoredInput) => input.qualityScore < 50,
      blockedDecision: 'ELIMINATE',
      violation: `Quality score ${input => input.qualityScore.toFixed(1)} is low (<50) — quality issues must be resolved before elimination`,
    },
    {
      id: 'guardrail-tier-critical',
      name: 'Critical Tier Protection',
      description: 'Cannot eliminate Tier 1 (Critical) sources without escalation',
      condition: (input: ScoredInput) => input.tier === 'Critical',
      blockedDecision: 'ELIMINATE',
      violation: `Source is Tier 1 (Critical) — cannot eliminate without escalation and approval`,
    },
    {
      id: 'guardrail-high-cost',
      name: 'High-Cost Governance',
      description: 'Cannot eliminate sources costing >$50k/year without analysis',
      condition: (input: ScoredInput) => input.annualCostUsd > 50000,
      blockedDecision: 'ELIMINATE',
      violation: `Annual cost ${input => `$${input.annualCostUsd.toFixed(0)}`} exceeds $50k threshold — elimination requires detailed analysis`,
    },
    {
      id: 'guardrail-composite-minimum',
      name: 'Composite Score Floor',
      description: 'Cannot eliminate sources with composite > 55 without business justification',
      condition: (input: ScoredInput) => input.compositeScore > 55,
      blockedDecision: 'ELIMINATE',
      violation: `Composite score ${input => input.compositeScore.toFixed(1)} is above elimination threshold (55) — requires business case`,
    },
    {
      id: 'guardrail-monitor-quality',
      name: 'Monitor-to-Eliminate Transition',
      description: 'Sources in MONITOR state must address quality before elimination',
      condition: (input: ScoredInput) => input.qualityScore < 70,
      blockedDecision: 'MONITOR',
      violation: `Quality too low (${input => input.qualityScore.toFixed(1)}) for monitoring — needs improvement or elimination path`,
    },
  ];
}

/**
 * Check violations against guardrails
 */
export function checkGuardrailViolations(
  input: ScoredInput,
  decision: PolicyDecision,
  guardrails: Guardrail[]
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  for (const guardrail of guardrails) {
    if (guardrail.blockedDecision === decision && guardrail.condition(input)) {
      violations.push({
        ruleId: guardrail.id,
        severity: 'CRITICAL',
        violation:
          typeof guardrail.violation === 'string'
            ? guardrail.violation
            : guardrail.violation(input),
        appliesTo: decision,
      });
    }
  }

  return violations;
}

/**
 * Get all guardrails that would block this decision
 */
export function getBlockingGuardrails(
  input: ScoredInput,
  decision: PolicyDecision,
  guardrails: Guardrail[]
): Guardrail[] {
  return guardrails.filter(g => g.blockedDecision === decision && g.condition(input));
}

/**
 * Create custom guardrail (for tenant-specific rules)
 */
export function createCustomGuardrail(
  id: string,
  name: string,
  description: string,
  condition: (input: ScoredInput) => boolean,
  blockedDecision: PolicyDecision,
  violationMessage: string | ((input: ScoredInput) => string)
): Guardrail {
  return {
    id,
    name,
    description,
    condition,
    blockedDecision,
    violation: violationMessage,
  };
}
