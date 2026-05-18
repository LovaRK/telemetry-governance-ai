/**
 * Trace Trust Evaluator
 *
 * Phase 6.1.5A.1.1: Trust Classification Layer
 * Transforms completeness scores into automation safety verdicts
 *
 * Key Principle:
 * "Completeness ≠ Trustworthiness.
 *  A trace can be 100% complete but structurally broken (wrong ordering, broken lineage, impossible timing).
 *  Phase 6.2 automation needs to know: Can I safely act on this?"
 */

import { Pool } from 'pg';
import { TraceCompleteness, reconstructSpanGraph, SpanNode } from './trace-completeness-validator';

/**
 * Trust levels for automation gating
 */
export enum TraceTrustLevel {
  TRUSTED = 'TRUSTED', // Safe for full automation
  DEGRADED = 'DEGRADED', // Human-in-the-loop required
  UNTRUSTWORTHY = 'UNTRUSTWORTHY', // Automation forbidden
}

/**
 * Weighted importance of each lifecycle stage
 * Missing DB_WRITE is catastrophic; missing INTENT_RECEIVED is just annoying
 */
export const STAGE_WEIGHTS: Record<string, number> = {
  INTENT_RECEIVED: 5, // Low: intent is logged but not critical for automation
  MUTATION_DISPATCHED: 5,
  API_ACCEPTED: 10,
  STATE_PERSISTED: 25, // HIGH: DB commit is critical
  AUDIT_SNAPSHOTTED: 5,
  QUERY_INVALIDATED: 25, // HIGH: Cache invalidation is critical for correctness
  CACHE_REFRESH_REQUESTED: 10,
  QUERY_REFETCHED: 15,
  UI_RECONCILED: 10,
  STATE_VERIFIED: 10, // HIGH: Final verification is critical for safety
};

export const TOTAL_STAGE_WEIGHT = Object.values(STAGE_WEIGHTS).reduce((a, b) => a + b, 0);

/**
 * Result of trust evaluation
 * Combines multiple assessment vectors into automation safety verdict
 */
export interface TraceTrustAssessment {
  traceId: string;
  trustLevel: TraceTrustLevel;
  safeForAutomation: boolean;

  // Scoring components
  completenessScore: number; // 0-100 (Stage presence)
  weightedCompletenessScore: number; // 0-100 (Weighted by criticality)
  orderingValid: boolean; // Binary: stages in correct sequence
  linkageValid: boolean; // Binary: parent-child relationships intact
  reachable: boolean; // Binary: all spans reachable from root

  // New assessment layers
  temporalValid: boolean; // Timestamps are monotonic and realistic
  cardinalityValid: boolean; // Span count is reasonable (no explosion)

  // Reasons for verdict
  reasons: string[]; // Explanation of trust level (for logging/UI)

  // Recommendations for Phase 6.2
  automationGate: {
    allowFull: boolean; // Full automation safe?
    allowSuggestOnly: boolean; // Suggest-only mode safe?
    allowEscalationOnly: boolean; // Only escalate to human?
  };

  // Metadata for audit
  criticalMissingStages: string[]; // Missing stages that impact safety
  severeIssues: string[]; // Breaking changes (not just gaps)
}

/**
 * Main trust evaluator
 * Takes completeness data and applies 4 evaluation layers
 */
