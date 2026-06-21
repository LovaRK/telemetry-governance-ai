/**
 * Contract: computeDeterministicSavings matches datasensAI_calculation_guide §8
 *
 * Formula (guide):
 *   Storage Savings = (retention_excess_gb + unused_field_gb + compression_opportunity_gb)
 *                     × storage_cost_per_gb_month × months
 *
 * Sub-formulas:
 *   retention_excess_gb   = daily_avg_gb × max(0, retention_days − max_recommended) / retention_days
 *   unused_field_gb       = daily_avg_gb × (fields_indexed − fields_used) / fields_indexed
 *   compression_opp_gb    = daily_avg_gb × (1 − utilization_pct / 100) × compression_factor
 *
 * Defaults: months=12, costPerGbPerDay=0.5 (→ $15/GB/month), maxRetention=365, compressionFactor=0.3
 */

import {
  computeDeterministicSavings,
  computeRetentionExcessGb,
  computeUnusedFieldGb,
  computeCompressionOpportunityGb,
  type RetentionInput,
  type FieldSavingsInput,
  type CompressionSavingsInput,
} from '../../packages/core/engine/savings/storage';

describe('Storage Savings — guide §8 contract', () => {

  describe('retention excess', () => {
    test('no excess when retention ≤ max recommended', () => {
      const input: RetentionInput = { dailyAvgGb: 1.0, retentionDays: 90 };
      expect(computeRetentionExcessGb(input, 365)).toBe(0);
    });

    test('correct excess when retention exceeds max', () => {
      // 1 GB/day × (730−365)/730 = 0.5 GB
      const input: RetentionInput = { dailyAvgGb: 1.0, retentionDays: 730 };
      expect(computeRetentionExcessGb(input, 365)).toBe(0.5);
    });

    test('zero daily volume → zero excess', () => {
      expect(computeRetentionExcessGb({ dailyAvgGb: 0, retentionDays: 730 }, 365)).toBe(0);
    });
  });

  describe('unused fields', () => {
    test('half fields unused → half daily volume', () => {
      // 2 GB/day × (100−50)/100 = 1 GB
      const input: FieldSavingsInput = { dailyAvgGb: 2, fieldsIndexed: 100, fieldsUsed: 50 };
      expect(computeUnusedFieldGb(input)).toBe(1);
    });

    test('all fields used → zero waste', () => {
      expect(computeUnusedFieldGb({ dailyAvgGb: 2, fieldsIndexed: 100, fieldsUsed: 100 })).toBe(0);
    });

    test('no indexed fields → zero (no evidence)', () => {
      expect(computeUnusedFieldGb({ dailyAvgGb: 2, fieldsIndexed: 0, fieldsUsed: 0 })).toBe(0);
    });
  });

  describe('compression opportunity', () => {
    test('low utilization → high opportunity', () => {
      // 1 GB/day × (1 − 20/100) × 0.3 = 0.24 GB
      const input: CompressionSavingsInput = { dailyAvgGb: 1, utilizationPct: 20 };
      expect(computeCompressionOpportunityGb(input, 0.3)).toBe(0.24);
    });

    test('full utilization → zero opportunity', () => {
      expect(computeCompressionOpportunityGb({ dailyAvgGb: 1, utilizationPct: 100 }, 0.3)).toBe(0);
    });
  });

  describe('end-to-end savings', () => {
    test('retention+compression with no field data (typical case)', () => {
      // retention: 0.5 GB/day, 730 days, max 365 → excess = 0.5 × (730−365)/730 = 0.25 GB
      // compression: 0.5 GB/day, 30% util → 0.5 × (1−0.3) × 0.3 = 0.105 → rounds to 0.11 GB
      // total GB = 0.25 + 0 + 0.11 = 0.36
      // cost: 0.36 × (0.5×30) × 12 = 0.36 × 15 × 12 = $64.80
      const result = computeDeterministicSavings(
        { dailyAvgGb: 0.5, retentionDays: 730 },
        null,
        { dailyAvgGb: 0.5, utilizationPct: 30 },
      );
      expect(result.retentionSavings).toBeGreaterThan(0);
      expect(result.fieldSavings).toBe(0);
      expect(result.compressionSavings).toBeGreaterThan(0);
      expect(result.totalSavings).toBe(result.retentionSavings + result.compressionSavings);
      expect(result.confidence).toBe(0.80);
    });

    test('all three components', () => {
      const result = computeDeterministicSavings(
        { dailyAvgGb: 1, retentionDays: 730 },
        { dailyAvgGb: 1, fieldsIndexed: 100, fieldsUsed: 50 },
        { dailyAvgGb: 1, utilizationPct: 20 },
      );
      expect(result.retentionSavings).toBeGreaterThan(0);
      expect(result.fieldSavings).toBeGreaterThan(0);
      expect(result.compressionSavings).toBeGreaterThan(0);
      expect(result.totalSavings).toBe(
        result.retentionSavings + result.fieldSavings + result.compressionSavings
      );
      expect(result.confidence).toBe(0.95);
    });

    test('no excess at all → zero savings', () => {
      const result = computeDeterministicSavings(
        { dailyAvgGb: 1, retentionDays: 90 },
        null,
        { dailyAvgGb: 1, utilizationPct: 100 },
      );
      expect(result.totalSavings).toBe(0);
      expect(result.confidence).toBe(0.80);
    });

    test('custom config overrides defaults', () => {
      const result = computeDeterministicSavings(
        { dailyAvgGb: 1, retentionDays: 730 },
        null,
        { dailyAvgGb: 1, utilizationPct: 50 },
        { costPerGbPerDay: 100 / 30, months: 12 },
      );
      // With ~$3.33/day → $100/month, savings should be much higher
      expect(result.totalSavings).toBeGreaterThan(
        computeDeterministicSavings(
          { dailyAvgGb: 1, retentionDays: 730 },
          null,
          { dailyAvgGb: 1, utilizationPct: 50 },
        ).totalSavings
      );
    });
  });
});
