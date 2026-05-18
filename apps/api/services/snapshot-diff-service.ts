import { PoolClient } from 'pg';
import { RawTelemetryInput } from '../agents/llm-decision-agent';
import { computeMetadataFingerprint } from './fingerprint-service';

export type IndexMetadata = RawTelemetryInput;

export interface DiffResult {
  unchanged: IndexMetadata[];
  changed: IndexMetadata[];
  new: IndexMetadata[];
  removed: IndexMetadata[];
  summaryStats: {
    unchangedCount: number;
    changedCount: number;
    newCount: number;
    removedCount: number;
    percentageUnchanged: number;
  };
}

export interface SnapshotDiffStats {
  snapshotId: string;
  snapshotDate: string;
  totalIndexes: number;
  unchangedIndexes: number;
  changedIndexes: number;
  newIndexes: number;
  removedIndexes: number;
  llmVersion: string;
  promptVersion: string;
  modelVersion: string;
  heuristicVersion: string;
}

async function getPreviousSnapshot(client: PoolClient, today: string) {
  const result = await client.query(
    `SELECT snapshot_date FROM snapshot_metadata
     WHERE snapshot_date < $1
     ORDER BY snapshot_date DESC
     LIMIT 1`,
    [today]
  );
  return result.rows[0]?.snapshot_date || null;
}

async function getMetadataForSnapshot(
  client: PoolClient,
  snapshotDate: string
): Promise<Map<string, { metadata: any; fingerprint: string }>> {
  const result = await client.query(
    `SELECT index_name, sourcetype, daily_avg_gb, total_events, retention_days, last_event_epoch, metadata_fingerprint
     FROM index_metadata_history
     WHERE snapshot_date = $1`,
    [snapshotDate]
  );

  const map = new Map();
  for (const row of result.rows) {
    const key = `${row.index_name}/${row.sourcetype || ''}`;
    map.set(key, {
      metadata: row,
      fingerprint: row.metadata_fingerprint,
    });
  }
  return map;
}

export async function diffSnapshots(
  client: PoolClient,
  currentMetadata: IndexMetadata[],
  today: string,
  versions: {
    llmVersion: string;
    promptVersion: string;
    modelVersion: string;
    heuristicVersion: string;
  }
): Promise<DiffResult> {
  const previousDate = await getPreviousSnapshot(client, today);

  if (!previousDate) {
    console.log('[SnapshotDiff] No previous snapshot found. All indexes are NEW.');
    return {
      unchanged: [],
      changed: [],
      new: currentMetadata,
      removed: [],
      summaryStats: {
        unchangedCount: 0,
        changedCount: 0,
        newCount: currentMetadata.length,
        removedCount: 0,
        percentageUnchanged: 0,
      },
    };
  }

  const previousMetadata = await getMetadataForSnapshot(client, previousDate);
  const unchanged: IndexMetadata[] = [];
  const changed: IndexMetadata[] = [];
  const newIndexes: IndexMetadata[] = [];
  const processedKeys = new Set<string>();

  for (const current of currentMetadata) {
    const key = `${current.index}/${current.sourcetype || ''}`;
    processedKeys.add(key);

    const previous = previousMetadata.get(key);
    const currentFingerprint = computeMetadataFingerprint(current);

    if (!previous) {
      newIndexes.push(current);
    } else if (previous.fingerprint === currentFingerprint) {
      unchanged.push(current);
    } else {
      changed.push(current);
    }
  }

  const removed = Array.from(previousMetadata.entries())
    .filter(([key]) => !processedKeys.has(key))
    .map(([, value]) => ({
      index: value.metadata.index_name,
      sourcetype: value.metadata.sourcetype,
      dailyAvgGb: value.metadata.daily_avg_gb,
      totalEvents: value.metadata.total_events,
      retentionDays: value.metadata.retention_days,
      firstEvent: '',
      lastEvent: new Date(value.metadata.last_event_epoch * 1000).toISOString(),
    }));

  const total = currentMetadata.length;
  const unchangedCount = unchanged.length;
  const changedCount = changed.length;
  const newCount = newIndexes.length;

  console.log('[SnapshotDiff] Diffing complete:', {
    total,
    unchanged: unchangedCount,
    changed: changedCount,
    new: newCount,
    removed: removed.length,
    percentage_unchanged: total > 0 ? Math.round((unchangedCount / total) * 100) : 0,
  });

  return {
    unchanged,
    changed,
    new: newIndexes,
    removed,
    summaryStats: {
      unchangedCount,
      changedCount,
      newCount,
      removedCount: removed.length,
      percentageUnchanged: total > 0 ? (unchangedCount / total) * 100 : 0,
    },
  };
}

