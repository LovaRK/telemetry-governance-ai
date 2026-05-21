/**
 * Deterministic Scoring Engine
 *
 * Implements the exact mathematical formulas from the datasensAI Calculation & Methodology Guide.
 * These scores are reproducible, auditable, and environment-relative.
 *
 * Formula reference:
 *   Utilization  = (weighted_sum / max_weighted_sum) × 100
 *   Detection    = (0.40 × potential) + (0.60 × realized)
 *   Quality      = max(0, 100 − (issue_density × 2000))
 *   Composite    = (util_weight × utilization) + (det_weight × detection) + (qual_weight × quality)
 *   ROI Score    = avg(composite_score) across all sourcetypes
 *   GainScope %  = (Tier1+2 total GB / Total GB) × 100
 */

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface UtilizationInputs {
  index: string;
  sourcetype?: string | null;
  /** Active alerts referencing this sourcetype */
  alertCount: number;
  /** Scheduled searches referencing this sourcetype */
  scheduledSearchCount: number;
  /** Dashboard panels referencing this sourcetype */
  dashboardPanelCount: number;
  /** Distinct users who ran ad-hoc searches */
  distinctUserCount: number;
  /** Ad-hoc searches run */
  adHocSearchCount: number;
}

export interface DetectionInputs {
  index: string;
  sourcetype?: string | null;
  /** Number of MITRE ATT&CK techniques this sourcetype covers */
  mitreTechniqueCount: number;
  /** Number of Splunk Lantern use cases applicable */
  lanternUsecaseCount: number;
  /** Number of active alerts/detections for this sourcetype */
  activeAlertCount: number;
}

export interface QualityInputs {
  index: string;
  sourcetype?: string | null;
  /** Weighted parsing issues (DateParser × 0.5, others × 1.0) */
  weightedIssues: number;
  /** Daily GB for this sourcetype */
  dailyGb: number;
  /** Events per GB scaling factor (default: 1,000,000) */
  eventsPerGbFactor?: number;
}

export interface ScoringWeights {
  utilization: number;  // default 0.35
  detection: number;    // default 0.40
  quality: number;      // default 0.25
  // must sum to 1.0
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  utilization: 0.35,
  detection: 0.40,
  quality: 0.25,
};

export const SCORING_PROFILES: Record<string, ScoringWeights> = {
  balanced:          { utilization: 0.35, detection: 0.40, quality: 0.25 },
  security_first:    { utilization: 0.25, detection: 0.50, quality: 0.25 },
  operations_first:  { utilization: 0.50, detection: 0.25, quality: 0.25 },
  data_quality:      { utilization: 0.30, detection: 0.30, quality: 0.40 },
};

// ─── Tier Thresholds ─────────────────────────────────────────────────────────

export const TIER_THRESHOLDS = {
  CRITICAL:     65,   // composite ≥ 65
  IMPORTANT:    40,   // composite ≥ 40
  NICE_TO_HAVE: 20,   // composite ≥ 20
  // WASTEFUL:  < 20
} as const;

export type TierLabel = 'Critical' | 'Important' | 'Nice-to-Have' | 'Low-Value';

export function assignTier(compositeScore: number): TierLabel {
  if (compositeScore >= TIER_THRESHOLDS.CRITICAL)     return 'Critical';
  if (compositeScore >= TIER_THRESHOLDS.IMPORTANT)    return 'Important';
  if (compositeScore >= TIER_THRESHOLDS.NICE_TO_HAVE) return 'Nice-to-Have';
  return 'Low-Value';
}

// ─── Detection Gap Thresholds (configurable) ─────────────────────────────────

const DETECTION_GAP_TECHNIQUE_MIN  = 15;   // technique_count ≥ this to check gap
const DETECTION_GAP_COVERAGE_MAX   = 25;   // coverage_pct < this = gap fires
const OPERATIONAL_GAP_LANTERN_MIN  = 4;    // lantern_usecase_count ≥ this
const OPERATIONAL_GAP_ALERT_MAX    = 0;    // alert_count == 0

// ─── Score Calculations ───────────────────────────────────────────────────────

