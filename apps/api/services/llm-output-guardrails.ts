/**
 * LLM Output Guardrails
 *
 * Enforces hard bounds on non-deterministic LLM outputs before they reach
 * the database or executive dashboards.
 *
 * Separation of concerns:
 *   DETERMINISTIC (locked)  — scores, tiers, ROI, GainScope (never touch these)
 *   LLM ADVISORY (bounded)  — estimatedSavings, isQuickWin, confidence
 *   LLM FREE TEXT           — reasoning, evidence, recommendation (no clamping)
 *
 * Design rule: the LLM may never invent a money number larger than what the
 * deterministic formula allows, and quick-win status must be consistent with
 * the computed composite score.
 */

import type { LLMDecision } from '../agents/llm-decision-agent';
import type { ScoredSourcetype } from './deterministic-scoring-engine';

// ─── Savings Formula ─────────────────────────────────────────────────────────

/**
 * Maximum permissible annual savings estimate for a given sourcetype.
 *
 * Formula (from PDF Section 4 — Storage Optimization):
 *   max_savings = daily_gb × 365 × cost_per_gb_per_day × savings_efficiency_factor
 *
 * savings_efficiency_factor:
 *   Low-Value  tier → 0.90  (can eliminate 90% of ingestion)
 *   Nice-to-Have   → 0.60
 *   Important      → 0.25  (reduction, not elimination)
 *   Critical       → 0.05  (minor optimization only)
 *
 * This bounds LLM-generated estimatedSavings to physical reality.
 */
const TIER_SAVINGS_EFFICIENCY: Record<string, number> = {
  'Low-Value':    0.90,
  'Nice-to-Have': 0.60,
  'Important':    0.25,
  'Critical':     0.05,
};

export function computeMaxSavings(
  dailyGb: number,
  annualCostUsd: number,
  tier: string,
  costPerGbPerDay: number
): number {
  const efficiency = TIER_SAVINGS_EFFICIENCY[tier] ?? 0.25;
  // Use annualCostUsd as primary bound if available; otherwise derive from GB × cost
  const annualCostEstimate = annualCostUsd > 0
    ? annualCostUsd
    : dailyGb * 365 * costPerGbPerDay;
  return Math.round(annualCostEstimate * efficiency * 100) / 100;
}

// ─── Quick-Win Rules ──────────────────────────────────────────────────────────

/**
 * Quick-win is only valid when ALL of:
 *   1. Tier is Low-Value or Nice-to-Have (high optimization headroom)
 *   2. compositeScore < 40  (below Important threshold)
 *   3. dailyGb >= minGbThreshold  (worth actioning — default 0.5 GB/day)
 *
 * This prevents LLM from marking Critical security data as a quick win.
 */
const QUICK_WIN_MAX_COMPOSITE = 40;
const QUICK_WIN_MIN_DAILY_GB  = 0.5;

export function isQuickWinAllowed(
  tier: string,
  compositeScore: number,
  dailyGb: number
): boolean {
  return (
    (tier === 'Low-Value' || tier === 'Nice-to-Have') &&
    compositeScore < QUICK_WIN_MAX_COMPOSITE &&
    dailyGb >= QUICK_WIN_MIN_DAILY_GB
  );
}

// ─── Confidence Bounds ────────────────────────────────────────────────────────

/**
 * Confidence must be in [0.0, 1.0].
 * Additionally, LLM is not allowed to report >0.95 confidence unless the
 * deterministic score is also unambiguous (composite >= 65 or composite < 20).
 * This prevents inflated confidence on borderline indexes.
 */
export function clampConfidence(
  llmConfidence: number,
  compositeScore: number
): number {
  const clamped = Math.max(0, Math.min(1, llmConfidence));
  const isAmbiguous = compositeScore >= 20 && compositeScore < 65;
  if (isAmbiguous && clamped > 0.85) return 0.85;
  return Math.round(clamped * 100) / 100;
}

// ─── Main Guardrail Application ───────────────────────────────────────────────

export interface GuardrailResult {
  decision: LLMDecision;
  clamped: {
    estimatedSavings: boolean;
    isQuickWin: boolean;
    confidence: boolean;
  };
  originalValues: {
    estimatedSavings: number;
    isQuickWin: boolean;
    confidenceScore: number;
  };
}

