import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

export const GET = createRoute(async (request: NextRequest) => {
  const tenantId = request.headers.get('x-tenant-id');
  const userId = request.headers.get('x-user-id');

  // Check if database is available
  if (!query) {
    throw new Error('Database not available: Run in full-stack mode with DATABASE_URL set');
  }

  // Fetch latest snapshot and KPIs from PostgreSQL (tenant-scoped via migration 107)
  let snapshotResult = await query(
    tenantId
      ? `SELECT * FROM telemetry_snapshots WHERE tenant_id = $1 ORDER BY snapshot_date DESC LIMIT 1`
      : `SELECT * FROM telemetry_snapshots ORDER BY snapshot_date DESC LIMIT 1`,
    tenantId ? [tenantId] : []
  );

  // If tenant-scoped query returned no results, fall back to querying all data
  if (snapshotResult.rows.length === 0 && tenantId) {
    snapshotResult = await query(
      `SELECT * FROM telemetry_snapshots ORDER BY snapshot_date DESC LIMIT 1`,
      []
    );
  }

  if (snapshotResult.rows.length === 0) {
    throw new Error('No data available: Run a refresh from the connection screen first');
  }

    const snapshot = snapshotResult.rows[0];
    const snapshotId = snapshot.snapshot_id;

    // Fetch KPIs for this snapshot
    let kpisResult = await query(
      `SELECT * FROM executive_kpis WHERE snapshot_id = $1`,
      [snapshotId]
    );
    let kpi = kpisResult.rows[0];

    // Fetch decisions for this snapshot — LEFT JOIN governance status
    let decisionsResult = await query(
      `SELECT ad.*,
              ra.status        AS gov_status,
              ra.action_note   AS gov_note,
              ra.actor_email   AS gov_actor,
              ra.updated_at    AS gov_updated_at
       FROM agent_decisions ad
       LEFT JOIN LATERAL (
         SELECT status, action_note, actor_email, updated_at
         FROM recommendation_actions
         WHERE index_name = ad.index_name
           AND (sourcetype = ad.sourcetype OR (sourcetype IS NULL AND ad.sourcetype IS NULL))
         ORDER BY updated_at DESC
         LIMIT 1
       ) ra ON true
       WHERE ad.snapshot_id = $1
       ORDER BY ad.composite_score DESC`,
      [snapshotId]
    );
    let decisions = decisionsResult.rows;

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

    return {
      data: {
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
        recommendation: d.recommendation,
        evidence: d.evidence,
        candidateReason: d.candidate_reason || [],
        isQuickWin: d.is_quick_win,
        isS3Candidate: d.is_s3_candidate,
        detectionGap: d.detection_gap,
        // Governance lifecycle status
        governanceStatus: d.gov_status || 'NEW',
        governanceNote: d.gov_note || null,
        governanceActor: d.gov_actor || null,
        governanceUpdatedAt: d.gov_updated_at || null,
      })),
        savingsStaircase: staircase,
        quickWins,
        snapshotDate: snapshot.snapshot_date || new Date().toISOString(),
        agentReasoning: snapshot.snapshot_metadata?.agentReasoning || '',
      },
      meta: { source: 'postgres' },
    };
});
