import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';
import { requireContext } from '@packages/auth/request-context';
import { NextResponse } from 'next/server';

/**
 * GET /api/governance/trends
 *
 * Computes temporal deltas between the two most recent csv_analytics snapshots
 * for the authenticated tenant.
 *
 * Response shape:
 *   sufficient_history  — false if < 2 snapshots exist
 *   current             — KPIs from the latest snapshot
 *   previous            — KPIs from the snapshot before that
 *   deltas              — current − previous (absolute + percent change)
 *   meta                — snapshot IDs, dates, source
 *
 * Metrics tracked:
 *   roi_score           — overall value score (0–100)
 *   gainscope_score     — % of spend on Tier 1+2 data
 *   total_license_spend — annual spend ($)
 *   license_spend_low_value — wasteable spend ($)
 *   total_daily_gb      — total daily ingest volume
 *   total_sourcetypes   — number of scored sourcetypes
 *   avg_utilization     — average utilization score across sourcetypes
 *   avg_detection       — average detection score
 *   avg_quality         — average quality score
 *   tier_critical       — count of Critical sourcetypes
 *   tier_important      — count of Important sourcetypes
 *   tier_nice_to_have   — count of Nice-to-Have sourcetypes
 *   tier_low_value      — count of Wasteful sourcetypes
 */

interface KpiSnapshot {
  snapshotId:          string;
  snapshotDate:        string;
  publishedAt:         string;
  roiScore:            number;
  gainscopeScore:      number;
  totalLicenseSpend:   number;
  licenseSpendLowValue:number;
  totalDailyGb:        number;
  totalSourcetypes:    number;
  avgUtilization:      number;
  avgDetection:        number;
  avgQuality:          number;
  tierCritical:        number;
  tierImportant:       number;
  tierNiceToHave:      number;
  tierLowValue:        number;
}

interface Delta {
  absolute:  number;
  pct:       number | null;   // null if previous was 0
  direction: 'up' | 'down' | 'flat';
}

function delta(current: number, previous: number): Delta {
  const absolute = current - previous;
  const pct      = previous !== 0 ? (absolute / Math.abs(previous)) * 100 : null;
  const direction = absolute > 0.001 ? 'up' : absolute < -0.001 ? 'down' : 'flat';
  return { absolute: Math.round(absolute * 100) / 100, pct: pct !== null ? Math.round(pct * 10) / 10 : null, direction };
}

export const GET = createRoute(async (request: NextRequest) => {
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) return ctxOrError;
  const tenantId = ctxOrError.tenantId;

  // Fetch the 2 most recent published csv_analytics snapshots for this tenant
  // Join pipeline_runs (for published_at) with executive_kpis (for KPI values)
  const result = await query<{
    snapshot_id:            string;
    snapshot_date:          string;
    published_at:           string;
    roi_score:              string;
    gainscope_score:        string;
    total_license_spend:    string;
    license_spend_low_value:string;
    total_daily_gb:         string;
    total_sourcetypes:      string;
    avg_utilization:        string;
    avg_detection:          string;
    avg_quality:            string;
    tier_critical:          string;
    tier_important:         string;
    tier_nice_to_have:      string;
    tier_low_value:         string;
  }>(
    `SELECT
       ek.snapshot_id::text,
       ek.snapshot_date::text,
       pr.published_at::text,
       ek.roi_score::text,
       ek.gainscope_score::text,
       ek.total_license_spend::text,
       ek.license_spend_low_value::text,
       ek.total_daily_gb::text,
       ek.total_sourcetypes::text,
       ek.avg_utilization::text,
       ek.avg_detection::text,
       ek.avg_quality::text,
       ek.tier_critical::text,
       ek.tier_important::text,
       ek.tier_nice_to_have::text,
       ek.tier_low_value::text
     FROM executive_kpis ek
     JOIN pipeline_runs pr ON pr.snapshot_id = ek.snapshot_id
     WHERE ek.tenant_id = $1
       AND pr.published    = true
       AND pr.source_hash  = '3173746d696c652d736f75726365'  -- include only csv_analytics runs
     ORDER BY pr.published_at DESC
     LIMIT 2`,
    [tenantId]
  );

  const rows = result.rows;

  // Fewer than 2 snapshots → insufficient history (correct, not an error)
  if (rows.length < 2) {
    return {
      data: {
        sufficient_history: false,
        message:            'Insufficient history — need at least 2 snapshots to compute trends.',
        snapshot_count:     rows.length,
        current:            rows.length === 1 ? parseRow(rows[0]) : null,
        previous:           null,
        deltas:             null,
      },
      meta: { tenantId, source: 'csv_analytics' },
    };
  }

  const current  = parseRow(rows[0]);
  const previous = parseRow(rows[1]);

  return {
    data: {
      sufficient_history: true,
      current,
      previous,
      deltas: {
        roiScore:             delta(current.roiScore,             previous.roiScore),
        gainscopeScore:       delta(current.gainscopeScore,       previous.gainscopeScore),
        totalLicenseSpend:    delta(current.totalLicenseSpend,    previous.totalLicenseSpend),
        licenseSpendLowValue: delta(current.licenseSpendLowValue, previous.licenseSpendLowValue),
        totalDailyGb:         delta(current.totalDailyGb,         previous.totalDailyGb),
        totalSourcetypes:     delta(current.totalSourcetypes,     previous.totalSourcetypes),
        avgUtilization:       delta(current.avgUtilization,       previous.avgUtilization),
        avgDetection:         delta(current.avgDetection,         previous.avgDetection),
        avgQuality:           delta(current.avgQuality,           previous.avgQuality),
        tierCritical:         delta(current.tierCritical,         previous.tierCritical),
        tierImportant:        delta(current.tierImportant,        previous.tierImportant),
        tierNiceToHave:       delta(current.tierNiceToHave,       previous.tierNiceToHave),
        tierLowValue:         delta(current.tierLowValue,         previous.tierLowValue),
      },
    },
    meta: {
      tenantId,
      source:      'csv_analytics',
      currentSnap: current.snapshotId,
      previousSnap:previous.snapshotId,
    },
  };
});

function parseRow(row: Record<string, string>): KpiSnapshot {
  return {
    snapshotId:           row.snapshot_id,
    snapshotDate:         row.snapshot_date,
    publishedAt:          row.published_at,
    roiScore:             parseFloat(row.roi_score)              || 0,
    gainscopeScore:       parseFloat(row.gainscope_score)        || 0,
    totalLicenseSpend:    parseFloat(row.total_license_spend)    || 0,
    licenseSpendLowValue: parseFloat(row.license_spend_low_value)|| 0,
    totalDailyGb:         parseFloat(row.total_daily_gb)         || 0,
    totalSourcetypes:     parseInt(row.total_sourcetypes, 10)    || 0,
    avgUtilization:       parseFloat(row.avg_utilization)        || 0,
    avgDetection:         parseFloat(row.avg_detection)          || 0,
    avgQuality:           parseFloat(row.avg_quality)            || 0,
    tierCritical:         parseInt(row.tier_critical, 10)        || 0,
    tierImportant:        parseInt(row.tier_important, 10)       || 0,
    tierNiceToHave:       parseInt(row.tier_nice_to_have, 10)    || 0,
    tierLowValue:         parseInt(row.tier_low_value, 10)       || 0,
  };
}
