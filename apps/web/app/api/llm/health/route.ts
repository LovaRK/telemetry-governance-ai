import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { startLlmHealthDaemon } from '@/lib/llm-health-daemon';

export const GET = createRoute(async (_request: NextRequest) => {
  startLlmHealthDaemon();

  const [cacheResult, historyResult] = await Promise.all([
    query<any>(
      `SELECT
         available,
         response_time_ms AS "responseTimeMs",
         inference_capacity AS "inferenceCapacity",
         models_available AS "models",
         fallback_enabled AS "fallbackEnabled",
         running_model AS "runningModel",
         EXTRACT(EPOCH FROM (NOW() - last_checked))::int AS "ageSeconds"
       FROM llm_health_cache
       WHERE provider = 'ollama'
       LIMIT 1`
    ),
    query<any>(
      `SELECT
         health_id AS "healthId",
         provider,
         available,
         response_time_ms AS "responseTimeMs",
         checked_duration_ms AS "checkedDurationMs",
         running_model AS "runningModel",
         inference_capacity AS "inferenceCapacity",
         error_reason AS "errorReason",
         models_available AS "models",
         fallback_enabled AS "fallbackEnabled",
         daemon_version AS "daemonVersion",
         checked_at AS "checkedAt"
       FROM llm_health_history
       WHERE provider = 'ollama'
       ORDER BY checked_at DESC
       LIMIT 1`
    ),
  ]);

  const cacheRow = cacheResult.rows[0] || null;
  const historyRow = historyResult.rows[0] || null;

  if (!cacheRow && !historyRow) {
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

  const ageSeconds = Number(cacheRow?.ageSeconds || 0);
  const isStale = ageSeconds > 90;
  let confidence: 'low' | 'medium' | 'high' = 'low';
  if (!isStale && ageSeconds < 30) {
    if (cacheRow?.inferenceCapacity === 'healthy') confidence = 'high';
    else if (cacheRow?.inferenceCapacity === 'degraded') confidence = 'medium';
  } else if (!isStale && ageSeconds < 90 && cacheRow?.inferenceCapacity === 'healthy') {
    confidence = 'medium';
  }

  return {
    data: {
      healthId: historyRow?.healthId || null,
      provider: 'ollama',
      available: cacheRow?.available ?? false,
      responseTimeMs: cacheRow?.responseTimeMs || 0,
      checkedDurationMs: historyRow?.checkedDurationMs || null,
      runningModel: historyRow?.runningModel || cacheRow?.runningModel || null,
      inferenceCapacity: cacheRow?.inferenceCapacity || 'unknown',
      errorReason: historyRow?.errorReason || null,
      models: cacheRow?.models || [],
      fallbackEnabled: cacheRow?.fallbackEnabled ?? false,
      daemonVersion: historyRow?.daemonVersion || null,
      ageSeconds,
      stale: isStale,
      confidence,
      lastCheckedAt: historyRow?.checkedAt || null,
      endpoint: process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    },
    meta: { source: 'postgres' },
  };
});

