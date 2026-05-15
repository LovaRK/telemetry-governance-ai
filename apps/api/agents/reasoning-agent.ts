import { DecisionTraceCollector } from '../../../core/traceability/decision_trace';
import { ScoredTelemetry } from './scoring-agent';
import { OllamaClient } from '../../../agents/reasoning/ollama';

export interface ReasoningResult {
  summary: string;
  insights: Array<{
    title: string;
    description: string;
    severity: 'info' | 'warning' | 'critical';
    affectedIndices: string[];
  }>;
  patterns: string[];
}

export async function runReasoningAgent(
  scored: ScoredTelemetry[],
  traceCollector: DecisionTraceCollector
): Promise<ReasoningResult> {
  const start = Date.now();
  const ollama = new OllamaClient();

  // Build prompt for LLM
  const prompt = buildReasoningPrompt(scored);

  let llmResponse: string;
  try {
    llmResponse = await ollama.generate(prompt);
  } catch (e) {
    llmResponse = 'LLM reasoning unavailable — using deterministic summary only.';
  }

  // Parse deterministic insights regardless of LLM
  const insights = extractInsights(scored);
  const patterns = detectPatterns(scored);

  const result: ReasoningResult = {
    summary: generateSummary(scored, llmResponse),
    insights,
    patterns,
  };

  traceCollector.addFromStage(
    'reasoning',
    { scoredCount: scored.length },
    { insightCount: insights.length, patternCount: patterns.length, llmUsed: llmResponse.includes('LLM reasoning unavailable') ? false : true },
    `Generated ${insights.length} insights and ${patterns.length} patterns. LLM: ${llmResponse.includes('LLM reasoning unavailable') ? 'fallback' : 'active'}`,
    ['Pattern detection: volume vs utilization correlation', 'Anomaly detection: retention-policy mismatch'],
    llmResponse.includes('LLM reasoning unavailable') ? 0.6 : 0.85,
    Date.now() - start
  );

  return result;
}

function buildReasoningPrompt(scored: ScoredTelemetry[]): string {
  const summary = scored.map(s => 
    `- ${s.index}: ${s.dailyAvgGb.toFixed(1)} GB/day, ${s.totalEvents.toLocaleString()} events, ${s.classification} (risk: ${s.riskScore})`
  ).join('\n');

  return `Analyze this telemetry data and identify top 3 optimization opportunities:\n${summary}\n\nProvide concise, actionable insights.`;
}

function extractInsights(scored: ScoredTelemetry[]): ReasoningResult['insights'] {
  const highRisk = scored.filter(s => s.riskScore > 70);
  const wasteClusters = scored.filter(s => s.classification === 'ELIMINATE' || s.classification === 'ARCHIVE');

  const insights: ReasoningResult['insights'] = [];

  if (wasteClusters.length > 0) {
    insights.push({
      title: `High Waste Cluster (${wasteClusters.length} indices)`,
      description: `Combined potential savings: $${wasteClusters.reduce((sum, s) => sum + s.dailyAvgGb * 365 * 0.5, 0).toFixed(0)}/year`,
      severity: 'critical',
      affectedIndices: wasteClusters.map(s => s.index),
    });
  }

  if (highRisk.some(s => s.classification === 'INVESTIGATE')) {
    insights.push({
      title: 'High-Cost Active Indices Need Review',
      description: 'Expensive, heavily-used indices may have duplicate data sources.',
      severity: 'warning',
      affectedIndices: highRisk.filter(s => s.classification === 'INVESTIGATE').map(s => s.index),
    });
  }

  return insights;
}

function detectPatterns(scored: ScoredTelemetry[]): string[] {
  const patterns: string[] = [];
  const avgUtilization = scored.reduce((sum, s) => sum + (s.metadata.utilizationPct || 0), 0) / scored.length;
  
  if (avgUtilization < 30) {
    patterns.push('Low average utilization across estate — investigate ingestion policies');
  }

  const retentionMismatch = scored.filter(s => s.retentionDays > 90 && (s.metadata.utilizationPct || 0) < 20);
  if (retentionMismatch.length > 3) {
    patterns.push(`${retentionMismatch.length} indices have long retention with low utilization — archive opportunity`);
  }

  return patterns;
}

function generateSummary(scored: ScoredTelemetry[], llmResponse: string): string {
  const criticalCount = scored.filter(s => s.riskScore > 70).length;
  return `Analysis complete: ${scored.length} indices evaluated. ${criticalCount} critical issues found. ${llmResponse.substring(0, 200)}`;
}
