export class EvidenceCollector {
  static fromAgentOutput(
    agentName: string,
    input: any,
    output: any
  ): string[] {
    const evidence: string[] = [];

    if (output?.telemetry_assets?.length) {
      evidence.push(`${output.telemetry_assets.length} telemetry assets analyzed`);
      output.telemetry_assets.slice(0, 3).forEach((asset: any) => {
        evidence.push(`- ${asset.telemetry_asset}: score ${asset.value_score}`);
      });
    }

    if (output?.insights?.length) {
      evidence.push(`${output.insights.length} insights generated`);
      output.insights.slice(0, 2).forEach((insight: any) => {
        evidence.push(`- ${insight.insight?.substring(0, 60)}...`);
      });
    }

    if (output?.recommendations?.length) {
      evidence.push(`${output.recommendations.length} recommendations generated`);
    }

    if (output?.status) {
      evidence.push(`Status: ${output.status}`);
    }

    if (output?.schema_version) {
      evidence.push(`Schema: ${output.schema_version}`);
    }

    return evidence;
  }

  static fromValueAgent(
    output: any
  ): string[] {
    const evidence: string[] = [];

    if (output?.telemetry_assets) {
      const actions = output.telemetry_assets.reduce((acc: Record<string, number>, a: any) => {
        acc[a.recommendation?.action || 'UNKNOWN'] = (acc[a.recommendation?.action || 'UNKNOWN'] || 0) + 1;
        return acc;
      }, {});

      Object.entries(actions).forEach(([action, count]) => {
        evidence.push(`${action}: ${count} sources`);
      });

      const totalSavings = output.telemetry_assets.reduce((sum: number, a: any) => 
        sum + (a.estimated_savings || 0), 0
      );
      if (totalSavings > 0) {
        evidence.push(`Potential savings: $${(totalSavings / 1000).toFixed(0)}k/year`);
      }
    }

    return evidence;
  }

  static fromReasoningAgent(
    output: any
  ): string[] {
    const evidence: string[] = [];

    if (output?.insights) {
      output.insights.forEach((insight: any, idx: number) => {
        evidence.push(`Insight ${idx + 1}: ${insight.insight}`);
        if (insight.confidence) {
          evidence.push(`  Confidence: ${insight.confidence.score?.toFixed(2)}`);
        }
        if (insight.evidence?.length) {
          evidence.push(`  Evidence: ${insight.evidence.slice(0, 2).join(', ')}`);
        }
      });
    }

    return evidence;
  }

  static fromDiscoveryAgent(
    output: any
  ): string[] {
    const evidence: string[] = [];

    if (output?.telemetry_summary) {
      const summary = output.telemetry_summary;
      evidence.push(`Total indexes: ${summary.total_indexes}`);
      evidence.push(`Total sources: ${summary.total_sources}`);
      evidence.push(`Daily GB estimate: ${summary.daily_gb_estimate}`);
    }

    if (output?.high_volume_sources?.length) {
      evidence.push(`High volume sources: ${output.high_volume_sources.join(', ')}`);
    }

    if (output?.critical_indexes?.length) {
      evidence.push(`Critical indexes: ${output.critical_indexes.join(', ')}`);
    }

    return evidence;
  }

  static fromConnectionAgent(
    output: any
  ): string[] {
    const evidence: string[] = [];

    evidence.push(`Connection status: ${output.status}`);
    if (output.indexes) {
      evidence.push(`Accessible indexes: ${output.indexes.length}`);
      evidence.push(`Index list: ${output.indexes.slice(0, 5).join(', ')}`);
    }
    if (output.capabilities) {
      evidence.push(`Search capability: ${output.capabilities.search}`);
      evidence.push(`Stats capability: ${output.capabilities.stats}`);
    }
    if (output.latency_ms) {
      evidence.push(`Latency: ${output.latency_ms}ms`);
    }
    return evidence;
  }

  static combine(...arrays: string[][]): string[] {
    return arrays.flat();
  }
}