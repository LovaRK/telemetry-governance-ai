/**
 * Bronze Extractor
 *
 * Writes immutable Bronze rows from raw Splunk MCP responses.
 * Bronze is the FIRST layer of the medallion architecture.
 *
 * CRITICAL INVARIANTS:
 * - Bronze rows are NEVER updated or deleted after insert (ON CONFLICT DO NOTHING)
 * - raw_payload stores the Splunk response exactly as received — no transformation
 * - Every row is tenant-scoped
 * - Extraction version is stamped for future Bronze-level replay
 *
 * Lineage:
 *   Splunk SID job → Bronze (raw_payload) → Silver (normalized) → Gold (scored)
 */

import * as crypto from 'crypto';
import { query } from '../../../core/database/connection';
import { assertTenantIsolation } from '../../api/middleware/assert-tenant-isolation';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export const EXTRACTION_VERSION = '1.0';

export interface BronzeRow {
  id: string;
  tenant_id: string;
  sid: string | null;
  index_name: string;
  sourcetype: string | null;
  raw_payload: Record<string, unknown>;
  extracted_at: string;
  extraction_version: string;
  pipeline_run_id: string | null;
}

export interface ExtractBronzeInput {
  tenant_id: string;
  sid?: string;
  index_name: string;
  sourcetype?: string;
  raw_payload: Record<string, unknown>;
  pipeline_run_id?: string;
}

export interface BronzeExtractionResult {
  inserted: number;
  skipped: number;   // ON CONFLICT (already exists — idempotent)
  rows: BronzeRow[];
  pipeline_run_id: string;
}

// ─────────────────────────────────────────────
// Write
// ─────────────────────────────────────────────

/**
 * Persist a single Splunk result as an immutable Bronze row.
 * Idempotent: duplicate inserts are silently skipped (ON CONFLICT DO NOTHING).
 *
 * @param input  Extraction input
 * @returns      The inserted (or skipped) Bronze row
 */
export async function extractBronzeRow(input: ExtractBronzeInput): Promise<BronzeRow | null> {
  assertTenantIsolation(input.tenant_id, 'bronze-extractor:extractBronzeRow');

  const id = generateBronzeId(input);
  const now = new Date().toISOString();

  const result = await query<BronzeRow>(
    `INSERT INTO bronze_splunk_events
       (id, tenant_id, sid, index_name, sourcetype, raw_payload,
        extracted_at, extraction_version, pipeline_run_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, tenant_id, sid, index_name, sourcetype,
               raw_payload, extracted_at::TEXT, extraction_version, pipeline_run_id`,
    [
      id,
      input.tenant_id,
      input.sid ?? null,
      input.index_name,
      input.sourcetype ?? null,
      JSON.stringify(input.raw_payload),
      now,
      EXTRACTION_VERSION,
      input.pipeline_run_id ?? null
    ]
  );

  if (result.rows.length === 0) {
    // ON CONFLICT — row already exists, not an error
    return null;
  }

  return result.rows[0];
}

/**
 * Batch-extract multiple Splunk results as Bronze rows.
 * Each row is inserted independently (ON CONFLICT DO NOTHING for idempotency).
 * Returns a summary of inserted vs skipped rows.
 */
