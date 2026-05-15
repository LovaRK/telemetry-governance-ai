import { DecisionTraceCollector } from '../../../core/traceability/decision_trace';
import { DiscoveryResult } from './discovery-agent';

export interface NormalizedTelemetry {
  index: string;
  sourcetype?: string;
  totalEvents: number;
  dailyAvgGb: number;
  retentionDays: number;
  firstEvent: string;
  lastEvent: string;
  metadata: Record<string, any>;
}

/**
 * Normalize raw Splunk discovery output into structured telemetry records.
 */
export function runNormalizationAgent(
  discovery: DiscoveryResult,
  traceCollector: DecisionTraceCollector
): NormalizedTelemetry[] {
  const start = Date.now();
  
  const normalized: NormalizedTelemetry[] = discovery.indices.map((idx) => ({
    index: idx.name,
    totalEvents: idx.eventCount,
    dailyAvgGb: idx.sizeGb / 30,
    retentionDays: 90,
    firstEvent: idx.firstSeen,
    lastEvent: idx.lastSeen,
    metadata: {
      sourcetypeCount: idx.sourcetypeCount,
      rawSizeGb: idx.sizeGb,
    },
  }));

  traceCollector.addFromStage(
    'normalization',
    { rawIndices: discovery.indices.length },
    { normalizedCount: normalized.length },
    `Normalized ${normalized.length} index records. Calculated daily averages and retention defaults.`,
    ['Applied 30-day rolling average for daily_avg_gb', 'Default retention: 90 days'],
    0.95,
    Date.now() - start
  );

  return normalized;
}
