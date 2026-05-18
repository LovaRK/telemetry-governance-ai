import { PoolClient } from 'pg';

export interface DecisionStabilityMetrics {
  consistencyRatio: number;
  avgConfidence: number;
  durationFactor: number;
  completenessFactor: number;
  stabilityScore: number;
  isUnstable: boolean;
  decisionFlipRate: number;
  decisionFlipCount: number;
}

// Compute consistency ratio from decision history
export function computeConsistencyRatio(decisionHistory: Array<{ action: string }>): number {
  if (decisionHistory.length === 0) return 0;

  // Count frequency of each decision
  const actionCounts = new Map<string, number>();
  for (const record of decisionHistory) {
    actionCounts.set(record.action, (actionCounts.get(record.action) || 0) + 1);
  }

  // Most frequent decision count divided by total
  const maxCount = Math.max(...Array.from(actionCounts.values()));
  return maxCount / decisionHistory.length;
}

// Compute duration factor - longer stable decisions are more trustworthy
export function computeDurationFactor(firstDecisionDate: Date): number {
  const now = new Date();
  const daysStable = Math.floor((now.getTime() - firstDecisionDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.min(daysStable / 90, 1.0);
}

// Compute completeness factor based on available signals
export function computeCompletenessFactor(availableSignals: number, expectedSignals: number): number {
  if (expectedSignals === 0) return 1.0;
  return Math.min(availableSignals / expectedSignals, 1.0);
}

// Detect decision oscillation (flip rate)
export function computeDecisionFlipRate(decisionHistory: Array<{ action: string }>): { flipRate: number; flipCount: number } {
  if (decisionHistory.length < 2) return { flipRate: 0, flipCount: 0 };

  let flipCount = 0;
  for (let i = 1; i < decisionHistory.length; i++) {
    if (decisionHistory[i].action !== decisionHistory[i - 1].action) {
      flipCount++;
    }
  }

  const flipRate = flipCount / (decisionHistory.length - 1);
  return { flipRate, flipCount };
}

// Main stability formula
export async function computeDecisionStability(
  client: PoolClient,
  indexName: string,
  sourcetype: string | null,
  limitSnapshots: number = 10
): Promise<DecisionStabilityMetrics> {
  // Fetch recent decision history
  const historyResult = await client.query(
    `SELECT action, confidence, snapshot_date FROM agent_decisions
     WHERE index_name = $1 AND sourcetype IS NOT DISTINCT FROM $2
     ORDER BY snapshot_date DESC
     LIMIT $3`,
    [indexName, sourcetype || null, limitSnapshots]
  );

  if (historyResult.rows.length === 0) {
    // No history - neutral stability
    return {
      consistencyRatio: 0.5,
      avgConfidence: 0.5,
      durationFactor: 0,
      completenessFactor: 0.5,
      stabilityScore: 0.5,
      isUnstable: false,
      decisionFlipRate: 0,
      decisionFlipCount: 0,
    };
  }

  const history = historyResult.rows.map((row: any) => ({
    action: row.action,
    confidence: row.confidence || 0.5,
    date: row.snapshot_date,
  }));

  // Compute each factor
  const consistencyRatio = computeConsistencyRatio(history);
  const avgConfidence = history.reduce((sum: number, h: any) => sum + h.confidence, 0) / history.length;
  const durationFactor = history.length > 0 ? computeDurationFactor(new Date(history[0].date)) : 0;
  const completenessFactor = computeCompletenessFactor(history.length, limitSnapshots);
  const { flipRate, flipCount } = computeDecisionFlipRate(history);

  // Weighted stability formula
  const stabilityScore = Math.max(
    0,
    Math.min(
      1,
      consistencyRatio * 0.4 + avgConfidence * 0.3 + durationFactor * 0.2 + completenessFactor * 0.1
    )
  );

  const isUnstable = flipRate > 0.3;

  return {
    consistencyRatio,
    avgConfidence,
    durationFactor,
    completenessFactor,
    stabilityScore,
    isUnstable,
    decisionFlipRate: flipRate,
    decisionFlipCount: flipCount,
  };
}
