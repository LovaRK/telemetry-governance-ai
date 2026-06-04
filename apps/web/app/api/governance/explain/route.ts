import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { requireContext } from '@packages/auth/request-context';
import {
  ExplanationService,
  SourcetypeContext,
  PortfolioContext,
} from '@api/services/explanation-service';

/**
 * POST /api/governance/explain
 *
 * Generates human-readable LLM explanations for governance decisions.
 * Inputs are ALWAYS fetched from the database (audit records + KPIs).
 * The request body controls WHAT to explain, not the numbers used.
 *
 * Architecture enforcement:
 *   DB audit record → ExplanationService → LLM → narrative
 *   The LLM never receives raw request data, never recalculates scores.
 *
 * Request body:
 *   type        — 'executive_summary' | 'sourcetype' | 'governance'
 *   sourcetype  — required for type=sourcetype|governance
 *
 * Response:
 *   explanation_type, narrative, provider, fallback_used, latency_ms, grounding
 *
 * Gate 1 enforced by service: same inputs → same tier/action (deterministic)
 * Gate 2 enforced here: grounding contains only numbers from DB audit records
 * Gate 3 enforced in service: templates explicitly encode the tier
 * Gate 4 enforced here: missing data returns structured insufficient-data response
 */

const service = new ExplanationService();

export const POST = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;
  const tenantId = ctxOrError.tenantId;

  let body: { type?: string; sourcetype?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body required' }, { status: 400 });
  }

  const { type, sourcetype } = body;

  if (!type || !['executive_summary', 'sourcetype', 'governance'].includes(type)) {
    return NextResponse.json(
      { error: 'type must be: executive_summary | sourcetype | governance' },
      { status: 400 }
    );
  }

  // ── Executive Summary ─────────────────────────────────────────────────────

  if (type === 'executive_summary') {
    // Always use the csv_analytics pointer — this is the canonical scored snapshot
    const kpiResult = await query<any>(
      `SELECT
         ek.roi_score::float, ek.gainscope_score::float,
         ek.total_license_spend::float, ek.license_spend_low_value::float,
         ek.total_daily_gb::float, ek.total_sourcetypes::int,
         ek.tier_critical::int, ek.tier_important::int,
         ek.tier_nice_to_have::int, ek.tier_low_value::int,
         ek.security_gaps::int, ek.operational_gaps::int,
         ek.snapshot_date::text
       FROM executive_kpis ek
       JOIN tenant_snapshot_pointer p
         ON p.active_snapshot_id::text = ek.snapshot_id::text
         AND p.tenant_id::text = ek.tenant_id::text
         AND p.snapshot_source = 'csv_analytics'
       WHERE ek.tenant_id::text = $1`,
      [tenantId]
    );

    // Gate 4: no data → structured insufficient-data response (not hallucinated numbers)
    if (kpiResult.rows.length === 0) {
      return {
        data: {
          explanation_type: 'executive_summary',
          narrative: 'No scored snapshot available yet. Run the 1stmile CSV ingestion pipeline to generate analytics data before requesting an executive summary.',
          provider:  'template',
          fallback_used: true,
          latency_ms: 0,
          grounding: {},
          sufficient_data: false,
        },
        meta: { tenantId },
      };
    }

    const row = kpiResult.rows[0];
    const ctx: PortfolioContext = {
      total_sourcetypes:  row.total_sourcetypes,
      total_daily_gb:     row.total_daily_gb,
      annual_spend:       row.total_license_spend,
      low_value_spend:    row.license_spend_low_value,
      roi_score:          row.roi_score,
      gainscope_pct:      row.gainscope_score,
      tier_critical:      row.tier_critical,
      tier_important:     row.tier_important,
      tier_nice_to_have:  row.tier_nice_to_have,
      tier_wasteful:      row.tier_low_value,
      security_gaps:      row.security_gaps,
      operational_gaps:   row.operational_gaps,
      snapshot_source:    'csv_analytics',
      snapshot_date:      row.snapshot_date,
    };

    const result = await service.explainExecutiveSummary(ctx);
    return { data: { ...result, sufficient_data: true }, meta: { tenantId } };
  }

  // ── Sourcetype or Governance ──────────────────────────────────────────────

  if (!sourcetype?.trim()) {
    return NextResponse.json(
      { error: 'sourcetype is required for type=sourcetype|governance' },
      { status: 400 }
    );
  }

  // Fetch from audit record — this is the immutable source of truth
  const auditResult = await query<any>(
    `SELECT
       gae.sourcetype, gae.index_name,
       gae.composite_score::float, gae.utilization_score::float,
       gae.detection_score::float, gae.quality_score::float,
       gae.tier, gae.recommendation,
       gae.reasoning,
       ad.annual_license_cost::float, ad.estimated_savings::float,
       ts.daily_avg_gb::float,
       ad.is_quick_win, ad.is_s3_candidate, ad.detection_gap,
       ad.candidate_reason
     FROM governance_audit_events gae
     JOIN agent_decisions ad
       ON ad.sourcetype = gae.sourcetype AND ad.tenant_id = gae.tenant_id
          AND ad.snapshot_id = gae.snapshot_id
     JOIN telemetry_snapshots ts
       ON ts.sourcetype = gae.sourcetype AND ts.tenant_id = gae.tenant_id
          AND ts.snapshot_id = gae.snapshot_id
     WHERE gae.tenant_id = $1
       AND gae.sourcetype = $2
     ORDER BY gae.created_at DESC
     LIMIT 1`,
    [tenantId, sourcetype.trim()]
  );

  // Gate 4: sourcetype not found → structured explanation (not hallucination)
  if (auditResult.rows.length === 0) {
    return {
      data: {
        explanation_type: type,
        narrative: `No audit record found for sourcetype "${sourcetype}". This sourcetype may not have been scored in the current snapshot.`,
        provider:  'template',
        fallback_used: true,
        latency_ms: 0,
        grounding: { sourcetype, tenant_id: tenantId },
        sufficient_data: false,
      },
      meta: { tenantId },
    };
  }

  const row = auditResult.rows[0];

  // Derive action from tier (deterministic — must match ingest rules)
  const actionMap: Record<string, string> = {
    Critical: 'KEEP', Important: 'KEEP', 'Nice-to-Have': 'OPTIMIZE', Wasteful: 'ELIMINATE',
  };

  const ctx: SourcetypeContext = {
    sourcetype:         row.sourcetype,
    index_name:         row.index_name,
    daily_gb:           row.daily_avg_gb,
    annual_cost:        row.annual_license_cost,
    utilization_score:  row.utilization_score,
    detection_score:    row.detection_score,
    quality_score:      row.quality_score,
    composite_score:    row.composite_score,
    tier:               row.tier,
    recommended_action: actionMap[row.tier] ?? 'REVIEW',
    estimated_savings:  row.estimated_savings,
    is_quick_win:       row.is_quick_win,
    is_s3_candidate:    row.is_s3_candidate,
    detection_gap:      row.detection_gap,
    operational_gap:    Array.isArray(row.candidate_reason)
      ? row.candidate_reason.includes('operational_gap')
      : false,
  };

  const result = type === 'governance'
    ? await service.explainGovernance(ctx)
    : await service.explainSourcetype(ctx);

  return { data: { ...result, sufficient_data: true }, meta: { tenantId } };
});
