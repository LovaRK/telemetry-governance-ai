/**
 * Gold Scorer
 *
 * Transforms Silver normalized telemetry into Gold materialized KPI snapshots.
 * Gold is the THIRD and final layer of the medallion architecture.
 *
 * CRITICAL INVARIANTS:
 * - Gold rows are NEVER updated after insert — APPEND-ONLY
 * - To update a score: set validity_closed_at on the old row AND insert a new row
 * - Every Gold row references exactly one Silver row (silver_id FK)
 * - Scoring version + profile are stamped for replay
 * - snapshot_hash + previous_snapshot_hash form a tamper-evident chain
 *
 * Lineage:
 *   Silver (normalized) → Gold (composite_score, tier, snapshot_hash)
 *
 * Replay:
 *   To replay with a new scoring_version:
 *     1. Close validity_closed_at on existing Gold rows for the affected range
 *     2. Run gold-scorer.scoreBatch(silverRows, { scoringVersion: '2.0' })
 *     3. New Gold rows are inserted — old rows remain for audit/certification
 */

import * as crypto from 'crypto';
import { query } from '../../../core/database/connection';
import { assertTenantIsolation } from '../../api/middleware/assert-tenant-isolation';
import { SilverRow } from './silver-normalizer';
import {
  SCORING_VERSION,
  computeGatedCompositeScore
} from '../../../packages/core/engine/scoring/composite';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface GoldRow {
  id: string;
  tenant_id: string;
  silver_id: string;
  index_name: string;
  utilization_score: number;
  detection_score: number;
  quality_score: number;
  composite_score: number;
  tier: string;
  minimum_activity_gated: boolean;
  scoring_version: string;
  scoring_profile: string;
  weight_utilization: number;
  weight_detection: number;
  weight_quality: number;
  snapshot_hash: string;
  previous_snapshot_hash: string | null;
  scored_at: string;
  validity_closed_at: string | null;
  pipeline_run_id: string | null;
}

export interface ScoringWeights {
  utilization: number;
  detection: number;
  quality: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  utilization: 0.35,
  detection: 0.40,
  quality: 0.25
};

export interface ScoreOptions {
  scoringVersion?: string;
  scoringProfile?: string;
  weights?: ScoringWeights;
  pipelineRunId?: string;
}

export interface GoldScoringResult {
  inserted: number;
  skipped: number;
  rows: GoldRow[];
  pipeline_run_id: string;
  scoring_version: string;
}

// ─────────────────────────────────────────────
// Tier classification
// ─────────────────────────────────────────────

/**
 * Classify a composite score into a value tier.
 * Thresholds are locked to the composite scoring model.
 */
export function classifyTier(composite: number): string {
  if (composite >= 80) return 'critical';
  if (composite >= 60) return 'high-value';
  if (composite >= 40) return 'medium-value';
  if (composite >= 20) return 'low-value';
  return 'inactive';
}

// ─────────────────────────────────────────────
// Score extraction from Silver
// ─────────────────────────────────────────────

/**
 * Derive individual KPI scores from a Silver normalized row.
 * Uses the canonical scoring model — deterministic, no external calls.
 */
