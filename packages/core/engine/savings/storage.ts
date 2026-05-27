/**
 * DETERMINISTIC STORAGE SAVINGS
 *
 * Computes savings from three independent, auditable sources:
 *   1. retention_excess_gb   — data stored beyond policy retention limit
 *   2. unused_field_gb       — indexed but never-searched fields
 *   3. compression_opportunity_gb — verbose/low-utilization data that can shrink
 *
 * All three are scaled by storage_cost and months to produce dollar figures.
 * The LLM layer should consume these numbers, not generate them.
 *
 * Architecture:
 *   deterministic savings  →  LLM explains WHY  →  dashboard
 *   (never: LLM guesses savings)
 *
 * Confidence is computed from data completeness:
 *   - All three components have source data    → 0.95
 *   - Only retention + utilization available   → 0.80
 *   - Only retention available                 → 0.60
 *   - No data                                  → 0.00 */
 
import { computeRetentionExcessGb, type RetentionInput } from './retention';
import { computeUnusedFieldGb, type FieldSavingsInput } from './fields';
import { computeCompressionOpportunityGb, type CompressionSavingsInput } from './compression';
import { computeRetentionSavings } from './retention';
import { computeFieldSavings } from './fields';
import { computeCompressionSavings } from './compression';

export interface DeterministicSavings {
  retentionSavings: number;
  fieldSavings: number;
  compressionSavings: number;
  totalSavings: number;
  confidence: number;
}

export interface SavingsConfig {
  months: number;
  costPerGbPerDay: number;
  maxRecommendedRetention: number;
  compressionFactor: number;
}

const DEFAULT_CONFIG: SavingsConfig = {
  months: 12,
  costPerGbPerDay: 0.5,
  maxRecommendedRetention: 365,
  compressionFactor: 0.3,
};

export function computeDeterministicSavings(
  retention: RetentionInput,
  fields: FieldSavingsInput | null,
  compression: CompressionSavingsInput,
  config: Partial<SavingsConfig> = {}
): DeterministicSavings {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const retentionExcessGb = computeRetentionExcessGb(retention, cfg.maxRecommendedRetention);
  const unusedFieldGb = fields ? computeUnusedFieldGb(fields) : 0;
  const compressionGb = computeCompressionOpportunityGb(compression, cfg.compressionFactor);

  const monthlyStorageCost = cfg.costPerGbPerDay * 30;
  const totalGb = retentionExcessGb + unusedFieldGb + compressionGb;
  const totalSavings = Math.round(totalGb * monthlyStorageCost * cfg.months * 100) / 100;
  const retentionSavings = Math.round(retentionExcessGb * monthlyStorageCost * cfg.months * 100) / 100;
  const fieldSavings = Math.round(unusedFieldGb * monthlyStorageCost * cfg.months * 100) / 100;
  const compressionSavings = Math.round(compressionGb * monthlyStorageCost * cfg.months * 100) / 100;

  let confidence: number;
  if (fields && retention.dailyAvgGb > 0 && compression.utilizationPct >= 0) {
    confidence = 0.95;
  } else if (retention.dailyAvgGb > 0 && compression.utilizationPct >= 0) {
    confidence = 0.80;
  } else if (retention.dailyAvgGb > 0) {
    confidence = 0.60;
  } else {
    confidence = 0;
  }

  return { retentionSavings, fieldSavings, compressionSavings, totalSavings, confidence };
}

// Re-export the individual functions for use in tests and elsewhere
export {
  computeRetentionExcessGb,
  computeRetentionSavings,
  computeUnusedFieldGb,
  computeFieldSavings,
  computeCompressionOpportunityGb,
  computeCompressionSavings,
  type RetentionInput,
  type FieldSavingsInput,
  type CompressionSavingsInput,
};
