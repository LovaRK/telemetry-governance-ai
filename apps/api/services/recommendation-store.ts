/**
 * Recommendation Store
 *
 * Persists deterministic recommendation candidates to the DB for:
 * - Operator review and approval workflows
 * - LLM enrichment queue (candidates awaiting explanation)
 * - Audit trail (reproducibility: same Gold snapshot → same candidates)
 * - Governance enforcement (REQUIRE_APPROVAL for high-savings actions)
 *
 * CRITICAL: Candidates are generated deterministically from Gold data.
 * This store only handles persistence — it never mutates the candidates.
 *
 * Schema note: uses `recommendation_candidates` table (separate from the
 * legacy `decision_history` table to avoid mixing deterministic candidates
 * with LLM-enriched decisions).
 */

import * as crypto from 'crypto';
import { query } from '../../../core/database/connection';
import { assertTenantIsolation } from '../../api/middleware/assert-tenant-isolation';
import {
  RecommendationCandidate,
  RecommendationType,
  RecommendationPriority
} from './deterministic-recommendation-engine';

// ─────────────────────────────────────────────
// Schema (created by migration inline below)
// ─────────────────────────────────────────────

// CREATE TABLE IF NOT EXISTS recommendation_candidates (
//   id                   TEXT PRIMARY KEY,
//   tenant_id            TEXT NOT NULL,
//   type                 TEXT NOT NULL,
//   index_name           TEXT NOT NULL,
//   priority             TEXT NOT NULL,
//   savings_estimate     REAL NOT NULL DEFAULT 0,
//   deterministic_reason TEXT NOT NULL,
//   evidence             JSONB NOT NULL DEFAULT '[]',
//   gold_snapshot_id     TEXT NOT NULL,
//   scoring_version      TEXT NOT NULL DEFAULT '1.0',
//   composite_score      REAL NOT NULL,
//   tier                 TEXT NOT NULL,
//   llm_enriched         BOOLEAN NOT NULL DEFAULT false,
//   llm_explanation      TEXT,
//   llm_enriched_at      TIMESTAMPTZ,
//   state                TEXT NOT NULL DEFAULT 'pending',  -- pending | dismissed | approved | executed
//   created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
// );

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type CandidateState = 'pending' | 'dismissed' | 'approved' | 'executed';

export interface PersistedCandidate extends RecommendationCandidate {
  id: string;
  llm_enriched: boolean;
  llm_explanation: string | null;
  llm_enriched_at: string | null;
  state: CandidateState;
  created_at: string;
}

export interface StoreBatchResult {
  inserted: number;
  skipped: number;
  ids: string[];
}

