import { z } from 'zod';

export const TimelineEventSchema = z.object({
  timestamp: z.string(),
  agent: z.string(),
  status: z.string(),
  duration_ms: z.number()
});

export const PipelineResultSchema = z.object({
  timeline: z.array(TimelineEventSchema),
  connection: z.any().optional(),
  discovery: z.any().optional(),
  context: z.any().optional(),
  reasoning: z.any().optional(),
  value: z.any().optional(),
  prioritization: z.any().optional(),
  composition: z.any().optional(),
  error: z.string().optional()
});

export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type PipelineResult = z.infer<typeof PipelineResultSchema>;