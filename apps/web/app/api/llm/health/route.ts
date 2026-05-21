import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { startLlmHealthDaemon } from '@/lib/llm-health-daemon';

export const GET = createRoute(async (_request: NextRequest) => {
  startLlmHealthDaemon();

  const result = await query<any>(
    `SELECT
       h.health_id AS "healthId",
       h.provider,
       h.available,
       h.response_time_ms AS "responseTimeMs",
       h.checked_duration_ms AS "checkedDurationMs",
       h.running_model AS "runningModel",
       h.inference_capacity AS "inferenceCapacity",
       h.error_reason AS "errorReason",
       h.models_available AS "models",
       h.fallback_enabled AS "fallbackEnabled",
       h.daemon_version AS "daemonVersion",
       EXTRACT(EPOCH FROM (NOW() - c.updated_at))::int AS "ageSeconds",
       c.total_polls AS "totalPolls",
       c.successful_polls AS "successfulPolls",
       c.failed_polls AS "failedPolls",
       c.last_successful_poll_at AS "lastSuccessfulPollAt"
     FROM llm_health_cache c
     JOIN llm_health_history h ON c.last_health_id = h.health_id
     WHERE c.provider = 'ollama'
     LIMIT 1`
  );

  if (result.rows.length === 0) {
    return {
      data: {
        provider: 'ollama',
        available: false,
        stale: true,
        confidence: 'low',
        endpoint: process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      },
      meta: { source: 'postgres' },
    };
  }

  const data = result.rows[0];
  const isStale = Number(data.ageSeconds || 0) > 90;
  let confidence: 'low' | 'medium' | 'high' = 'low';
  if (!isStale && Number(data.ageSeconds || 0) < 30) {
    if (data.inferenceCapacity === 'healthy') confidence = 'high';
    else if (data.inferenceCapacity === 'degraded') confidence = 'medium';
  } else if (!isStale && Number(data.ageSeconds || 0) < 90 && data.inferenceCapacity === 'healthy') {
    confidence = 'medium';
  }

  return {
    data: {
      ...data,
      endpoint: process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      stale: isStale,
      confidence,
    },
    meta: { source: 'postgres' },
  };
});

