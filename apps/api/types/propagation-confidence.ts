/**
 * Propagation Confidence Domain
 *
 * Phase 6.1.5A.2: Quantify substrate reliability separate from structural trust
 *
 * Problem: Structural trust (completeness, ordering, cardinality) is necessary but not sufficient.
 * A trace can be perfectly structured but arrive via broken propagation channels.
 *
 * Solution: Measure context propagation reliability at four layers:
 * 1. Extraction (can we read traceparent from inbound?)
 * 2. ALS binding (does AsyncLocalStorage hold context correctly?)
 * 3. Async boundary crossing (queue/SSE — does context survive message broker?)
 * 4. Replay recovery (do retries maintain causal continuity?)
 *
 * Phase 2B blocker: SSE amplifies propagation failures 200x (one client → 200 subscribers).
 * Must measure and gate automation on propagation confidence BEFORE enabling streaming.
 */

/**
 * Propagation Confidence Metrics
 * All scores normalized to [0, 1] where 1.0 = perfect, 0.0 = complete failure
 */
export interface PropagationConfidence {
  // ===== EXTRACTION PHASE =====
  // Can we read context from inbound HTTP headers?
  extractionSuccessRate: number; // [0, 1] — % of requests with parseable traceparent header
  extractionFailureRate: number; // [0, 1] — % that lost context at boundary (1 - success rate)

  // ===== ASYNC LOCAL STORAGE RELIABILITY =====
  // Does context persist through async boundaries via AsyncLocalStorage?
  alsIntegrity: number; // [0, 1] — % of spans with correct ALS binding at execution
  alsContextLossRate: number; // [0, 1] — % of async operations where context vanished
  orphanRepairRate: number; // [0, 1] — % of orphans recovered via topology match fallback

  // ===== ASYNC BOUNDARY CROSSING =====
  // Queue/SSE boundaries: does trace_id survive message broker?
  asyncBoundaryIntegrity: number; // [0, 1] — % of messages with propagated context on dequeue
  contextLossAtBoundary: number; // [0, 1] — % of messages losing trace_id at broker boundary
  visibilityTimeoutForkRate: number; // [0, 1] — % of messages claimed by 2+ workers (causal fork risk)

  // ===== REPLAY & RECOVERY =====
  // Do retries maintain causal continuity?
  replayContinuityScore: number; // [0, 1] — % of retries maintaining parent_span_id chain
  ambiguousReplayRate: number; // [0, 1] — % of retries with fork risk (multiple workers claiming same task)
  retryOrphanRate: number; // [0, 1] — % of retries creating orphan spans

  // ===== DERIVED: EFFECTIVE PROPAGATION TRUST =====
  // Weighted blend: which signal is most concerning?
  compositeScore: number; // [0, 1] — floor(min(extraction, als, boundary, replay))
  // Rationale: propagation chain is only as strong as weakest link
  // If extraction is 80% but boundary is 40%, effective trust = 40%

  // ===== METADATA =====
  observationWindow: {
    startedAt: string; // ISO8601
    duration_seconds: number;
    sample_size: number; // How many spans measured this window
  };
  blockedByFactor?: 'EXTRACTION' | 'ALS' | 'BOUNDARY' | 'REPLAY'; // Which layer is bottleneck
}

/**
 * Effective Automation Trust
 * Combines structural trust (Phase 6.1.5A.1.1) + propagation confidence + freshness decay
 *
 * Final verdict for Phase 6.2 automation gate:
 * safeForAutomation = structuralTrust ∧ propagationConfidence ∧ freshnessModifier
 */
export interface EffectiveAutomationTrust {
  traceId: string;

  // ===== STRUCTURAL TRUST =====
  // From Phase 6.1.5A.1.1 validator
  structuralTrust: number; // [0, 1] — completeness, ordering, cardinality, lineage
  structuralVerdictExplained: string; // "TRUSTED" | "DEGRADED" | "UNTRUSTWORTHY"

  // ===== PROPAGATION CONFIDENCE =====
  // NEW: substrate reliability separate from structure
  propagationConfidence: PropagationConfidence;

  // ===== FRESHNESS DECAY =====
  // From Phase 2 (Trust Decay Service) — mutations age out
  freshnessModifier: number; // [0, 1] — decay from approval/mutation age
  // Example: mutation approved 25 days ago = 0.5x modifier (halfway to expiry at 30d)
  freshnessExpiresAt?: string; // ISO8601 when this trace expires from policy

  // ===== FINAL VERDICT =====
  // Multiplicative composition: all gates must pass
  // effectiveScore = structuralTrust × propagationConfidence.compositeScore × freshnessModifier
  effectiveScore: number; // [0, 1] — final automation safety verdict

  automationGate: {
    allowFull: boolean; // effectiveScore >= 0.85 AND all components >= 0.80
    allowSuggestOnly: boolean; // effectiveScore >= 0.70 (human approval required)
    allowEscalationOnly: boolean; // effectiveScore < 0.70 (SRE investigation)
    reasoning: string[];
  };