export async function evaluateTraceTrust(
  completeness: TraceCompleteness,
  spanGraph: any, // From reconstructSpanGraph
  pool: Pool
): Promise<TraceTrustAssessment> {
  const reasons: string[] = [];
  const criticalMissingStages: string[] = [];
  const severeIssues: string[] = [];

  // ===== LAYER 1: WEIGHTED COMPLETENESS =====
  const weightedScore = calculateWeightedCompletenessScore(completeness);

  if (weightedScore < 100) {
    // Identify CRITICAL missing stages
    for (const stage of completeness.missingStages) {
      const weight = STAGE_WEIGHTS[stage] ?? 0;
      if (weight >= 20) {
        criticalMissingStages.push(stage);
        severeIssues.push(`CRITICAL: Missing ${stage} (weight: ${weight})`);
      }
    }
  }

  // ===== LAYER 2: TEMPORAL CONSISTENCY =====
  const temporalValid = await validateTemporalConsistency(completeness, pool);

  if (!temporalValid) {
    severeIssues.push('SEVERE: Timestamp ordering anomaly detected (possible clock skew or impossible latencies)');
  }

  // ===== LAYER 2.5: PARENT-CHILD LINKAGE =====
  if (!completeness.parentChildLinkageValid) {
    severeIssues.push(`SEVERE: orphan spans detected (${completeness.orphanSpans.length} broken parent-child links)`);
  }

  // ===== LAYER 3: CARDINALITY GUARD =====
  const cardinalityValid = validateSpanCardinality(completeness.spanCount);

  if (!cardinalityValid) {
    severeIssues.push(
      `SEVERE: Abnormal span explosion (${completeness.spanCount} spans, threshold ~30)`
    );
  }

  // ===== LAYER 4: TRACE TRUST CLASSIFICATION =====

  // Trust rules (in order of precedence)
  let trustLevel: TraceTrustLevel;
  const automationGate = {
    allowFull: false,
    allowSuggestOnly: false,
    allowEscalationOnly: false,
  };

  // Rule 1: UNTRUSTWORTHY (hard blocks)
  if (
    completeness.completenessScore < 60 ||
    criticalMissingStages.length > 0 ||
    severeIssues.length > 0 ||
    !completeness.parentChildLinkageValid ||
    !temporalValid ||
    !cardinalityValid
  ) {
    trustLevel = TraceTrustLevel.UNTRUSTWORTHY;
    automationGate.allowEscalationOnly = true; // Only escalate to human

    reasons.push('Trace contains critical gaps or structural anomalies');
    if (completeness.completenessScore < 60) {
      reasons.push(
        `Completeness too low (${completeness.completenessScore}/100, threshold 60)`
      );
    }
    if (criticalMissingStages.length > 0) {
      reasons.push(`Missing critical stages: ${criticalMissingStages.join(', ')}`);
    }
    if (!completeness.parentChildLinkageValid) {
      reasons.push('Orphan spans detected (broken parent-child linkage)');
    }
    if (!temporalValid) {
      reasons.push('Temporal anomaly (impossible timing or clock skew)');
    }
    if (!cardinalityValid) {
      reasons.push('Abnormal span cardinality (possible retry storm)');
    }
  }
  // Rule 2: DEGRADED (partial automation)
  else if (
    completeness.completenessScore < 90 ||
    weightedScore < 85 ||
    completeness.orderingViolations.length > 0
  ) {
    trustLevel = TraceTrustLevel.DEGRADED;
    automationGate.allowSuggestOnly = true; // Suggest only, human approves

    reasons.push('Trace has minor gaps; suggest-only mode enabled');
    if (completeness.completenessScore < 90) {
      reasons.push(
        `Completeness approaching threshold (${completeness.completenessScore}/100)`
      );
    }
    if (weightedScore < 85) {
      reasons.push(`Weighted completeness low (${weightedScore}/100)`);
    }
    if (completeness.orderingViolations.length > 0) {
      reasons.push(
        `${completeness.orderingViolations.length} stage ordering anomalies detected`
      );
    }
  }
  // Rule 3: TRUSTED (full automation safe)
  else {
    trustLevel = TraceTrustLevel.TRUSTED;
    automationGate.allowFull = true; // Full automation safe

    reasons.push('Trace is complete, ordered, and structurally sound');
    reasons.push(`Completeness: ${completeness.completenessScore}/100`);
    reasons.push(`Weighted score: ${weightedScore}/100`);
  }

  return {
    traceId: completeness.traceId,
    trustLevel,
    safeForAutomation: automationGate.allowFull,
    completenessScore: completeness.completenessScore,
    weightedCompletenessScore: weightedScore,
    orderingValid: completeness.stageOrderingValid,
    linkageValid: completeness.parentChildLinkageValid,
    reachable: completeness.spanDepthMetrics.unreachableFromRoot === 0,
    temporalValid,
    cardinalityValid,
    reasons,
    automationGate,
    criticalMissingStages,
    severeIssues,
  };
}

