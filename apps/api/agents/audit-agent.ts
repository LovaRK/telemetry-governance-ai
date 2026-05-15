import { DecisionTraceCollector } from '../../../core/traceability/decision_trace';
import { DecisionResult } from './decision-agent';
import { ReasoningResult } from './reasoning-agent';

export interface AuditResult {
  traceId: string;
  auditPassed: boolean;
  issues: string[];
  finalReport: {
    recommendationCount: number;
    totalPotentialSavings: number;
    avgConfidence: number;
    coverage: number;
  };
}

export function runAuditAgent(
  decision: DecisionResult,
  reasoning: ReasoningResult,
  totalIndices: number,
  traceCollector: DecisionTraceCollector
): AuditResult {
  const start = Date.now();
  const issues: string[] = [];

  // Audit checks
  if (decision.overallConfidence < 0.5) {
    issues.push('Overall confidence below 50% — recommend manual review');
  }
  if (reasoning.insights.length === 0) {
    issues.push('No insights generated — possible data quality issue');
  }
  if (decision.finalRecommendations.length === 0) {
    issues.push('Zero recommendations — all indices marked KEEP');
  }

  const coverage = totalIndices > 0 ? decision.finalRecommendations.length / totalIndices : 0;

  const result: AuditResult = {
    traceId: traceCollector.getTraceId(),
    auditPassed: issues.length === 0,
    issues,
    finalReport: {
      recommendationCount: decision.finalRecommendations.length,
      totalPotentialSavings: decision.finalRecommendations.reduce((sum, r) => sum + r.expectedSavings, 0),
      avgConfidence: decision.overallConfidence,
      coverage,
    },
  };

  traceCollector.addFromStage(
    'audit',
    { recommendationCount: decision.finalRecommendations.length },
    { auditPassed: result.auditPassed, issueCount: issues.length },
    `Audit complete: ${issues.length} issues found. Coverage: ${(coverage * 100).toFixed(1)}%`,
    issues.length > 0 ? issues : ['All audit checks passed'],
    result.auditPassed ? 0.95 : 0.6,
    Date.now() - start
  );

  return result;
}
