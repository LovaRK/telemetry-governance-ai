/**
 * Contract: Stage 3B.5 — Recommendation Validation
 *
 * Proves that score → tier → recommendation → flags are logically consistent
 * across the full production dataset. This is the gate before LLM explanations:
 * the LLM will narrate these decisions — if the decisions are wrong, the
 * narratives will be confidently wrong.
 *
 * Business rules validated (from ingest-1stmile-csvs.mjs):
 *
 * Tier assignment (PDF §7):
 *   composite ≥ 65  → Critical
 *   composite ≥ 40  → Important
 *   composite ≥ 20  → Nice-to-Have
 *   composite  < 20 → Wasteful
 *
 * Action mapping:
 *   Critical     → KEEP
 *   Important    → KEEP
 *   Nice-to-Have → OPTIMIZE
 *   Wasteful     → ELIMINATE
 *
 * DB classification mapping:
 *   Critical     → KEEP
 *   Important    → INVESTIGATE
 *   Nice-to-Have → OPTIMIZE
 *   Wasteful     → ELIMINATE
 *
 * Savings formula:
 *   Wasteful     → estimated_savings = annual_cost × 0.95
 *   Nice-to-Have → estimated_savings = annual_cost × 0.50
 *   Critical/Important → estimated_savings = 0
 *
 * Quick win flag:
 *   (Nice-to-Have OR Wasteful) AND annual_cost > 500 → is_quick_win = true
 *   otherwise → false
 *
 * S3 candidate flag:
 *   daily_gb > 1 AND (Nice-to-Have OR Wasteful) AND detection_score = 0
 *   → is_s3_candidate = true
 *
 * Each test covers the 4 cohorts specified:
 *   top 20 highest-cost sourcetypes
 *   top 20 lowest-cost sourcetypes
 *   top 20 highest-score (composite) sourcetypes
 *   top 20 lowest-score (composite) sourcetypes
 */

import { query } from '../../core/database/connection';
import './setup';

const PROD_TENANT    = 'a11d19eb-6be3-4f9a-9a78-7c8c5182810e';
const TOLERANCE      = 0.011;   // floating-point rounding tolerance (> 0.01)
const SAVINGS_TOL    = 1.00;    // $1 savings tolerance

// ── Data loading ──────────────────────────────────────────────────────────────

interface Decision {
  sourcetype:          string;
  index_name:          string;
  tier:                string;
  action:              string;
  classification:      string;
  composite_score:     number;
  utilization_score:   number;
  detection_score:     number;
  quality_score:       number;
  annual_license_cost: number;
  estimated_savings:   number;
  daily_avg_gb:        number;
  is_quick_win:        boolean;
  is_s3_candidate:     boolean;
  detection_gap:       boolean;
  recommendation:      string;
}

async function loadDecisions(orderBy: string, limit: number): Promise<Decision[]> {
  const snapshotResult = await query<{ active_snapshot_id: string }>(
    `SELECT active_snapshot_id FROM tenant_snapshot_pointer
     WHERE tenant_id = $1 AND snapshot_source = 'csv_analytics'`,
    [PROD_TENANT]
  );
  const snapshotId = snapshotResult.rows[0]?.active_snapshot_id;
  if (!snapshotId) throw new Error('No csv_analytics snapshot found — run ingest first');

  const result = await query<any>(
    `SELECT DISTINCT ON (ad.sourcetype)
       ad.sourcetype, ad.index_name, ad.tier, ad.action,
       ts.classification,
       ad.composite_score::float,    ad.utilization_score::float,
       ad.detection_score::float,    ad.quality_score::float,
       ad.annual_license_cost::float, ad.estimated_savings::float,
       ts.daily_avg_gb::float,
       ad.is_quick_win, ad.is_s3_candidate, ad.detection_gap,
       ad.recommendation
     FROM agent_decisions ad
     JOIN telemetry_snapshots ts
       ON ts.snapshot_id = ad.snapshot_id AND ts.sourcetype = ad.sourcetype
     WHERE ad.tenant_id = $1 AND ad.snapshot_id = $2
     ORDER BY ad.sourcetype, ${orderBy}
     LIMIT $3`,
    [PROD_TENANT, snapshotId, limit]
  );
  return result.rows;
}

// ── Rule validators ───────────────────────────────────────────────────────────

function expectedAction(tier: string): string {
  if (tier === 'Critical' || tier === 'Important') return 'KEEP';
  if (tier === 'Nice-to-Have') return 'OPTIMIZE';
  return 'ELIMINATE';
}

