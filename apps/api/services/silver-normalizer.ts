/**
 * Silver Normalizer
 *
 * Transforms Bronze raw Splunk payloads into normalized Silver rows.
 * Silver is the SECOND layer of the medallion architecture.
 *
 * CRITICAL INVARIANTS:
 * - Silver rows are NEVER updated after insert
 * - New parser_version creates NEW Silver rows; old rows are retained
 * - Every Silver row references exactly one Bronze row (bronze_id FK)
 * - Parser version + normalization version are stamped for replay
 *
 * Lineage:
 *   Bronze (raw_payload) → Silver (normalized) → Gold (scored)
 *
 * Replay:
 *   To replay with a new parser_version:
 *     1. Run silver-normalizer.normalizeBatch(bronzeRows, { parserVersion: '2.0' })
 *     2. New Silver rows are inserted with parser_version='2.0'
 *     3. Old Silver rows (parser_version='1.0') remain untouched
 *     4. Gold-scorer can then re-score from the new Silver rows
 */

import * as crypto from 'crypto';
import { query } from '../../../core/database/connection';
import { assertTenantIsolation } from '../../api/middleware/assert-tenant-isolation';
import { BronzeRow } from './bronze-extractor';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export const PARSER_VERSION = '1.0';
export const NORMALIZATION_VERSION = '1.0';

export interface SilverRow {
  id: string;
  tenant_id: string;
  bronze_id: string;
  index_name: string;
  sourcetype: string | null;
  event_count: number | null;
  distinct_hosts: number | null;
  parsing_error_rate: number | null;
  field_coverage_pct: number | null;
  time_span_days: number | null;
  normalized_fields: Record<string, unknown> | null;
  parser_version: string;
  normalization_version: string;
  normalized_at: string;
  pipeline_run_id: string | null;
}

export interface NormalizeOptions {
  parserVersion?: string;
  normalizationVersion?: string;
  pipelineRunId?: string;
}

export interface SilverNormalizationResult {
  inserted: number;
  skipped: number;
  rows: SilverRow[];
  pipeline_run_id: string;
  parser_version: string;
}

// ─────────────────────────────────────────────
// Field extraction helpers
// ─────────────────────────────────────────────

/**
 * Extract normalized fields from a raw Splunk Bronze payload.
 * This is the canonical field mapping — version-locked for replay.
 */
function extractNormalizedFields(
  raw: Record<string, unknown>
): {
  event_count: number | null;
  distinct_hosts: number | null;
  parsing_error_rate: number | null;
  field_coverage_pct: number | null;
  time_span_days: number | null;
  normalized_fields: Record<string, unknown>;
} {
  // Support multiple Splunk response shapes:
  // Shape A: { event_count, total_event_count, currentDBSizeMB, ... }  (aggregation result)
  // Shape B: { results: [...], fields: [...] }                          (search result)
  // Shape C: { _raw, host, source, sourcetype, ... }                    (raw event)

  const eventCount = extractNumeric(raw, [
    'event_count', 'total_event_count', 'count', 'eventCount', 'totalCount'
  ]);

  const distinctHosts = extractNumeric(raw, [
    'distinct_hosts', 'distinctHosts', 'host_count', 'hostCount'
  ]);

  const parsingErrorRate = extractNumeric(raw, [
    'parsing_error_rate', 'parsingErrorRate', 'error_rate', 'errorRate'
  ]);

  const fieldCoveragePct = extractNumeric(raw, [
    'field_coverage_pct', 'fieldCoveragePct', 'coverage_pct', 'coveragePct'
  ]);

  const timeSpanDays = extractNumeric(raw, [
    'time_span_days', 'timeSpanDays', 'span_days', 'spanDays'
  ]);

  // Build canonical normalized fields map (exclude large arrays, raw _raw field)
  const normalized: Record<string, unknown> = {};
  const EXCLUDED_KEYS = new Set(['_raw', 'results', '_serial', '_cd', 'splunk_server']);

  for (const [key, value] of Object.entries(raw)) {
    if (EXCLUDED_KEYS.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = value;
    }
  }

  return {
    event_count: eventCount,
    distinct_hosts: distinctHosts,
    parsing_error_rate: parsingErrorRate !== null
      ? Math.max(0, Math.min(100, parsingErrorRate))
      : null,
    field_coverage_pct: fieldCoveragePct !== null
      ? Math.max(0, Math.min(100, fieldCoveragePct))
      : null,
    time_span_days: timeSpanDays,
    normalized_fields: normalized
  };
}

