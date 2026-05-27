import { query, transaction } from '@core/database/connection';
import type { RequestContext } from '@packages/auth/request-context';

export interface JobProgress {
  batch: number;
  totalBatches: number;
  decisionsWritten: number;
  message?: string;
}

/**
 * CRITICAL: All job payloads MUST include immutable tenant metadata.
 * This prevents workers from inferring tenant context and accidentally defaulting to 'default'.
 * Tenant context is a requirement, not optional.
 */
export interface JobPayload {
  tenantId: string;
  userId: string;
  traceId: string;
  requestId?: string | null;
  modelName?: string | null;
  snapshotId: string;
  runId: string;
  [key: string]: unknown;
}

export interface JobRecord {
  id: number;
  jobId: string;
  jobType: string;
  status: 'pending' | 'running' | 'partial' | 'complete' | 'failed';
  snapshotId: string | null;
  snapshotDate: string;
  payload: Record<string, unknown>;
  progress: JobProgress;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  heartbeatAt?: string | null;
  leaseExpiresAt?: string | null;
  workerId?: string | null;
  requestId?: string | null;
  modelName?: string | null;
  latencyMs?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  batchCount?: number | null;
}

export async function enqueueJob(opts: {
  jobType?: string;
  snapshotId?: string;
  payload: JobPayload;
}): Promise<string> {
  // CRITICAL: Validate immutable tenant context is present
  // Workers MUST NOT infer tenant or default to 'default'
  if (!opts.payload.tenantId || !opts.payload.userId || !opts.payload.traceId) {
    throw new Error(
      `Invalid job payload: missing required tenant context. ` +
      `Must include tenantId, userId, traceId. Received: ${JSON.stringify(opts.payload)}`
    );
  }

  // Validate tenantId is a UUID, not 'default'
  if (opts.payload.tenantId === 'default' || !isValidUUID(opts.payload.tenantId)) {
    throw new Error(
      `Invalid tenantId "${opts.payload.tenantId}" - must be a valid UUID, not 'default'`
    );
  }

  const result = await query<{ job_id: string }>(`
    INSERT INTO job_queue (job_type, snapshot_id, payload, status, progress, snapshot_date, request_id, model_name)
    VALUES ($1, $2, $3, 'pending', '{"batch":0,"totalBatches":0,"decisionsWritten":0}', CURRENT_DATE, $4, $5)
    RETURNING job_id
  `, [
    opts.jobType || 'llm_analysis',
    opts.snapshotId || null,
    JSON.stringify(opts.payload),
    opts.payload.requestId || null,
    opts.payload.modelName || null,
  ]);
  return result.rows[0].job_id;
}

export async function getJobStatus(jobId: string): Promise<JobRecord | null> {
  const result = await query<any>(`
    SELECT id, job_id as "jobId", job_type as "jobType", status,
           snapshot_id as "snapshotId", snapshot_date as "snapshotDate",
           payload, progress, error_message as "errorMessage",
           created_at as "createdAt", started_at as "startedAt",
           completed_at as "completedAt", request_id as "requestId",
           model_name as "modelName", latency_ms as "latencyMs",
           tokens_in as "tokensIn", tokens_out as "tokensOut", batch_count as "batchCount"
    FROM job_queue WHERE job_id = $1
  `, [jobId]);
  return result.rows[0] || null;
}

