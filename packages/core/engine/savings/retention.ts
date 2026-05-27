/**
 * RETENTION SAVINGS
 *
 * Deterministic calculation: what fraction of daily volume is stored beyond
 * the recommended maximum retention period, and what that costs.
 *
 * Formula:
 *   retention_excess_gb = daily_avg_gb × max(0, retention_days - max_recommended) / retention_days
 *   monthly_cost        = retention_excess_gb × storage_cost_per_gb_per_month
 *   total_savings       = monthly_cost × months
 *
 * storage_cost_per_gb_per_month = cost_per_gb_per_day × 30
 */

export interface RetentionInput {
  dailyAvgGb: number;
  retentionDays: number;
}

const DEFAULT_MAX_RETENTION = 365;

export function computeRetentionExcessGb(
  inp: RetentionInput,
  maxRecommendedRetention: number = DEFAULT_MAX_RETENTION
): number {
  if (inp.dailyAvgGb <= 0 || inp.retentionDays <= 0) return 0;
  const excessDays = Math.max(0, inp.retentionDays - maxRecommendedRetention);
  if (excessDays === 0) return 0;
  return Math.round(inp.dailyAvgGb * (excessDays / inp.retentionDays) * 100) / 100;
}

export function computeRetentionSavings(
  inp: RetentionInput,
  months: number = 12,
  costPerGbPerDay: number = 0.5,
  maxRecommendedRetention: number = DEFAULT_MAX_RETENTION
): number {
  const excessGb = computeRetentionExcessGb(inp, maxRecommendedRetention);
  if (excessGb === 0) return 0;
  const monthlyStorageCost = costPerGbPerDay * 30;
  return Math.round(excessGb * monthlyStorageCost * months * 100) / 100;
}
