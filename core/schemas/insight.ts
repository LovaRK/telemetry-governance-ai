import { z } from 'zod';

export const ConfidenceSchema = z.object({
  score: z.number().min(0).max(1),
  factors: z.array(z.string())
});

export const InsightSchema = z.object({
  insight: z.string(),
  confidence: ConfidenceSchema,
  evidence: z.array(z.string()),
  source_queries: z.array(z.string()),
  supporting_metrics: z.array(z.string()),
  trigger_conditions: z.array(z.string()).optional(),
  correlation: z.string().optional()
});

export type Insight = z.infer<typeof InsightSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;