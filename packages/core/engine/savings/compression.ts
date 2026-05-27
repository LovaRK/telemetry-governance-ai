/**
 * COMPRESSION SAVINGS
 *
 * Deterministic calculation: what portion of daily volume could be saved
 * through compression optimization (e.g., reducing verbosity, removing
 * unnecessary fields at source).
 *
 * Formula:
 *   compression_opportunity_gb = daily_avg_gb × (1 - utilization_pct / 100) × compression_factor
 *   monthly_cost               = compression_opportunity_gb × storage_cost_per_gb_per_month
 *   total_savings              = monthly_cost × months
 *
 * compression_factor (default 0.3) caps max savings at 30% of low-utilization volume.
 * This prevents over-claiming: compression never eliminates all data, only
 * reduces its footprint.
 *
 * When utilization is high (>= 80%), little compression opportunity exists.
 */

export interface CompressionSavingsInput {
  dailyAvgGb: number;
  utilizationPct: number;
}

const DEFAULT_COMPRESSION_FACTOR = 0.3;

export function computeCompressionOpportunityGb(
  inp: CompressionSavingsInput,
  compressionFactor: number = DEFAULT_COMPRESSION_FACTOR
): number {
  if (inp.dailyAvgGb <= 0 || inp.utilizationPct < 0) return 0;
  const lowUtilPct = Math.max(0, 1 - inp.utilizationPct / 100);
  return Math.round(inp.dailyAvgGb * lowUtilPct * compressionFactor * 100) / 100;
}

export function computeCompressionSavings(
  inp: CompressionSavingsInput,
  months: number = 12,
  costPerGbPerDay: number = 0.5,
  compressionFactor: number = DEFAULT_COMPRESSION_FACTOR
): number {
  const compressionGb = computeCompressionOpportunityGb(inp, compressionFactor);
  if (compressionGb === 0) return 0;
  const monthlyStorageCost = costPerGbPerDay * 30;
  return Math.round(compressionGb * monthlyStorageCost * months * 100) / 100;
}