export async function extractBronzeBatch(
  inputs: ExtractBronzeInput[],
  pipelineRunId?: string
): Promise<BronzeExtractionResult> {
  if (inputs.length === 0) {
    return { inserted: 0, skipped: 0, rows: [], pipeline_run_id: pipelineRunId ?? '' };
  }

  const runId = pipelineRunId ?? `bronze-run-${crypto.randomBytes(8).toString('hex')}`;
  const inserted: BronzeRow[] = [];
  let skipped = 0;

  // Insert in parallel (each insert is independent and idempotent)
  const results = await Promise.all(
    inputs.map(input =>
      extractBronzeRow({ ...input, pipeline_run_id: runId })
        .catch(err => {
          console.warn('[BRONZE_INSERT_FAILED]', {
            index_name: input.index_name,
            tenant_id: input.tenant_id,
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

  console.log('[BRONZE_BATCH_EXTRACTED]', {
    pipeline_run_id: runId,
    inserted: inserted.length,
    skipped,
    total: inputs.length,
    timestamp: new Date().toISOString()
  });

  return {
    inserted: inserted.length,
    skipped,
    rows: inserted,
    pipeline_run_id: runId
  };
}

// ─────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────

/**
 * Get unprocessed Bronze rows for a given tenant + optional pipeline run.
 * "Unprocessed" = no Silver row yet with the given parser_version.
 */
export async function getUnprocessedBronzeRows(
  tenantId: string,
  opts: {
    parserVersion?: string;
    limit?: number;
    pipeline_run_id?: string;
    since?: string;   // ISO timestamp — only rows extracted after this time
  } = {}
): Promise<BronzeRow[]> {
  assertTenantIsolation(tenantId, 'bronze-extractor:getUnprocessedBronzeRows');

  const parserVersion = opts.parserVersion ?? '1.0';
  const limit = opts.limit ?? 500;

  const conditions: string[] = ['b.tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramIdx = 2;

  if (opts.since) {
    conditions.push(`b.extracted_at > $${paramIdx}`);
    params.push(opts.since);
    paramIdx++;
  }

  if (opts.pipeline_run_id) {
    conditions.push(`b.pipeline_run_id = $${paramIdx}`);
    params.push(opts.pipeline_run_id);
    paramIdx++;
  }

  const where = conditions.join(' AND ');

  const result = await query<BronzeRow>(
    `SELECT b.id, b.tenant_id, b.sid, b.index_name, b.sourcetype,
            b.raw_payload, b.extracted_at::TEXT, b.extraction_version, b.pipeline_run_id
     FROM bronze_splunk_events b
     WHERE ${where}
       AND NOT EXISTS (
         SELECT 1 FROM silver_normalized_telemetry s
         WHERE s.bronze_id = b.id
           AND s.parser_version = $${paramIdx}
       )
     ORDER BY b.extracted_at ASC
     LIMIT $${paramIdx + 1}`,
    [...params, parserVersion, limit]
  );

  return result.rows;
}

/**
 * Get Bronze rows by SID (for re-processing a specific Splunk job).
 */
export async function getBronzeRowsBySid(
  tenantId: string,
  sid: string
): Promise<BronzeRow[]> {
  assertTenantIsolation(tenantId, 'bronze-extractor:getBronzeRowsBySid');

  const result = await query<BronzeRow>(
    `SELECT id, tenant_id, sid, index_name, sourcetype,
            raw_payload, extracted_at::TEXT, extraction_version, pipeline_run_id
     FROM bronze_splunk_events
     WHERE tenant_id = $1 AND sid = $2
     ORDER BY extracted_at ASC`,
    [tenantId, sid]
  );

  return result.rows;
}

/**
 * Count Bronze rows for a tenant (for pipeline health metrics).
 */
export async function getBronzeRowCount(tenantId: string): Promise<number> {
  assertTenantIsolation(tenantId, 'bronze-extractor:getBronzeRowCount');

  const result = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM bronze_splunk_events WHERE tenant_id = $1`,
    [tenantId]
  );

  return parseInt(result.rows[0]?.count ?? '0', 10);
}

// ─────────────────────────────────────────────
// ID generation
// ─────────────────────────────────────────────

/**
 * Generate a deterministic Bronze row ID.
 * Same Splunk response → same ID (idempotent insert guarantee).
 * Based on: tenant_id + index_name + sourcetype + payload hash.
 */
function generateBronzeId(input: ExtractBronzeInput): string {
  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(input.raw_payload))
    .digest('hex')
    .substring(0, 16);

  const key = [
    input.tenant_id,
    input.index_name,
    input.sourcetype ?? 'unknown',
    payloadHash
  ].join(':');

  const id = crypto
    .createHash('sha256')
    .update(key)
    .digest('hex')
    .substring(0, 24);

  return `bronze-${id}`;
}