/**
 * Dimension 1 — Utilization Score
 *
 * weighted_sum(st) = (alerts × 3) + (scheduled × 3) + (dashboards × 2) + (adhoc × 1) + (users × 2)
 * utilization(st)  = (weighted_sum(st) / max_weighted_sum) × 100
 *
 * Relative score: the most-used sourcetype scores 100; all others scale proportionally.
 * Attribution weighting (1/N) must be applied before calling this — inputs should already
 * carry fractional counts when a search resolves to N sourcetypes.
 */
export function computeUtilizationScores(
  inputs: UtilizationInputs[]
): Map<string, number> {
  const weightedSums = new Map<string, number>();

  for (const inp of inputs) {
    const key = `${inp.index}::${inp.sourcetype || '_'}`;
    const ws = (inp.alertCount           * 3)
             + (inp.scheduledSearchCount * 3)
             + (inp.dashboardPanelCount  * 2)
             + (inp.adHocSearchCount     * 1)
             + (inp.distinctUserCount    * 2);
    weightedSums.set(key, ws);
  }

  const maxWeightedSum = Math.max(...Array.from(weightedSums.values()), 1); // avoid div/0

  const scores = new Map<string, number>();
  for (const [key, ws] of weightedSums) {
    scores.set(key, Math.round((ws / maxWeightedSum) * 100 * 10) / 10);
  }

  return scores;
}

/**
 * Dimension 2 — Detection Score
 *
 * mitre_potential    = min(100, technique_count × 1.25)
 * lantern_potential  = min(100, lantern_usecase_count × 6.0)
 * potential          = max(mitre_potential, lantern_potential)
 * realized           = (alert_count / max_alert_count_across_env) × 100
 * detection(st)      = (0.40 × potential) + (0.60 × realized)
 *
 * Hard rule: if technique_count == 0 AND lantern_count == 0 → detection = 0
 */
export function computeDetectionScores(
  inputs: DetectionInputs[]
): Map<string, { score: number; detectionGap: boolean; operationalGap: boolean }> {
  const maxAlertCount = Math.max(...inputs.map(i => i.activeAlertCount), 1);

  const results = new Map<string, { score: number; detectionGap: boolean; operationalGap: boolean }>();

  for (const inp of inputs) {
    const key = `${inp.index}::${inp.sourcetype || '_'}`;

    // Hard rule: no MITRE and no Lantern = 0
    if (inp.mitreTechniqueCount === 0 && inp.lanternUsecaseCount === 0) {
      results.set(key, {
        score: 0,
        detectionGap: false,
        operationalGap: false,
      });
      continue;
    }

    const mitrePotential   = Math.min(100, inp.mitreTechniqueCount  * 1.25);
    const lanternPotential = Math.min(100, inp.lanternUsecaseCount  * 6.0);
    const potential        = Math.max(mitrePotential, lanternPotential);
    const realized         = (inp.activeAlertCount / maxAlertCount) * 100;
    const score            = Math.round(((0.40 * potential) + (0.60 * realized)) * 10) / 10;

    // Detection gap: security data with thin coverage
    const coveragePct    = inp.mitreTechniqueCount > 0
      ? (inp.activeAlertCount / inp.mitreTechniqueCount) * 100
      : 0;
    const detectionGap   = inp.mitreTechniqueCount >= DETECTION_GAP_TECHNIQUE_MIN
                        && coveragePct < DETECTION_GAP_COVERAGE_MAX;

    // Operational gap: use cases exist but nobody has built alerts
    const operationalGap = inp.lanternUsecaseCount >= OPERATIONAL_GAP_LANTERN_MIN
                        && inp.activeAlertCount    <= OPERATIONAL_GAP_ALERT_MAX;

    results.set(key, { score, detectionGap, operationalGap });
  }

  return results;
}

/**
 * Dimension 3 — Quality Score
 *
 * weighted_issues = Σ hits (DateParserVerbose × 0.5, all others × 1.0)
 * approx_events   = daily_gb × 1,000,000
 * issue_density   = weighted_issues / approx_events
 * quality(st)     = max(0, 100 − (issue_density × 2000))
 *
 * Edge case: sourcetype missing from quality data → defaults to 100 (no known issues)
 * Edge case: daily_gb = 0 → cannot compute density → defaults to 100
 */
