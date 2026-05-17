import { NextResponse, NextRequest } from 'next/server';
import { query } from '@core/database/connection';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const snapshotId = searchParams.get('snapshotId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
    const offset = parseInt(searchParams.get('offset') || '0');

    let sql = `SELECT * FROM agent_decisions`;
    let params: any[] = [];

    if (snapshotId) {
      sql += ` WHERE snapshot_id = $1`;
      params = [snapshotId];
    }

    sql += ` ORDER BY composite_score DESC, snapshot_date DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);

    if (result.rows.length === 0) {
      return NextResponse.json({
        mode: 'FULL_STACK',
        data: [],
        total: 0,
      });
    }

    // Get total count
    let countSql = `SELECT COUNT(*) as count FROM agent_decisions`;
    if (snapshotId) {
      countSql += ` WHERE snapshot_id = $1`;
    }
    const countResult = await query(countSql, snapshotId ? [snapshotId] : []);
    const total = parseInt(countResult.rows[0]?.count || '0');

    return NextResponse.json({
      mode: 'FULL_STACK',
      data: result.rows.map((row: any) => ({
        id: row.id,
        snapshotId: row.snapshot_id,
        snapshotDate: row.snapshot_date,
        index: row.index_name,
        sourcetype: row.sourcetype,
        tier: row.tier,
        action: row.action,
        confidence: row.confidence,
        confidenceScore: row.confidence_score,
        utilization: row.utilization_score,
        detection: row.detection_score,
        quality: row.quality_score,
        risk: row.risk_score,
        compositeScore: row.composite_score,
        reasoning: row.reasoning,
        evidence: row.evidence,
        recommendation: row.recommendation,
        estimatedSavings: row.estimated_savings,
        annualLicenseCost: row.annual_license_cost,
        isQuickWin: row.is_quick_win,
        isS3Candidate: row.is_s3_candidate,
        detectionGap: row.detection_gap,
      })),
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[agent-decisions] Error:', error);
    return NextResponse.json({
      mode: 'FULL_STACK',
      error: 'Database query failed',
      reason: error instanceof Error ? error.message : 'Unknown error',
      data: [],
    }, { status: 500 });
  }
}
