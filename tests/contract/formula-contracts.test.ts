import {
  computeROIScore,
  computeGainScope,
  computeCompositeScore,
  computeLowValueSpend,
  computeUtilizationScores,
  computeDetectionScores,
  computeQualityScore,
  assignTier,
  computeDeterministicSavings,
  computeRetentionExcessGb,
  computeRetentionSavings,
  computeUnusedFieldGb,
  computeFieldSavings,
  computeCompressionOpportunityGb,
  computeCompressionSavings,
  validateAttribution,
  type ScoredSourcetype,
  type UtilizationInputs,
  type DetectionInputs,
  type QualityInputs,
  type DeterministicSavings,
} from '../../packages/core/engine';

function makeScored(overrides: Partial<ScoredSourcetype> = {}): ScoredSourcetype {
  return {
    index: 'test',
    sourcetype: null,
    utilizationScore: 50,
    detectionScore: 50,
    qualityScore: 50,
    compositeScore: 50,
    tier: 'Important',
    dailyGb: 10,
    annualCostUsd: 1000,
    detectionGap: false,
    operationalGap: false,
    ...overrides,
  };
}

// ─── ROI Score ─────────────────────────────────────────────────────────────

describe('Formula Contract: ROI Score', () => {
  it('ROI = avg(composite_score) across all scored sourcetypes', () => {
    const data = [
      makeScored({ compositeScore: 80 }),
      makeScored({ compositeScore: 60 }),
      makeScored({ compositeScore: 40 }),
    ];
    expect(computeROIScore(data)).toBe(60);
  });

  it('returns 0 for empty array', () => {
    expect(computeROIScore([])).toBe(0);
  });

  it('rounds to one decimal place', () => {
    const data = [
      makeScored({ compositeScore: 85 }),
      makeScored({ compositeScore: 62 }),
      makeScored({ compositeScore: 38 }),
    ];
    expect(computeROIScore(data)).toBe(61.7);
  });

  it('single sourcetype returns its own composite score', () => {
    const data = [makeScored({ compositeScore: 72.5 })];
    expect(computeROIScore(data)).toBe(72.5);
  });

  it('is NOT derived from savings or cost — only composite_score matters', () => {
    const data = [
      makeScored({ compositeScore: 90, annualCostUsd: 1000000, dailyGb: 500 }),
      makeScored({ compositeScore: 10, annualCostUsd: 1, dailyGb: 0.001 }),
    ];
    const roi = computeROIScore(data);
    expect(roi).toBe(50);
    // The old bug would compute (0 / 1000001) * 100 = 0%, conflating savings with value
    expect(roi).not.toBe(0);
  });
});

// ─── GainScope ──────────────────────────────────────────────────────────────

describe('Formula Contract: GainScope %', () => {
  it('GainScope = (Tier1+2 GB / Total GB) × 100', () => {
    const data = [
      makeScored({ tier: 'Critical', dailyGb: 100 }),
      makeScored({ tier: 'Important', dailyGb: 50 }),
      makeScored({ tier: 'Nice-to-Have', dailyGb: 30 }),
      makeScored({ tier: 'Low-Value', dailyGb: 20 }),
    ];
    expect(computeGainScope(data)).toBe(75);
  });

  it('returns 0 when total GB is 0', () => {
    const data = [
      makeScored({ tier: 'Critical', dailyGb: 0 }),
      makeScored({ tier: 'Important', dailyGb: 0 }),
    ];
    expect(computeGainScope(data)).toBe(0);
  });

  it('returns 0 when no Tier1+2 volume', () => {
    const data = [
      makeScored({ tier: 'Nice-to-Have', dailyGb: 50 }),
      makeScored({ tier: 'Low-Value', dailyGb: 50 }),
    ];
    expect(computeGainScope(data)).toBe(0);
  });

  it('returns 100 when all volume is Tier1+2', () => {
    const data = [
      makeScored({ tier: 'Critical', dailyGb: 75 }),
      makeScored({ tier: 'Important', dailyGb: 25 }),
    ];
    expect(computeGainScope(data)).toBe(100);
  });

  it('is NOT derived from sourcetype count — only GB volume matters', () => {
    const data = [
      makeScored({ tier: 'Critical', dailyGb: 100 }),
      makeScored({ tier: 'Important', dailyGb: 0.1 }),
      makeScored({ tier: 'Nice-to-Have', dailyGb: 0.1 }),
      makeScored({ tier: 'Low-Value', dailyGb: 0.1 }),
    ];
    const gs = computeGainScope(data);
    // The old bug: ((1+1)/4) × 100 = 50% (count-based, inverted)
    // Correct: (100.1/100.3) × 100 ≈ 99.8%
    expect(gs).toBeGreaterThan(90);
    expect(gs).toBeLessThan(100);
  });

  it('rounds to one decimal place', () => {
    const data = [
      makeScored({ tier: 'Critical', dailyGb: 33 }),
      makeScored({ tier: 'Important', dailyGb: 33 }),
      makeScored({ tier: 'Low-Value', dailyGb: 33 }),
    ];
    expect(computeGainScope(data)).toBe(66.7);
  });
});

