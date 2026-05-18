import { NextResponse } from 'next/server';

let query: any = null;
try {
  const conn = require('@core/database/connection');
  query = conn.query;
} catch {
  // Database module not available in web-only mode
}

export async function GET(request: Request) {
  try {
    if (!query || !process.env.DATABASE_URL) {
      return NextResponse.json({
        mode: 'DEMO_MODE',
        error: 'Database not available',
        data: []
      }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '7', 10);

    // Validate days parameter
    if (![7, 30, 90].includes(days)) {
      return NextResponse.json({
        error: 'Invalid days parameter. Use 7, 30, or 90.',
        data: []
      }, { status: 400 });
    }

    // Fetch KPI history for the specified number of days
    const res = await query(
      `
      SELECT
        snapshot_date,
        roi_score,
        gainscope_score,
        total_license_spend,
        license_spend_low_value,
        storage_savings_potential,
        total_daily_gb,
        total_sourcetypes,
        tier_critical,
        tier_important,
        tier_nice_to_have,
        tier_low_value,
        security_gaps,
        operational_gaps,
        avg_utilization,
        avg_detection,
        avg_quality,
        avg_confidence
      FROM executive_kpis
      WHERE snapshot_date >= CURRENT_DATE - INTERVAL '${days} days'
      ORDER BY snapshot_date ASC
      `
    );

    const history = (res.rows || []).map((row: any) => ({
      date: row.snapshot_date,
      roiScore: parseFloat(row.roi_score || '0'),
      gainScopeScore: parseFloat(row.gainscope_score || '0'),
      totalLicenseSpend: parseFloat(row.total_license_spend || '0'),
      licenseSpendLowValue: parseFloat(row.license_spend_low_value || '0'),
      storageSavingsPotential: parseFloat(row.storage_savings_potential || '0'),
      totalDailyGb: parseFloat(row.total_daily_gb || '0'),
      totalSourcetypes: parseInt(row.total_sourcetypes || '0', 10),
      tierCritical: parseInt(row.tier_critical || '0', 10),
      tierImportant: parseInt(row.tier_important || '0', 10),
      tierNiceToHave: parseInt(row.tier_nice_to_have || '0', 10),
      tierLowValue: parseInt(row.tier_low_value || '0', 10),
      securityGaps: parseInt(row.security_gaps || '0', 10),
      operationalGaps: parseInt(row.operational_gaps || '0', 10),
      avgUtilization: parseFloat(row.avg_utilization || '0'),
      avgDetection: parseFloat(row.avg_detection || '0'),
      avgQuality: parseFloat(row.avg_quality || '0'),
      avgConfidence: parseFloat(row.avg_confidence || '0'),
    }));

    return NextResponse.json({
      mode: 'FULL_STACK',
      days,
      data: history,
      count: history.length
    });
  } catch (e) {
    console.error('[kpi-history] Error:', e);
    return NextResponse.json({
      mode: 'DEMO_MODE',
      error: 'Database query failed',
      data: []
    }, { status: 503 });
  }
}
