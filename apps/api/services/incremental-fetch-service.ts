import * as crypto from 'crypto';
import { query } from '../../../core/database/connection';

// ─────────────────────────────────────────────
// Pipeline Watermark API
// ─────────────────────────────────────────────
//
// Watermarks allow the pipeline to fetch only the delta since the last run.
// Bootstrap: if no watermark exists, defaults to 24 hours ago.
// Advance: watermark only advances on FULL SUCCESS (atomic).
//
// Usage:
//   const watermark = await getWatermark('main_aggregation', tenantId);
//   // ... run pipeline with watermark.last_processed_at as 'since' ...
//   await advanceWatermark('main_aggregation', tenantId, new Date(), newSid, indexCount);

export interface PipelineWatermark {
  pipeline_name: string;
  tenant_id: string;
  last_processed_at: Date;
  last_sid: string | null;
  last_index_count: number;
  consecutive_empty_runs: number;
  updated_at: Date;
}

/**
 * Get the current watermark for a pipeline.
 * Returns null if no watermark row exists (first run — use 24h ago as default).
 */
export async function getWatermark(
  pipelineName: string,
  tenantId: string = 'SYSTEM'
): Promise<PipelineWatermark | null> {
  try {
    const result = await query<PipelineWatermark>(
      `SELECT pipeline_name, tenant_id, last_processed_at, last_sid,
              last_index_count, consecutive_empty_runs, updated_at
       FROM pipeline_watermarks
       WHERE pipeline_name = $1 AND tenant_id = $2`,
      [pipelineName, tenantId]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    console.warn('[WATERMARK_GET_FAILED]', {
      pipeline_name: pipelineName,
      tenant_id: tenantId,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
    return null;
  }
}

/**
 * Get the watermark timestamp, defaulting to 24 hours ago if no watermark exists.
 * Use this as the 'since' parameter for incremental fetches.
 */
export async function getWatermarkOrDefault(
  pipelineName: string,
  tenantId: string = 'SYSTEM',
  defaultOffsetHours: number = 24
): Promise<Date> {
  const watermark = await getWatermark(pipelineName, tenantId);
  if (watermark) {
    return watermark.last_processed_at;
  }
  return new Date(Date.now() - defaultOffsetHours * 60 * 60 * 1000);
}

/**
 * Advance the pipeline watermark after a successful run.
 * CRITICAL: Only call this after ALL pipeline stages complete successfully.
 * A partial success must NOT advance the watermark (partial data = next run re-fetches overlap).
 *
 * @param pipelineName - Name of the pipeline
 * @param tenantId     - Tenant scope
 * @param to           - New watermark timestamp (typically: pipeline run start time)
 * @param lastSid      - Last Splunk job ID from this run (optional)
 * @param indexCount   - Number of indexes processed
 */
export async function advanceWatermark(
  pipelineName: string,
  tenantId: string,
  to: Date,
  lastSid?: string,
  indexCount?: number
): Promise<void> {
  try {
    await query(
      `INSERT INTO pipeline_watermarks
         (pipeline_name, tenant_id, last_processed_at, last_sid, last_index_count, consecutive_empty_runs, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, NOW())
       ON CONFLICT (pipeline_name) DO UPDATE
         SET last_processed_at      = EXCLUDED.last_processed_at,
             last_sid               = COALESCE(EXCLUDED.last_sid, pipeline_watermarks.last_sid),
             last_index_count       = COALESCE(EXCLUDED.last_index_count, pipeline_watermarks.last_index_count),
             consecutive_empty_runs = CASE WHEN EXCLUDED.last_index_count = 0
                                       THEN pipeline_watermarks.consecutive_empty_runs + 1
                                       ELSE 0 END,
             updated_at             = NOW()`,
      [pipelineName, tenantId, to.toISOString(), lastSid ?? null, indexCount ?? 0]
    );

    console.log('[WATERMARK_ADVANCED]', {
      pipeline_name: pipelineName,
      tenant_id: tenantId,
      advanced_to: to.toISOString(),
      last_sid: lastSid,
      index_count: indexCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // Non-critical: watermark failure doesn't block the pipeline, but next run will re-fetch overlap
    console.error('[WATERMARK_ADVANCE_FAILED]', {
      pipeline_name: pipelineName,
      tenant_id: tenantId,
      error: error instanceof Error ? error.message : String(error),
      note: 'Next run will re-process from previous watermark',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Record a pipeline execution in pipeline_executions_v2.
 * Call at the start of each run with status='running', update on completion.
 */
export async function recordPipelineExecution(
  pipelineName: string,
  tenantId: string,
  watermarkFrom: Date | null,
  status: 'pending' | 'running' | 'completed' | 'failed' | 'partial' = 'running'
): Promise<string> {
  const id = `exec-${crypto.randomBytes(8).toString('hex')}`;
  await query(
    `INSERT INTO pipeline_executions_v2
       (id, tenant_id, pipeline_name, status, watermark_from, started_at, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
    [id, tenantId, pipelineName, status, watermarkFrom?.toISOString() ?? null]
  );
  return id;
}

/**
 * Update a pipeline execution record on completion.
 */
export async function completePipelineExecution(
  executionId: string,
  result: {
    status: 'completed' | 'failed' | 'partial';
    watermark_to?: Date;
    indexes_fetched?: number;
    indexes_new?: number;
    indexes_updated?: number;
    indexes_unchanged?: number;
    duration_ms?: number;
    error_message?: string;
  }
): Promise<void> {
  await query(
    `UPDATE pipeline_executions_v2
     SET status             = $1,
         watermark_to       = $2,
         indexes_fetched    = $3,
         indexes_new        = $4,
         indexes_updated    = $5,
         indexes_unchanged  = $6,
         duration_ms        = $7,
         error_message      = $8,
         completed_at       = NOW()
     WHERE id = $9`,
    [
      result.status,
      result.watermark_to?.toISOString() ?? null,
      result.indexes_fetched ?? null,
      result.indexes_new ?? null,
      result.indexes_updated ?? null,
      result.indexes_unchanged ?? null,
      result.duration_ms ?? null,
      result.error_message ?? null,
      executionId
    ]
  );
}

// ─────────────────────────────────────────────
// Original incremental fetch types
// ─────────────────────────────────────────────

export interface FetchChangedSourcesInput {
  tenantId: string;
  since: string | Date | null;
}

export interface SourceChange {
  indexName: string;
  sourcetype: string | null;
  granularity: 'index' | 'sourcetype';
  snapshotId: string;
  createdAt: string;
  updatedAt: string;
}

export interface FetchChangedSourcesResult {
  changed: SourceChange[];
  unchanged: SourceChange[];
  deleted: Array<{ indexName: string; sourcetype: string | null; granularity: 'index' | 'sourcetype' }>;
}

export async function fetchChangedSources(input: FetchChangedSourcesInput): Promise<FetchChangedSourcesResult> {
  const { tenantId, since } = input;

  // No watermark means initial full fetch (latest snapshot only).
  if (!since) {
    const full = await query(
      `SELECT index_name, sourcetype, granularity, snapshot_id, created_at, updated_at
       FROM telemetry_snapshots
       WHERE tenant_id::text = $1
         AND snapshot_id = (
           SELECT snapshot_id
           FROM telemetry_snapshots
           WHERE tenant_id::text = $1
           ORDER BY created_at DESC, id DESC
           LIMIT 1
         )`,
      [tenantId]
    );

    return {
      changed: full.rows.map(mapRow),
      unchanged: [],
      deleted: [],
    };
  }

  const sinceTs = since instanceof Date ? since.toISOString() : since;

  const latestSnapshotRes = await query(
    `SELECT snapshot_id
     FROM telemetry_snapshots
     WHERE tenant_id::text = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [tenantId]
  );

  if (latestSnapshotRes.rows.length === 0) {
    return { changed: [], unchanged: [], deleted: [] };
  }

  const latestSnapshotId = latestSnapshotRes.rows[0].snapshot_id as string;

  const changedRes = await query(
    `SELECT index_name, sourcetype, granularity, snapshot_id, created_at, updated_at
     FROM telemetry_snapshots
     WHERE tenant_id::text = $1
       AND snapshot_id = $2
       AND updated_at > $3
     ORDER BY updated_at DESC`,
    [tenantId, latestSnapshotId, sinceTs]
  );

  const unchangedRes = await query(
    `SELECT index_name, sourcetype, granularity, snapshot_id, created_at, updated_at
     FROM telemetry_snapshots
     WHERE tenant_id::text = $1
       AND snapshot_id = $2
       AND updated_at <= $3
     ORDER BY updated_at DESC`,
    [tenantId, latestSnapshotId, sinceTs]
  );

  const previousSnapshotRes = await query(
    `SELECT snapshot_id
     FROM telemetry_snapshots
     WHERE tenant_id::text = $1
       AND snapshot_id <> $2
     GROUP BY snapshot_id
     ORDER BY MAX(created_at) DESC, MAX(id) DESC
     LIMIT 1`,
    [tenantId, latestSnapshotId]
  );

  let deleted: FetchChangedSourcesResult['deleted'] = [];
  if (previousSnapshotRes.rows.length > 0) {
    const previousSnapshotId = previousSnapshotRes.rows[0].snapshot_id as string;
    const deletedRes = await query(
      `SELECT p.index_name, p.sourcetype, p.granularity
       FROM telemetry_snapshots p
       WHERE p.tenant_id::text = $1
         AND p.snapshot_id = $2
         AND NOT EXISTS (
           SELECT 1
           FROM telemetry_snapshots c
           WHERE c.tenant_id = p.tenant_id
             AND c.snapshot_id = $3
             AND c.index_name = p.index_name
             AND COALESCE(c.sourcetype, '') = COALESCE(p.sourcetype, '')
             AND c.granularity = p.granularity
         )`,
      [tenantId, previousSnapshotId, latestSnapshotId]
    );
    deleted = deletedRes.rows.map((r: any) => ({
      indexName: r.index_name,
      sourcetype: r.sourcetype,
      granularity: r.granularity,
    }));
  }

  return {
    changed: changedRes.rows.map(mapRow),
    unchanged: unchangedRes.rows.map(mapRow),
    deleted,
  };
}

function mapRow(r: any): SourceChange {
  return {
    indexName: r.index_name,
    sourcetype: r.sourcetype,
    granularity: r.granularity,
    snapshotId: String(r.snapshot_id),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}
