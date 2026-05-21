import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { startLlmHealthDaemon } from '@/lib/llm-health-daemon';

export const GET = createRoute(async (_request: NextRequest) => {
  startLlmHealthDaemon();

  const infraStats = await query<any>(
    `SELECT
       COALESCE(AVG(response_time_ms) FILTER (WHERE available = true)::int, 0) AS "avgLatency",
       COALESCE(
         ROUND((COUNT(*) FILTER (WHERE available = true)::numeric / NULLIF(COUNT(*), 0)::numeric) * 100, 2)::float,
         0.0
       ) AS "uptimePercent"
     FROM llm_health_history
     WHERE checked_at > NOW() - INTERVAL '24 hours'`
  );

  const inferenceStats = await query<any>(
    `SELECT
       COALESCE(
         ROUND((COUNT(*) FILTER (WHERE fallback_used = true)::numeric / NULLIF(COUNT(*), 0)::numeric) * 100, 2)::float,
         0.0
       ) AS "fallbackRate",
       COALESCE(SUM(tokens_processed)::int, 0) AS "tokens24h",
       COUNT(*) FILTER (WHERE error_code IS NOT NULL)::int AS "failures24h"
     FROM agent_decisions
     WHERE created_at > NOW() - INTERVAL '24 hours'`
  );

  return {
    data: {
      infra: infraStats.rows[0] || { avgLatency: 0, uptimePercent: 0.0 },
      inference: inferenceStats.rows[0] || { fallbackRate: 0.0, tokens24h: 0, failures24h: 0 },
    },
    meta: { source: 'postgres' },
  };
});