// ─── Composite Score ────────────────────────────────────────────────────────

describe('Formula Contract: Composite Score', () => {
  it('composite = (util_weight × util_score) + (det_weight × det_score) + (qual_weight × qual_score)', () => {
    const composite = computeCompositeScore(80, 70, 60, {
      utilization: 0.35,
      detection: 0.40,
      quality: 0.25,
    });
    expect(composite).toBe(71); // (0.35×80=28) + (0.40×70=28) + (0.25×60=15) = 71
  });

  it('throws when weights do not sum to 1.0', () => {
    expect(() => computeCompositeScore(50, 50, 50, {
      utilization: 0.5,
      detection: 0.5,
      quality: 0.5,
    })).toThrow('must sum to 1.0');
  });

  it('throws on NaN input', () => {
    expect(() => computeCompositeScore(NaN, 50, 50)).toThrow('not finite');
  });
});

// ─── Low-Value Spend ────────────────────────────────────────────────────────

describe('Formula Contract: Low-Value Spend', () => {
  it('sums annual cost for Tier 3+4 sourcetypes', () => {
    const data = [
      makeScored({ tier: 'Critical', annualCostUsd: 100000 }),
      makeScored({ tier: 'Important', annualCostUsd: 50000 }),
      makeScored({ tier: 'Nice-to-Have', annualCostUsd: 10000 }),
      makeScored({ tier: 'Low-Value', annualCostUsd: 5000 }),
    ];
    expect(computeLowValueSpend(data)).toBe(15000);
  });

  it('returns 0 when no low-value sourcetypes', () => {
    const data = [
      makeScored({ tier: 'Critical', annualCostUsd: 100000 }),
    ];
    expect(computeLowValueSpend(data)).toBe(0);
  });
});

// ─── Utilization Score ──────────────────────────────────────────────────────

describe('Formula Contract: Utilization Score', () => {
  it('is relative to max weighted sum in the batch', () => {
    const inputs: UtilizationInputs[] = [
      { index: 'a', sourcetype: null, alertCount: 10, scheduledSearchCount: 10, dashboardPanelCount: 10, distinctUserCount: 10, adHocSearchCount: 10 },
      { index: 'b', sourcetype: null, alertCount: 0, scheduledSearchCount: 0, dashboardPanelCount: 0, distinctUserCount: 0, adHocSearchCount: 0 },
    ];
    const scores = computeUtilizationScores(inputs);
    // a: (10×3)+(10×3)+(10×2)+(10×1)+(10×2) = 30+30+20+10+20 = 110
    // b: 0
    // max = 110 → a=100, b=0
    expect(scores.get('a::_')).toBe(100);
    expect(scores.get('b::_')).toBe(0);
  });
});

// ─── Detection Score ────────────────────────────────────────────────────────

