import { DecisionTraceCollector } from '../../../core/traceability/decision_trace';
import { NormalizedTelemetry } from './normalization-agent';
import { scoreTelemetry, ScoringResult } from '../services/scoring-service';

export interface ScoredTelemetry extends NormalizedTelemetry {
  classification: string;
  confidence: number;
  riskScore: number;
  recommendation: string;
  evidence: string[];
}

export function runScoringAgent(
  normalized: NormalizedTelemetry[],
  traceCollector: DecisionTraceCollector
): ScoredTelemetry[] {
  const start = Date.now();
  
  const scored: ScoredTelemetry[] = normalized.map((item) => {
    const input = {
      index: item.index,
      sourcetype: item.sourcetype,
      totalEvents: item.totalEvents,
      dailyAvgGb: item.dailyAvgGb,
      retentionDays: item.retentionDays,
      utilizationPct: item.metadata.utilizationPct || 0,
      costPerYear: item.dailyAvgGb * 365 * 0.5,
    };

    const result = scoreTelemetry(input);

    return {
      ...item,
      classification: result.classification,
      confidence: result.confidence,
      riskScore: result.riskScore,
      recommendation: result.recommendation,
      evidence: result.evidence,
    };
  });

  const distribution = scored.reduce((acc, s) => {
    acc[s.classification] = (acc[s.classification] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  traceCollector.addFromStage(
    'scoring',
    { recordCount: normalized.length },
    { scoredCount: scored.length, distribution },
    `Scored ${scored.length} telemetry records using deterministic rules. High-risk: ${distribution['ELIMINATE'] || 0}`,
    ['Utilization threshold: 5% for ELIMINATE', 'Volume threshold: 10 GB/day for ELIMINATE'],
    0.92,
    Date.now() - start
  );

  return scored;
}
