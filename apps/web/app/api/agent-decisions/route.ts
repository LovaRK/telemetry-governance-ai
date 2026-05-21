import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { requireContext } from '@packages/auth/request-context';

/**
 * Agent Decisions Endpoint
 *
 * L3: Trace-consistent + globally enforced purity
 * No synthetic data, no fallbacks.
 */
export const GET = createRoute(async (req: NextRequest) => {
  // Extract and validate RequestContext (fail-closed)
  const ctxOrError = await requireContext(req);
  if (ctxOrError instanceof NextResponse) {
    return ctxOrError;
  }
  const context = ctxOrError;

  // Validate database is available - no fallback
  if (!process.env.DATABASE_URL) {
    throw new Error('❌ DATABASE_URL not set - cannot source agent_decisions');
  }

  const res = await query(`SELECT * FROM agent_decisions LIMIT 100`, undefined, context);

  if (!res || !res.rows) {
    throw new Error('❌ Database returned invalid result - expected rows');
  }

  const decisions = (res.rows || []).map((d: any) => ({
    snapshotId: d.snapshot_id,
    snapshotDate: d.snapshot_date,
    index: d.index_name,
    sourcetype: d.sourcetype,
    tier: d.tier,
    action: d.action,
    compositeScore: d.composite_score,
    utilizationScore: d.utilization_score,
    detectionScore: d.detection_score,
    qualityScore: d.quality_score,
    riskScore: d.risk_score,
    annualLicenseCost: d.annual_license_cost,
    estimatedSavings: d.estimated_savings,
    confidence: d.confidence,
    confidenceScore: d.confidence_score,
    recommendation: d.recommendation,
    reasoning: d.reasoning,
    evidence: d.evidence,
    isQuickWin: d.is_quick_win,
    isS3Candidate: d.is_s3_candidate,
    detectionGap: d.detection_gap,
    candidateReason: d.candidate_reason || [],
  }));

  // Return with required meta
  return {
    data: decisions,
    meta: {
      source: 'postgres',
    },
  };
});

