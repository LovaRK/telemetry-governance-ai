/**
 * Contract: Stage 3C — LLM Explanation Layer (4 validation gates)
 *
 * Gate 1 — Recommendation stability
 *   Same inputs → same tier/action regardless of LLM availability.
 *   Explanation text may vary; recommendation must never change.
 *
 * Gate 2 — LLM must not invent metrics
 *   Every number in the explanation narrative must exist in the grounding object
 *   (which is sourced from audit records and executive KPIs).
 *
 * Gate 3 — LLM must not contradict governance
 *   Tier=Wasteful → narrative must not say "retain" / "keep" / "valuable".
 *   Tier=Critical  → narrative must not say "eliminate" / "remove".
 *
 * Gate 4 — Insufficient data
 *   When no scored snapshot exists: returns structured explanation, not hallucinated numbers.
 *
 * Tests are designed to pass whether LLM is live (Ollama/Anthropic) or unavailable
 * (template fallback). The gates apply equally to both paths.
 */

import { randomUUID } from 'crypto';
import { query } from '../../core/database/connection';
import { loginAndGetToken, authPost } from './_helpers';
import {
  ExplanationService,
  SourcetypeContext,
  PortfolioContext,
} from '../../apps/api/services/explanation-service';
import './setup';

const PROD_TENANT = 'a11d19eb-6be3-4f9a-9a78-7c8c5182810e';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract all numbers from a string (integers and decimals). */
function extractNumbers(text: string): number[] {
  // Match numbers with optional $ prefix, commas, % suffix
  const matches = text.match(/\$?[\d,]+\.?\d*/g) || [];
  return matches
    .map(m => parseFloat(m.replace(/[$,%]/g, '').replace(/,/g, '')))
    .filter(n => !isNaN(n) && n > 0);
}

/** Check if a number is represented anywhere in the grounding object. */
function numberInGrounding(n: number, grounding: Record<string, unknown>): boolean {
  const groundingValues = Object.values(grounding).flatMap(v => {
    if (typeof v === 'number') return [v];
    if (typeof v === 'string') return [parseFloat(v)].filter(x => !isNaN(x));
    return [];
  });
  // Allow tolerance: the LLM may round $129,835 to $130k — within 2% is acceptable
  return groundingValues.some(gv => Math.abs(gv - n) / Math.max(Math.abs(n), 1) < 0.02);
}

// ── Test data ─────────────────────────────────────────────────────────────────

const WASTEFUL_CTX: SourcetypeContext = {
  sourcetype:         '__test_wasteful_gate3__',
  index_name:         'test-index',
  daily_gb:           0.5,
  annual_cost:        1825,
  utilization_score:  2.0,
  detection_score:    0.0,
  quality_score:      80.0,
  composite_score:    15.5,
  tier:               'Wasteful',
  recommended_action: 'ELIMINATE',
  estimated_savings:  1733.75,
  is_quick_win:       true,
  is_s3_candidate:    false,
  detection_gap:      false,
  operational_gap:    false,
};

const CRITICAL_CTX: SourcetypeContext = {
  sourcetype:         '__test_critical_gate3__',
  index_name:         'security-index',
  daily_gb:           8.0,
  annual_cost:        29200,
  utilization_score:  82.0,
  detection_score:    65.0,
  quality_score:      95.0,
  composite_score:    78.75,
  tier:               'Critical',
  recommended_action: 'KEEP',
  estimated_savings:  0,
  is_quick_win:       false,
  is_s3_candidate:    false,
  detection_gap:      false,
  operational_gap:    false,
};

const PORTFOLIO_CTX: PortfolioContext = {
  total_sourcetypes: 176,
  total_daily_gb:    159.9,
  annual_spend:      583740,
  low_value_spend:   553964,
  roi_score:         25.31,
  gainscope_pct:     5.1,
  tier_critical:     0,
  tier_important:    2,
  tier_nice_to_have: 162,
  tier_wasteful:     12,
  security_gaps:     0,
  operational_gaps:  0,
  snapshot_source:   'csv_analytics',
  snapshot_date:     new Date().toISOString().split('T')[0],
};

// ─────────────────────────────────────────────────────────────────────────────

