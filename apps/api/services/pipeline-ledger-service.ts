import { getClient, query, transaction } from '@core/database/connection';
import type { RequestContext } from '@packages/auth/request-context';
import crypto from 'crypto';

export type PipelineRunStatus = 'PENDING' | 'RUNNING' | 'FAILED' | 'SUCCEEDED';

export interface PipelineRunRecord {
  runId: string;
  snapshotId: string;
  tenantId: string;
  status: PipelineRunStatus;
  published: boolean;
  startedAt: string;
  publishedAt: string | null;
  supersededByRunId: string | null;
  pipelineVersion: string;
  modelVersion: string;
  promptVersion: string;
  splunkQueryVersion: string;
  errorMessage: string | null;
}

export interface StageEventInput {
  runId: string;
  stage: 'SPLUNK_FETCH' | 'SNAPSHOT_WRITE' | 'KPI_AGGREGATION' | 'AI_DECISIONS' | 'GOVERNANCE_SYNC' | 'PUBLISH';
  status: 'IN_PROGRESS' | 'SUCCESS' | 'FAILED';
  errorType?: 'NETWORK' | 'MODEL_MISSING' | 'TIMEOUT' | 'AUTH' | 'PROMPT' | 'UNKNOWN' | null;
  errorCode?: string | null;
  attempt?: number;
  recordsProcessed?: number;
  metadata?: Record<string, unknown>;
  errorMessage?: string | null;
}

export async function ensurePipelineLedgerSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      run_id UUID PRIMARY KEY,
      snapshot_id UUID NOT NULL UNIQUE,
      tenant_id VARCHAR(64) NOT NULL,
      status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING','RUNNING','FAILED','SUCCEEDED')),
      published BOOLEAN NOT NULL DEFAULT FALSE,
      idempotency_hash VARCHAR(64) UNIQUE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      published_at TIMESTAMPTZ,
      superseded_by_run_id UUID REFERENCES pipeline_runs(run_id),
      pipeline_version VARCHAR(32) NOT NULL,
      model_version VARCHAR(64) NOT NULL,
      prompt_version VARCHAR(32) NOT NULL,
      splunk_query_version VARCHAR(32) NOT NULL,
      error_message TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS pipeline_stage_events (
      event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES pipeline_runs(run_id) ON DELETE CASCADE,
      stage VARCHAR(32) NOT NULL CHECK (stage IN ('SPLUNK_FETCH','SNAPSHOT_WRITE','KPI_AGGREGATION','AI_DECISIONS','GOVERNANCE_SYNC','PUBLISH')),
      attempt INT NOT NULL DEFAULT 1,
      status VARCHAR(20) NOT NULL CHECK (status IN ('IN_PROGRESS','SUCCESS','FAILED')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      records_processed INT NOT NULL DEFAULT 0,
      metadata_json JSONB,
      error_message TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS tenant_snapshot_pointer (
      tenant_id VARCHAR(64) PRIMARY KEY,
      active_run_id UUID NOT NULL REFERENCES pipeline_runs(run_id),
      active_snapshot_id UUID NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_pipeline_runs_tenant_started ON pipeline_runs(tenant_id, started_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pipeline_runs_tenant_published ON pipeline_runs(tenant_id, published, published_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pipeline_stage_events_run_stage ON pipeline_stage_events(run_id, stage, started_at DESC)`);

  await query(`ALTER TABLE telemetry_snapshots ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL`);
  await query(`ALTER TABLE executive_kpis ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL`);
  await query(`ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL`);

  await query(`ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS run_id UUID`);
  await query(`ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS trace_id VARCHAR(128)`);
  await query(`ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS model_version VARCHAR(64)`);
  await query(`ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(32)`);
  await query(`ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS decision_trace_id UUID`);
  await query(`ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS model_provider VARCHAR(50) NOT NULL DEFAULT 'ollama'`);
  await query(`ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS model_name VARCHAR(100)`);
  await query(`ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN NOT NULL DEFAULT FALSE`);
  await query(`ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS fallback_reason VARCHAR(50)`);
  await query(`ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS latency_ms INT NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS tokens_processed INT DEFAULT 0`);
  await query(`ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS system_prompt_hash VARCHAR(64)`);
  await query(`ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS error_code VARCHAR(100)`);

  await query(`UPDATE agent_decisions SET decision_trace_id = gen_random_uuid() WHERE decision_trace_id IS NULL`);
  await query(`ALTER TABLE agent_decisions ALTER COLUMN decision_trace_id SET DEFAULT gen_random_uuid()`);

  await query(`ALTER TABLE pipeline_stage_events ADD COLUMN IF NOT EXISTS error_type VARCHAR(50)`);
  await query(`ALTER TABLE pipeline_stage_events ADD COLUMN IF NOT EXISTS error_code VARCHAR(100)`);
  await query(`ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS llm_provider VARCHAR(50)`);
  await query(`ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS llm_model VARCHAR(100)`);
  await query(`ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS total_llm_tokens INT NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS total_llm_latency_ms INT NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS fallback_triggered BOOLEAN NOT NULL DEFAULT FALSE`);
  await query(`ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS fallback_reason VARCHAR(50)`);

  await query(`ALTER TABLE telemetry_snapshots DROP CONSTRAINT IF EXISTS uq_snapshot_identity`);
  await query(`ALTER TABLE executive_kpis DROP CONSTRAINT IF EXISTS executive_kpis_snapshot_date_key`);
  await query(`ALTER TABLE executive_kpis DROP CONSTRAINT IF EXISTS uq_executive_kpis_snapshot`);

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_snapshots_tenant_snapshot_identity'
      ) THEN
        ALTER TABLE telemetry_snapshots
        ADD CONSTRAINT uq_snapshots_tenant_snapshot_identity
        UNIQUE (tenant_id, snapshot_id, granularity, index_name, sourcetype);
      END IF;
    END $$;
  `);

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_exec_kpis_tenant_snapshot'
      ) THEN
        ALTER TABLE executive_kpis
        ADD CONSTRAINT uq_exec_kpis_tenant_snapshot
        UNIQUE (tenant_id, snapshot_id);
      END IF;
    END $$;
  `);

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_decisions_tenant_snapshot_key'
      ) THEN
        ALTER TABLE agent_decisions
        ADD CONSTRAINT uq_decisions_tenant_snapshot_key
        UNIQUE (tenant_id, snapshot_id, index_name, sourcetype);
      END IF;
    END $$;
  `);

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_stage_events_error_type_check'
      ) THEN
        ALTER TABLE pipeline_stage_events
          ADD CONSTRAINT pipeline_stage_events_error_type_check
          CHECK (error_type IS NULL OR error_type IN ('NETWORK','MODEL_MISSING','TIMEOUT','AUTH','PROMPT','UNKNOWN'));
      END IF;
    END $$;
  `);

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'agent_decisions_fallback_reason_check'
      ) THEN
        ALTER TABLE agent_decisions
          ADD CONSTRAINT agent_decisions_fallback_reason_check
          CHECK (fallback_reason IS NULL OR fallback_reason IN ('MODEL_UNAVAILABLE','TIMEOUT','RATE_LIMIT','INFRASTRUCTURE_DOWN'));
      END IF;
    END $$;
  `);

  await query(`CREATE TABLE IF NOT EXISTS llm_health_cache (
    provider VARCHAR(50) PRIMARY KEY,
    available BOOLEAN NOT NULL DEFAULT FALSE,
    response_time_ms INT NOT NULL DEFAULT 0,
    queue_depth INT NOT NULL DEFAULT 0,
    running_model VARCHAR(100),
    inference_capacity VARCHAR(32) NOT NULL DEFAULT 'healthy',
    models_available TEXT[] NOT NULL DEFAULT '{}',
    fallback_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_decision_trace ON agent_decisions(decision_trace_id)`);
}