// ─────────────────────────────────────────────
// Ensure table exists (idempotent DDL)
// ─────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS "recommendation_candidates" (
      "id"                   TEXT        NOT NULL PRIMARY KEY,
      "tenant_id"            TEXT        NOT NULL,
      "type"                 TEXT        NOT NULL,
      "index_name"           TEXT        NOT NULL,
      "priority"             TEXT        NOT NULL,
      "savings_estimate"     REAL        NOT NULL DEFAULT 0,
      "deterministic_reason" TEXT        NOT NULL,
      "evidence"             JSONB       NOT NULL DEFAULT '[]',
      "gold_snapshot_id"     TEXT        NOT NULL,
      "scoring_version"      TEXT        NOT NULL DEFAULT '1.0',
      "composite_score"      REAL        NOT NULL,
      "tier"                 TEXT        NOT NULL,
      "llm_enriched"         BOOLEAN     NOT NULL DEFAULT false,
      "llm_explanation"      TEXT,
      "llm_enriched_at"      TIMESTAMPTZ,
      "state"                TEXT        NOT NULL DEFAULT 'pending',
      "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "recommendation_candidates_type_check"
        CHECK ("type" IN ('reduce_retention','optimize_searches','decommission',
                          'upgrade_sourcetype','consolidate_index','increase_detection','archive_cold')),
      CONSTRAINT "recommendation_candidates_priority_check"
        CHECK ("priority" IN ('critical','high','medium','low')),
      CONSTRAINT "recommendation_candidates_state_check"
        CHECK ("state" IN ('pending','dismissed','approved','executed'))
    );
    CREATE INDEX IF NOT EXISTS "rec_candidates_tenant_idx"
      ON "recommendation_candidates" ("tenant_id", "state", "created_at" DESC);
    CREATE INDEX IF NOT EXISTS "rec_candidates_gold_idx"
      ON "recommendation_candidates" ("gold_snapshot_id");
    CREATE INDEX IF NOT EXISTS "rec_candidates_type_idx"
      ON "recommendation_candidates" ("tenant_id", "type", "priority");`
  );
  _tableEnsured = true;
}

// ─────────────────────────────────────────────
// Write
// ─────────────────────────────────────────────

/**
 * Persist a batch of deterministic recommendation candidates.
 * Idempotent: same gold_snapshot_id + type → ON CONFLICT DO NOTHING.
 */
export async function storeCandidates(
  candidates: RecommendationCandidate[]
): Promise<StoreBatchResult> {
  if (candidates.length === 0) return { inserted: 0, skipped: 0, ids: [] };

  await ensureTable();

  const insertedIds: string[] = [];
  let skipped = 0;

  for (const candidate of candidates) {
    assertTenantIsolation(candidate.tenant_id, 'recommendation-store:storeCandidates');

    const id = generateCandidateId(candidate);

    const result = await query<{ id: string }>(
      `INSERT INTO recommendation_candidates
         (id, tenant_id, type, index_name, priority, savings_estimate,
          deterministic_reason, evidence, gold_snapshot_id, scoring_version,
          composite_score, tier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [
        id,
        candidate.tenant_id,
        candidate.type,
        candidate.index_name,
        candidate.priority,
        candidate.savings_estimate,
        candidate.deterministic_reason,
        JSON.stringify(candidate.evidence),
        candidate.gold_snapshot_id,
        candidate.scoring_version,
        candidate.composite_score,
        candidate.tier
      ]
    ).catch(err => {
      console.warn('[RECOMMENDATION_STORE_INSERT_FAILED]', {
        id,
        index_name: candidate.index_name,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString()
      });
      return { rows: [] as { id: string }[] };
    });

    if (result.rows.length > 0) {
      insertedIds.push(id);
    } else {
      skipped++;
    }
  }

  return {
    inserted: insertedIds.length,
    skipped,
    ids: insertedIds
  };
}

/**
 * Attach LLM-generated enrichment to a candidate.
 * Called by the LLM enrichment layer after inference.
 */
export async function enrichCandidate(
  candidateId: string,
  explanation: string
): Promise<void> {
  await ensureTable();
  await query(
    `UPDATE recommendation_candidates
     SET llm_enriched = true,
         llm_explanation = $2,
         llm_enriched_at = NOW()
     WHERE id = $1`,
    [candidateId, explanation]
  );
}

/**
 * Update the state of a candidate (operator action).
 */
export async function updateCandidateState(
  candidateId: string,
  state: CandidateState,
  tenantId: string
): Promise<void> {
  assertTenantIsolation(tenantId, 'recommendation-store:updateCandidateState');
  await ensureTable();
  await query(
    `UPDATE recommendation_candidates
     SET state = $2
     WHERE id = $1 AND tenant_id = $3`,
    [candidateId, state, tenantId]
  );
}

// ─────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────

/**
 * Get pending (unenriched or unprocessed) candidates for a tenant.
 */
