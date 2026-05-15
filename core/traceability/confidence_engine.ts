import { ConfidenceInput } from './types';

export class ConfidenceEngine {
  static compute(input: ConfidenceInput): number {
    const { evidenceCount, dataQualityScore, anomalyScore, sourceReliability } = input;
    
    let score = 0.3;

    score += Math.min(evidenceCount * 0.04, 0.25);

    score += dataQualityScore * 0.2;

    score += (1 - Math.min(anomalyScore, 1)) * 0.15;

    score += sourceReliability * 0.1;

    if (evidenceCount === 0) {
      score *= 0.5;
    }

    return Math.round(Math.min(Math.max(score, 0), 1) * 100) / 100;
  }

  static fromStageData(
    stage: string,
    input: any,
    output: any
  ): number {
    const evidenceCount = this.countEvidence(output);
    const dataQualityScore = this.assessDataQuality(input, output);
    const anomalyScore = this.detectAnomalies(output);
    const sourceReliability = this.assessSourceReliability(stage, input);

    return this.compute({
      evidenceCount,
      dataQualityScore,
      anomalyScore,
      sourceReliability
    });
  }

  private static countEvidence(output: any): number {
    if (!output) return 0;
    if (output.evidence && Array.isArray(output.evidence)) {
      return output.evidence.length;
    }
    if (output.insights && Array.isArray(output.insights)) {
      return output.insights.reduce((acc: number, i: any) => 
        acc + (i.evidence?.length || 0), 0
      );
    }
    if (output.telemetry_assets && Array.isArray(output.telemetry_assets)) {
      return output.telemetry_assets.reduce((acc: number, a: any) => 
        acc + (a.evidence?.length || 0), 0
      );
    }
    return 1;
  }

  private static assessDataQuality(input: any, output: any): number {
    if (!output) return 0.3;
    
    const hasData = Object.keys(output).length > 0;
    if (!hasData) return 0.2;

    if (output.telemetry_assets?.length > 0) return 0.9;
    if (output.insights?.length > 0) return 0.8;
    if (output.sources?.length > 0) return 0.7;
    if (output.status === 'CONNECTED') return 0.85;

    return 0.6;
  }

  private static detectAnomalies(output: any): number {
    if (!output) return 0.5;
    
    const anomalyIndicators = [
      output.anomaly_frequency > 10,
      output.error_rate > 0.1,
      output.waste_score > 60,
      output.value_score < 20
    ];

    const anomalyCount = anomalyIndicators.filter(Boolean).length;
    return Math.min(anomalyCount * 0.25, 1);
  }

  private static assessSourceReliability(stage: string, input: any): number {
    const reliabilityMap: Record<string, number> = {
      connection: 0.95,
      discovery: 0.85,
      context: 0.8,
      reasoning: 0.7,
      value: 0.75,
      prioritization: 0.8,
      composition: 0.75
    };

    const base = reliabilityMap[stage] || 0.5;
    
    return base;
  }

  static getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
    if (confidence >= 0.8) return 'high';
    if (confidence >= 0.5) return 'medium';
    return 'low';
  }

  static getConfidenceColor(confidence: number): string {
    const level = this.getConfidenceLevel(confidence);
    const colors: Record<string, string> = {
      high: '#22c55e',
      medium: '#f59e0b',
      low: '#ef4444'
    };
    return colors[level];
  }
}