export function buildIdempotencyHash(input: { tenantId: string; trigger: string; window: string }): string {
  return crypto.createHash('sha256').update(`${input.tenantId}:${input.window}:${input.trigger}`).digest('hex');
}

async function recoverStalePipelineRuns(maxAgeMinutes: number = 5): Promise<number> {
  const result = await query<{ count: string }>(`
    WITH stale AS (
      UPDATE pipeline_runs
      SET status = 'FAILED',
          published = false,
          error_message = COALESCE(error_message, 'Recovered stale pipeline run after refresh restart'),
          idempotency_hash = NULL
      WHERE status IN ('PENDING','RUNNING')
        AND started_at < NOW() - ($1::text || ' minutes')::interval
      RETURNING 1
    )
    SELECT COUNT(*)::text AS count FROM stale
  `, [String(maxAgeMinutes)]);
  return Number(result.rows[0]?.count || '0');
}

export async function getActiveRunByHash(hash: string): Promise<PipelineRunRecord | null> {
  await recoverStalePipelineRuns(5);
  const result = await query<any>(
    `SELECT run_id as "runId", snapshot_id as "snapshotId", tenant_id as "tenantId", status, published,
            started_at as "startedAt", published_at as "publishedAt", superseded_by_run_id as "supersededByRunId",
            pipeline_version as "pipelineVersion", model_version as "modelVersion", prompt_version as "promptVersion",
            splunk_query_version as "splunkQueryVersion", error_message as "errorMessage"
     FROM pipeline_runs
     WHERE idempotency_hash = $1 AND status IN ('PENDING','RUNNING')
     ORDER BY started_at DESC
     LIMIT 1`,
    [hash]
  );
  return result.rows[0] || null;
}

export async function createRunningRun(
  params: {
    runId: string;
    snapshotId: string;
    tenantId: string;
    idempotencyHash: string;
    pipelineVersion: string;
    modelVersion: string;
    promptVersion: string;
    splunkQueryVersion: string;
  },
  context?: RequestContext
): Promise<void> {
  // CRITICAL: Reject 'default' tenant - this must come from RequestContext
  if (params.tenantId === 'default' || !isValidUUID(params.tenantId)) {
    throw new Error(`Invalid tenantId "${params.tenantId}" - must be a valid UUID, not 'default'`);
  }

  await query(
    `INSERT INTO pipeline_runs (
      run_id, snapshot_id, tenant_id, status, published, idempotency_hash,
      pipeline_version, model_version, prompt_version, splunk_query_version
     ) VALUES ($1,$2,$3,'RUNNING',false,$4,$5,$6,$7,$8)`,
    [params.runId, params.snapshotId, params.tenantId, params.idempotencyHash, params.pipelineVersion, params.modelVersion, params.promptVersion, params.splunkQueryVersion],
    context
  );
}