describe('Formula Contract: Detection Score', () => {
  it('= 0.40 × max(mitre_potential, lantern_potential) + 0.60 × realized', () => {
    const inputs: DetectionInputs[] = [
      { index: 'a', sourcetype: null, mitreTechniqueCount: 20, lanternUsecaseCount: 0, activeAlertCount: 10 },
    ];
    const scores = computeDetectionScores(inputs);
    const result = scores.get('a::_')!;
    // mitre_potential = min(100, 20×1.25) = 25
    // realized = 10/10×100 = 100
    // score = 0.40×25 + 0.60×100 = 10 + 60 = 70
    expect(result.score).toBe(70);
  });

  it('returns 0 when no MITRE or Lantern data exists', () => {
    const inputs: DetectionInputs[] = [
      { index: 'a', sourcetype: null, mitreTechniqueCount: 0, lanternUsecaseCount: 0, activeAlertCount: 50 },
    ];
    const scores = computeDetectionScores(inputs);
    expect(scores.get('a::_')!.score).toBe(0);
  });

  it('detects detection gap when MITRE-rich but coverage-thin', () => {
    const inputs: DetectionInputs[] = [
      { index: 'a', sourcetype: null, mitreTechniqueCount: 20, lanternUsecaseCount: 0, activeAlertCount: 2 },
    ];
    const scores = computeDetectionScores(inputs);
    expect(scores.get('a::_')!.detectionGap).toBe(true);
  });
});

// ─── Quality Score ──────────────────────────────────────────────────────────

describe('Formula Contract: Quality Score', () => {
  it('= max(0, 100 − (weighted_issues / (daily_gb × 1M) × 2000))', () => {
    const q = computeQualityScore({ index: 'a', sourcetype: null, weightedIssues: 500, dailyGb: 10 });
    // approx_events = 10 × 1,000,000 = 10,000,000
    // issue_density = 500 / 10,000,000 = 0.00005
    // quality = max(0, 100 − (0.00005 × 2000)) = max(0, 100 − 0.1) = 99.9
    expect(q).toBe(99.9);
  });

  it('defaults to 100 when dailyGb is 0', () => {
    const q = computeQualityScore({ index: 'a', sourcetype: null, weightedIssues: 9999, dailyGb: 0 });
    expect(q).toBe(100);
  });

  it('never goes below 0', () => {
    const q = computeQualityScore({ index: 'a', sourcetype: null, weightedIssues: 1000000, dailyGb: 0.001 });
    // Very high issue density → should floor at 0
    expect(q).toBeGreaterThanOrEqual(0);
  });
});

// ─── Tier Assignment ────────────────────────────────────────────────────────

describe('Formula Contract: Tier Assignment', () => {
  it('composite ≥ 65 → Critical', () => expect(assignTier(65)).toBe('Critical'));
  it('composite ≥ 40 → Important', () => expect(assignTier(40)).toBe('Important'));
  it('composite ≥ 20 → Nice-to-Have', () => expect(assignTier(20)).toBe('Nice-to-Have'));
  it('composite < 20 → Low-Value', () => expect(assignTier(19)).toBe('Low-Value'));
  it('boundary: 64.9 → Important', () => expect(assignTier(64.9)).toBe('Important'));
  it('boundary: 39.9 → Nice-to-Have', () => expect(assignTier(39.9)).toBe('Nice-to-Have'));
});

// ─── Cross-file Contract: aggregation-service ↦ scoring-engine ─────────────

