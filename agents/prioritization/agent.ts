import { PrioritizationInput, PrioritizationOutput } from './types';

export async function runPrioritizationAgent(input: PrioritizationInput): Promise<PrioritizationOutput> {
  const { reasoning } = input;
  const insights = reasoning.insights || [];

  const severityScores: Record<string, number> = {};
  const high: any[] = [];
  const medium: any[] = [];
  const low: any[] = [];

  insights.forEach((insight, index) => {
    const score = insight.confidence?.score || 0.5;
    const key = `insight_${index}`;
    severityScores[key] = score;

    if (score >= 0.75) {
      high.push({ ...insight, key });
    } else if (score >= 0.5) {
      medium.push({ ...insight, key });
    } else {
      low.push({ ...insight, key });
    }
  });

  return {
    prioritized: { high, medium, low },
    severity_scores: severityScores,
    schema_version: 'v1'
  };
}