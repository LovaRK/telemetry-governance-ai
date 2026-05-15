import { TelemetryAsset } from '../../core/schemas/telemetry-asset';

export interface CompositionInput {
  value: {
    telemetry_assets: TelemetryAsset[];
    data_freshness_seconds: number;
  };
  prioritization: {
    prioritized: {
      high: TelemetryAsset[];
      medium: TelemetryAsset[];
      low: TelemetryAsset[];
    };
    severity_scores: Record<string, number>;
  };
}

export interface UIComponent {
  type: 'metric_card' | 'line_chart' | 'bar_chart' | 'recommendation_card' | 'timeline_event' | 'status_banner';
  title: string;
  priority?: string;
  value?: string;
  data_source?: string;
  reasoning?: string;
  evidence?: string[];
  asset?: TelemetryAsset;
}

export interface CompositionOutput {
  schema_version: string;
  components: UIComponent[];
}