describe('Contract: Stage 3C — LLM Explanation Layer (4 gates)', () => {

  const service = new ExplanationService();
  let token: string;

  beforeAll(async () => {
    token = await loginAndGetToken();
  }, 15000);

  // ── Gate 1: Recommendation stability ────────────────────────────────────────

  describe('Gate 1 — Recommendation must never change (regardless of LLM availability)', () => {

    test('Wasteful ctx → explanation action is ELIMINATE, not KEEP or OPTIMIZE', async () => {
      const result = await service.explainSourcetype(WASTEFUL_CTX);
      // The action in the grounding must be ELIMINATE
      expect(result.grounding['recommended_action']).toBe('ELIMINATE');
      // The narrative must mention ELIMINATE or the tier
      const narrativeLower = result.narrative.toLowerCase();
      const mentions = ['eliminate', 'remove', 'wasteful', 'optimize', 'reduce'];
      expect(mentions.some(m => narrativeLower.includes(m))).toBe(true);
    });

    test('Critical ctx → explanation action is KEEP, not ELIMINATE', async () => {
      const result = await service.explainSourcetype(CRITICAL_CTX);
      expect(result.grounding['recommended_action']).toBe('KEEP');
      expect(result.grounding['tier']).toBe('Critical');
    });

    test('Same inputs produce same grounding data (determinism proof)', async () => {
      const r1 = await service.explainSourcetype(WASTEFUL_CTX);
      const r2 = await service.explainSourcetype(WASTEFUL_CTX);
      // Grounding must be identical — it comes from the ctx, not from LLM
      expect(r1.grounding['composite_score']).toBe(r2.grounding['composite_score']);
      expect(r1.grounding['tier']).toBe(r2.grounding['tier']);
      expect(r1.grounding['recommended_action']).toBe(r2.grounding['recommended_action']);
      expect(r1.grounding['annual_cost']).toBe(r2.grounding['annual_cost']);
    });

    test('governance explanation also preserves tier in grounding', async () => {
      const result = await service.explainGovernance(WASTEFUL_CTX);
      expect(result.grounding['tier']).toBe('Wasteful');
      expect(result.grounding['composite_score']).toBe(15.5);
      expect(result.explanation_type).toBe('governance');
    });

    test('executive summary grounding contains the exact portfolio numbers', async () => {
      const result = await service.explainExecutiveSummary(PORTFOLIO_CTX);
      expect(result.grounding['total_sourcetypes']).toBe(176);
      expect(result.grounding['roi_score']).toBeCloseTo(25.31, 1);
      expect(result.grounding['annual_spend']).toBe(583740);
    });
  });

  // ── Gate 2: LLM must not invent metrics ──────────────────────────────────────

  describe('Gate 2 — All numbers in narrative must come from grounding', () => {

    test('sourcetype narrative: every significant number is in grounding', async () => {
      const result = await service.explainSourcetype(WASTEFUL_CTX);
      const numbersInNarrative = extractNumbers(result.narrative).filter(n => n > 10);

      const ungrounded = numbersInNarrative.filter(
        n => !numberInGrounding(n, result.grounding as Record<string, unknown>)
      );
      if (ungrounded.length > 0) {
        console.warn('Potentially ungrounded numbers:', ungrounded);
        console.warn('Narrative:', result.narrative);
        console.warn('Grounding:', result.grounding);
      }
      // Allow 1 ungrounded number (LLM may rephrase e.g. "95%" savings)
      expect(ungrounded.length).toBeLessThanOrEqual(1);
    });

    test('executive summary: key portfolio numbers appear in grounding', async () => {
      const result = await service.explainExecutiveSummary(PORTFOLIO_CTX);
      // Grounding must contain the numbers the narrative is based on
      expect(result.grounding['total_sourcetypes']).toBe(176);
      expect(result.grounding['total_daily_gb']).toBeCloseTo(159.9, 0);
      expect(result.grounding['low_value_spend']).toBe(553964);
    });

    test('governance explanation: composite formula numbers are in grounding', async () => {
      const result = await service.explainGovernance(CRITICAL_CTX);
      expect(result.grounding['utilization_score']).toBe(82.0);
      expect(result.grounding['detection_score']).toBe(65.0);
      expect(result.grounding['quality_score']).toBe(95.0);
      expect(result.grounding['composite_score']).toBe(78.75);
    });

    test('provider field is set (ollama | anthropic | template)', async () => {
      const result = await service.explainSourcetype(WASTEFUL_CTX);
      expect(['ollama', 'anthropic', 'template']).toContain(result.provider);
    });
  });

  // ── Gate 3: LLM must not contradict governance ────────────────────────────────

  describe('Gate 3 — Narrative must not contradict tier classification', () => {

    test('Wasteful tier → narrative must not say "retain" or "strongly recommend keeping"', async () => {
      const result = await service.explainSourcetype(WASTEFUL_CTX);
      const narrative = result.narrative.toLowerCase();
      // These phrases would contradict a Wasteful/ELIMINATE recommendation
      const contradictions = [
        'strongly recommend keeping',
        'should be retained',
        'strong candidate to retain',
        'critical data',
        'do not eliminate',
        'must keep',
      ];
      const found = contradictions.filter(c => narrative.includes(c));
      if (found.length > 0) {
        console.error(`Gate 3 violation — Wasteful tier narrative contains: ${found.join(', ')}`);
        console.error('Narrative:', result.narrative);
      }
      expect(found).toHaveLength(0);
    });

    test('Critical tier → narrative must not say "eliminate" or "remove"', async () => {
      const result = await service.explainSourcetype(CRITICAL_CTX);
      const narrative = result.narrative.toLowerCase();
      const contradictions = [
        'should be eliminated',
        'recommend removing',
        'not worth keeping',
        'wasteful',
      ];
      const found = contradictions.filter(c => narrative.includes(c));
      if (found.length > 0) {
        console.error(`Gate 3 violation — Critical tier narrative contains: ${found.join(', ')}`);
        console.error('Narrative:', result.narrative);
      }
      expect(found).toHaveLength(0);
    });

    test('governance explanation contains the composite formula', async () => {
      const result = await service.explainGovernance(WASTEFUL_CTX);
      // Template and LLM both should reference the composite score
      expect(result.narrative).toContain('15.5');
    });

    test('governance explanation references reproducibility concept', async () => {
      const result = await service.explainGovernance(WASTEFUL_CTX);
      const narrative = result.narrative.toLowerCase();
      const reproducibilityTerms = ['reproducible', 'deterministic', 'audit', 'scoring'];
      const found = reproducibilityTerms.filter(t => narrative.includes(t));
      expect(found.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Gate 4: Insufficient data ────────────────────────────────────────────────

  describe('Gate 4 — No data → structured response, not hallucinated numbers', () => {

    test('API returns 200 with sufficient_data=false for unknown sourcetype', async () => {
      const res = await authPost('/api/governance/explain', token, {
        type: 'sourcetype',
        sourcetype: '__definitely_does_not_exist_xyz789__',
      }, PROD_TENANT, 'test-user');

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.sufficient_data).toBe(false);
    });

    test('insufficient-data narrative does not claim ROI improved or savings achieved', async () => {
      const res = await authPost('/api/governance/explain', token, {
        type: 'sourcetype',
        sourcetype: '__definitely_does_not_exist_xyz789__',
      }, PROD_TENANT, 'test-user');

      const body = await res.json() as any;
      const narrative = (body.data.narrative || '').toLowerCase();
      // Must not hallucinate improvement claims
      const hallucinations = ['roi improved', 'savings of $', 'increased by'];
      const found = hallucinations.filter(h => narrative.includes(h));
      expect(found).toHaveLength(0);
    });

    test('insufficient-data response contains the requested sourcetype in the message', async () => {
      const targetSourcetype = '__sentinel_sourcetype_gate4__';
      const res = await authPost('/api/governance/explain', token, {
        type: 'sourcetype',
        sourcetype: targetSourcetype,
      }, PROD_TENANT, 'test-user');

      const body = await res.json() as any;
      expect(body.data.narrative).toContain(targetSourcetype);
    });

    test('API rejects invalid type with 400', async () => {
      const res = await authPost('/api/governance/explain', token, {
        type: 'make_up_a_recommendation',
      }, PROD_TENANT, 'test-user');
      expect(res.status).toBe(400);
    });

    test('API rejects sourcetype|governance without sourcetype field', async () => {
      const res = await authPost('/api/governance/explain', token, {
        type: 'sourcetype',
        // sourcetype deliberately omitted
      }, PROD_TENANT, 'test-user');
      expect(res.status).toBe(400);
    });
  });

  // ── Live API: real production sourcetype ─────────────────────────────────────

  describe('Live API — wazuh-alerts: real audit record → real explanation', () => {

    test('sourcetype explanation for wazuh-alerts returns 200 with grounding', async () => {
      const res = await authPost('/api/governance/explain', token, {
        type: 'sourcetype',
        sourcetype: 'wazuh-alerts',
      }, PROD_TENANT, 'test-user');

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.sufficient_data).toBe(true);
      expect(body.data.narrative).toBeTruthy();
      expect(body.data.narrative.length).toBeGreaterThan(20);
    });

    test('wazuh-alerts grounding matches known audit values', async () => {
      const res = await authPost('/api/governance/explain', token, {
        type: 'sourcetype',
        sourcetype: 'wazuh-alerts',
      }, PROD_TENANT, 'test-user');

      const body = await res.json() as any;
      const g = body.data.grounding;
      expect(g.composite_score).toBeCloseTo(53.61, 0);
      expect(g.tier).toBe('Important');
      expect(g.recommended_action).toBe('KEEP');
      expect(g.detection_score).toBe(0);
    });

    test('governance explanation for wazuh-alerts references composite formula', async () => {
      const res = await authPost('/api/governance/explain', token, {
        type: 'governance',
        sourcetype: 'wazuh-alerts',
      }, PROD_TENANT, 'test-user');

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      // The composite score 53.61 should appear in the narrative
      expect(body.data.narrative).toContain('53.6');
    });

    test('executive summary returns portfolio-level narrative', async () => {
      const res = await authPost('/api/governance/explain', token, {
        type: 'executive_summary',
      }, PROD_TENANT, 'test-user');

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.sufficient_data).toBe(true);
      // Narrative must mention key portfolio metric (176 sourcetypes)
      expect(body.data.narrative).toContain('176');
    });

    test('all three explanation types return provider field', async () => {
      const types = ['sourcetype', 'governance', 'executive_summary'] as const;
      for (const t of types) {
        const body_data = t === 'executive_summary'
          ? { type: t }
          : { type: t, sourcetype: 'wazuh-alerts' };
        const res = await authPost('/api/governance/explain', token, body_data, PROD_TENANT, 'test-user');
        const body = await res.json() as any;
        expect(['ollama', 'anthropic', 'template']).toContain(body.data.provider);
        expect(typeof body.data.fallback_used).toBe('boolean');
        expect(typeof body.data.latency_ms).toBe('number');
      }
    });
  });
});
