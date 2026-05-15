import { UISpecInput, UISpecOutput, UIComponent } from './types';

export async function runUISpecAgent(input: UISpecInput): Promise<UISpecOutput> {
  const { prioritization } = input;
  const components: UIComponent[] = [];

  const totalInsights = prioritization.prioritized.high.length + prioritization.prioritized.medium.length + prioritization.prioritized.low.length;

  components.push({
    type: 'metric_card',
    title: 'Total Insights',
    value: totalInsights.toString(),
    priority: 'medium',
    reasoning: `Generated ${totalInsights} insights from telemetry analysis`
  });

  components.push({
    type: 'metric_card',
    title: 'High Priority',
    value: prioritization.prioritized.high.length.toString(),
    priority: 'high',
    reasoning: 'Insights requiring immediate attention'
  });

  prioritization.prioritized.high.forEach((insight: any, index: number) => {
    components.push({
      type: 'insight_card',
      title: `Insight ${index + 1}`,
      priority: 'high',
      reasoning: insight.insight,
      evidence: insight.evidence,
      source_queries: insight.source_queries,
      supporting_metrics: insight.supporting_metrics,
      trigger_conditions: insight.trigger_conditions
    });
  });

  prioritization.prioritized.medium.forEach((insight: any, index: number) => {
    components.push({
      type: 'recommendation_card',
      title: `Recommendation ${index + 1}`,
      priority: 'medium',
      reasoning: insight.insight,
      evidence: insight.evidence
    });
  });

  if (prioritization.prioritized.high.length > 0) {
    components.push({
      type: 'line_chart',
      title: 'Priority Trend',
      data_source: 'insights',
      reasoning: 'Trend of high-priority insights over time'
    });
  }

  return {
    schema_version: 'v1',
    components
  };
}