export async function reuseDecisionsForUnchanged(
  client: PoolClient,
  unchangedIndexes: IndexMetadata[],
  previousDate: string,
  newSnapshotId: string,
  today: string,
  versions: {
    llmVersion: string;
    promptVersion: string;
    modelVersion: string;
    heuristicVersion: string;
  }
): Promise<number> {
  if (unchangedIndexes.length === 0) return 0;

  let reused = 0;

  for (const index of unchangedIndexes) {
    const result = await client.query(
      `SELECT * FROM agent_decisions
       WHERE index_name = $1 AND sourcetype IS NOT DISTINCT FROM $2 AND snapshot_date = $3
       ORDER BY created_at DESC LIMIT 1`,
      [index.index, index.sourcetype || null, previousDate]
    );

    if (result.rows.length > 0) {
      const prev = result.rows[0];
      const currentFingerprint = computeMetadataFingerprint(index);

      await client.query(
        `INSERT INTO agent_decisions (
          snapshot_id, snapshot_date, index_name, sourcetype, tier, action,
          composite_score, utilization_score, detection_score, quality_score, risk_score,
          annual_license_cost, estimated_savings, confidence, confidence_score,
          recommendation, reasoning, evidence, is_quick_win, is_s3_candidate, detection_gap,
          metadata_fingerprint, llm_version, prompt_version, model_version, heuristic_version,
          source_checksum, last_llm_processed_at, decision_stability_score, processing_status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
        )`,
        [
          newSnapshotId, today, index.index, index.sourcetype || null,
          prev.tier, prev.action,
          prev.composite_score, prev.utilization_score, prev.detection_score,
          prev.quality_score, prev.risk_score,
          prev.annual_license_cost, prev.estimated_savings,
          prev.confidence, prev.confidence_score,
          prev.recommendation, prev.reasoning, prev.evidence,
          prev.is_quick_win, prev.is_s3_candidate, prev.detection_gap,
          currentFingerprint,
          versions.llmVersion, versions.promptVersion, versions.modelVersion, versions.heuristicVersion,
          prev.source_checksum, prev.last_llm_processed_at,
          Math.min(prev.decision_stability_score + 5, 100), // Increase stability
          'unchanged',
        ]
      );

      reused++;
    }
  }

  console.log(`[SnapshotDiff] Reused ${reused}/${unchangedIndexes.length} unchanged decisions`);
  return reused;
}

export async function persistDiffStats(
  client: PoolClient,
  stats: SnapshotDiffStats
): Promise<void> {
  await client.query(
    `INSERT INTO snapshot_metadata (
      snapshot_id, snapshot_date, total_indexes,
      indexes_unchanged, indexes_changed, indexes_new, indexes_removed,
      llm_version, prompt_version, model_version, heuristic_version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (snapshot_id) DO UPDATE SET
      indexes_unchanged = $4, indexes_changed = $5, indexes_new = $6, indexes_removed = $7`,
    [
      stats.snapshotId, stats.snapshotDate, stats.totalIndexes,
      stats.unchangedIndexes, stats.changedIndexes, stats.newIndexes, stats.removedIndexes,
      stats.llmVersion, stats.promptVersion, stats.modelVersion, stats.heuristicVersion,
    ]
  );
}

export async function persistMetadataHistory(
  client: PoolClient,
  metadata: IndexMetadata[],
  today: string,
  diffResult: DiffResult
): Promise<void> {
  for (const index of metadata) {
    const fingerprint = computeMetadataFingerprint(index);
    let changeType = 'new';

    if (diffResult.unchanged.some(m => m.index === index.index && m.sourcetype === index.sourcetype)) {
      changeType = 'unchanged';
    } else if (diffResult.changed.some(m => m.index === index.index && m.sourcetype === index.sourcetype)) {
      changeType = 'changed';
    }

    await client.query(
      `INSERT INTO index_metadata_history (
        snapshot_date, index_name, sourcetype, metadata_fingerprint,
        daily_avg_gb, total_events, retention_days, last_event_epoch, change_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (snapshot_date, index_name, sourcetype) DO UPDATE SET
        metadata_fingerprint = $4, change_type = $9`,
      [
        today, index.index, index.sourcetype || null,
        fingerprint,
        index.dailyAvgGb, index.totalEvents, index.retentionDays,
        index.lastEvent, changeType,
      ]
    );
  }
}
