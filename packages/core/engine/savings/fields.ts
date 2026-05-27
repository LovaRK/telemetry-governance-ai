/**
 * FIELD SAVINGS
 *
 * Deterministic calculation: what portion of daily volume is wasted on
 * indexed fields that are never searched, and what that costs.
 *
 * Formula:
 *   unused_field_gb   = daily_avg_gb × max(0, fields_indexed - fields_used) / max(fields_indexed, 1)
 *   monthly_cost      = unused_field_gb × storage_cost_per_gb_per_month
 *   total_savings     = monthly_cost × months
 *
 * When field usage data is unavailable (fieldsIndexed = 0), returns 0.
 * This avoids imputing savings without evidence.
 */

export interface FieldSavingsInput {
  dailyAvgGb: number;
  fieldsIndexed: number;
  fieldsUsed: number;
}

export function computeUnusedFieldGb(inp: FieldSavingsInput): number {
  if (inp.dailyAvgGb <= 0 || inp.fieldsIndexed <= 0) return 0;
  const unusedFields = Math.max(0, inp.fieldsIndexed - inp.fieldsUsed);
  if (unusedFields === 0) return 0;
  return Math.round(inp.dailyAvgGb * (unusedFields / inp.fieldsIndexed) * 100) / 100;
}

export function computeFieldSavings(
  inp: FieldSavingsInput,
  months: number = 12,
  costPerGbPerDay: number = 0.5
): number {
  const unusedGb = computeUnusedFieldGb(inp);
  if (unusedGb === 0) return 0;
  const monthlyStorageCost = costPerGbPerDay * 30;
  return Math.round(unusedGb * monthlyStorageCost * months * 100) / 100;
}