/**
 * LAYER 1: Weighted Completeness Score
 * Missing DB_WRITE is catastrophic; missing INTENT_RECEIVED is just annoying
 */
export function calculateWeightedCompletenessScore(completeness: TraceCompleteness): number {
  let totalWeight = 0;
  let observedWeight = 0;

  for (const stage of completeness.observedStages) {
    observedWeight += STAGE_WEIGHTS[stage] ?? 0;
  }

  totalWeight = TOTAL_STAGE_WEIGHT;

  return totalWeight > 0 ? Math.round((observedWeight / totalWeight) * 100) : 0;
}

/**
 * LAYER 2: Temporal Consistency Validation
 * Checks for impossible timing: negative durations, impossible latencies, clock skew
 */
export async function validateTemporalConsistency(
  completeness: TraceCompleteness,
  pool: Pool
): Promise<boolean> {
  const client = await pool.connect();

  try {
    // Check for temporal anomalies in lifecycle progression
    const result = await client.query(
      `
      WITH timeline AS (
        SELECT
          trace_id,
          lifecycle_state,
          recorded_at,
          LAG(recorded_at) OVER (PARTITION BY trace_id ORDER BY recorded_at) as prev_timestamp,
          EXTRACT(EPOCH FROM (recorded_at - LAG(recorded_at) OVER (PARTITION BY trace_id ORDER BY recorded_at))) as duration_seconds
        FROM mutation_lifecycle_events
        WHERE trace_id = $1
      )
      SELECT
        COUNT(CASE WHEN duration_seconds < 0 THEN 1 END) as negative_durations,
        COUNT(CASE WHEN duration_seconds > 300 THEN 1 END) as impossible_latencies,
        MIN(duration_seconds) as min_duration,
        MAX(duration_seconds) as max_duration
      FROM timeline
      WHERE prev_timestamp IS NOT NULL
      `,
      [completeness.traceId]
    );

    const anomalies = result.rows[0];

    // Fail if any negative durations (clock skew)
    if (anomalies.negative_durations > 0) {
      return false;
    }

    // Warn on impossible latencies (e.g., full mutation in > 5 minutes)
    if (anomalies.impossible_latencies > 0 && anomalies.max_duration > 300) {
      return false;
    }

    return true;
  } finally {
    client.release();
  }
}

/**
 * LAYER 3: Span Cardinality Guard
 * Detects abnormal span explosion (retry storms, infinite loops)
 */
export function validateSpanCardinality(spanCount: number): boolean {
  // Reasonable expectations:
  // - Simple mutation: 3-5 spans (root + dispatch + db + invalidation + reconcile)
  // - With retries: 8-15 spans (2-3 retries)
  // - Heavily retried: 20-30 spans (5+ retries)
  // - Abnormal: >40 spans indicates retry storm or infinite loop

  const CARDINALITY_THRESHOLD = 40;

  return spanCount <= CARDINALITY_THRESHOLD;
}

/**
 * Phase 6.2 Automation Gating
 * Maps trust level to automation behavior
 */
export function getAutomationBehavior(assessment: TraceTrustAssessment): {
  action: 'automate' | 'suggest' | 'escalate';
  rationale: string[];
} {
  switch (assessment.trustLevel) {
    case TraceTrustLevel.TRUSTED:
      return {
        action: 'automate',
        rationale: ['Trace is complete and trustworthy', 'Full automation safe'],
      };

    case TraceTrustLevel.DEGRADED:
      return {
        action: 'suggest',
        rationale: [
          'Trace has minor gaps',
          'Human operator approval recommended before automation',
          'Enable suggest-only mode',
        ],
      };

    case TraceTrustLevel.UNTRUSTWORTHY:
      return {
        action: 'escalate',
        rationale: [
          'Trace has critical gaps or structural anomalies',
          'Automation forbidden',
          'Manual operator investigation required',
          ...assessment.severeIssues.slice(0, 2), // Include top 2 issues
        ],
      };
  }
}