export async function appendStageEvent(input: StageEventInput): Promise<void> {
  await query(
    `INSERT INTO pipeline_stage_events (
     run_id, stage, attempt, status, completed_at, records_processed, metadata_json, error_message
      , error_type, error_code
     ) VALUES (
       $1,
       $2::varchar,
       $3,
       $4::varchar,
       CASE WHEN $4::varchar IN ('SUCCESS','FAILED') THEN NOW() ELSE NULL END,
       $5,
       $6::jsonb,
       $7,
       $8,
       $9
     )`,
    [
      input.runId,
      input.stage,
      input.attempt || 1,
      input.status,
      input.recordsProcessed || 0,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.errorMessage || null,
      input.errorType || null,
      input.errorCode || null,
    ]
  );
}

export async function markRunFailed(runId: string, errorMessage: string): Promise<void> {
  await query(`UPDATE pipeline_runs SET status = 'FAILED', published = false, error_message = $2, idempotency_hash = NULL WHERE run_id = $1`, [runId, errorMessage]);
}

export async function publishRunAtomic(params: { runId: string; snapshotId: string; tenantId: string }): Promise<void> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const pointerRes = await client.query<any>(`SELECT active_run_id FROM tenant_snapshot_pointer WHERE tenant_id = $1 FOR UPDATE`, [params.tenantId]);
    if (pointerRes.rows.length > 0) {
      const previousRunId = pointerRes.rows[0].active_run_id;
      await client.query(`UPDATE pipeline_runs SET superseded_by_run_id = $1 WHERE run_id = $2`, [params.runId, previousRunId]);
    }
    await client.query(`UPDATE pipeline_runs SET status = 'SUCCEEDED', published = true, published_at = NOW(), idempotency_hash = NULL WHERE run_id = $1`, [params.runId]);
    await client.query(
      `INSERT INTO tenant_snapshot_pointer (tenant_id, active_run_id, active_snapshot_id, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (tenant_id) DO UPDATE
       SET active_run_id = EXCLUDED.active_run_id,
           active_snapshot_id = EXCLUDED.active_snapshot_id,
           updated_at = EXCLUDED.updated_at`,
      [params.tenantId, params.runId, params.snapshotId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getLatestPublishedRun(tenantId: string): Promise<PipelineRunRecord | null> {
  const pointer = await query<any>(`SELECT p.active_run_id FROM tenant_snapshot_pointer p WHERE p.tenant_id = $1`, [tenantId]);
  if (pointer.rows.length === 0) return null;
  const run = await query<any>(
    `SELECT run_id as "runId", snapshot_id as "snapshotId", tenant_id as "tenantId", status, published,
            started_at as "startedAt", published_at as "publishedAt", superseded_by_run_id as "supersededByRunId",
            pipeline_version as "pipelineVersion", model_version as "modelVersion", prompt_version as "promptVersion",
            splunk_query_version as "splunkQueryVersion", error_message as "errorMessage"
     FROM pipeline_runs WHERE run_id = $1`,
    [pointer.rows[0].active_run_id]
  );
  return run.rows[0] || null;
}

export async function getRunById(runId: string): Promise<PipelineRunRecord | null> {
  const run = await query<any>(
    `SELECT run_id as "runId", snapshot_id as "snapshotId", tenant_id as "tenantId", status, published,
            started_at as "startedAt", published_at as "publishedAt", superseded_by_run_id as "supersededByRunId",
            pipeline_version as "pipelineVersion", model_version as "modelVersion", prompt_version as "promptVersion",
            splunk_query_version as "splunkQueryVersion", error_message as "errorMessage"
     FROM pipeline_runs WHERE run_id = $1`,
    [runId]
  );
  return run.rows[0] || null;
}

export async function getRunMetrics(runId: string, snapshotId: string, tenantId: string): Promise<{ splunkBytes: number; dailyAvgGb: number; decisionCount: number }> {
  const snaps = await query<any>(
    `SELECT COALESCE(SUM(total_events),0) as total_events, COALESCE(SUM(daily_avg_gb),0) as total_gb
     FROM telemetry_snapshots
     WHERE tenant_id = $1 AND snapshot_id = $2`,
    [tenantId, snapshotId]
  );

  const decisions = await query<any>(`SELECT COUNT(*) as count FROM agent_decisions WHERE tenant_id = $1 AND snapshot_id = $2`, [tenantId, snapshotId]);

  return {
    splunkBytes: Number(snaps.rows[0]?.total_events || 0),
    dailyAvgGb: Number(snaps.rows[0]?.total_gb || 0),
    decisionCount: Number(decisions.rows[0]?.count || 0),
  };
}

function isValidUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}
