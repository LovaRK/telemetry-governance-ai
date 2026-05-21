import { query } from '@core/database/connection';

type InferenceCapacity = 'healthy' | 'degraded' | 'down' | 'warming' | 'throttled' | 'maintenance';

const DAEMON_VERSION = '2.1.0';
const POLL_INTERVAL_MS = 30_000;
const MAX_JITTER_MS = 5_000;
const REQUEST_TIMEOUT_MS = 5_000;

let started = false;
let stopped = false;
let pollInFlight = false;
let timer: NodeJS.Timeout | null = null;

function endpoint(): string {
  return process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
}

function fallbackEnabled(): boolean {
  return process.env.ENABLE_ANTHROPIC_FALLBACK === 'true' && Boolean(process.env.ANTHROPIC_API_KEY);
}

function configuredLocalModel(): string {
  // Project truth source for local model name.
  return process.env.LLM_MODEL || 'gemma2:9b';
}

function classifyError(err: unknown): string {
  const e = err as any;
  if (e?.name === 'TimeoutError' || e?.code === 'ETIMEDOUT') return 'TIMEOUT';
  if (e?.cause?.code === 'ECONNREFUSED' || String(e?.message || '').toLowerCase().includes('fetch failed')) return 'ECONNREFUSED';
  if (String(e?.message || '').toLowerCase().includes('out of memory')) return 'OOM';
  return 'UNKNOWN';
}

async function ensureSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS llm_health_history (
      health_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider VARCHAR(50) NOT NULL,
      available BOOLEAN NOT NULL,
      response_time_ms INT NOT NULL,
      checked_duration_ms INT NOT NULL,
      queue_depth INT,
      running_model VARCHAR(100),
      inference_capacity VARCHAR(32) NOT NULL CHECK (inference_capacity IN ('healthy', 'degraded', 'down', 'warming', 'throttled', 'maintenance')),
      error_reason VARCHAR(100),
      models_available TEXT[] NOT NULL DEFAULT '{}',
      fallback_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      daemon_version VARCHAR(32) NOT NULL,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_health_checked ON llm_health_history(checked_at DESC)`);
  await query(`
    CREATE TABLE IF NOT EXISTS llm_health_cache (
      provider VARCHAR(50) PRIMARY KEY,
      last_health_id UUID,
      last_successful_poll_at TIMESTAMPTZ,
      total_polls BIGINT NOT NULL DEFAULT 0,
      successful_polls BIGINT NOT NULL DEFAULT 0,
      failed_polls BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'llm_health_cache_last_health_id_fkey'
      ) THEN
        ALTER TABLE llm_health_cache
          ADD CONSTRAINT llm_health_cache_last_health_id_fkey
          FOREIGN KEY (last_health_id) REFERENCES llm_health_history(health_id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);
}

async function pollOnce(): Promise<void> {
  if (pollInFlight || stopped) return;
  pollInFlight = true;
  const loopStart = Date.now();

  let available = false;
  let models: string[] = [];
  let runningModel: string | null = configuredLocalModel();
  let inferenceCapacity: InferenceCapacity = 'down';
  let errorReason: string | null = null;
  let responseTimeMs = 0;

  try {
    const res = await fetch(`${endpoint()}/api/tags`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    responseTimeMs = Date.now() - loopStart;

    if (res.ok) {
      const data = await res.json();
      available = true;
      models = (data?.models || []).map((m: any) => m?.name).filter(Boolean);
      if (!runningModel && models.length > 0) runningModel = models[0];
      inferenceCapacity = responseTimeMs > 3000 ? 'degraded' : 'healthy';
    } else {
      errorReason = res.status === 401 || res.status === 403 ? 'AUTH_FAILURE' : `STATUS_${res.status}`;
      inferenceCapacity = 'down';
    }
  } catch (err) {
    responseTimeMs = Date.now() - loopStart;
    errorReason = classifyError(err);
    inferenceCapacity = 'down';
  }

  const checkedDurationMs = Date.now() - loopStart;

  try {
    await ensureSchema();

    const history = await query<{ health_id: string }>(
      `INSERT INTO llm_health_history (
         provider, available, response_time_ms, checked_duration_ms, queue_depth,
         running_model, inference_capacity, error_reason, models_available, fallback_enabled,
         daemon_version, checked_at
       ) VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,NOW())
       RETURNING health_id`,
      [
        'ollama',
        available,
        responseTimeMs,
        checkedDurationMs,
        runningModel,
        inferenceCapacity,
        errorReason,
        models,
        fallbackEnabled(),
        DAEMON_VERSION,
      ]
    );

    const healthId = history.rows[0]?.health_id;
    await query(
      `INSERT INTO llm_health_cache (
         provider, last_health_id, last_successful_poll_at, total_polls, successful_polls, failed_polls, updated_at
       ) VALUES ($1,$2,$3,1,$4,$5,NOW())
       ON CONFLICT (provider) DO UPDATE SET
         last_health_id = EXCLUDED.last_health_id,
         last_successful_poll_at = COALESCE(EXCLUDED.last_successful_poll_at, llm_health_cache.last_successful_poll_at),
         total_polls = llm_health_cache.total_polls + 1,
         successful_polls = llm_health_cache.successful_polls + EXCLUDED.successful_polls,
         failed_polls = llm_health_cache.failed_polls + EXCLUDED.failed_polls,
         updated_at = NOW()`,
      [
        'ollama',
        healthId,
        available ? new Date().toISOString() : null,
        available ? 1 : 0,
        available ? 0 : 1,
      ]
    );
  } catch (e) {
    console.error('[LLMHealthDaemon] failed to persist health state:', e);
  } finally {
    pollInFlight = false;
  }
}

function scheduleNext(): void {
  if (stopped) return;
  const jitter = Math.floor(Math.random() * MAX_JITTER_MS);
  timer = setTimeout(async () => {
    await pollOnce();
    scheduleNext();
  }, POLL_INTERVAL_MS + jitter);
}

export function startLlmHealthDaemon(): void {
  if (started) return;
  started = true;
  stopped = false;

  void pollOnce();
  scheduleNext();

  const shutdown = () => stopLlmHealthDaemon();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  process.once('beforeExit', shutdown);
}

export function stopLlmHealthDaemon(): void {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

export function llmHealthDaemonState() {
  return {
    started,
    stopped,
    pollInFlight,
    version: DAEMON_VERSION,
    endpoint: endpoint(),
  };
}
