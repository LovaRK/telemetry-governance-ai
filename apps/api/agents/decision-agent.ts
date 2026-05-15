import { DecisionTraceCollector } from '../../../core/traceability/decision_trace';
import { ScoredTelemetry } from './scoring-agent';
import { ReasoningResult } from './reasoning-agent';

export interface DecisionResult {
  finalRecommendations: Array<{
    index: string;
    action: string;
    priority: number;
    rationale: string;
    expectedSavings: number;
  }>;
  overallConfidence: number;
  topPriorityIndex: string | null;
}

export function runDecisionAgent(
  scored: ScoredTelemetry[],
  reasoning: ReasoningResult,
  traceCollector: DecisionTraceCollector
): DecisionResult {
  const start = Date.now();

  const recommendations = scored
    .filter(s => s.classification !== 'KEEP')
    .sort((a, b) => b.riskScore - a.riskScore)
    .map((s, idx) => ({
      index: s.index,
      action: s.classification,
      priority: idx + 1,
      rationale: s.recommendation,
      expectedSavings: s.dailyAvgGb * 365 * 0.5, // heuristic cost model
    }));

  const overallConfidence = scored.length > 0
    ? scored.reduce((sum, s) => sum + s.confidence, 0) / scored.length
    : 0;

  const result: DecisionResult = {
    finalRecommendations: recommendations,
    overallConfidence: parseFloat(overallConfidence.toFixed(4)),
    topPriorityIndex: recommendations.length > 0 ? recommendations[0].index : null,
  };

  traceCollector.addFromStage(
    'decision',
    { scoredCount: scored.length, insightCount: reasoning.insights.length },
    { recommendationCount: recommendations.length, topPriority: result.topPriorityIndex },
    `Finalized ${recommendations.length} recommendations. Overall confidence: ${(overallConfidence * 100).toFixed(1)}%`,
    ['Sorted by risk score descending', 'Excluded KEEP-classified indices'],
    overallConfidence,
    Date.now() - start
  );

  return result;
}