export function computeQualityScore(inp: QualityInputs): number {
  if (inp.dailyGb <= 0) return 100; // No volume — treat as clean
  const factor       = inp.eventsPerGbFactor ?? 1_000_000;
  const approxEvents = inp.dailyGb * factor;
  const issueDensity = inp.weightedIssues / approxEvents;
  return Math.max(0, Math.round((100 - (issueDensity * 2000)) * 10) / 10);
}

/**
 * Composite Score + Tier Assignment
 *
 * composite(st) = (util_weight × utilization) + (det_weight × detection) + (qual_weight × quality)
 *
 * NaN guard: raises error if any dimension is not a finite number.
 */
export function computeCompositeScore(
  utilization: number,
  detection: number,
  quality: number,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): number {
  // Validate weights sum to 1.0
  const sum = weights.utilization + weights.detection + weights.quality;
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(`Scoring weights must sum to 1.0. Got: ${sum}`);
  }

  // NaN guard
  if (!isFinite(utilization)) throw new Error(`Utilization score is not finite: ${utilization}`);
  if (!isFinite(detection))   throw new Error(`Detection score is not finite: ${detection}`);
  if (!isFinite(quality))     throw new Error(`Quality score is not finite: ${quality}`);

  const composite = (weights.utilization * utilization)
                  + (weights.detection   * detection)
                  + (weights.quality     * quality);

  return Math.round(composite * 10) / 10;
}

// ─── Portfolio-Level KPIs ─────────────────────────────────────────────────────

export interface ScoredSourcetype {
  index: string;
  sourcetype?: string | null;
  utilizationScore: number;
  detectionScore: number;
  qualityScore: number;
  compositeScore: number;
  tier: TierLabel;
  dailyGb: number;
  annualCostUsd: number;
  detectionGap: boolean;
  operationalGap: boolean;
}

/**
 * ROI Score = avg(composite_score) across all sourcetypes
 */
export function computeROIScore(scored: ScoredSourcetype[]): number {
  if (scored.length === 0) return 0;
  const avg = scored.reduce((sum, s) => sum + s.compositeScore, 0) / scored.length;
  return Math.round(avg * 10) / 10;
}

/**
 * GainScope % = (Tier 1+2 total GB / Total GB) × 100
 * "What percent of your daily volume is well-utilized?"
 */
export function computeGainScope(scored: ScoredSourcetype[]): number {
  const totalGb     = scored.reduce((sum, s) => sum + s.dailyGb, 0);
  if (totalGb === 0) return 0;
  const tier12Gb    = scored
    .filter(s => s.tier === 'Critical' || s.tier === 'Important')
    .reduce((sum, s) => sum + s.dailyGb, 0);
  return Math.round((tier12Gb / totalGb) * 100 * 10) / 10;
}

/**
 * Low-Value Spend = Σ(annual_cost) for Tier 3+4 sourcetypes
 */
export function computeLowValueSpend(scored: ScoredSourcetype[]): number {
  return scored
    .filter(s => s.tier === 'Nice-to-Have' || s.tier === 'Low-Value')
    .reduce((sum, s) => sum + s.annualCostUsd, 0);
}

/**
 * Validate that weights sum to 1.0
 */
export function validateWeights(weights: ScoringWeights): void {
  const sum = weights.utilization + weights.detection + weights.quality;
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(
      `Weights must sum to 1.0. Got: utilization=${weights.utilization}, ` +
      `detection=${weights.detection}, quality=${weights.quality} (sum=${sum})`
    );
  }
}

/**
 * Extract ScoringWeights from user config decisionWeights blob.
 * Falls back to DEFAULT_WEIGHTS if not set.
 */
export function extractWeightsFromConfig(decisionWeights: Record<string, number>): ScoringWeights {
  const w: ScoringWeights = {
    utilization: decisionWeights.utilization ?? DEFAULT_WEIGHTS.utilization,
    detection:   decisionWeights.detection   ?? DEFAULT_WEIGHTS.detection,
    quality:     decisionWeights.quality     ?? DEFAULT_WEIGHTS.quality,
  };
  validateWeights(w);
  return w;
}