function deriveScoresFromSilver(silver: SilverRow): {
  utilization: number;
  detection: number;
  quality: number;
} {
  const fields = (
    typeof silver.normalized_fields === 'string'
      ? JSON.parse(silver.normalized_fields)
      : silver.normalized_fields
  ) ?? {};

  // Utilization score: derived from event_count + time_span_days
  // Scale: 0-100 where 100 = very active index
  let utilization = 0;
  if (silver.event_count !== null && silver.event_count > 0) {
    const eventsPerDay = silver.time_span_days
      ? silver.event_count / Math.max(silver.time_span_days, 1)
      : silver.event_count;

    // Log-scale normalization: 10k events/day → ~100 score
    utilization = Math.min(100, Math.round(Math.log10(eventsPerDay + 1) * 33.3));
  }

  // Detection score: derived from available detection signals
  // Prefer pre-computed detection_score if present in normalized fields
  let detection = 0;
  if (typeof fields.detection_score === 'number') {
    detection = Math.max(0, Math.min(100, fields.detection_score));
  } else if (typeof fields.detection_coverage === 'number') {
    detection = Math.max(0, Math.min(100, fields.detection_coverage));
  } else {
    // Heuristic: sourcetype relevance to security detection
    const securitySourcetypes = [
      'WinEventLog', 'XmlWinEventLog', 'syslog', 'pan:traffic', 'pan:threat',
      'cisco:asa', 'aws:cloudtrail', 'okta:im2', 'crowdstrike', 'defendpoint',
      'o365:management:activity', 'stream:http', 'suricata', 'zeek'
    ];
    const st = (silver.sourcetype ?? '').toLowerCase();
    const isSecurityRelevant = securitySourcetypes.some(s => st.includes(s.toLowerCase()));
    detection = isSecurityRelevant ? 50 : 10; // Default heuristic
  }

  // Quality score: derived from parsing_error_rate + field_coverage_pct
  let quality = 50; // neutral default
  if (silver.parsing_error_rate !== null && silver.field_coverage_pct !== null) {
    // High errors + low coverage = low quality; low errors + high coverage = high quality
    const errorPenalty = silver.parsing_error_rate * 0.5; // 0-50 penalty
    const coverageBonus = silver.field_coverage_pct * 0.5; // 0-50 bonus
    quality = Math.max(0, Math.min(100, 50 - errorPenalty + coverageBonus));
  } else if (silver.parsing_error_rate !== null) {
    quality = Math.max(0, Math.min(100, 100 - silver.parsing_error_rate));
  } else if (silver.field_coverage_pct !== null) {
    quality = silver.field_coverage_pct;
  }

  return {
    utilization: Math.round(utilization),
    detection: Math.round(detection),
    quality: Math.round(quality)
  };
}

// ─────────────────────────────────────────────
// Snapshot hash chain
// ─────────────────────────────────────────────

function computeGoldSnapshotHash(fields: {
  tenant_id: string;
  index_name: string;
  utilization_score: number;
  detection_score: number;
  quality_score: number;
  composite_score: number;
  scoring_version: string;
  scoring_profile: string;
  silver_id: string;
}): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(fields, Object.keys(fields).sort()))
    .digest('hex');
}

async function getPreviousGoldHash(
  tenantId: string,
  indexName: string
): Promise<string | null> {
  const result = await query<{ snapshot_hash: string }>(
    `SELECT snapshot_hash
     FROM gold_telemetry_snapshots
     WHERE tenant_id = $1 AND index_name = $2 AND validity_closed_at IS NULL
     ORDER BY scored_at DESC
     LIMIT 1`,
    [tenantId, indexName]
  );
  return result.rows[0]?.snapshot_hash ?? null;
}

// ─────────────────────────────────────────────
// Write
// ─────────────────────────────────────────────

/**
 * Score a single Silver row into a Gold row.
 * APPEND-ONLY: if a current Gold row exists for this index, it will be superseded
 * (validity_closed_at set) and a new row inserted.
 */
