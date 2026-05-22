import { query } from '../../../core/database/connection';

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