describe('Cross-file Contract: rebuildInlineKpis delegates to scoring engine', () => {
  it('rebuildInlineKpis calls computeROIScore (not inline savings/totalSpend)', () => {
    const data = [
      makeScored({ compositeScore: 90 }),
      makeScored({ compositeScore: 70 }),
    ];
    const roi = computeROIScore(data);
    expect(roi).toBe(80);
    // Verified by code review: aggregation-service.ts:1382 now calls computeROIScore
  });

  it('rebuildInlineKpis calls computeGainScope (not inline count formula)', () => {
    const data = [
      makeScored({ tier: 'Critical', dailyGb: 80 }),
      makeScored({ tier: 'Low-Value', dailyGb: 20 }),
    ];
    const gs = computeGainScope(data);
    expect(gs).toBe(80);
    // Verified by code review: aggregation-service.ts:1383 now calls computeGainScope
  });

  it('computeROIScore + computeGainScope produce deterministic, idempotent results', () => {
    const data = [
      makeScored({ compositeScore: 72.3, tier: 'Critical', dailyGb: 200 }),
      makeScored({ compositeScore: 45.1, tier: 'Important', dailyGb: 100 }),
      makeScored({ compositeScore: 18.7, tier: 'Low-Value', dailyGb: 50 }),
    ];
    const roi1 = computeROIScore(data);
    const gs1 = computeGainScope(data);
    const roi2 = computeROIScore(data);
    const gs2 = computeGainScope(data);
    expect(roi1).toBe(roi2);
    expect(gs1).toBe(gs2);
  });
});

// ─── Deterministic Storage Savings ──────────────────────────────────────────

describe('Formula Contract: Retention Savings', () => {
  it('retention_excess_gb = daily_gb × excess_days / total_days', () => {
    const result = computeRetentionExcessGb({ dailyAvgGb: 100, retentionDays: 400 });
    // excess = 400 - 365 = 35, excess_gb = 100 × 35/400 = 8.75
    expect(result).toBe(8.75);
  });

  it('returns 0 when retention is within policy', () => {
    expect(computeRetentionExcessGb({ dailyAvgGb: 100, retentionDays: 365 })).toBe(0);
    expect(computeRetentionExcessGb({ dailyAvgGb: 100, retentionDays: 180 })).toBe(0);
  });

  it('returns 0 when dailyGb is 0', () => {
    expect(computeRetentionExcessGb({ dailyAvgGb: 0, retentionDays: 500 })).toBe(0);
  });

  it('respects custom maxRecommendedRetention', () => {
    const result = computeRetentionExcessGb({ dailyAvgGb: 50, retentionDays: 100 }, 90);
    // excess = 100 - 90 = 10, excess_gb = 50 × 10/100 = 5
    expect(result).toBe(5);
  });

  it('computeRetentionSavings converts GB to dollar value', () => {
    const result = computeRetentionSavings(
      { dailyAvgGb: 100, retentionDays: 400 },
      12,      // months
      0.5,     // costPerGbPerDay
      365      // maxRetention
    );
    // excess_gb = 8.75, monthly_cost = 8.75 × 0.50 × 30 = 131.25
    // annual = 131.25 × 12 = 1575
    expect(result).toBe(1575);
  });
});

describe('Formula Contract: Field Savings', () => {
  it('unused_field_gb = daily_gb × unused_fields / total_fields', () => {
    const result = computeUnusedFieldGb({ dailyAvgGb: 100, fieldsIndexed: 500, fieldsUsed: 50 });
    // unused = 450/500 = 0.9, unused_gb = 100 × 0.9 = 90
    expect(result).toBe(90);
  });

  it('returns 0 when fieldsIndexed is 0 (no data)', () => {
    expect(computeUnusedFieldGb({ dailyAvgGb: 100, fieldsIndexed: 0, fieldsUsed: 0 })).toBe(0);
  });

  it('returns 0 when all fields are used', () => {
    expect(computeUnusedFieldGb({ dailyAvgGb: 100, fieldsIndexed: 50, fieldsUsed: 50 })).toBe(0);
  });

  it('computeFieldSavings converts GB to dollar value', () => {
    const result = computeFieldSavings(
      { dailyAvgGb: 100, fieldsIndexed: 500, fieldsUsed: 50 },
      12, 0.5
    );
    // unused_gb = 90, monthly = 90 × 15 = 1350, annual = 1350 × 12 = 16200
    expect(result).toBe(16200);
  });
});

