import { DecisionTraceCollector } from '../../../core/traceability/decision_trace';
import { SplunkClient } from '../services/splunk-client';

export interface DiscoveryResult {
  indices: Array<{
    name: string;
    eventCount: number;
    sizeGb: number;
    sourcetypeCount: number;
    firstSeen: string;
    lastSeen: string;
  }>;
  totalSizeGb: number;
  totalEventCount: number;
}

export async function runDiscoveryAgent(
  splunk: SplunkClient,
  traceCollector: DecisionTraceCollector
): Promise<DiscoveryResult> {
  const start = Date.now();
  
  const health = await splunk.healthCheckFast();
  const connected = health.success;

  const result: DiscoveryResult = {
    indices: [],
    totalSizeGb: 0,
    totalEventCount: 0,
  };

  traceCollector.addFromStage(
    'discovery',
    { mcpConnected: connected },
    { indicesFound: result.indices.length, totalSizeGb: result.totalSizeGb },
    `Discovered ${result.indices.length} indices from Splunk. Connection: ${connected ? 'connected' : 'failed'}`,
    [`Latency: ${health.latencyMs}ms`],
    connected ? 0.9 : 0.3,
    Date.now() - start
  );

  return result;
}
