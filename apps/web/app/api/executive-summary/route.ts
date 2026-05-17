import { NextResponse } from 'next/server';
import { query } from '@core/database/connection';

export async function GET() {
  try {
    // Fetch latest snapshot and KPIs from PostgreSQL
    const snapshotResult = await query(
      `SELECT * FROM telemetry_snapshots ORDER BY snapshot_date DESC LIMIT 1`
    );

    if (snapshotResult.rows.length === 0) {
      return NextResponse.json({
        mode: 'DEMO_MODE',
        error: 'No data available',
        missingDependency: 'No snapshots',
        reason: 'Run a refresh from the connection screen first',
        kpis: null,
        snapshots: [],
        decisions: [],
        staircase: [],
        quickWins: [],
        agentReasoning: '',
      }, { status: 503 });
    }

    const snapshot = snapshotResult.rows[0];
    const snapshotId = snapshot.snapshot_id;

    // Fetch KPIs for this snapshot
    const kpisResult = await query(
      `SELECT * FROM executive_kpis WHERE snapshot_id = $1`,
      [snapshotId]
    );
    const kpi = kpisResult.rows[0];

    // Fetch decisions for this snapshot
    const decisionsResult = await query(
      `SELECT * FROM agent_decisions WHERE snapshot_id = $1 ORDER BY composite_score DESC`,
      [snapshotId]
    );
    const decisions = decisionsResult.rows;

    // Build staircase data from decisions
    const staircase = [
      {
        stage: 'Quick Wins',
        amount: decisions.filter((d: any) => d.is_quick_win).reduce((sum: number, d: any) => sum + (d.estimated_savings || 0), 0),
      },
      {
        stage: 'Archive',
        amount: decisions.filter((d: any) => d.action === 'ARCHIVE').reduce((sum: number, d: any) => sum + (d.estimated_savings || 0), 0),
      },
      {
        stage: 'Optimize',
        amount: decisions.filter((d: any) => d.action === 'OPTIMIZE').reduce((sum: number, d: any) => sum + (d.estimated_savings || 0), 0),
      },
      {
        stage: 'S3 Candidate',
        amount: decisions.filter((d: any) => d.is_s3_candidate).reduce((sum: number, d: any) => sum + (d.estimated_savings || 0), 0),
      },
    ];

    // Quick wins: tier=CRITICAL + is_quick_win
    const quickWins = decisions
      .filter((d: any) => d.is_quick_win)
      .sort((a: any, b: any) => (b.estimated_savings || 0) - (a.estimated_savings || 0))
      .slice(0, 5)
      .map((d: any) => ({
        index: d.index_name,
        sourcetype: d.sourcetype,
        action: d.action,
        savings: d.estimated_savings,
        reason: d.recommendation,
      }));

    return NextResponse.json({
      mode: 'FULL_STACK',
      kpis: {
        roiScore: kpi?.roi_score ?? 0,
        gainScopeScore: kpi?.gainscope_score ?? 0,
        totalDailyGb: kpi?.total_daily_gb ?? 0,
        totalLicenseSpend: kpi?.total_license_spend ?? 0,
        detectionGaps: kpi?.security_gaps ?? 0,
        operationalGaps: kpi?.operational_gaps ?? 0,
        confidence: kpi?.avg_confidence ?? 0,
      },
      snapshots: [snapshot],
      decisions: decisions.map((d: any) => ({
        index: d.index_name,
        sourcetype: d.sourcetype,
        tier: d.tier,
        action: d.action,
        confidence: d.confidence,
        confidenceScore: d.confidence_score,
        utilization: d.utilization_score,
        detection: d.detection_score,
        quality: d.quality_score,
        risk: d.risk_score,
        savings: d.estimated_savings,
        reasoning: d.reasoning,
        evidence: d.evidence,
      })),
      staircase,
      quickWins,
      agentReasoning: snapshot.snapshot_metadata?.agentReasoning || '',
    });
  } catch (error) {
    console.error('[executive-summary] Error:', error);
    return NextResponse.json({
      mode: 'FULL_STACK',
      error: 'Database query failed',
      missingDependency: 'PostgreSQL',
      reason: error instanceof Error ? error.message : 'Unknown error',
      kpis: null,
      snapshots: [],
      decisions: [],
      staircase: [],
      quickWins: [],
      agentReasoning: '',
    }, { status: 500 });
  }
}