/** Claim the next pending job atomically (SELECT FOR UPDATE SKIP LOCKED). */
export async function claimNextJob(): Promise<JobRecord | null> {
  return transaction(async (client) => {
    const result = await client.query<any>(`
      SELECT id, job_id as "jobId", job_type as "jobType", status,
             snapshot_id as "snapshotId", snapshot_date as "snapshotDate",
             payload, progress, error_message as "errorMessage",
             created_at as "createdAt",
             request_id as "requestId", model_name as "modelName",
             latency_ms as "latencyMs", tokens_in as "tokensIn",
             tokens_out as "tokensOut", batch_count as "batchCount"
      FROM job_queue
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);
    if (result.rows.length === 0) return null;

    const job = result.rows[0];
    await client.query(`
      UPDATE job_queue
      SET status = 'running',
          started_at = NOW(),
          heartbeat_at = NOW(),
          lease_expires_at = NOW() + INTERVAL '5 minutes',
          worker_id = $2
      WHERE id = $1
    `, [job.id, process.env.WORKER_ID || 'worker']);
    return { ...job, status: 'running' as const };
  });
}

export async function updateJobProgress(jobId: string, progress: JobProgress): Promise<void> {
  await query(`
    UPDATE job_queue
    SET status = 'partial',
        progress = $1,
        heartbeat_at = NOW(),
        lease_expires_at = NOW() + INTERVAL '5 minutes'
    WHERE job_id = $2
  `, [JSON.stringify(progress), jobId]);
}

/** Save checkpoint so worker can resume from this batch index on restart. */
export async function checkpointJob(jobId: string, checkpoint: number, progress: JobProgress): Promise<void> {
  await query(`
    UPDATE job_queue
    SET progress = $1,
        payload = jsonb_set(payload, '{checkpoint}', $2::jsonb),
        heartbeat_at = NOW(),
        lease_expires_at = NOW() + INTERVAL '5 minutes'
    WHERE job_id = $3
  `, [JSON.stringify(progress), checkpoint.toString(), jobId]);
}

export async function setJobComplete(jobId: string, snapshotId: string): Promise<void> {
  await query(`
    UPDATE job_queue
    SET status = 'complete',
        snapshot_id = $1,
        completed_at = NOW(),
        heartbeat_at = NOW(),
        lease_expires_at = NULL
    WHERE job_id = $2
  `, [snapshotId, jobId]);
}

export async function setJobFailed(jobId: string, errorMessage: string): Promise<void> {
  await query(`
    UPDATE job_queue
    SET status = 'failed',
        error_message = $1,
        completed_at = NOW(),
        heartbeat_at = NOW(),
        lease_expires_at = NULL
    WHERE job_id = $2
  `, [errorMessage, jobId]);
}

export async function setJobExecutionMetrics(jobId: string, metrics: {
  modelName?: string | null;
  latencyMs?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  batchCount?: number | null;
}): Promise<void> {
  await query(
    `UPDATE job_queue
        SET model_name = COALESCE($2, model_name),
            latency_ms = COALESCE($3, latency_ms),
            tokens_in = COALESCE($4, tokens_in),
            tokens_out = COALESCE($5, tokens_out),
            batch_count = COALESCE($6, batch_count)
      WHERE job_id = $1`,
    [
      jobId,
      metrics.modelName ?? null,
      metrics.latencyMs ?? null,
      metrics.tokensIn ?? null,
      metrics.tokensOut ?? null,
      metrics.batchCount ?? null,
    ]
  );
}

/** Recover stale non-terminal jobs after worker restart/crash. */
export async function recoverStaleJobs(maxAgeMinutes: number = 5, context?: RequestContext): Promise<number> {
  const hasTenantScope = !!context?.tenantId;
  const tenantPredicate = hasTenantScope ? `AND jq.payload->>'tenantId' = $2` : ``;
  const affectedRunTenantJoin = hasTenantScope ? `AND pr_scope.tenant_id::text = $2` : ``;
  const params = hasTenantScope ? [String(maxAgeMinutes), context!.tenantId] : [String(maxAgeMinutes)];

  const result = await query<{ count: string }>(`
    WITH stale AS (
      UPDATE job_queue jq
      SET status = 'failed',
          error_message = COALESCE(
            jq.error_message,
            CASE
              WHEN jq.lease_expires_at IS NOT NULL AND jq.lease_expires_at < NOW()
                THEN 'Recovered stale job after lease expiry'
              ELSE 'Recovered stale running/partial job after worker restart'
            END
          ),
          completed_at = NOW(),
          lease_expires_at = NULL
      WHERE jq.status IN ('pending','running','partial')
        AND (
          (jq.lease_expires_at IS NOT NULL AND jq.lease_expires_at < NOW())
          OR COALESCE(jq.started_at, jq.created_at) < NOW() - ($1::text || ' minutes')::interval
        )
        ${tenantPredicate}
      RETURNING jq.job_id, jq.payload
    ),
    affected_runs AS (
      SELECT DISTINCT (s.payload->>'runId')::uuid AS run_id
      FROM stale s
      JOIN pipeline_runs pr_scope ON pr_scope.run_id = (s.payload->>'runId')::uuid
      WHERE s.payload ? 'runId'
        AND (s.payload->>'runId') ~* '^[0-9a-f-]{36}$'
        ${affectedRunTenantJoin}
    ),
    failed_runs AS (
      UPDATE pipeline_runs pr
      SET status = 'FAILED',
          published = FALSE,
          error_message = COALESCE(pr.error_message, 'Pipeline worker lease expired'),
          idempotency_hash = NULL
      FROM affected_runs ar
      WHERE pr.run_id = ar.run_id
        AND pr.status IN ('PENDING','RUNNING')
      RETURNING pr.run_id
    ),
    failed_events AS (
      INSERT INTO pipeline_stage_events (
        run_id, stage, attempt, status, completed_at, records_processed,
        metadata_json, error_message, error_type, error_code
      )
      SELECT fr.run_id, 'AI_DECISIONS', 1, 'FAILED', NOW(), 0,
             jsonb_build_object('source', 'recoverStaleJobs', 'reason', 'lease_expired_or_stale'),
             'Pipeline worker lease expired',
             'TIMEOUT',
             'TIMEOUT'
      FROM failed_runs fr
      WHERE NOT EXISTS (
        SELECT 1
        FROM pipeline_stage_events pse
        WHERE pse.run_id = fr.run_id
          AND pse.stage = 'AI_DECISIONS'
          AND pse.status = 'FAILED'
          AND pse.error_code = 'TIMEOUT'
      )
      RETURNING 1
    )
    SELECT COUNT(*)::text AS count FROM stale
  `, params, context);
  return Number(result.rows[0]?.count || '0');
}

/** Get most recent job for a given snapshot date (for SSE reconnect). */
export async function getLatestJob(snapshotDate?: string, context?: RequestContext): Promise<JobRecord | null> {
  if (context?.tenantId) {
    const result = await query<any>(`
      SELECT id, job_id as "jobId", job_type as "jobType", status,
             snapshot_id as "snapshotId", snapshot_date as "snapshotDate",
             payload, progress, error_message as "errorMessage",
             created_at as "createdAt", started_at as "startedAt",
             completed_at as "completedAt", request_id as "requestId",
             model_name as "modelName", latency_ms as "latencyMs",
             tokens_in as "tokensIn", tokens_out as "tokensOut", batch_count as "batchCount"
      FROM job_queue
      WHERE snapshot_date = $1
        AND payload->>'tenantId' = $2
      ORDER BY created_at DESC
      LIMIT 1
    `, [snapshotDate || new Date().toISOString().split('T')[0], context.tenantId], context);
    return result.rows[0] || null;
  }

  const result = await query<any>(`
    SELECT id, job_id as "jobId", job_type as "jobType", status,
           snapshot_id as "snapshotId", snapshot_date as "snapshotDate",
           payload, progress, error_message as "errorMessage",
           created_at as "createdAt", started_at as "startedAt",
           completed_at as "completedAt", request_id as "requestId",
           model_name as "modelName", latency_ms as "latencyMs",
           tokens_in as "tokensIn", tokens_out as "tokensOut", batch_count as "batchCount"
    FROM job_queue
    WHERE snapshot_date = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [snapshotDate || new Date().toISOString().split('T')[0]]);
  return result.rows[0] || null;
}

function isValidUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}
