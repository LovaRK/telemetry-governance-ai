import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { requireContext } from '@packages/auth/request-context';
import { NextResponse } from 'next/server';

/**
 * GET /api/governance/audit
 *
 * Governance audit overview + decision lineage for the current tenant.
 *
 * Query params:
 *   snapshot_id  — filter to a specific snapshot (optional)
 *   tier         — filter by tier: Critical|Important|Nice-to-Have|Wasteful (optional)
 *   sourcetype   — filter by sourcetype (optional)
 *   limit        — max lineage rows returned (default 100, max 500)
 *
 * Response shape:
 *   overview     — aggregate counts and timestamps (dashboard summary cards)
 *   lineage      — per-sourcetype audit records with full reasoning
 *   meta         — tenant, snapshot, source
 */
export const GET = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;
  const tenantId = ctxOrError.tenantId;

  const { searchParams } = new URL(request.url);
  const snapshotId = searchParams.get('snapshot_id') || null;
  const tier       = searchParams.get('tier')        || null;
  const sourcetype = searchParams.get('sourcetype')  || null;
  const limit      = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

  // ── Overview (aggregate counts — always the full latest snapshot) ──────────
  const overviewResult = await query<{
    total_decisions:     string;
    critical_decisions:  string;
    important_decisions: string;
    wasteful_candidates: string;
    last_audit_ts:       string;
    snapshot_source:     string;
    snapshot_id:         string;
  }>(
    `SELECT
       COUNT(*)::text                                              AS total_decisions,
       COUNT(*) FILTER (WHERE tier = 'Critical')::text            AS critical_decisions,
       COUNT(*) FILTER (WHERE tier = 'Important')::text           AS important_decisions,
       COUNT(*) FILTER (WHERE tier = 'Wasteful')::text            AS wasteful_candidates,
       MAX(created_at)::text                                      AS last_audit_ts,
       MAX(decision_source)                                       AS snapshot_source,
       (array_agg(snapshot_id ORDER BY created_at DESC))[1]::text AS snapshot_id
     FROM governance_audit_events
     WHERE tenant_id = $1`,
    [tenantId]
  );

  const ov = overviewResult.rows[0];

  // ── Tier distribution breakdown ────────────────────────────────────────────
  const tierDistResult = await query<{ tier: string; count: string; pct: string }>(
    `SELECT
       tier,
       COUNT(*)::text                                                         AS count,
       ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 1)::text  AS pct
     FROM governance_audit_events
     WHERE tenant_id = $1
       ${snapshotId ? 'AND snapshot_id = $2' : ''}
     GROUP BY tier
     ORDER BY
       CASE tier
         WHEN 'Critical'     THEN 1
         WHEN 'Important'    THEN 2
         WHEN 'Nice-to-Have' THEN 3
         WHEN 'Wasteful'     THEN 4
       END`,
    snapshotId ? [tenantId, snapshotId] : [tenantId]
  );

  // ── Decision lineage (per-sourcetype, filterable) ─────────────────────────
  const conditions: string[] = [`tenant_id = $1`];
  const params: unknown[]    = [tenantId];

  if (snapshotId) { params.push(snapshotId); conditions.push(`snapshot_id = $${params.length}`); }
  if (tier)       { params.push(tier);        conditions.push(`tier = $${params.length}`); }
  if (sourcetype) { params.push(`%${sourcetype}%`); conditions.push(`sourcetype ILIKE $${params.length}`); }

  params.push(limit);

  const lineageResult = await query<{
    audit_id:          string;
    snapshot_id:       string;
    sourcetype:        string;
    index_name:        string;
    composite_score:   string;
    utilization_score: string;
    detection_score:   string;
    quality_score:     string;
    tier:              string;
    recommendation:    string;
    decision_source:   string;
    reasoning:         unknown;
    created_at:        string;
  }>(
    `SELECT
       audit_id, snapshot_id, sourcetype, index_name,
       composite_score::text, utilization_score::text,
       detection_score::text, quality_score::text,
       tier, recommendation, decision_source, reasoning, created_at
     FROM governance_audit_events
     WHERE ${conditions.join(' AND ')}
     ORDER BY composite_score DESC NULLS LAST, sourcetype
     LIMIT $${params.length}`,
    params
  );

  return {
    data: {
      overview: {
        totalDecisions:    parseInt(ov?.total_decisions     || '0', 10),
        criticalDecisions: parseInt(ov?.critical_decisions  || '0', 10),
        importantDecisions:parseInt(ov?.important_decisions || '0', 10),
        wastefulCandidates:parseInt(ov?.wasteful_candidates || '0', 10),
        lastAuditTimestamp: ov?.last_audit_ts   || null,
        snapshotSource:     ov?.snapshot_source || null,
        snapshotId:         ov?.snapshot_id     || null,
      },
      tierDistribution: tierDistResult.rows.map(r => ({
        tier:    r.tier,
        count:   parseInt(r.count, 10),
        percent: parseFloat(r.pct),
      })),
      lineage: lineageResult.rows.map(r => ({
        auditId:          r.audit_id,
        snapshotId:       r.snapshot_id,
        sourcetype:       r.sourcetype,
        indexName:        r.index_name,
        compositeScore:   parseFloat(r.composite_score),
        utilizationScore: parseFloat(r.utilization_score),
        detectionScore:   parseFloat(r.detection_score),
        qualityScore:     parseFloat(r.quality_score),
        tier:             r.tier,
        recommendation:   r.recommendation,
        decisionSource:   r.decision_source,
        reasoning:        r.reasoning,
        createdAt:        r.created_at,
      })),
    },
    meta: {
      tenantId,
      filters: { snapshotId, tier, sourcetype },
      returned: lineageResult.rows.length,
      limit,
    },
  };
});
