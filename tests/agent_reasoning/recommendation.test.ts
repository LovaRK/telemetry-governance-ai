import fs from 'fs';
import path from 'path';

type TelemetryFixture = {
  name: string;
  search_count_30d: number;
  alerts_30d: number;
  annual_license_cost: number;
  utilization_score: number;
  detection_score: number;
  quality_score: number;
  security_critical: boolean;
  expected: {
    decision: 'KEEP' | 'REMOVE' | 'APPROVAL_REQUIRED' | 'OPTIMIZE';
    minConfidence: number;
    minSavings: number;
  };
};

type Decision = {
  decision: 'KEEP' | 'REMOVE' | 'APPROVAL_REQUIRED' | 'OPTIMIZE';
  confidence: number;
  estimatedSavings: number;
};

function evaluateDecision(f: TelemetryFixture): Decision {
  const lowUsage = f.search_count_30d <= 1;
  const highCost = f.annual_license_cost >= 1000;
  const weakValue = f.utilization_score < 20 && f.detection_score < 20;

  if (f.security_critical && lowUsage && highCost) {
    return {
      decision: 'APPROVAL_REQUIRED',
      confidence: 0.84,
      estimatedSavings: Math.round(f.annual_license_cost * 0.5),
    };
  }

  if (!f.security_critical && lowUsage && highCost && weakValue) {
    return {
      decision: 'REMOVE',
      confidence: 0.9,
      estimatedSavings: Math.round(f.annual_license_cost * 0.6),
    };
  }

  if (f.search_count_30d < 20 && f.annual_license_cost > 500) {
    return {
      decision: 'OPTIMIZE',
      confidence: 0.78,
      estimatedSavings: Math.round(f.annual_license_cost * 0.25),
    };
  }

  return {
    decision: 'KEEP',
    confidence: 0.92,
    estimatedSavings: 0,
  };
}

function loadFixture(name: string): TelemetryFixture {
  const p = path.join(process.cwd(), 'tests', 'fixtures', name);
  return JSON.parse(fs.readFileSync(p, 'utf8')) as TelemetryFixture;
}

describe('Agent Reasoning - Recommendation', () => {
  test('healthy fixture returns KEEP', () => {
    const f = loadFixture('healthy.json');
    const d = evaluateDecision(f);

    expect(d.decision).toBe(f.expected.decision);
    expect(d.confidence).toBeGreaterThanOrEqual(f.expected.minConfidence);
    expect(d.estimatedSavings).toBeGreaterThanOrEqual(f.expected.minSavings);
  });

  test('waste fixture returns REMOVE with positive savings', () => {
    const f = loadFixture('waste.json');
    const d = evaluateDecision(f);

    expect(d.decision).toBe(f.expected.decision);
    expect(d.confidence).toBeGreaterThanOrEqual(f.expected.minConfidence);
    expect(d.estimatedSavings).toBeGreaterThanOrEqual(f.expected.minSavings);
  });

  test('risky_removal fixture escalates to APPROVAL_REQUIRED', () => {
    const f = loadFixture('risky_removal.json');
    const d = evaluateDecision(f);

    expect(d.decision).toBe(f.expected.decision);
    expect(d.confidence).toBeGreaterThanOrEqual(f.expected.minConfidence);
    expect(d.estimatedSavings).toBeGreaterThanOrEqual(f.expected.minSavings);
  });
});
