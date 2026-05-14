import { z } from 'zod';

export const ConnectionStateSchema = z.enum(['CONNECTED', 'DEGRADED', 'AUTH_FAILED', 'NO_INDEX_ACCESS', 'NO_DATA', 'PARTIAL_DATA']);

export const ConnectionOutputSchema = z.object({
  status: ConnectionStateSchema,
  indexes: z.array(z.string()),
  sources: z.number(),
  latency_ms: z.number(),
  capabilities: z.object({
    search: z.boolean(),
    stats: z.boolean()
  }),
  error: z.string().optional(),
  schema_version: z.string()
});

export type ConnectionOutput = z.infer<typeof ConnectionOutputSchema>;