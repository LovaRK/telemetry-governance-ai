import { z } from 'zod';

export const RecommendationSchema = z.object({
  action: z.enum(['KEEP', 'OPTIMIZE', 'ARCHIVE', 'ELIMINATE', 'INVESTIGATE']),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  approval_required: z.boolean()
});

export const ScoringBreakdownSchema = z.object({
  waste_score: z.number(),
  derived_from: z.object({
    ingest_volume: z.number(),
    low_search_usage: z.number(),
    duplicate_patterns: z.number()
  })
});

export const TelemetryAssetSchema = z.object({
  telemetry_asset: z.string(),
  value_score: z.number().min(0).max(100),
  waste_score: z.number().min(0).max(100),
  risk_score: z.number().min(0).max(100),
  recommendation: RecommendationSchema,
  confidence: z.number().min(0).max(1),
  estimated_annual_cost: z.number().optional(),
  estimated_savings: z.number().optional(),
  criticality: z.string().optional(),
  evidence: z.array(z.string()),
  scoring_breakdown: ScoringBreakdownSchema.optional(),
  decision_trace_id: z.string().optional(),
  reasoning_mode: z.string().optional()
});

export type TelemetryAsset = z.infer<typeof TelemetryAssetSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;