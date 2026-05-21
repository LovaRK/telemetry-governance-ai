import { query, transaction } from '@core/database/connection';

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
    INSERT INTO job_queue (job_type, snapshot_id, payload, status, progress, snapshot_date)
    VALUES ($1, $2, $3, 'pending', '{"batch":0,"totalBatches":0,"decisionsWritten":0}', CURRENT_DATE)
    RETURNING job_id
  `, [opts.jobType || 'llm_analysis', opts.snapshotId || null, JSON.stringify(opts.payload)]);
  return result.rows[0].job_id;
}

export async function getJobStatus(jobId: string): Promise<JobRecord | null> {
  const result = await query<any>(`
    SELECT id, job_id as "jobId", job_type as "jobType", status,
           snapshot_id as "snapshotId", snapshot_date as "snapshotDate",
           payload, progress, error_message as "errorMessage",
           created_at as "createdAt", started_at as "startedAt",
           completed_at as "completedAt"
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
             created_at as "createdAt"
      FROM job_queue
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);
    if (result.rows.length === 0) return null;

    const job = result.rows[0];
    await client.query(`
      UPDATE job_queue SET status = 'running', started_at = NOW()
      WHERE id = $1
    `, [job.id]);
    return { ...job, status: 'running' as const };
  });
}

export async function updateJobProgress(jobId: string, progress: JobProgress): Promise<void> {
  await query(`
    UPDATE job_queue SET status = 'partial', progress = $1
    WHERE job_id = $2
  `, [JSON.stringify(progress), jobId]);
}

/** Save checkpoint so worker can resume from this batch index on restart. */
export async function checkpointJob(jobId: string, checkpoint: number, progress: JobProgress): Promise<void> {
  await query(`
    UPDATE job_queue
    SET progress = $1,
        payload = jsonb_set(payload, '{checkpoint}', $2::jsonb)
    WHERE job_id = $3
  `, [JSON.stringify(progress), checkpoint.toString(), jobId]);
}

export async function setJobComplete(jobId: string, snapshotId: string): Promise<void> {
  await query(`
    UPDATE job_queue
    SET status = 'complete', snapshot_id = $1, completed_at = NOW()
    WHERE job_id = $2
  `, [snapshotId, jobId]);
}

export async function setJobFailed(jobId: string, errorMessage: string): Promise<void> {
  await query(`
    UPDATE job_queue
    SET status = 'failed', error_message = $1, completed_at = NOW()
    WHERE job_id = $2
  `, [errorMessage, jobId]);
}

/** Get most recent job for a given snapshot date (for SSE reconnect). */
export async function getLatestJob(snapshotDate?: string): Promise<JobRecord | null> {
  const result = await query<any>(`
    SELECT id, job_id as "jobId", job_type as "jobType", status,
           snapshot_id as "snapshotId", snapshot_date as "snapshotDate",
           payload, progress, error_message as "errorMessage",
           created_at as "createdAt", started_at as "startedAt",
           completed_at as "completedAt"
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
