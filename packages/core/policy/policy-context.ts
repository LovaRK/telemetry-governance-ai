/**
 * POLICY CONTEXT EXTRACTOR
 * Exposes constraints to LLM BEFORE decision-making
 * Critical: LLM must see guardrails before reasoning, not after
 */

import type { ScoredInput, Guardrail } from './types';

/**
 * Extract readable constraints that block specific decisions
 */
export interface PolicyConstraint {
  decision: string;
  blockedBy: string;
  reason: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
}

/**
 * LLM-friendly policy context
 */
export interface PolicyContext {
  constraints: PolicyConstraint[];
  allowedDecisions: string[];
  recommendedDecision?: string;
  explanation: string;
}

/**
 * Extract constraints for this specific input
 */
export function extractPolicyContext(input: ScoredInput, guardrails: Guardrail[]): PolicyContext {
  const constraints: PolicyConstraint[] = [];

  // Check which decisions are blocked
  const blockedDecisions = new Map<string, string[]>();

  for (const guardrail of guardrails) {
    if (guardrail.condition(input)) {
      if (!blockedDecisions.has(guardrail.blockedDecision)) {
        blockedDecisions.set(guardrail.blockedDecision, []);
      }
      blockedDecisions.get(guardrail.blockedDecision)!.push(guardrail.name);
    }
  }

  // Convert to readable constraints
  for (const [decision, guardrailNames] of blockedDecisions) {
    constraints.push({
      decision,
      blockedBy: guardrailNames.join(', '),
      reason: `Cannot ${decision} — ${guardrailNames[0] || 'constraint violated'}`,
      severity: 'CRITICAL',
    });
  }

  // Determine allowed decisions
  const allPossibleDecisions = ['ELIMINATE', 'RETAIN', 'MONITOR', 'ESCALATE', 'REBALANCE'];
  const allowedDecisions = allPossibleDecisions.filter(
    d => !blockedDecisions.has(d)
  );

  // Build explanation
  const explanation =
    constraints.length === 0
      ? `All decisions are available for ${input.index}`
      : `${input.index} has ${constraints.length} constraint(s). Choose from: ${allowedDecisions.join(', ')}`;

  return {
    constraints,
    allowedDecisions,
    explanation,
  };
}

/**
 * Build complete LLM prompt context
 */
export function buildLLMPromptContext(
  input: ScoredInput,
  policyContext: PolicyContext
): {
  scoresSummary: string;
  constraints: string;
  decisionGuidance: string;
} {
  return {
    scoresSummary: `
Scores for ${input.index}::${input.sourcetype || 'N/A'}:
- Utilization: ${input.utilizationScore.toFixed(1)} (how much it's used)
- Detection: ${input.detectionScore.toFixed(1)} (threat coverage)
- Quality: ${input.qualityScore.toFixed(1)} (data reliability)
- Composite: ${input.compositeScore.toFixed(1)} (overall value)
- Tier: ${input.tier}
- Annual Cost: $${input.annualCostUsd.toFixed(0)}
    `.trim(),

    constraints:
      policyContext.constraints.length === 0
        ? 'No policy constraints — all decisions are available'
        : `POLICY CONSTRAINTS:\n${policyContext.constraints.map(c => `- ${c.decision}: ${c.reason}`).join('\n')}`,

    decisionGuidance: `
ALLOWED DECISIONS: ${policyContext.allowedDecisions.join(', ')}
${policyContext.explanation}

Reasoning must respect these constraints. Do not recommend blocked decisions.
    `.trim(),
  };
}