function extractNumeric(
  obj: Record<string, unknown>,
  keys: string[]
): number | null {
  for (const key of keys) {
    const val = obj[key];
    if (val !== undefined && val !== null) {
      const n = Number(val);
      if (!isNaN(n)) return n;
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// Write
// ─────────────────────────────────────────────

/**
 * Normalize a single Bronze row into a Silver row.
 * Idempotent: duplicate (bronze_id + parser_version) inserts are silently skipped.
 */
export async function normalizeBronzeRow(
  bronzeRow: BronzeRow,
  opts: NormalizeOptions = {}
): Promise<SilverRow | null> {
  assertTenantIsolation(bronzeRow.tenant_id, 'silver-normalizer:normalizeBronzeRow');

  const parserVersion = opts.parserVersion ?? PARSER_VERSION;
  const normalizationVersion = opts.normalizationVersion ?? NORMALIZATION_VERSION;
  const pipelineRunId = opts.pipelineRunId ?? null;

  const extracted = extractNormalizedFields(
    typeof bronzeRow.raw_payload === 'string'
      ? JSON.parse(bronzeRow.raw_payload)
      : bronzeRow.raw_payload
  );

  const id = generateSilverId(bronzeRow.id, parserVersion);
  const now = new Date().toISOString();

  const result = await query<SilverRow>(
    `INSERT INTO silver_normalized_telemetry
       (id, tenant_id, bronze_id, index_name, sourcetype,
        event_count, distinct_hosts, parsing_error_rate, field_coverage_pct,
        time_span_days, normalized_fields, parser_version, normalization_version,
        normalized_at, pipeline_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, tenant_id, bronze_id, index_name, sourcetype,
               event_count, distinct_hosts, parsing_error_rate, field_coverage_pct,
               time_span_days, normalized_fields, parser_version, normalization_version,
               normalized_at::TEXT, pipeline_run_id`,
    [
      id,
      bronzeRow.tenant_id,
      bronzeRow.id,
      bronzeRow.index_name,
      bronzeRow.sourcetype ?? null,
      extracted.event_count,
      extracted.distinct_hosts,
      extracted.parsing_error_rate,
      extracted.field_coverage_pct,
      extracted.time_span_days,
      JSON.stringify(extracted.normalized_fields),
      parserVersion,
      normalizationVersion,
      now,
      pipelineRunId
    ]
  );

  if (result.rows.length === 0) return null; // ON CONFLICT
  return result.rows[0];
}

/**
 * Normalize a batch of Bronze rows into Silver.
 * Processes in parallel. Returns summary of inserted vs skipped.
 */
export async function normalizeBatch(
  bronzeRows: BronzeRow[],
  opts: NormalizeOptions = {}
): Promise<SilverNormalizationResult> {
  if (bronzeRows.length === 0) {
    return {
      inserted: 0,
      skipped: 0,
      rows: [],
      pipeline_run_id: opts.pipelineRunId ?? '',
      parser_version: opts.parserVersion ?? PARSER_VERSION
    };
  }

  const runId = opts.pipelineRunId ?? `silver-run-${crypto.randomBytes(8).toString('hex')}`;
  const parserVersion = opts.parserVersion ?? PARSER_VERSION;
  const inserted: SilverRow[] = [];
  let skipped = 0;

  const results = await Promise.all(
    bronzeRows.map(row =>
      normalizeBronzeRow(row, { ...opts, pipelineRunId: runId })
        .catch(err => {
          console.warn('[SILVER_NORMALIZE_FAILED]', {
            bronze_id: row.id,
            index_name: row.index_name,
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString()
          });
          return null;
        })
    )
  );

  for (const row of results) {
    if (row) {
      inserted.push(row);
    } else {
      skipped++;
    }
  }

  console.log('[SILVER_BATCH_NORMALIZED]', {
    pipeline_run_id: runId,
    parser_version: parserVersion,
    inserted: inserted.length,
    skipped,
    total: bronzeRows.length,
    timestamp: new Date().toISOString()
  });

  return {
    inserted: inserted.length,
    skipped,
    rows: inserted,
    pipeline_run_id: runId,
    parser_version: parserVersion
  };
}

// ─────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────

/**
 * Get unscored Silver rows (no Gold row yet for this silver_id + scoring_version).
 */
export async function getUnscoredSilverRows(
  tenantId: string,
  opts: {
    scoringVersion?: string;
    parserVersion?: string;
    limit?: number;
    since?: string;
  } = {}
): Promise<SilverRow[]> {
  assertTenantIsolation(tenantId, 'silver-normalizer:getUnscoredSilverRows');

  const scoringVersion = opts.scoringVersion ?? '1.0';
  const parserVersion = opts.parserVersion ?? PARSER_VERSION;
  const limit = opts.limit ?? 500;

  const extraConditions: string[] = [];
  const params: unknown[] = [tenantId, parserVersion, scoringVersion, limit];
  let paramIdx = 5;

  if (opts.since) {
    extraConditions.push(`AND s.normalized_at > $${paramIdx}`);
    params.splice(paramIdx - 1, 0, opts.since);
    paramIdx++;
  }

  const result = await query<SilverRow>(
    `SELECT s.id, s.tenant_id, s.bronze_id, s.index_name, s.sourcetype,
            s.event_count, s.distinct_hosts, s.parsing_error_rate, s.field_coverage_pct,
            s.time_span_days, s.normalized_fields, s.parser_version, s.normalization_version,
            s.normalized_at::TEXT, s.pipeline_run_id
     FROM silver_normalized_telemetry s
     WHERE s.tenant_id = $1
       AND s.parser_version = $2
       ${extraConditions.join(' ')}
       AND NOT EXISTS (
         SELECT 1 FROM gold_telemetry_snapshots g
         WHERE g.silver_id = s.id
           AND g.scoring_version = $3
       )
     ORDER BY s.normalized_at ASC
     LIMIT $4`,
    params
  );

  return result.rows;
}

/**
 * Get a Silver row by its Bronze ID and parser version.
 */
export async function getSilverRowByBronzeId(
  tenantId: string,
  bronzeId: string,
  parserVersion = PARSER_VERSION
): Promise<SilverRow | null> {
  assertTenantIsolation(tenantId, 'silver-normalizer:getSilverRowByBronzeId');

  const result = await query<SilverRow>(
    `SELECT id, tenant_id, bronze_id, index_name, sourcetype,
            event_count, distinct_hosts, parsing_error_rate, field_coverage_pct,
            time_span_days, normalized_fields, parser_version, normalization_version,
            normalized_at::TEXT, pipeline_run_id
     FROM silver_normalized_telemetry
     WHERE tenant_id = $1 AND bronze_id = $2 AND parser_version = $3`,
    [tenantId, bronzeId, parserVersion]
  );

  return result.rows[0] ?? null;
}

// ─────────────────────────────────────────────
// ID generation
// ─────────────────────────────────────────────

/**
 * Deterministic Silver row ID.
 * Same bronze_id + parser_version → same Silver ID (idempotent insert guarantee).
 */
function generateSilverId(bronzeId: string, parserVersion: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${bronzeId}:${parserVersion}`)
    .digest('hex')
    .substring(0, 24);

  return `silver-${hash}`;
}
