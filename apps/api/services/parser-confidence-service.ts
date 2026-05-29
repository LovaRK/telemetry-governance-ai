/**
 * Parser Confidence Service — Phase 9
 *
 * Audits SPL queries for field resolution quality:
 *   1. Parse the SPL to extract referenced field names
 *   2. Look up each field in parser_spl_field_registry to determine if it's known
 *   3. Assign per-field resolution status and compute an aggregate confidence score
 *   4. Persist to parser_confidence_audit (APPEND-ONLY, tenant-isolated)
 *
 * Confidence scoring formula:
 *   confidence = resolved_count / total_count
 *   where "resolved" = field appears in CIM registry OR matches a known eval/tstats pattern
 *
 * Data Quality SLO:
 *   confidence < 0.5  → 'low_confidence' — triggers WARN or ALERT per SLO config
 *   confidence < 0.7  → 'moderate_confidence'
 *   confidence >= 0.7 → 'high_confidence'
 */

import * as crypto from 'crypto';
import { query } from '../../../core/database/connection';
import { assertTenantIsolation } from '../middleware/assert-tenant-isolation';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const PARSER_CONFIDENCE_VERSION = '1.0';

export const CONFIDENCE_THRESHOLDS = {
  LOW:      0.5,   // below this → SLO WARN
  MODERATE: 0.7,   // below this → mild concern
  HIGH:     0.9,   // above this → healthy
} as const;

