import { ContextInput, ContextOutput } from './types';

export async function runContextAgent(input: ContextInput): Promise<ContextOutput> {
  const { discovery } = input;

  const categories = {
    health: [] as string[],
    errors: [] as string[],
    latency: [] as string[],
    security: [] as string[],
    waste: [] as string[],
    anomalies: [] as string[]
  };

  discovery.high_volume_sources.forEach(source => {
    if (source.includes('cpu') || source.includes('memory') || source.includes('disk')) {
      categories.health.push(source);
    } else if (source.includes('error') || source.includes('exception')) {
      categories.errors.push(source);
    } else if (source.includes('latency') || source.includes('duration')) {
      categories.latency.push(source);
    } else if (source.includes('security') || source.includes('auth')) {
      categories.security.push(source);
    } else if (source.includes('debug') || source.includes('trace')) {
      categories.waste.push(source);
    } else {
      categories.health.push(source);
    }
  });

  discovery.error_sources.forEach(source => {
    if (!categories.errors.includes(source)) {
      categories.errors.push(source);
    }
  });

  if (discovery.telemetry_summary.daily_gb_estimate > 100) {
    categories.waste.push('high_volume_unused');
  }

  categories.anomalies.push('pattern_detection_enabled');

  return {
    categories,
    schema_version: 'v1'
  };
}