export async function scoreSilverRow(
  silver: SilverRow,
  opts: ScoreOptions = {}
): Promise<GoldRow | null> {
  assertTenantIsolation(silver.tenant_id, 'gold-scorer:scoreSilverRow');

  const scoringVersion = opts.scoringVersion ?? SCORING_VERSION;
  const scoringProfile = opts.scoringProfile ?? 'balanced';
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const pipelineRunId = opts.pipelineRunId ?? null;

  // Derive raw scores
  const rawScores = deriveScoresFromSilver(silver);

  // Apply composite scoring with minimum activity gate
  const gated = computeGatedCompositeScore(
    rawScores.utilization,
    rawScores.detection,
    rawScores.quality,
    { utilization: weights.utilization, detection: weights.detection, quality: weights.quality }
  );

  const tier = classifyTier(gated.composite);

  // Get previous hash for chain (can be null for first row of this index)
  const previousHash = await getPreviousGoldHash(silver.tenant_id, silver.index_name);

  const snapshotHash = computeGoldSnapshotHash({
    tenant_id: silver.tenant_id,
    index_name: silver.index_name,
    utilization_score: rawScores.utilization,
    detection_score: rawScores.detection,
    quality_score: rawScores.quality,
    composite_score: gated.composite,
    scoring_version: scoringVersion,
    scoring_profile: scoringProfile,
    silver_id: silver.id
  });

  const id = `gold-${crypto.randomBytes(12).toString('hex')}`;
  const now = new Date().toISOString();

  // APPEND-ONLY: close validity window on current row for this index (if any)
  await query(
    `UPDATE gold_telemetry_snapshots
     SET validity_closed_at = $1
     WHERE tenant_id = $2 AND index_name = $3
       AND validity_closed_at IS NULL
       AND scoring_version = $4`,
    [now, silver.tenant_id, silver.index_name, scoringVersion]
  );

  // Insert new Gold row
  const result = await query<GoldRow>(
    `INSERT INTO gold_telemetry_snapshots
       (id, tenant_id, silver_id, index_name,
        utilization_score, detection_score, quality_score, composite_score,
        tier, minimum_activity_gated, scoring_version, scoring_profile,
        weight_utilization, weight_detection, weight_quality,
        snapshot_hash, previous_snapshot_hash, scored_at, pipeline_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING id, tenant_id, silver_id, index_name,
               utilization_score, detection_score, quality_score, composite_score,
               tier, minimum_activity_gated, scoring_version, scoring_profile,
               weight_utilization, weight_detection, weight_quality,
               snapshot_hash, previous_snapshot_hash,
               scored_at::TEXT, validity_closed_at::TEXT, pipeline_run_id`,
    [
      id,
      silver.tenant_id,
      silver.id,
      silver.index_name,
      rawScores.utilization,
      rawScores.detection,
      rawScores.quality,
      gated.composite,
      tier,
      gated.minimum_activity_gated,
      scoringVersion,
      scoringProfile,
      weights.utilization,
      weights.detection,
      weights.quality,
      snapshotHash,
      previousHash,
      now,
      pipelineRunId
    ]
  );

  return result.rows[0] ?? null;
}

/**
 * Score a batch of Silver rows into Gold.
 * Processes serially (not parallel) to maintain correct hash chain ordering.
 */
export async function scoreBatch(
  silverRows: SilverRow[],
  opts: ScoreOptions = {}
): Promise<GoldScoringResult> {
  if (silverRows.length === 0) {
    return {
      inserted: 0,
      skipped: 0,
      rows: [],
      pipeline_run_id: opts.pipelineRunId ?? '',
      scoring_version: opts.scoringVersion ?? SCORING_VERSION
    };
  }

  const runId = opts.pipelineRunId ?? `gold-run-${crypto.randomBytes(8).toString('hex')}`;
  const scoringVersion = opts.scoringVersion ?? SCORING_VERSION;
  const inserted: GoldRow[] = [];
  let skipped = 0;

  // Serial processing — order matters for the hash chain
  for (const silver of silverRows) {
    try {
      const row = await scoreSilverRow(silver, { ...opts, pipelineRunId: runId });
      if (row) {
        inserted.push(row);
      } else {
        skipped++;
      }
    } catch (err) {
      console.warn('[GOLD_SCORE_FAILED]', {
        silver_id: silver.id,
        index_name: silver.index_name,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString()
      });
      skipped++;
    }
  }

  console.log('[GOLD_BATCH_SCORED]', {
    pipeline_run_id: runId,
    scoring_version: scoringVersion,
    inserted: inserted.length,
    skipped,
    total: silverRows.length,
    timestamp: new Date().toISOString()
  });

  return {
    inserted: inserted.length,
    skipped,
    rows: inserted,
    pipeline_run_id: runId,
    scoring_version: scoringVersion
  };
}

