import { DecisionTraceCollector } from '../../../../core/traceability/decision_trace';
import { runDiscoveryAgent } from '../discovery-agent';
import { runNormalizationAgent } from '../normalization-agent';
import { runScoringAgent } from '../scoring-agent';
import { runDecisionAgent } from '../decision-agent';
import { runAuditAgent } from '../audit-agent';
import { SplunkClient } from '../../services/splunk-client';

describe('6-Agent Pipeline Integration', () => {
  let traceCollector: DecisionTraceCollector;

  beforeEach(() => {
    traceCollector = new DecisionTraceCollector('test-trace-001');
  });

  it('runs full pipeline end-to-end with demo data', async () => {
    // Mock Splunk client that returns demo-like data
    const mockSplunk = {
      healthCheck: jest.fn().mockResolvedValue({ status: 'connected', latencyMs: 45 }),
      getIndexMetrics: jest.fn().mockResolvedValue([
        { name: 'nginx', eventCount: 1e9, sizeGb: 300, sourcetypeCount: 3, firstSeen: '2024-01-01', lastSeen: '2024-12-01' },
        { name: 'security', eventCount: 1e6, sizeGb: 50, sourcetypeCount: 5, firstSeen: '2024-01-01', lastSeen: '2024-12-01' },
      ]),
    } as unknown as SplunkClient;

    // Stage 1: Discovery
    const discovery = await runDiscoveryAgent(mockSplunk, traceCollector);
    expect(discovery.indices.length).toBe(2);

    // Stage 2: Normalization
    const normalized = runNormalizationAgent(discovery, traceCollector);
    expect(normalized.length).toBe(2);
    expect(normalized[0].dailyAvgGb).toBe(10); // 300/30

    // Stage 3: Scoring
    const scored = runScoringAgent(normalized, traceCollector);
    expect(scored[0].classification).toBe('ELIMINATE'); // 10 GB/day, 0% utilization

    // Stage 4: Reasoning (requires Ollama, skip in pure unit test or mock)
    // const reasoning = await runReasoningAgent(scored, traceCollector);

    // Stage 5: Decision
    const decision = runDecisionAgent(scored, { insights: [], patterns: [], summary: '' }, traceCollector);
    expect(decision.finalRecommendations.length).toBeGreaterThan(0);
    expect(decision.overallConfidence).toBeGreaterThan(0);

    // Stage 6: Audit
    const audit = runAuditAgent(decision, { insights: [], patterns: [], summary: '' }, 2, traceCollector);
    expect(audit.auditPassed).toBe(true);
    expect(audit.finalReport.recommendationCount).toBe(decision.finalRecommendations.length);

    // Verify trace completeness
    const traces = traceCollector.getAll();
    expect(traces.length).toBeGreaterThanOrEqual(5); // discovery, normalization, scoring, decision, audit
    expect(traceCollector.getOverallConfidence()).toBeGreaterThan(0);
  });
});