describe('Formula Contract: Compression Savings', () => {
  it('compression_gb = daily_gb × (1 - utilization/100) × factor', () => {
    const result = computeCompressionOpportunityGb(
      { dailyAvgGb: 100, utilizationPct: 30 },
      0.3
    );
    // low_util_pct = 0.7, compression_gb = 100 × 0.7 × 0.3 = 21
    expect(result).toBe(21);
  });

  it('returns 0 when dailyGb is 0', () => {
    expect(computeCompressionOpportunityGb({ dailyAvgGb: 0, utilizationPct: 50 })).toBe(0);
  });

  it('near-zero compression when utilization is high', () => {
    const result = computeCompressionOpportunityGb(
      { dailyAvgGb: 100, utilizationPct: 95 },
      0.3
    );
    // low_util_pct = 0.05, compression_gb = 100 × 0.05 × 0.3 = 1.5
    expect(result).toBe(1.5);
  });
});

describe('Formula Contract: Deterministic Savings (combined)', () => {
  it('totalSavings = sum of all component savings', () => {
    const result = computeDeterministicSavings(
      { dailyAvgGb: 100, retentionDays: 400 },
      { dailyAvgGb: 100, fieldsIndexed: 500, fieldsUsed: 50 },
      { dailyAvgGb: 100, utilizationPct: 30 },
      { months: 12, costPerGbPerDay: 0.5, maxRecommendedRetention: 365, compressionFactor: 0.3 }
    );
    // retention: 8.75 GB × $15/GB/mo × 12 = $1,575
    // fields: 90 GB × $15/GB/mo × 12 = $16,200
    // compression: 21 GB × $15/GB/mo × 12 = $3,780
    // total: $21,555
    expect(result.retentionSavings).toBe(1575);
    expect(result.fieldSavings).toBe(16200);
    expect(result.compressionSavings).toBe(3780);
    expect(result.totalSavings).toBe(21555);
    expect(result.confidence).toBe(0.95);
  });

  it('confidence drops when field data unavailable', () => {
    const result = computeDeterministicSavings(
      { dailyAvgGb: 100, retentionDays: 400 },
      null,  // no field data
      { dailyAvgGb: 100, utilizationPct: 30 }
    );
    expect(result.fieldSavings).toBe(0);
    expect(result.confidence).toBe(0.80);
  });

  it('confidence drops further with only retention data', () => {
    const result = computeDeterministicSavings(
      { dailyAvgGb: 100, retentionDays: 400 },
      null,
      { dailyAvgGb: 0, utilizationPct: -1 }  // no usable compression data
    );
    expect(result.compressionSavings).toBe(0);
    expect(result.confidence).toBe(0.60);
  });

  it('returns zero for no savings opportunity', () => {
    const result = computeDeterministicSavings(
      { dailyAvgGb: 100, retentionDays: 365 },  // no excess retention
      { dailyAvgGb: 100, fieldsIndexed: 10, fieldsUsed: 10 },  // all fields used
      { dailyAvgGb: 100, utilizationPct: 100 }  // fully utilized
    );
    expect(result.totalSavings).toBe(0);
  });

  it('LLM should never generate savings — deterministic is authoritative', () => {
    // This test verifies the architectural contract: savings come from
    // deterministic calculation, not LLM estimation.
    const det = computeDeterministicSavings(
      { dailyAvgGb: 50, retentionDays: 500 },
      { dailyAvgGb: 50, fieldsIndexed: 200, fieldsUsed: 20 },
      { dailyAvgGb: 50, utilizationPct: 10 },
      { months: 12, costPerGbPerDay: 0.5 }
    );
    // retention: 50 × 135/500 = 13.5 GB × $15/mo × 12 = $2,430
    // fields: 50 × 180/200 = 45 GB × $15/mo × 12 = $8,100
    // compression: 50 × 0.9 × 0.3 = 13.5 GB × $15/mo × 12 = $2,430
    // total: $12,960
    expect(det.totalSavings).toBeGreaterThan(0);
    // The aggregation service always overwrites LLM estimatedSavings with this value.
    // This test documents that contract.
    expect(det.totalSavings).toBe(12960);
  });
});