// ─────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────

/**
 * Get the current (valid) Gold row for each index for a tenant.
 * "Current" = validity_closed_at IS NULL (not yet superseded).
 */
export async function getCurrentGoldSnapshot(
  tenantId: string,
  indexName: string,
  scoringVersion = SCORING_VERSION
): Promise<GoldRow | null> {
  assertTenantIsolation(tenantId, 'gold-scorer:getCurrentGoldSnapshot');

  const result = await query<GoldRow>(
    `SELECT id, tenant_id, silver_id, index_name,
            utilization_score, detection_score, quality_score, composite_score,
            tier, minimum_activity_gated, scoring_version, scoring_profile,
            weight_utilization, weight_detection, weight_quality,
            snapshot_hash, previous_snapshot_hash,
            scored_at::TEXT, validity_closed_at::TEXT, pipeline_run_id
     FROM gold_telemetry_snapshots
     WHERE tenant_id = $1 AND index_name = $2
       AND scoring_version = $3
       AND validity_closed_at IS NULL
     ORDER BY scored_at DESC
     LIMIT 1`,
    [tenantId, indexName, scoringVersion]
  );

  return result.rows[0] ?? null;
}

/**
 * Get all current Gold snapshots for a tenant (the KPI dashboard feed).
 */
export async function getAllCurrentGoldSnapshots(
  tenantId: string,
  opts: {
    scoringVersion?: string;
    tier?: string;
    limit?: number;
  } = {}
): Promise<GoldRow[]> {
  assertTenantIsolation(tenantId, 'gold-scorer:getAllCurrentGoldSnapshots');

  const scoringVersion = opts.scoringVersion ?? SCORING_VERSION;
  const extraConditions: string[] = [];
  const params: unknown[] = [tenantId, scoringVersion];

  if (opts.tier) {
    params.push(opts.tier);
    extraConditions.push(`AND tier = $${params.length}`);
  }

  const limit = opts.limit ?? 1000;

  const result = await query<GoldRow>(
    `SELECT id, tenant_id, silver_id, index_name,
            utilization_score, detection_score, quality_score, composite_score,
            tier, minimum_activity_gated, scoring_version, scoring_profile,
            weight_utilization, weight_detection, weight_quality,
            snapshot_hash, previous_snapshot_hash,
            scored_at::TEXT, validity_closed_at::TEXT, pipeline_run_id
     FROM gold_telemetry_snapshots
     WHERE tenant_id = $1
       AND scoring_version = $2
       AND validity_closed_at IS NULL
       ${extraConditions.join(' ')}
     ORDER BY composite_score DESC, index_name ASC
     LIMIT ${limit}`,
    params
  );

  return result.rows;
}

/**
 * Get historical Gold rows for an index (for trend analysis).
 * Returns ALL rows including superseded ones, ordered by scored_at DESC.
 */
export async function getGoldHistory(
  tenantId: string,
  indexName: string,
  opts: { limit?: number; since?: string } = {}
): Promise<GoldRow[]> {
  assertTenantIsolation(tenantId, 'gold-scorer:getGoldHistory');

  const params: unknown[] = [tenantId, indexName];
  const extra: string[] = [];

  if (opts.since) {
    params.push(opts.since);
    extra.push(`AND scored_at > $${params.length}`);
  }

  const limit = opts.limit ?? 100;

  const result = await query<GoldRow>(
    `SELECT id, tenant_id, silver_id, index_name,
            utilization_score, detection_score, quality_score, composite_score,
            tier, minimum_activity_gated, scoring_version, scoring_profile,
            weight_utilization, weight_detection, weight_quality,
            snapshot_hash, previous_snapshot_hash,
            scored_at::TEXT, validity_closed_at::TEXT, pipeline_run_id
     FROM gold_telemetry_snapshots
     WHERE tenant_id = $1 AND index_name = $2
     ${extra.join(' ')}
     ORDER BY scored_at DESC
     LIMIT ${limit}`,
    params
  );

  return result.rows;
}