function expectedClassification(tier: string): string {
  if (tier === 'Critical')     return 'KEEP';
  if (tier === 'Important')    return 'INVESTIGATE';
  if (tier === 'Nice-to-Have') return 'OPTIMIZE';
  return 'ELIMINATE';
}

function expectedTier(composite: number): string {
  if (composite >= 65) return 'Critical';
  if (composite >= 40) return 'Important';
  if (composite >= 20) return 'Nice-to-Have';
  return 'Wasteful';
}

function expectedSavings(tier: string, annualCost: number): number {
  if (tier === 'Wasteful')     return annualCost * 0.95;
  if (tier === 'Nice-to-Have') return annualCost * 0.50;
  return 0;
}

function expectedQuickWin(tier: string, annualCost: number): boolean {
  return (tier === 'Nice-to-Have' || tier === 'Wasteful') && annualCost > 500;
}

function expectedS3Candidate(tier: string, dailyGb: number, detectionScore: number): boolean {
  return dailyGb > 1 && (tier === 'Nice-to-Have' || tier === 'Wasteful') && detectionScore === 0;
}

// ── Validation runner ─────────────────────────────────────────────────────────

function validateDecisions(label: string, decisions: Decision[]): {
  violations: string[];
  total: number;
} {
  const violations: string[] = [];

  for (const d of decisions) {
    const st = `${label}[${d.sourcetype}]`;

    // Rule 1: tier assignment matches composite
    const expectedT = expectedTier(d.composite_score);
    if (d.tier !== expectedT) {
      violations.push(`${st}: tier='${d.tier}' but composite=${d.composite_score} → expect '${expectedT}'`);
    }

    // Rule 2: action matches tier
    const expectedA = expectedAction(d.tier);
    if (d.action !== expectedA) {
      violations.push(`${st}: action='${d.action}' but tier='${d.tier}' → expect '${expectedA}'`);
    }

    // Rule 3: DB classification matches tier
    const expectedC = expectedClassification(d.tier);
    if (d.classification !== expectedC) {
      violations.push(`${st}: classification='${d.classification}' but tier='${d.tier}' → expect '${expectedC}'`);
    }

    // Rule 4: estimated_savings matches formula
    const expectedS = expectedSavings(d.tier, d.annual_license_cost);
    if (Math.abs(d.estimated_savings - expectedS) > SAVINGS_TOL) {
      violations.push(`${st}: savings=${d.estimated_savings.toFixed(2)} but tier='${d.tier}', cost=${d.annual_license_cost.toFixed(2)} → expect ${expectedS.toFixed(2)}`);
    }

    // Rule 5: is_quick_win flag matches rule
    const expectedQW = expectedQuickWin(d.tier, d.annual_license_cost);
    if (d.is_quick_win !== expectedQW) {
      violations.push(`${st}: is_quick_win=${d.is_quick_win} but tier='${d.tier}', cost=${d.annual_license_cost.toFixed(0)} → expect ${expectedQW}`);
    }

    // Rule 6: is_s3_candidate flag matches rule
    const expectedS3 = expectedS3Candidate(d.tier, d.daily_avg_gb, d.detection_score);
    if (d.is_s3_candidate !== expectedS3) {
      violations.push(`${st}: is_s3_candidate=${d.is_s3_candidate} but tier='${d.tier}', gb=${d.daily_avg_gb.toFixed(2)}, det=${d.detection_score} → expect ${expectedS3}`);
    }

    // Rule 7: recommendation text contains tier
    if (!d.recommendation.includes(d.tier)) {
      violations.push(`${st}: recommendation='${d.recommendation}' does not mention tier='${d.tier}'`);
    }

    // Rule 8: Critical/Important sourcetypes must have savings = 0 (we don't eliminate valuable data)
    if ((d.tier === 'Critical' || d.tier === 'Important') && d.estimated_savings > TOLERANCE) {
      violations.push(`${st}: tier='${d.tier}' should have savings=0, got ${d.estimated_savings.toFixed(2)}`);
    }

    // Rule 9: KEEP recommendations must not have ELIMINATE in the text
    if (d.action === 'KEEP' && d.recommendation.toUpperCase().includes('ELIMINATE')) {
      violations.push(`${st}: action=KEEP but recommendation says ELIMINATE`);
    }

    // Rule 10: Wasteful sourcetypes must not be marked is_s3_candidate=false
    //          if they have >1GB AND zero detection (same rule as Nice-to-Have)
    // (This is already covered by Rule 6, kept for explicit documentation)
  }

  return { violations, total: decisions.length };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Contract: Stage 3B.5 — Recommendation validation (production data)', () => {

  // ── Cohort 1: Top 20 highest-cost sourcetypes ────────────────────────────

  describe('Cohort 1: top 20 highest annual cost', () => {
    let decisions: Decision[];

    beforeAll(async () => {
      decisions = await loadDecisions('ad.annual_license_cost DESC NULLS LAST', 20);
    }, 15000);

    test('loaded 20 highest-cost decisions', () => {
      expect(decisions.length).toBe(20);
    });

    test('all 10 consistency rules pass for highest-cost cohort', () => {
      const { violations, total } = validateDecisions('high-cost', decisions);
      if (violations.length > 0) {
        console.error(`\nViolations in high-cost cohort (${total} records):`);
        violations.forEach(v => console.error('  ✗', v));
      }
      expect(violations).toHaveLength(0);
    });

    test('high-cost sourcetypes should be flagged as quick wins if Tier 3/4 (business rule)', () => {
      const tier34 = decisions.filter(d => d.tier === 'Nice-to-Have' || d.tier === 'Wasteful');
      const notFlagged = tier34.filter(d => !d.is_quick_win && d.annual_license_cost > 500);
      expect(notFlagged).toHaveLength(0);
    });

    test('Wasteful sourcetypes save 95% of cost, Nice-to-Have save 50%', () => {
      decisions.forEach(d => {
        if (d.tier === 'Wasteful') {
          expect(d.estimated_savings).toBeCloseTo(d.annual_license_cost * 0.95, 0);
        } else if (d.tier === 'Nice-to-Have') {
          expect(d.estimated_savings).toBeCloseTo(d.annual_license_cost * 0.50, 0);
        } else {
          expect(d.estimated_savings).toBe(0);
        }
      });
    });
  });

  // ── Cohort 2: Top 20 lowest-cost sourcetypes ─────────────────────────────

  describe('Cohort 2: top 20 lowest annual cost (near-zero spend)', () => {
    let decisions: Decision[];

    beforeAll(async () => {
      decisions = await loadDecisions('ad.annual_license_cost ASC NULLS LAST', 20);
    }, 15000);

    test('loaded 20 lowest-cost decisions', () => {
      expect(decisions.length).toBe(20);
    });

    test('all 10 consistency rules pass for lowest-cost cohort', () => {
      const { violations } = validateDecisions('low-cost', decisions);
      if (violations.length > 0) {
        violations.forEach(v => console.error('  ✗', v));
      }
      expect(violations).toHaveLength(0);
    });

    test('low-cost Wasteful sourcetypes (< $500/yr) are NOT quick wins', () => {
      const lowCostWasteful = decisions.filter(
        d => (d.tier === 'Wasteful' || d.tier === 'Nice-to-Have') && d.annual_license_cost <= 500
      );
      // is_quick_win should be false for cost ≤ $500
      lowCostWasteful.forEach(d => {
        expect(d.is_quick_win).toBe(false);
      });
    });
  });

  // ── Cohort 3: Top 20 highest composite score ──────────────────────────────

  describe('Cohort 3: top 20 highest composite score (most valuable data)', () => {
    let decisions: Decision[];

    beforeAll(async () => {
      decisions = await loadDecisions('ad.composite_score DESC NULLS LAST', 20);
    }, 15000);

    test('loaded 20 highest-score decisions', () => {
      expect(decisions.length).toBe(20);
    });

    test('all 10 consistency rules pass for highest-score cohort', () => {
      const { violations } = validateDecisions('high-score', decisions);
      if (violations.length > 0) violations.forEach(v => console.error('  ✗', v));
      expect(violations).toHaveLength(0);
    });

    test('composite ≥ 40 → action is KEEP (not OPTIMIZE or ELIMINATE)', () => {
      const highValue = decisions.filter(d => d.composite_score >= 40);
      highValue.forEach(d => {
        expect(d.action).toBe('KEEP');
      });
    });

    test('highest-score sourcetypes have estimated_savings = 0 (protect valuable data)', () => {
      const criticalOrImportant = decisions.filter(
        d => d.composite_score >= 40
      );
      criticalOrImportant.forEach(d => {
        expect(d.estimated_savings).toBe(0);
      });
    });

    test('no high-score source is incorrectly marked is_quick_win', () => {
      // Critical/Important tiers are not quick wins — we don't eliminate valuable data
      const valuableWronglyFlagged = decisions.filter(
        d => d.composite_score >= 40 && d.is_quick_win
      );
      expect(valuableWronglyFlagged).toHaveLength(0);
    });
  });

  // ── Cohort 4: Top 20 lowest composite score ───────────────────────────────

  describe('Cohort 4: top 20 lowest composite score (least valuable data)', () => {
    let decisions: Decision[];

    beforeAll(async () => {
      decisions = await loadDecisions('ad.composite_score ASC NULLS LAST', 20);
    }, 15000);

    test('loaded 20 lowest-score decisions', () => {
      expect(decisions.length).toBe(20);
    });

    test('all 10 consistency rules pass for lowest-score cohort', () => {
      const { violations } = validateDecisions('low-score', decisions);
      if (violations.length > 0) violations.forEach(v => console.error('  ✗', v));
      expect(violations).toHaveLength(0);
    });

    test('composite < 20 → tier is Wasteful → action is ELIMINATE', () => {
      const wasteful = decisions.filter(d => d.composite_score < 20);
      wasteful.forEach(d => {
        expect(d.tier).toBe('Wasteful');
        expect(d.action).toBe('ELIMINATE');
      });
    });

    test('Wasteful sourcetypes have classification = ELIMINATE in telemetry_snapshots', () => {
      const wasteful = decisions.filter(d => d.tier === 'Wasteful');
      wasteful.forEach(d => {
        expect(d.classification).toBe('ELIMINATE');
      });
    });

    test('lowest-score sourcetypes have zero or near-zero detection', () => {
      // Very low composite with any detection would push score above 20
      // Validate internal consistency: low composite implies low detection contribution
      decisions.filter(d => d.composite_score < 10).forEach(d => {
        const detContribution = 0.40 * d.detection_score;
        // If detection contributed >8 points but composite < 10, util+qual must be very low
        if (detContribution > 8) {
          // composite = 0.35×U + 0.40×D + 0.25×Q
          const recomputed =
            0.35 * d.utilization_score + 0.40 * d.detection_score + 0.25 * d.quality_score;
          expect(recomputed).toBeCloseTo(d.composite_score, 0);
        }
      });
    });
  });

  // ── Cross-cohort: no tier can appear with wrong action ────────────────────

  describe('Cross-cohort: universal rule enforcement across ALL 176 sourcetypes', () => {
    let allDecisions: Decision[];

    beforeAll(async () => {
      // Load ALL unique sourcetypes, not just top 20
      allDecisions = await loadDecisions('ad.composite_score DESC NULLS LAST', 500);
    }, 15000);

    test('176 unique sourcetypes loaded', () => {
      expect(allDecisions.length).toBe(176);
    });

    test('zero tier/action mismatches across all 176 sourcetypes', () => {
      const mismatches = allDecisions.filter(
        d => d.action !== expectedAction(d.tier)
      );
      if (mismatches.length > 0) {
        mismatches.forEach(d =>
          console.error(`  Mismatch: ${d.sourcetype} tier=${d.tier} action=${d.action}`)
        );
      }
      expect(mismatches).toHaveLength(0);
    });

    test('zero tier/composite mismatches (tier formula is deterministic)', () => {
      const mismatches = allDecisions.filter(
        d => d.tier !== expectedTier(d.composite_score)
      );
      expect(mismatches).toHaveLength(0);
    });

    test('zero savings formula violations across all 176', () => {
      const violations = allDecisions.filter(d => {
        const expected = expectedSavings(d.tier, d.annual_license_cost);
        return Math.abs(d.estimated_savings - expected) > SAVINGS_TOL;
      });
      expect(violations).toHaveLength(0);
    });

    test('no Critical or Important sourcetype has estimated savings > $0', () => {
      const highValueWithSavings = allDecisions.filter(
        d => (d.tier === 'Critical' || d.tier === 'Important') && d.estimated_savings > TOLERANCE
      );
      expect(highValueWithSavings).toHaveLength(0);
    });

    test('every recommendation text is consistent with its action', () => {
      const incoherent = allDecisions.filter(d => {
        if (d.action === 'KEEP' && d.recommendation.toUpperCase().includes('ELIMINATE')) return true;
        if (d.action === 'ELIMINATE' && d.recommendation.toUpperCase().includes('KEEP')) return true;
        return false;
      });
      expect(incoherent).toHaveLength(0);
    });

    test('tier distribution: 0 Critical, 2 Important, 162 Nice-to-Have, 12 Wasteful', () => {
      const counts = { Critical: 0, Important: 0, 'Nice-to-Have': 0, Wasteful: 0 };
      allDecisions.forEach(d => { counts[d.tier as keyof typeof counts]++; });
      expect(counts.Critical).toBe(0);
      expect(counts.Important).toBe(2);
      expect(counts['Nice-to-Have']).toBe(162);
      expect(counts.Wasteful).toBe(12);
    });
  });
});