/**
 * Apply all guardrails to a single LLM decision.
 *
 * @param decision   Raw LLM decision
 * @param scored     Deterministic scores for this index/sourcetype
 * @param costPerGbPerDay  Configured cost rate
 * @returns          Guarded decision + audit trail of clamped fields
 */
export function applyGuardrails(
  decision: LLMDecision,
  scored: ScoredSourcetype | undefined,
  costPerGbPerDay: number
): GuardrailResult {
  const original = {
    estimatedSavings: Number(decision.estimatedSavings ?? 0),
    isQuickWin:       Boolean(decision.isQuickWin),
    confidenceScore:  Number(decision.confidenceScore ?? 0),
  };

  // If we have no deterministic scores for this decision (e.g. reused), pass through
  if (!scored) {
    return {
      decision,
      clamped: { estimatedSavings: false, isQuickWin: false, confidence: false },
      originalValues: original,
    };
  }

  // 1. Clamp estimatedSavings
  const maxSavings = computeMaxSavings(
    scored.dailyGb,
    scored.annualCostUsd,
    scored.tier,
    costPerGbPerDay
  );
  const clampedSavings = Math.min(original.estimatedSavings, maxSavings);
  const savingsClamped = clampedSavings < original.estimatedSavings;

  // 2. Enforce quick-win rules
  const quickWinAllowed = isQuickWinAllowed(scored.tier, scored.compositeScore, scored.dailyGb);
  const clampedQuickWin = original.isQuickWin && quickWinAllowed;
  const quickWinClamped = original.isQuickWin && !quickWinAllowed;

  // 3. Clamp confidence
  const clampedConfidence = clampConfidence(original.confidenceScore, scored.compositeScore);
  const confidenceClamped = clampedConfidence < original.confidenceScore;

  if (savingsClamped || quickWinClamped || confidenceClamped) {
    const reasons: string[] = [];
    if (savingsClamped) reasons.push(`savings clamped $${original.estimatedSavings.toFixed(0)}→$${clampedSavings.toFixed(0)}`);
    if (quickWinClamped) reasons.push(`quickWin revoked (tier=${scored.tier}, composite=${scored.compositeScore})`);
    if (confidenceClamped) reasons.push(`confidence clamped ${original.confidenceScore.toFixed(2)}→${clampedConfidence.toFixed(2)}`);
    console.log(`[Guardrails] ${decision.index}/${decision.sourcetype || '_'}: ${reasons.join('; ')}`);
  }

  return {
    decision: {
      ...decision,
      estimatedSavings: clampedSavings,
      isQuickWin:       clampedQuickWin,
      confidenceScore:  clampedConfidence,
    },
    clamped: {
      estimatedSavings: savingsClamped,
      isQuickWin:       quickWinClamped,
      confidence:       confidenceClamped,
    },
    originalValues: original,
  };
}

/**
 * Apply guardrails to ALL decisions in a batch.
 * Returns guarded decisions and a summary of how many were clamped.
 */
export function applyGuardrailsToBatch(
  decisions: LLMDecision[],
  scoredMap: Map<string, ScoredSourcetype>,
  costPerGbPerDay: number
): {
  decisions: LLMDecision[];
  stats: { savingsClamped: number; quickWinRevoked: number; confidenceClamped: number };
} {
  const stats = { savingsClamped: 0, quickWinRevoked: 0, confidenceClamped: 0 };
  const guarded: LLMDecision[] = [];

  for (const dec of decisions) {
    const key = `${dec.index}::${dec.sourcetype || '_'}`;
    const scored = scoredMap.get(key);
    const result = applyGuardrails(dec, scored, costPerGbPerDay);
    guarded.push(result.decision);
    if (result.clamped.estimatedSavings) stats.savingsClamped++;
    if (result.clamped.isQuickWin)       stats.quickWinRevoked++;
    if (result.clamped.confidence)       stats.confidenceClamped++;
  }

  if (stats.savingsClamped + stats.quickWinRevoked + stats.confidenceClamped > 0) {
    console.log(`[Guardrails] Batch summary: savings_clamped=${stats.savingsClamped}, ` +
      `quickwin_revoked=${stats.quickWinRevoked}, confidence_clamped=${stats.confidenceClamped}`);
  }

  return { decisions: guarded, stats };
}
