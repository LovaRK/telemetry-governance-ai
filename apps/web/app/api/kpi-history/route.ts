import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

const VALID_DAYS = [7, 30, 90] as const;

export const GET = createRoute(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '7', 10);

  if (!VALID_DAYS.includes(days as 7 | 30 | 90)) {
    throw new Error('Invalid days parameter. Use 7, 30, or 90.');
  }

  // Use parameterized interval to avoid injection and driver issues
  const res = await query<any>(
    `SELECT
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
    WHERE snapshot_date >= CURRENT_DATE - ($1 || ' days')::INTERVAL
    ORDER BY snapshot_date ASC`,
    [days]
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

  return {
    data: {
      mode: 'FULL_STACK',
      days,
      data: history,
      count: history.length,
    },
    meta: { source: 'postgres' },
  };
});