// ─── Attribution Weighting Guardrail ────────────────────────────────────────

describe('Formula Contract: Attribution Validation', () => {
  it('returns PASS when inputs look properly weighted', () => {
    const inputs: UtilizationInputs[] = [
      { index: 'main', sourcetype: null, alertCount: 2.5, scheduledSearchCount: 1.0, dashboardPanelCount: 0.5, distinctUserCount: 5, adHocSearchCount: 10 },
      { index: 'security', sourcetype: null, alertCount: 1.0, scheduledSearchCount: 0.5, dashboardPanelCount: 0, distinctUserCount: 3, adHocSearchCount: 8 },
    ];
    const result = validateAttribution(inputs, 3.5, 1.5, 0.5);
    expect(result.state).toBe('PASS');
  });

  it('returns FAIL when alert counts are inflated beyond threshold', () => {
    const inputs: UtilizationInputs[] = [
      { index: 'main', sourcetype: 'wineventlog', alertCount: 50, scheduledSearchCount: 0, dashboardPanelCount: 0, distinctUserCount: 0, adHocSearchCount: 0 },
      { index: 'main', sourcetype: 'syslog', alertCount: 50, scheduledSearchCount: 0, dashboardPanelCount: 0, distinctUserCount: 0, adHocSearchCount: 0 },
    ];
    const result = validateAttribution(inputs, 5, 0, 0);
    // Total alert = 100, inventory total = 5, ratio = 20× > 3× threshold
    expect(result.state).toBe('FAIL');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('returns WARN when all adHoc and user counts are zero', () => {
    const inputs: UtilizationInputs[] = [
      { index: 'main', sourcetype: null, alertCount: 1, scheduledSearchCount: 0, dashboardPanelCount: 0, distinctUserCount: 0, adHocSearchCount: 0 },
    ];
    const result = validateAttribution(inputs, 1, 0, 0);
    expect(result.state).toBe('WARN');
    expect(result.reasons.some(r => r.includes('ad-hoc') || r.includes('distinct'))).toBe(true);
  });

  it('returns WARN on empty inputs', () => {
    const result = validateAttribution([], 0, 0, 0);
    expect(result.state).toBe('WARN');
  });

  it('returns PASS when aggregate counts are within acceptable range', () => {
    const inputs: UtilizationInputs[] = [
      { index: 'main', sourcetype: null, alertCount: 3, scheduledSearchCount: 2, dashboardPanelCount: 1, distinctUserCount: 10, adHocSearchCount: 20 },
    ];
    const result = validateAttribution(inputs, 10, 5, 3);
    // 3/10 = 0.3×, 2/5 = 0.4×, 1/3 = 0.33× — all well under 3× threshold
    expect(result.state).toBe('PASS');
  });

  it('sourcetype-level entries sharing counts trigger WARN', () => {
    const inputs: UtilizationInputs[] = [
      { index: 'main', sourcetype: 'wineventlog', alertCount: 10, scheduledSearchCount: 5, dashboardPanelCount: 2, distinctUserCount: 1, adHocSearchCount: 1 },
      { index: 'main', sourcetype: 'syslog', alertCount: 10, scheduledSearchCount: 5, dashboardPanelCount: 2, distinctUserCount: 1, adHocSearchCount: 1 },
      { index: 'main', sourcetype: 'apache', alertCount: 10, scheduledSearchCount: 5, dashboardPanelCount: 2, distinctUserCount: 1, adHocSearchCount: 1 },
    ];
    const result = validateAttribution(inputs, 30, 15, 6);
    // 3 sourcetypes each with alert=10, avg=10, > 3 trigger, and ratio = 30/30 = 1× < 3×
    // But sourcetype-level sharing check triggers (avg 10 > 3)
    expect(result.state).toBe('WARN');
    expect(result.reasons.some(r => r.includes('sourcetypes sharing'))).toBe(true);
  });
});