// SPL keywords and functions that are not "user fields" — skip resolution for these
const SPL_BUILTINS = new Set([
  // Evaluation functions
  'if', 'case', 'coalesce', 'isnull', 'isnotnull', 'nullif', 'len', 'lower', 'upper',
  'substr', 'trim', 'ltrim', 'rtrim', 'replace', 'split', 'mvindex', 'mvcount',
  'mvjoin', 'mvsort', 'tonumber', 'tostring', 'typeof', 'cidrmatch',
  // Statistical functions
  'sum', 'count', 'avg', 'min', 'max', 'stdev', 'var', 'dc', 'values', 'list',
  'first', 'last', 'range', 'mode', 'median', 'perc', 'earliest', 'latest',
  // SPL commands (appear as field names in tstats BY clauses but aren't fields)
  'tstats', 'stats', 'eval', 'where', 'search', 'table', 'head', 'tail',
  'sort', 'dedup', 'rename', 'rex', 'lookup', 'join', 'append', 'union',
  'timechart', 'chart', 'bin', 'bucket', 'transaction', 'multikv', 'fields',
  // Pseudo-fields
  '_raw', '_key', '_serial', '_subsecond', '_indextime', '_cd',
  // Time args (earliest/latest appear in search strings)
  'now', 'relative_time',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedField {
  name: string;
  type: string;          // 'string' | 'number' | 'ip' | 'timestamp' | 'json' | 'unknown'
  resolved: boolean;     // found in registry or known pattern
  confidence: number;    // per-field confidence 0.0–1.0
  source: 'registry' | 'pattern_match' | 'cim' | 'unresolved';
}

export interface UnresolvedField {
  name: string;
  reason: string;
  raw_token: string;
}

export interface ConfidenceAuditRecord {
  id: string;
  tenant_id: string;
  silver_id?: string;
  spl_query: string;
  parsed_fields: ParsedField[];
  unresolved_fields: UnresolvedField[];
  confidence_score: number;
  parser_version: string;
  unresolved_reason: string | null;
  index_name: string | null;
  created_at: string;
}

export interface AuditOptions {
  silverId?: string;
  indexName?: string;
  sourcetype?: string;
  parserVersion?: string;
}

export type ConfidenceBand = 'high_confidence' | 'moderate_confidence' | 'low_confidence';

export interface AuditResult {
  auditId: string;
  confidence_score: number;
  confidence_band: ConfidenceBand;
  parsed_fields: ParsedField[];
  unresolved_fields: UnresolvedField[];
  unresolved_reason: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPL Field Extraction (deterministic, no LLM)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract field names referenced in SPL.
 * Handles the most common patterns:
 *   - tstats BY field1, field2
 *   - stats ... BY field
 *   - eval newfield = expr
 *   - where field = value
 *   - rex field=_raw "(?<fieldname>...)"
 *   - rename oldfield AS newfield
 *   - index=X sourcetype=Y field=value (search filter)
 */
export function extractSplFields(spl: string): string[] {
  const fields = new Set<string>();

  // Normalise whitespace
  const s = spl.replace(/\s+/g, ' ').trim();

  // Pattern 1: BY clause (tstats, stats, timechart, chart)
  // "BY field1, field2, field3"
  const byMatches = s.matchAll(/\bBY\s+((?:[a-zA-Z_][a-zA-Z0-9_.]*\s*,\s*)*[a-zA-Z_][a-zA-Z0-9_.]*)/gi);
  for (const m of byMatches) {
    for (const f of m[1].split(/\s*,\s*/)) {
      const clean = f.trim();
      if (clean) fields.add(clean);
    }
  }

  // Pattern 2: eval assignment "eval fieldname = ..."
  const evalMatches = s.matchAll(/\beval\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s*=/gi);
  for (const m of evalMatches) fields.add(m[1].trim());

  // Pattern 3: rename "oldfield AS newfield"
  const renameMatches = s.matchAll(/\brename\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s+[Aa][Ss]\s+([a-zA-Z_][a-zA-Z0-9_.]*)/g);
  for (const m of renameMatches) {
    fields.add(m[1].trim());
    fields.add(m[2].trim());
  }

  // Pattern 4: rex named capture groups  "(?<fieldname>...)"
  const rexMatches = s.matchAll(/\(\?<([a-zA-Z_][a-zA-Z0-9_]*)>/g);
  for (const m of rexMatches) fields.add(m[1]);

  // Pattern 5: search filter conditions  "field=value" or "field!=value"
  const filterMatches = s.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_.]*)\s*[!=><]+\s*["']?[^"'\s,|)]+/g);
  for (const m of filterMatches) {
    const f = m[1].trim();
    // Skip Splunk metadata fields that aren't "data" fields
    if (!['index', 'sourcetype', 'source', 'host', 'splunk_server'].includes(f.toLowerCase())) {
      fields.add(f);
    }
  }

  // Pattern 6: WHERE clause fields
  const whereMatches = s.matchAll(/\bwhere\s+([a-zA-Z_][a-zA-Z0-9_.]*)\b/gi);
  for (const m of whereMatches) fields.add(m[1].trim());

  // Pattern 7: table / fields command "| table f1 f2 f3" or "| fields f1, f2"
  const tableMatches = s.matchAll(/\|\s*(?:table|fields)\s+((?:[a-zA-Z_][a-zA-Z0-9_.\s,]*)+)/gi);
  for (const m of tableMatches) {
    for (const f of m[1].split(/[\s,]+/)) {
      const clean = f.trim();
      if (clean) fields.add(clean);
    }
  }

  // Remove SPL builtins, operators, and very short tokens
  return Array.from(fields).filter(f =>
    f.length >= 2 &&
    !SPL_BUILTINS.has(f.toLowerCase()) &&
    !/^\d+$/.test(f) &&   // pure numbers
    !/^-/.test(f)          // negative numbers / flags
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Field Registry Lookup (cached per request)
// ─────────────────────────────────────────────────────────────────────────────

interface RegistryEntry {
  field_name: string;
  expected_type: string;
  is_cim_field: boolean;
}

// Module-level 5-minute cache (avoids hammering DB for every SPL audit)
let _registryCache: Map<string, RegistryEntry> | null = null;
let _registryCacheAt = 0;
const REGISTRY_CACHE_TTL_MS = 5 * 60 * 1000;

async function getFieldRegistry(): Promise<Map<string, RegistryEntry>> {
  const now = Date.now();
  if (_registryCache && now - _registryCacheAt < REGISTRY_CACHE_TTL_MS) {
    return _registryCache;
  }

  const res = await query(
    `SELECT field_name, expected_type, is_cim_field
     FROM parser_spl_field_registry
     ORDER BY sourcetype, field_name`,
  );

  const map = new Map<string, RegistryEntry>();
  for (const row of res.rows) {
    // key = field_name (lowercased for case-insensitive lookup)
    const key = (row.field_name as string).toLowerCase();
    // CIM fields take precedence — insert only if not already present
    if (!map.has(key) || row.is_cim_field) {
      map.set(key, {
        field_name: row.field_name,
        expected_type: row.expected_type,
        is_cim_field: row.is_cim_field,
      });
    }
  }

  _registryCache   = map;
  _registryCacheAt = now;
  return map;
}

export function _clearRegistryCache(): void {
  _registryCache   = null;
  _registryCacheAt = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Known field name patterns (heuristic resolution when not in registry)
// ─────────────────────────────────────────────────────────────────────────────

function resolveByPattern(fieldName: string): { resolved: boolean; type: string; confidence: number } {
  const f = fieldName.toLowerCase();

  // IP address fields
  if (/^(src|dest|source|destination|remote|local|client|server)_(ip|addr|address)$/.test(f) ||
      /^(ip_address|ipaddress|client_ip|server_ip)$/.test(f)) {
    return { resolved: true, type: 'ip', confidence: 0.85 };
  }

  // Port fields
  if (/^(src|dest|source|destination|remote|local)_port$/.test(f) || f === 'port') {
    return { resolved: true, type: 'number', confidence: 0.85 };
  }

  // Byte count fields
  if (/^(bytes|bytes_in|bytes_out|bytes_sent|bytes_received|recv_bytes|sent_bytes)$/.test(f)) {
    return { resolved: true, type: 'number', confidence: 0.85 };
  }

  // Timestamp fields
  if (/^(timestamp|event_time|log_time|start_time|end_time|creation_time)$/.test(f)) {
    return { resolved: true, type: 'timestamp', confidence: 0.8 };
  }

  // User / identity fields
  if (/^(user|username|user_name|account|account_name|actor|actor_id)$/.test(f)) {
    return { resolved: true, type: 'string', confidence: 0.8 };
  }

  // Status / result fields
  if (/^(status|result|outcome|response_code|http_status)$/.test(f)) {
    return { resolved: true, type: 'string', confidence: 0.75 };
  }

  // Count / metric fields
  if (/^(count|total|num_|count_|avg_|sum_|max_|min_)/.test(f) || f.endsWith('_count') || f.endsWith('_total')) {
    return { resolved: true, type: 'number', confidence: 0.75 };
  }

  // tstats-style prefixed fields "count AS event_count"
  if (f.startsWith('event_') || f.startsWith('source_') || f.startsWith('dest_')) {
    return { resolved: true, type: 'string', confidence: 0.7 };
  }

  return { resolved: false, type: 'unknown', confidence: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: Audit a single SPL query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Audit one SPL query for parser confidence.
 * Returns an AuditResult with confidence score + persists to parser_confidence_audit.
 */
export async function auditSplQuery(
  tenantId: string,
  splQuery: string,
  opts: AuditOptions = {},
): Promise<AuditResult> {
  assertTenantIsolation(tenantId, 'auditSplQuery');

  const parserVersion = opts.parserVersion ?? PARSER_CONFIDENCE_VERSION;
  const fieldNames    = extractSplFields(splQuery);

  const registry = await getFieldRegistry();

  const parsedFields:     ParsedField[]     = [];
  const unresolvedFields: UnresolvedField[] = [];

  for (const fieldName of fieldNames) {
    const key      = fieldName.toLowerCase();
    const regEntry = registry.get(key);

    if (regEntry) {
      // Resolved via registry
      parsedFields.push({
        name:       fieldName,
        type:       regEntry.expected_type,
        resolved:   true,
        confidence: regEntry.is_cim_field ? 1.0 : 0.9,
        source:     regEntry.is_cim_field ? 'cim' : 'registry',
      });
    } else {
      // Try heuristic pattern matching
      const patternResult = resolveByPattern(fieldName);
      if (patternResult.resolved) {
        parsedFields.push({
          name:       fieldName,
          type:       patternResult.type,
          resolved:   true,
          confidence: patternResult.confidence,
          source:     'pattern_match',
        });
      } else {
        // Unresolved
        parsedFields.push({
          name:       fieldName,
          type:       'unknown',
          resolved:   false,
          confidence: 0,
          source:     'unresolved',
        });
        unresolvedFields.push({
          name:       fieldName,
          reason:     'Field not found in CIM registry or known patterns',
          raw_token:  fieldName,
        });
      }
    }
  }

  // Confidence = weighted average (CIM fields weight 1.0, pattern 0.85, unresolved 0.0)
  const confidenceScore = fieldNames.length === 0
    ? 1.0   // no extractable fields = treat as high confidence (may be a simple search)
    : parsedFields.reduce((s, f) => s + f.confidence, 0) / parsedFields.length;

  // Build human-readable unresolved reason
  let unresolvedReason: string | null = null;
  if (unresolvedFields.length > 0) {
    const topUnresolved = unresolvedFields.slice(0, 5).map(f => f.name).join(', ');
    unresolvedReason = `${unresolvedFields.length} field(s) could not be resolved: ${topUnresolved}${unresolvedFields.length > 5 ? ` (+ ${unresolvedFields.length - 5} more)` : ''}`;
  }

  // Deterministic ID: SHA256(tenantId:spl:parserVersion).substring(0,24)
  const idHash = crypto
    .createHash('sha256')
    .update(`${tenantId}:${splQuery}:${parserVersion}:${Date.now()}`)
    .digest('hex')
    .substring(0, 24);
  const auditId = `pca-${idHash}`;

  // Persist (fire-and-forget on audit path; non-blocking)
  void persistAuditRecord({
    id:                auditId,
    tenant_id:         tenantId,
    silver_id:         opts.silverId ?? null,
    spl_query:         splQuery,
    parsed_fields:     parsedFields,
    unresolved_fields: unresolvedFields,
    confidence_score:  confidenceScore,
    parser_version:    parserVersion,
    unresolved_reason: unresolvedReason,
    index_name:        opts.indexName ?? null,
  });

  return {
    auditId,
    confidence_score:  confidenceScore,
    confidence_band:   classifyConfidence(confidenceScore),
    parsed_fields:     parsedFields,
    unresolved_fields: unresolvedFields,
    unresolved_reason: unresolvedReason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch audit
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchAuditResult {
  results:       Map<string, AuditResult>;   // spl → result
  avg_confidence: number;
  low_confidence_count: number;
  total_audited:  number;
}

/**
 * Audit multiple SPL queries (e.g., all saved searches for a tenant run).
 * Sequential — does not overwhelm DB with parallel writes.
 */
export async function auditSplBatch(
  tenantId: string,
  splQueries: { spl: string; indexName?: string; silverId?: string }[],
  opts: Omit<AuditOptions, 'silverId' | 'indexName'> = {},
): Promise<BatchAuditResult> {
  assertTenantIsolation(tenantId, 'auditSplBatch');

  const results = new Map<string, AuditResult>();
  let totalConfidence = 0;
  let lowConfidenceCount = 0;

  for (const item of splQueries) {
    const result = await auditSplQuery(tenantId, item.spl, {
      ...opts,
      indexName: item.indexName,
      silverId:  item.silverId,
    });
    results.set(item.spl, result);
    totalConfidence += result.confidence_score;
    if (result.confidence_score < CONFIDENCE_THRESHOLDS.LOW) {
      lowConfidenceCount++;
    }
  }

  return {
    results,
    avg_confidence:       splQueries.length > 0 ? totalConfidence / splQueries.length : 1.0,
    low_confidence_count: lowConfidenceCount,
    total_audited:        splQueries.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/** Retrieve most recent audit records for a tenant (optionally filtered by index). */
export async function getRecentAuditRecords(
  tenantId: string,
  opts: {
    indexName?: string;
    limit?: number;
    minCreatedAt?: Date;
    lowConfidenceOnly?: boolean;
  } = {},
): Promise<ConfidenceAuditRecord[]> {
  assertTenantIsolation(tenantId, 'getRecentAuditRecords');

  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (opts.indexName) {
    conditions.push(`index_name = $${idx++}`);
    params.push(opts.indexName);
  }
  if (opts.minCreatedAt) {
    conditions.push(`created_at >= $${idx++}`);
    params.push(opts.minCreatedAt.toISOString());
  }
  if (opts.lowConfidenceOnly) {
    conditions.push(`confidence_score < $${idx++}`);
    params.push(CONFIDENCE_THRESHOLDS.LOW);
  }

  const limit = Math.min(opts.limit ?? 50, 500);
  const sql = `
    SELECT id, tenant_id, silver_id, spl_query, parsed_fields,
           unresolved_fields, confidence_score, parser_version,
           unresolved_reason, index_name, created_at
    FROM   parser_confidence_audit
    WHERE  ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT  ${limit}
  `;

  const res = await query(sql, params);
  return res.rows as ConfidenceAuditRecord[];
}

/** Aggregate confidence stats per index for a tenant — used by Data Quality SLO dashboard. */
export async function getConfidenceSummaryByIndex(
  tenantId: string,
  lookbackDays = 7,
): Promise<{ index_name: string; avg_confidence: number; low_confidence_runs: number; total_runs: number }[]> {
  assertTenantIsolation(tenantId, 'getConfidenceSummaryByIndex');

  const res = await query(
    `SELECT
       index_name,
       AVG(confidence_score)                                          AS avg_confidence,
       COUNT(*) FILTER (WHERE confidence_score < $2)                 AS low_confidence_runs,
       COUNT(*)                                                       AS total_runs
     FROM   parser_confidence_audit
     WHERE  tenant_id = $1
       AND  index_name IS NOT NULL
       AND  created_at >= NOW() - ($3::int || ' days')::INTERVAL
     GROUP BY index_name
     ORDER BY avg_confidence ASC`,
    [tenantId, CONFIDENCE_THRESHOLDS.LOW, lookbackDays],
  );

  return res.rows.map(r => ({
    index_name:           r.index_name as string,
    avg_confidence:       parseFloat(r.avg_confidence),
    low_confidence_runs:  parseInt(r.low_confidence_runs, 10),
    total_runs:           parseInt(r.total_runs, 10),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal persistence
// ─────────────────────────────────────────────────────────────────────────────

async function persistAuditRecord(record: {
  id: string;
  tenant_id: string;
  silver_id: string | null;
  spl_query: string;
  parsed_fields: ParsedField[];
  unresolved_fields: UnresolvedField[];
  confidence_score: number;
  parser_version: string;
  unresolved_reason: string | null;
  index_name: string | null;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO parser_confidence_audit
         (id, tenant_id, silver_id, spl_query, parsed_fields, unresolved_fields,
          confidence_score, parser_version, unresolved_reason, index_name)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [
        record.id,
        record.tenant_id,
        record.silver_id,
        record.spl_query,
        JSON.stringify(record.parsed_fields),
        JSON.stringify(record.unresolved_fields),
        record.confidence_score,
        record.parser_version,
        record.unresolved_reason,
        record.index_name,
      ],
    );
  } catch (err) {
    // Audit persistence must never throw into the governance hot path
    console.error('[ParserConfidenceService] Failed to persist audit record:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function classifyConfidence(score: number): ConfidenceBand {
  if (score >= CONFIDENCE_THRESHOLDS.MODERATE) return 'high_confidence';
  if (score >= CONFIDENCE_THRESHOLDS.LOW)      return 'moderate_confidence';
  return 'low_confidence';
}

/** Register a custom field in the DB registry (runtime extension). */
export async function registerCustomField(
  sourcetype: string,
  fieldName: string,
  expectedType: string,
  description?: string,
): Promise<void> {
  const id = `psfr-custom-${crypto.createHash('sha256').update(`${sourcetype}:${fieldName}`).digest('hex').substring(0, 12)}`;
  await query(
    `INSERT INTO parser_spl_field_registry
       (id, sourcetype, field_name, expected_type, is_cim_field, description)
     VALUES ($1, $2, $3, $4, false, $5)
     ON CONFLICT (sourcetype, field_name) DO UPDATE
       SET expected_type = EXCLUDED.expected_type,
           description   = COALESCE(EXCLUDED.description, parser_spl_field_registry.description)`,
    [id, sourcetype, fieldName, expectedType, description ?? null],
  );
  // Invalidate cache so next audit picks up the new field
  _clearRegistryCache();
}
