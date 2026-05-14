import { z } from 'zod';
import { TelemetryAssetSchema, type TelemetryAsset } from './telemetry-asset';
import { InsightSchema, type Insight } from './insight';
import { ConnectionOutputSchema, type ConnectionOutput } from './connection';
import { PipelineResultSchema, type PipelineResult } from './timeline';

export function validateTelemetryAsset(data: unknown): TelemetryAsset {
  return TelemetryAssetSchema.parse(data);
}

export function validateInsight(data: unknown): Insight {
  return InsightSchema.parse(data);
}

export function validateConnectionOutput(data: unknown): ConnectionOutput {
  return ConnectionOutputSchema.parse(data);
}

export function validatePipelineResult(data: unknown): PipelineResult {
  return PipelineResultSchema.parse(data);
}

export function safeValidate<T>(schema: z.ZodType<T>, data: unknown): { success: true; data: T } | { success: false; error: z.ZodError } {
  try {
    return { success: true, data: schema.parse(data) };
  } catch (error) {
    return { success: false, error: error as z.ZodError };
  }
}

export { TelemetryAssetSchema, InsightSchema, ConnectionOutputSchema, PipelineResultSchema };
export type { TelemetryAsset, Insight, ConnectionOutput, PipelineResult };