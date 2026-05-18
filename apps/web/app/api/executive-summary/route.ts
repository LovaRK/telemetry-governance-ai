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
    // Check if database is available
    if (!query || !process.env.DATABASE_URL) {
      return NextResponse.json({
        mode: 'DEMO_MODE',
        error: 'Database not available',
        missingDependency: 'PostgreSQL',
        reason: 'Run in full-stack mode with DATABASE_URL set',
        kpis: null,
        snapshots: [],
        decisions: [],
        staircase: [],
        quickWins: [],
        agentReasoning: '',
      }, { status: 503 });
    }

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
        indexName: d.index_name,
        action: d.action,
        savings: d.estimated_savings || 0,
        tier: d.tier || 'CRITICAL',
        reasoning: d.recommendation || '',
      }));

    // Calculate tier counts and aggregate metrics from decisions
    const tierCounts = {
      critical: decisions.filter((d: any) => d.tier?.toUpperCase() === 'CRITICAL').length,
      important: decisions.filter((d: any) => d.tier?.toUpperCase() === 'IMPORTANT').length,
      niceToHave: decisions.filter((d: any) => d.tier?.toUpperCase() === 'NICE_TO_HAVE' || d.tier?.toUpperCase() === 'NICE-TO-HAVE').length,
      lowValue: decisions.filter((d: any) => d.tier?.toUpperCase() === 'LOW_VALUE' || d.tier?.toUpperCase() === 'LOW-VALUE').length,
    };

    const lowValueSpend = decisions
      .filter((d: any) => d.tier?.toUpperCase() === 'LOW_VALUE' || d.tier?.toUpperCase() === 'LOW-VALUE')
      .reduce((sum: number, d: any) => sum + (parseFloat(d.annual_license_cost) || 0), 0);

    const totalSavings = decisions.reduce((sum: number, d: any) => sum + (parseFloat(d.estimated_savings) || 0), 0);

    const avgUtilization = decisions.length > 0
      ? decisions.reduce((sum: number, d: any) => sum + (parseFloat(d.utilization_score) || 0), 0) / decisions.length
      : 0;

    const avgDetection = decisions.length > 0
      ? decisions.reduce((sum: number, d: any) => sum + (parseFloat(d.detection_score) || 0), 0) / decisions.length
      : 0;

    const avgQuality = decisions.length > 0
      ? decisions.reduce((sum: number, d: any) => sum + (parseFloat(d.quality_score) || 0), 0) / decisions.length
      : 0;

    const avgConfidence = decisions.length > 0
      ? decisions.reduce((sum: number, d: any) => sum + (parseFloat(d.confidence || 0)), 0) / decisions.length
      : 0;

    return NextResponse.json({
      mode: 'FULL_STACK',
      kpis: {
        roiScore: parseFloat(kpi?.roi_score || '0'),
        gainScopeScore: parseFloat(kpi?.gainscope_score || '0'),
        totalLicenseSpend: parseFloat(kpi?.total_license_spend || '0'),
        licenseSpendLowValue: lowValueSpend,
        storageSavingsPotential: totalSavings,
        totalDailyGb: parseFloat(kpi?.total_daily_gb || '0'),
        totalSourcetypes: decisions.length,
        tierCounts,
        securityGaps: parseInt(kpi?.security_gaps || '0', 10),
        operationalGaps: parseInt(kpi?.operational_gaps || '0', 10),
        avgUtilization,
        avgDetection,
        avgQuality,
        avgConfidence,
      },
      snapshots: [
        {
          snapshotId: snapshot.snapshot_id,
          indexName: snapshot.index_name,
          sourcetype: snapshot.sourcetype,
          granularity: snapshot.granularity,
          parentIndex: snapshot.parent_index,
          totalEvents: parseInt(snapshot.total_events || '0', 10),
          dailyAvgGb: parseFloat(snapshot.daily_avg_gb || '0'),
          retentionDays: parseInt(snapshot.retention_days || '90', 10),
          utilizationPct: parseFloat(snapshot.utilization_pct || '0'),
          costPerYear: parseFloat(snapshot.cost_per_year || '0'),
          riskScore: parseFloat(snapshot.risk_score || '0'),
          classification: snapshot.classification,
          confidence: parseFloat(snapshot.confidence || '0'),
          recommendation: snapshot.recommendation,
          tier: decisions[0]?.tier || snapshot.classification,
          action: decisions[0]?.action || 'KEEP',
          reasoning: snapshot.raw_metadata?.reasoning || '',
          estimatedSavings: decisions.reduce((s: number, d: any) => s + (parseFloat(d.estimated_savings) || 0), 0),
          compositeScore: decisions.length > 0 ? parseFloat(decisions[0].composite_score || '0') : 0,
          utilizationScore: decisions.length > 0 ? parseFloat(decisions[0].utilization_score || '0') : parseFloat(snapshot.utilization_pct || '0'),
          detectionScore: decisions.length > 0 ? parseFloat(decisions[0].detection_score || '0') : 0,
          qualityScore: decisions.length > 0 ? parseFloat(decisions[0].quality_score || '0') : 0,
          isQuickWin: decisions.length > 0 && decisions[0].is_quick_win,
          isS3Candidate: decisions.length > 0 && decisions[0].is_s3_candidate,
          detectionGap: decisions.length > 0 && decisions[0].detection_gap,
        },
      ],
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
        candidateReason: d.candidate_reason || [],
      })),
      savingsStaircase: staircase,
      quickWins,
      snapshotDate: snapshot.snapshot_date || new Date().toISOString(),
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
