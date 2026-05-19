/**
 * QUALITY SIGNALS MAPPER
 * Normalizes parsing errors → canonical QualitySignals
 * Applies weighting: DateParserVerbose=0.5x, others=1.0x
 */

import type { QualitySignals } from './types';

interface RawParsingEvent {
  sourcetype: string;
  component: string;
  count: number;
  timestamp?: string;
}

const PARSING_COMPONENT_WEIGHTS: Record<string, number> = {
  DateParserVerbose: 0.5,
  DateParser: 1.0,
  XMLParser: 1.0,
  JSONParser: 1.0,
  CSVParser: 1.0,
  SyslogParser: 1.0,
};

function getComponentWeight(component: string): number {
  return PARSING_COMPONENT_WEIGHTS[component] ?? 1.0;
}

/**
 * CRITICAL: Weighted issues are computed HERE
 * Not in engine — ensures consistent quality scoring
 */
export function mapQualitySignals(raw: RawParsingEvent[]): QualitySignals[] {
  const bySourcetype = new Map<string, { weighted: number; lastAssessment: Date }>();

  for (const event of raw) {
    const weight = getComponentWeight(event.component);
    const weightedCount = event.count * weight;

    const key = event.sourcetype;
    const current = bySourcetype.get(key) || { weighted: 0, lastAssessment: new Date() };

    bySourcetype.set(key, {
      weighted: current.weighted + weightedCount,
      lastAssessment: event.timestamp ? new Date(event.timestamp) : current.lastAssessment,
    });
  }

  const result: QualitySignals[] = [];

  for (const [sourcetype, data] of bySourcetype) {
    result.push({
      index: sourcetype,
      sourcetype,
      parseErrorRate: data.weighted, // absolute weighted count
      weightedIssues: data.weighted,
      qualityScore: 0, // Computed by engine, not here
      lastAssessment: data.lastAssessment,
      _rawComponents: raw.filter(e => e.sourcetype === sourcetype).length,
    });
  }

  return result;
}

/**
 * Aggregate quality signals across all sourcetypes
 */
export function aggregateQualityMetrics(signals: QualitySignals[]): {
  totalWeightedIssues: number;
  avgQualityScore: number;
  problematicSourcetypes: string[];
} {
  const totalWeightedIssues = signals.reduce((sum, s) => sum + s.weightedIssues, 0);

  const avgQualityScore = signals.length > 0 ? signals.reduce((sum, s) => sum + s.qualityScore, 0) / signals.length : 100;

  const problematicSourcetypes = signals
    .filter(s => s.qualityScore < 70)
    .sort((a, b) => a.qualityScore - b.qualityScore)
    .map(s => s.sourcetype || 'unknown')
    .slice(0, 10);

  return {
    totalWeightedIssues,
    avgQualityScore,
    problematicSourcetypes,
  };
}

/**
 * Quality profile: low-quality sourcetypes needing attention
 */
export function identifyQualityHotspots(signals: QualitySignals[]): QualitySignals[] {
  return signals.filter(s => s.qualityScore < 70 || s.weightedIssues > 100).sort((a, b) => a.qualityScore - b.qualityScore);
}