export async function getPendingCandidates(
  tenantId: string,
  opts: {
    type?: RecommendationType;
    priority?: RecommendationPriority;
    limit?: number;
    llm_enriched?: boolean;
  } = {}
): Promise<PersistedCandidate[]> {
  assertTenantIsolation(tenantId, 'recommendation-store:getPendingCandidates');
  await ensureTable();

  const conditions: string[] = ["tenant_id = $1", "state = 'pending'"];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (opts.type) {
    conditions.push(`type = $${idx}`);
    params.push(opts.type);
    idx++;
  }
  if (opts.priority) {
    conditions.push(`priority = $${idx}`);
    params.push(opts.priority);
    idx++;
  }
  if (opts.llm_enriched !== undefined) {
    conditions.push(`llm_enriched = $${idx}`);
    params.push(opts.llm_enriched);
    idx++;
  }

  const limit = opts.limit ?? 100;

  const result = await query<any>(
    `SELECT id, tenant_id, type, index_name, priority, savings_estimate,
            deterministic_reason, evidence, gold_snapshot_id, scoring_version,
            composite_score, tier, llm_enriched, llm_explanation,
            llm_enriched_at::TEXT, state, created_at::TEXT
     FROM recommendation_candidates
     WHERE ${conditions.join(' AND ')}
     ORDER BY
       CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       savings_estimate DESC
     LIMIT ${limit}`,
    params
  );

  return result.rows.map(mapRow);
}

/**
 * Get candidates that need LLM enrichment (pending, not yet enriched).
 */
export async function getUnenrichedCandidates(
  tenantId: string,
  limit = 20
): Promise<PersistedCandidate[]> {
  return getPendingCandidates(tenantId, { llm_enriched: false, limit });
}

/**
 * Count pending candidates for dashboard summary.
 */
export async function getCandidateSummary(tenantId: string): Promise<{
  total: number;
  by_priority: Record<RecommendationPriority, number>;
  by_type: Record<string, number>;
  total_savings_estimate: number;
}> {
  assertTenantIsolation(tenantId, 'recommendation-store:getCandidateSummary');
  await ensureTable();

  const result = await query<any>(
    `SELECT priority, type, COUNT(*) as count, SUM(savings_estimate) as savings
     FROM recommendation_candidates
     WHERE tenant_id = $1 AND state = 'pending'
     GROUP BY priority, type`,
    [tenantId]
  );

  const by_priority: Record<string, number> = {
    critical: 0, high: 0, medium: 0, low: 0
  };
  const by_type: Record<string, number> = {};
  let total = 0;
  let total_savings = 0;

  for (const row of result.rows) {
    const count = parseInt(row.count, 10);
    const savings = parseFloat(row.savings ?? '0');
    by_priority[row.priority] = (by_priority[row.priority] ?? 0) + count;
    by_type[row.type] = (by_type[row.type] ?? 0) + count;
    total += count;
    total_savings += savings;
  }

  return {
    total,
    by_priority: by_priority as Record<RecommendationPriority, number>,
    by_type,
    total_savings_estimate: Math.round(total_savings)
  };
}

// ─────────────────────────────────────────────
// ID generation
// ─────────────────────────────────────────────

/**
 * Deterministic candidate ID.
 * Same gold_snapshot_id + type → same ID (idempotent insert guarantee).
 */
function generateCandidateId(candidate: RecommendationCandidate): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${candidate.gold_snapshot_id}:${candidate.type}`)
    .digest('hex')
    .substring(0, 24);

  return `rec-${hash}`;
}

function mapRow(row: any): PersistedCandidate {
  return {
    id: row.id,
    type: row.type as RecommendationType,
    index_name: row.index_name,
    tenant_id: row.tenant_id,
    priority: row.priority as RecommendationPriority,
    savings_estimate: row.savings_estimate,
    deterministic_reason: row.deterministic_reason,
    evidence: typeof row.evidence === 'string' ? JSON.parse(row.evidence) : row.evidence,
    gold_snapshot_id: row.gold_snapshot_id,
    scoring_version: row.scoring_version,
    composite_score: row.composite_score,
    tier: row.tier,
    llm_enriched: row.llm_enriched,
    llm_explanation: row.llm_explanation,
    llm_enriched_at: row.llm_enriched_at,
    state: row.state,
    created_at: row.created_at
  };
}
