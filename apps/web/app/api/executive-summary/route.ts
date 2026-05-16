import { NextResponse } from 'next/server';
import { query } from '@core/database/connection';

function parseDollars(s: string): number {
  if (!s) return 0;
  const m = s.match(/\$?([\d,]+(?:\.\d+)?)/);
  return m ? parseFloat(m[1].replace(/,/g, '')) : 0;
}

function normalizeQuickWins(raw: any[]): any[] {
  return raw.map((qw) => ({
    indexName: qw.indexName ?? qw.index ?? '',
    action: qw.action ?? '',
    savings: typeof qw.savings === 'number' ? qw.savings : parseDollars(qw.impact ?? ''),
    tier: qw.tier ?? '',
    reasoning: qw.reasoning ?? qw.details ?? qw.impact ?? '',
  }));
}

function normalizeSavingsStaircase(raw: any[]): any[] {
  return raw.map((step, i) => {
    const amount = typeof step.amount === 'number' ? step.amount : (typeof step.savings === 'number' ? step.savings : 0);
    const prevAmount = i === 0 ? amount : (typeof raw[i - 1].amount === 'number' ? raw[i - 1].amount : 0);
    return {
      label: step.label ?? step.stage ?? `Stage ${i + 1}`,
      savings: i === 0 ? 0 : Math.max(0, prevAmount - amount),
      cumulative: amount,
      action: (step.action ?? (step.stage ?? '').replace(/^After /, '').replace(/ /g, '_').toUpperCase()) || 'CURRENT',
      count: step.count ?? 0,
    };
  });
}

export async function GET() {
  try {
    // Read LLM agent output from executive_kpis — latest snapshot only
    const kpiResult = await query(`
      SELECT * FROM executive_kpis
      ORDER BY snapshot_date DESC
      LIMIT 1
    `);

    if (kpiResult.rows.length === 0) {
      return NextResponse.json({ error: 'No data. Refresh from Splunk first.' }, { status: 404 });
    }

    const k = kpiResult.rows[0];

    // Read per-index LLM decisions (tier, action, reasoning stored in evidence JSONB)
    const snapshotsResult = await query(`
      SELECT
        index_name, sourcetype, granularity, parent_index,
        daily_avg_gb, total_events, retention_days,
        utilization_pct, cost_per_year, risk_score,
        classification, confidence, recommendation, evidence, raw_metadata,
        snapshot_id, snapshot_date
      FROM telemetry_snapshots
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM telemetry_snapshots)
        AND granularity = 'index'
      ORDER BY risk_score DESC, cost_per_year DESC
    `);

    const snapshots = snapshotsResult.rows.map((row) => {
      const evidence = typeof row.evidence === 'string' ? JSON.parse(row.evidence) : row.evidence;
      const rawMeta = typeof row.raw_metadata === 'string' ? JSON.parse(row.raw_metadata) : row.raw_metadata;
      return {
        indexName: row.index_name,
        sourcetype: row.sourcetype,
        granularity: row.granularity,
        parentIndex: row.parent_index,
        dailyAvgGb: parseFloat(row.daily_avg_gb),
        totalEvents: parseInt(row.total_events, 10),
        retentionDays: row.retention_days,
        utilizationPct: parseFloat(row.utilization_pct),
        costPerYear: parseFloat(row.cost_per_year),
        riskScore: parseFloat(row.risk_score),
        classification: row.classification,
        confidence: parseFloat(row.confidence),
        recommendation: row.recommendation,
        // LLM agent fields stored in evidence
        tier: evidence?.tier || 'Nice-to-Have',
        action: evidence?.action || row.classification,
        reasoning: evidence?.reasoning || rawMeta?.reasoning || '',
        estimatedSavings: evidence?.estimatedSavings || 0,
        compositeScore: evidence?.compositeScore || parseFloat(row.risk_score),
        utilizationScore: evidence?.utilizationScore || parseFloat(row.utilization_pct),
        detectionScore: evidence?.detectionScore || 0,
        qualityScore: evidence?.qualityScore || 50,
        isQuickWin: evidence?.isQuickWin || false,
        isS3Candidate: evidence?.isS3Candidate || false,
        detectionGap: evidence?.detectionGap || false,
        snapshotId: row.snapshot_id,
      };
    });

    // 7-day history for sparklines
    const historyResult = await query(`
      SELECT snapshot_date, roi_score, gainscope_score, total_daily_gb, total_license_spend
      FROM executive_kpis
      ORDER BY snapshot_date DESC
      LIMIT 7
    `);
    const history = historyResult.rows.reverse().map((r) => ({
      date: r.snapshot_date,
      roiScore: parseFloat(r.roi_score),
      gainScopeScore: parseFloat(r.gainscope_score),
      totalDailyGb: parseFloat(r.total_daily_gb),
      totalLicenseSpend: parseFloat(r.total_license_spend),
    }));

    return NextResponse.json({
      history,
      kpis: {
        roiScore: parseFloat(k.roi_score),
        gainScopeScore: parseFloat(k.gainscope_score),
        totalLicenseSpend: parseFloat(k.total_license_spend),
        licenseSpendLowValue: parseFloat(k.license_spend_low_value),
        storageSavingsPotential: parseFloat(k.storage_savings_potential),
        totalDailyGb: parseFloat(k.total_daily_gb),
        totalSourcetypes: k.total_sourcetypes,
        tierCounts: {
          critical: k.tier_critical,
          important: k.tier_important,
          niceToHave: k.tier_nice_to_have,
          lowValue: k.tier_low_value,
        },
        securityGaps: k.security_gaps,
        operationalGaps: k.operational_gaps,
        avgUtilization: parseFloat(k.avg_utilization),
        avgDetection: parseFloat(k.avg_detection),
        avgQuality: parseFloat(k.avg_quality),
        avgConfidence: parseFloat(k.avg_confidence),
      },
      quickWins: normalizeQuickWins(typeof k.quick_wins === 'string' ? JSON.parse(k.quick_wins) : (k.quick_wins || [])),
      savingsStaircase: normalizeSavingsStaircase(typeof k.savings_staircase === 'string' ? JSON.parse(k.savings_staircase) : (k.savings_staircase || [])),
      agentReasoning: k.agent_reasoning,
      snapshotDate: k.snapshot_date,
      snapshots,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch executive summary' },
      { status: 500 }
    );
  }
}