  // ===== AUDIT =====
  evaluatedAt: string; // ISO8601
  evaluationContext: {
    // Which bottleneck limited trust?
    limitedBy: 'STRUCTURAL' | 'PROPAGATION' | 'FRESHNESS' | 'NONE';
    // Margin to passing threshold (for alerting)
    marginToPassingThreshold: number; // [0, 0.15] — how close to demotion
  };
}

/**
 * Compute effective automation trust by blending three independent signals
 *
 * Principle: A trace must be trustworthy on ALL dimensions to be automation-safe.
 * Weak propagation + strong structure = DEGRADED (not TRUSTED)
 * Strong propagation + weak structure = DEGRADED (not TRUSTED)
 * Either weak + freshness expiring = DEGRADED (not TRUSTED)
 */
export function computeEffectiveAutomationTrust(
  traceId: string,
  structuralTrust: number, // 0-1 from Phase 6.1.5A.1.1
  propagationConfidence: PropagationConfidence,
  freshnessModifier: number, // 0-1 from Phase 2 decay service
  structuralVerdictExplained: string = 'UNKNOWN'
): EffectiveAutomationTrust {
  // Multiplicative composition: weakest link dominates
  const rawEffectiveScore = structuralTrust * propagationConfidence.compositeScore * freshnessModifier;

  // Which factor is the bottleneck?
  let limitedBy: 'STRUCTURAL' | 'PROPAGATION' | 'FRESHNESS' | 'NONE' = 'NONE';
  const signals = [
    { name: 'STRUCTURAL' as const, score: structuralTrust },
    { name: 'PROPAGATION' as const, score: propagationConfidence.compositeScore },
    { name: 'FRESHNESS' as const, score: freshnessModifier },
  ];
  const sortedByScore = signals.sort((a, b) => a.score - b.score);
  if (sortedByScore[0].score < 0.85) {
    limitedBy = sortedByScore[0].name;
  }

  // Determine automation gate
  const automationGate = {
    allowFull: rawEffectiveScore >= 0.85 && structuralTrust >= 0.80 && propagationConfidence.compositeScore >= 0.80 && freshnessModifier >= 0.80,
    allowSuggestOnly: rawEffectiveScore >= 0.70 && structuralTrust >= 0.70 && propagationConfidence.compositeScore >= 0.70 && freshnessModifier >= 0.70,
    allowEscalationOnly: true, // Always allow escalation
    reasoning: [] as string[],
  };

  // Build reasoning
  if (!automationGate.allowFull && !automationGate.allowSuggestOnly) {
    automationGate.reasoning.push('Effective score below 70% threshold — automation forbidden');
  } else if (!automationGate.allowFull) {
    automationGate.reasoning.push('Effective score 70-85% — suggest-only mode (human approval required)');
  } else {
    automationGate.reasoning.push(`Full automation safe (${(rawEffectiveScore * 100).toFixed(1)}% confidence)`);
  }

  if (structuralTrust < 0.80) {
    automationGate.reasoning.push(`Structural trust low (${(structuralTrust * 100).toFixed(1)}%): ${structuralVerdictExplained}`);
  }

  if (propagationConfidence.compositeScore < 0.80) {
    const blocked = propagationConfidence.blockedByFactor || 'UNKNOWN';
    automationGate.reasoning.push(`Propagation confidence low (${(propagationConfidence.compositeScore * 100).toFixed(1)}%): bottleneck at ${blocked}`);
  }

  if (freshnessModifier < 0.80) {
    automationGate.reasoning.push(`Freshness decay applied (${(freshnessModifier * 100).toFixed(1)}%): mutation aging out`);
  }

  const marginToPassingThreshold = Math.max(0, Math.min(0.15, 0.85 - rawEffectiveScore));

  return {
    traceId,
    structuralTrust,
    structuralVerdictExplained,
    propagationConfidence,
    freshnessModifier,
    effectiveScore: rawEffectiveScore,
    automationGate,
    evaluatedAt: new Date().toISOString(),
    evaluationContext: {
      limitedBy,
      marginToPassingThreshold,
    },
  };
}

/**
 * Classify propagation confidence tier
 * For UI display and alert thresholds
 */
export enum PropagationConfidenceTier {
  EXCELLENT = 'EXCELLENT', // compositeScore >= 0.95 (optimal)
  HEALTHY = 'HEALTHY', // compositeScore >= 0.85
  DEGRADED = 'DEGRADED', // compositeScore >= 0.70 (needs monitoring)
  CRITICAL = 'CRITICAL', // compositeScore < 0.70 (alarm)
}

export function classifyPropagationConfidenceTier(confidence: PropagationConfidence): PropagationConfidenceTier {
  const score = confidence.compositeScore;
  if (score >= 0.95) return PropagationConfidenceTier.EXCELLENT;
  if (score >= 0.85) return PropagationConfidenceTier.HEALTHY;
  if (score >= 0.70) return PropagationConfidenceTier.DEGRADED;
  return PropagationConfidenceTier.CRITICAL;
}
