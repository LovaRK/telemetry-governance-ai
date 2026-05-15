import { PrioritizationOutput } from '../prioritization/types';

export interface UIComponent {
  type: 'metric_card' | 'line_chart' | 'bar_chart' | 'table' | 'insight_card' | 'recommendation_card' | 'timeline_event' | 'status_banner';
  title: string;
  value?: string;
  data_source?: string;
  priority?: string;
  reasoning?: string;
  evidence?: string[];
  source_queries?: string[];
  supporting_metrics?: string[];
  trigger_conditions?: string[];
  raw_query?: string;
}

export interface UISpecInput {
  prioritization: PrioritizationOutput;
}

export interface UISpecOutput {
  schema_version: string;
  components: UIComponent[];
}