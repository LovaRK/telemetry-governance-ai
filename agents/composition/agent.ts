import { CompositionInput, CompositionOutput, UIComponent } from './types';
import { TelemetryAsset } from '../../core/schemas/telemetry-asset';

export async function runCompositionAgent(input: CompositionInput): Promise<CompositionOutput> {
  const { value, prioritization } = input;
  const components: UIComponent[] = [];

  const assets = value.telemetry_assets;
  const totalSavings = assets.reduce((sum, a) => sum + (a.estimated_savings || 0), 0);
  
  components.push({
    type: 'metric_card',
    title: 'Total Telemetry Assets',
    value: assets.length.toString(),
    priority: 'medium',
    reasoning: `Analyzed ${assets.length} telemetry sources`
  });

  components.push({
    type: 'metric_card',
    title: 'Potential Annual Savings',
    value: `$${(totalSavings / 1000).toFixed(0)}k`,
    priority: 'high',
    reasoning: 'Estimated savings from optimization recommendations'
  });

  const sortedAssets = [...assets].sort((a, b) => {
    const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return priorityOrder[a.recommendation.priority] - priorityOrder[b.recommendation.priority];
  });

  for (const asset of sortedAssets) {
    components.push({
      type: 'recommendation_card',
      title: `${asset.recommendation.action}: ${asset.telemetry_asset}`,
      priority: asset.recommendation.priority,
      reasoning: `Value: ${asset.value_score} | Waste: ${asset.waste_score} | Risk: ${asset.risk_score}`,
      evidence: asset.evidence,
      asset
    });
  }

  return {
    schema_version: 'v1',
    components
  };
}