/**
 * Batch evaluate trust for compliance reporting
 */
export async function evaluateTraceTrustBatch(
  traceIds: string[],
  completenessMap: Map<string, TraceCompleteness>,
  pool: Pool
): Promise<Map<string, TraceTrustAssessment>> {
  const results = new Map<string, TraceTrustAssessment>();

  for (const traceId of traceIds) {
    const completeness = completenessMap.get(traceId);
    if (!completeness) continue;

    const spanGraph = await reconstructSpanGraph(traceId, pool);
    const assessment = await evaluateTraceTrust(completeness, spanGraph, pool);
    results.set(traceId, assessment);
  }

  return results;
}

/**
 * Trust audit report for SRE/compliance
 */
export interface TrustAuditReport {
  totalTraces: number;
  trustedTraces: number;
  degradedTraces: number;
  untrustyworthyTraces: number;
  trustPercentage: number;
  automationSafePercentage: number;
  commonCriticalGaps: Array<{ stage: string; count: number }>;
  commonSevereIssues: Array<{ issue: string; count: number }>;
  recommendations: string[];
}

export async function generateTrustAuditReport(
  pool: Pool,
  lookbackDays: number = 7
): Promise<TrustAuditReport> {
  const client = await pool.connect();

  try {
    const tracesResult = await client.query(
      `
      SELECT DISTINCT trace_id
      FROM mutation_lifecycle_events
      WHERE recorded_at > NOW() - INTERVAL '1 day' * $1
      ORDER BY trace_id
      `,
      [lookbackDays]
    );

    const traceIds = tracesResult.rows.map((r) => r.trace_id);

    let trustedCount = 0;
    let degradedCount = 0;
    let untrustyworthyCount = 0;
    const criticalGapFrequency: Record<string, number> = {};
    const severeIssueFrequency: Record<string, number> = {};

    // Evaluate each trace (simplified - in production, batch by completeness first)
    for (const traceId of traceIds.slice(0, 100)) {
      // Evaluate sample
      // Note: In production, pre-fetch all completeness scores, then evaluate trust
      // This is just pseudocode for the logic
    }

    const totalTraces = traceIds.length;
    const automationSafeCount = trustedCount;

    return {
      totalTraces,
      trustedTraces: trustedCount,
      degradedTraces: degradedCount,
      untrustyworthyTraces: untrustyworthyCount,
      trustPercentage: totalTraces > 0 ? (trustedCount / totalTraces) * 100 : 0,
      automationSafePercentage: totalTraces > 0 ? (automationSafeCount / totalTraces) * 100 : 0,
      commonCriticalGaps: Object.entries(criticalGapFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([stage, count]) => ({ stage, count })),
      commonSevereIssues: Object.entries(severeIssueFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([issue, count]) => ({ issue, count })),
      recommendations: generateRecommendations(trustedCount, totalTraces),
    };
  } finally {
    client.release();
  }
}

/**
 * (Private) Generate recommendations based on trust audit
 */
function generateRecommendations(trustedCount: number, totalTraces: number): string[] {
  const trustPercentage = totalTraces > 0 ? (trustedCount / totalTraces) * 100 : 0;
  const recommendations: string[] = [];

  if (trustPercentage < 80) {
    recommendations.push('Trust percentage below 80% - investigate root causes');
  }

  if (trustPercentage < 70) {
    recommendations.push('CRITICAL: Only 70% of traces are automation-safe - disable automation');
  }

  if (trustPercentage > 95) {
    recommendations.push('Trace quality excellent - automation safe');
  }

  return recommendations;
}
