/**
 * Golden Dataset — scoring parity with the datasensAI Calculation Guide
 *
 * Fixtures in fixtures.json are hand-derived from the guide's §11 worked
 * examples (the same numbers Teja's Data Sensei produces). This suite feeds
 * them through deterministic-scoring-engine.ts and asserts exact outputs
 * (±0.1 for rounding).
 *
 * If a fixture fails after a "harmless" engine change, scoring parity with
 * Data Sensei is broken — fix the engine, never the fixture, unless both
 * sides have agreed to a methodology change.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  computeUtilizationScores,
  computeDetectionScores,
  computeQualityScore,
  computeCompositeScore,
  computeROIScore,
  computeGainScope,
  computeLowValueSpend,
  assignTier,
  validateWeights,
  DEFAULT_WEIGHTS,
  UtilizationInputs,
  DetectionInputs,
  ScoredSourcetype,
  TierLabel,
} from '../../apps/api/services/deterministic-scoring-engine';

const fixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures.json'), 'utf-8')
);

type EnvFixture = (typeof fixtures.environment)[number];

const TOLERANCE = 0.1;

function keyOf(f: EnvFixture): string {
  return `${f.index}::${f.sourcetype}`;
}

describe('Golden dataset: calc-guide worked examples', () => {
  const env: EnvFixture[] = fixtures.environment;

  const utilizationInputs: UtilizationInputs[] = env.map(f => ({
    index: f.index,
    sourcetype: f.sourcetype,
    alertCount: f.inputs.alertCount,
    scheduledSearchCount: f.inputs.scheduledSearchCount,
    dashboardPanelCount: f.inputs.dashboardPanelCount,
    adHocSearchCount: f.inputs.adHocSearchCount,
    distinctUserCount: f.inputs.distinctUserCount,
  }));

  const detectionInputs: DetectionInputs[] = env.map(f => ({
    index: f.index,
    sourcetype: f.sourcetype,
    mitreTechniqueCount: f.inputs.mitreTechniqueCount,
    lanternUsecaseCount: f.inputs.lanternUsecaseCount,
    activeAlertCount: f.inputs.activeAlertCount,
  }));

  const utilScores = computeUtilizationScores(utilizationInputs);
  const detScores = computeDetectionScores(detectionInputs);

  describe.each(env.map(f => [f.name, f] as const))('%s', (_name, f) => {
    const k = keyOf(f);

    test('utilization matches guide', () => {
      expect(utilScores.get(k)).toBeCloseTo(f.expected.utilization, 1);
    });

    test('detection matches guide (incl. hard rule and gap flags)', () => {
      const det = detScores.get(k)!;
      expect(det.score).toBeCloseTo(f.expected.detection, 1);
      expect(det.detectionGap).toBe(f.expected.detectionGap);
      expect(det.operationalGap).toBe(f.expected.operationalGap);
    });

    test('quality matches guide', () => {
      const q = computeQualityScore({
        index: f.index,
        sourcetype: f.sourcetype,
        weightedIssues: f.inputs.weightedIssues,
        dailyGb: f.inputs.dailyGb,
      });
      expect(q).toBeCloseTo(f.expected.quality, 1);
    });

    test('composite + tier match guide at balanced weights', () => {
      const composite = computeCompositeScore(
        utilScores.get(k)!,
        detScores.get(k)!.score,
        computeQualityScore({
          index: f.index,
          sourcetype: f.sourcetype,
          weightedIssues: f.inputs.weightedIssues,
          dailyGb: f.inputs.dailyGb,
        }),
        DEFAULT_WEIGHTS
      );
      expect(Math.abs(composite - f.expected.composite)).toBeLessThanOrEqual(TOLERANCE);
      expect(assignTier(composite)).toBe(f.expected.tier as TierLabel);
    });
  });

  describe('non-default weight profiles (weight changes must not break math)', () => {
    const reweighted: Array<[string, any]> = fixtures.reweightedCases.map((c: any) => [c.name, c]);
    test.each(reweighted)(
      '%s',
      (_name, c) => {
        validateWeights(c.weights);
        const composite = computeCompositeScore(
          c.subScores.utilization,
          c.subScores.detection,
          c.subScores.quality,
          c.weights
        );
        expect(Math.abs(composite - c.expected.composite)).toBeLessThanOrEqual(TOLERANCE);
        expect(assignTier(composite)).toBe(c.expected.tier as TierLabel);
      }
    );

    test('weights not summing to 1.0 are rejected', () => {
      expect(() =>
        computeCompositeScore(50, 50, 50, { utilization: 0.5, detection: 0.5, quality: 0.5 })
      ).toThrow(/sum to 1.0/);
    });
  });

  describe('quality edge cases (guide §6)', () => {
    const edgeCases: Array<[string, any]> = fixtures.qualityEdgeCases.map((c: any) => [c.name, c]);
    test.each(edgeCases)(
      '%s',
      (_name, c) => {
        const q = computeQualityScore({
          index: 'x',
          sourcetype: 'y',
          weightedIssues: c.weightedIssues,
          dailyGb: c.dailyGb,
        });
        expect(q).toBeCloseTo(c.expected, 1);
      }
    );
  });

  describe('portfolio KPIs over the golden environment', () => {
    const scored: ScoredSourcetype[] = env.map(f => {
      const k = keyOf(f);
      const quality = computeQualityScore({
        index: f.index,
        sourcetype: f.sourcetype,
        weightedIssues: f.inputs.weightedIssues,
        dailyGb: f.inputs.dailyGb,
      });
      const composite = computeCompositeScore(
        utilScores.get(k)!, detScores.get(k)!.score, quality, DEFAULT_WEIGHTS
      );
      return {
        index: f.index,
        sourcetype: f.sourcetype,
        utilizationScore: utilScores.get(k)!,
        detectionScore: detScores.get(k)!.score,
        qualityScore: quality,
        compositeScore: composite,
        tier: assignTier(composite),
        dailyGb: f.inputs.dailyGb,
        annualCostUsd: 0, // set per cost scenario below
        detectionGap: detScores.get(k)!.detectionGap,
        operationalGap: detScores.get(k)!.operationalGap,
      };
    });

    test('ROI score', () => {
      expect(computeROIScore(scored)).toBeCloseTo(fixtures.portfolioKpis.roiScore, 1);
    });

    test('GainScope %', () => {
      expect(computeGainScope(scored)).toBeCloseTo(fixtures.portfolioKpis.gainScopePct, 1);
    });

    test('Low-Value spend at $3,650/GB/yr and at $183/GB/yr (tally config)', () => {
      const at = (costPerGbYear: number) =>
        computeLowValueSpend(
          scored.map(s => ({ ...s, annualCostUsd: s.dailyGb * costPerGbYear }))
        );
      expect(at(3650)).toBeCloseTo(fixtures.portfolioKpis.lowValueSpendAt3650, 0);
      expect(at(183)).toBeCloseTo(fixtures.portfolioKpis.lowValueSpendAt183, 0);
    });
  });
});
