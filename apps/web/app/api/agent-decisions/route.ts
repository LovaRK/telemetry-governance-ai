import { NextResponse } from 'next/server';

let query: any = null;
try {
  const conn = require('@core/database/connection');
  query = conn.query;
} catch {
  // Database module not available in web-only mode
}

export async function GET() {
  try {
    if (!query || !process.env.DATABASE_URL) {
      return NextResponse.json({
        mode: 'DEMO_MODE',
        error: 'Database not available',
        missingDependency: 'PostgreSQL',
        data: []
      }, { status: 503 });
    }

    const res = await query(`SELECT * FROM agent_decisions LIMIT 100`);
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

    return NextResponse.json({
      mode: 'FULL_STACK',
      data: decisions
    });
  } catch (e) {
    return NextResponse.json({
      mode: 'DEMO_MODE',
      error: 'Database query failed',
      data: []
    }, { status: 503 });
  }
}
