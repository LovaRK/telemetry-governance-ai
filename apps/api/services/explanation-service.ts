/**
 * Explanation Service — Stage 3C
 *
 * Architecture rule (enforced here):
 *   Deterministic Decision → Governance Evidence → LLM Explanation
 *   NOT: LLM → Decision
 *
 * The LLM receives pre-computed, audited facts and generates ONLY human-readable
 * narrative. It never recalculates scores, never assigns tiers, never invents numbers.
 *
 * Three explanation types:
 *   executive_summary — portfolio-level narrative (one per snapshot)
 *   sourcetype        — per-sourcetype reasoning (one per sourcetype)
 *   governance        — audit trail explanation for operators
 *
 * When LLM is unavailable, falls back to deterministic template text.
 * Template text is structurally equivalent but not AI-generated.
 * The fallback is always marked fallback_used=true.
 */

import { LLMRouter } from '../../../agents/reasoning/llm-router';

// ── Input types ───────────────────────────────────────────────────────────────

/** All numbers come from audit records or executive KPIs — LLM must not alter them. */
export interface SourcetypeContext {
  sourcetype:         string;
  index_name:         string;
  daily_gb:           number;
  annual_cost:        number;
  utilization_score:  number;
  detection_score:    number;
  quality_score:      number;
  composite_score:    number;
  tier:               string;   // Critical | Important | Nice-to-Have | Wasteful
  recommended_action: string;   // KEEP | OPTIMIZE | ELIMINATE
  estimated_savings:  number;
  is_quick_win:       boolean;
  is_s3_candidate:    boolean;
  detection_gap:      boolean;
  operational_gap:    boolean;
}

export interface PortfolioContext {
  total_sourcetypes:    number;
  total_daily_gb:       number;
  annual_spend:         number;
  low_value_spend:      number;
  roi_score:            number;
  gainscope_pct:        number;
  tier_critical:        number;
  tier_important:       number;
  tier_nice_to_have:    number;
  tier_wasteful:        number;
  security_gaps:        number;
  operational_gaps:     number;
  snapshot_source:      string;
  snapshot_date:        string;
}

export interface ExplanationResult {
  explanation_type: 'executive_summary' | 'sourcetype' | 'governance';
  narrative:        string;
  provider:         'ollama' | 'anthropic' | 'template';
  fallback_used:    boolean;
  latency_ms:       number;
  /** The exact numbers the narrative is based on — for Gate 2 validation. */
  grounding:        Record<string, unknown>;
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildExecutiveSummaryPrompt(ctx: PortfolioContext): string {
  return `You are a Splunk data optimization analyst. Write a concise executive summary (3-4 sentences, no bullet points) based ONLY on the following verified metrics. Do not invent numbers, estimates, or recommendations beyond what is provided.

VERIFIED METRICS:
- Total sourcetypes assessed: ${ctx.total_sourcetypes}
- Total daily ingest: ${ctx.total_daily_gb.toFixed(1)} GB/day
- Annual license spend: $${Math.round(ctx.annual_spend).toLocaleString()}
- Low-value spend (Tier 3+4): $${Math.round(ctx.low_value_spend).toLocaleString()}
- ROI Score: ${ctx.roi_score.toFixed(1)} / 100
- GainScope: ${ctx.gainscope_pct.toFixed(1)}% of ingest is in high-value tiers
- Tier distribution: ${ctx.tier_critical} Critical, ${ctx.tier_important} Important, ${ctx.tier_nice_to_have} Nice-to-Have, ${ctx.tier_wasteful} Wasteful
- Security coverage gaps: ${ctx.security_gaps}
- Operational coverage gaps: ${ctx.operational_gaps}

Write the summary now. Do not add headers. Do not use markdown. Do not say "Based on the metrics".`;
}

function buildSourcetypePrompt(ctx: SourcetypeContext): string {
  return `You are a Splunk data optimization analyst. Write a concise explanation (2-3 sentences) for this sourcetype recommendation, based ONLY on the verified scores below. Do not invent numbers. Do not change the recommendation.

VERIFIED SCORES:
- Sourcetype: ${ctx.sourcetype} (index: ${ctx.index_name})
- Daily volume: ${ctx.daily_gb.toFixed(2)} GB/day
- Annual cost: $${Math.round(ctx.annual_cost).toLocaleString()}
- Utilization score: ${ctx.utilization_score.toFixed(1)} / 100 (measures search usage, dashboards, alerts)
- Detection score: ${ctx.detection_score.toFixed(1)} / 100 (measures security/operational detection value)
- Quality score: ${ctx.quality_score.toFixed(1)} / 100 (measures parsing correctness)
- Composite score: ${ctx.composite_score.toFixed(1)} / 100
- Tier: ${ctx.tier}
- Recommended action: ${ctx.recommended_action}
- Estimated savings if actioned: $${Math.round(ctx.estimated_savings).toLocaleString()}
- Quick win opportunity: ${ctx.is_quick_win ? 'Yes' : 'No'}
- S3 archive candidate: ${ctx.is_s3_candidate ? 'Yes' : 'No'}
- Detection coverage gap: ${ctx.detection_gap ? 'Yes — has MITRE mapping but no active alerts' : 'No'}
- Operational gap: ${ctx.operational_gap ? 'Yes — has Lantern use cases but no active alerts' : 'No'}

Write the explanation now. Do not add headers. Do not use markdown. Include the recommended action and the primary reason.`;
}

function buildGovernancePrompt(ctx: SourcetypeContext): string {
  return `You are a governance analyst. Write a brief explanation (2-3 sentences) of how this recommendation was derived, for an operator reading the audit trail. Emphasize reproducibility and determinism.

AUDIT INPUTS:
- Sourcetype: ${ctx.sourcetype}
- Utilization score: ${ctx.utilization_score.toFixed(1)} (weight: 35%)
- Detection score: ${ctx.detection_score.toFixed(1)} (weight: 40%)
- Quality score: ${ctx.quality_score.toFixed(1)} (weight: 25%)
- Composite = (0.35 × ${ctx.utilization_score.toFixed(1)}) + (0.40 × ${ctx.detection_score.toFixed(1)}) + (0.25 × ${ctx.quality_score.toFixed(1)}) = ${ctx.composite_score.toFixed(1)}
- Tier thresholds: ≥65 Critical, ≥40 Important, ≥20 Nice-to-Have, <20 Wasteful
- Derived tier: ${ctx.tier}
- Derived action: ${ctx.recommended_action}
- This decision is stored in governance_audit_events and is fully reproducible from audit inputs.

Write the governance explanation now. Do not use markdown.`;
}

// ── Deterministic fallbacks ───────────────────────────────────────────────────

function templateExecutiveSummary(ctx: PortfolioContext): string {
  const pct = ctx.annual_spend > 0
    ? ((ctx.low_value_spend / ctx.annual_spend) * 100).toFixed(0)
    : '0';
  return (
    `The environment contains ${ctx.total_sourcetypes} assessed sourcetypes generating ` +
    `${ctx.total_daily_gb.toFixed(1)} GB/day of ingest. ` +
    `Only ${ctx.gainscope_pct.toFixed(1)}% of ingest volume falls into Critical or Important tiers, ` +
    `indicating significant optimization opportunities. ` +
    `Estimated annual savings potential is $${Math.round(ctx.low_value_spend).toLocaleString()} ` +
    `(${pct}% of total spend), concentrated in ${ctx.tier_nice_to_have} Nice-to-Have ` +
    `and ${ctx.tier_wasteful} Wasteful sourcetypes.` +
    (ctx.security_gaps > 0
      ? ` ${ctx.security_gaps} sourcetype${ctx.security_gaps > 1 ? 's have' : ' has'} MITRE ATT&CK coverage with insufficient active detection.`
      : '')
  );
}

function templateSourcetype(ctx: SourcetypeContext): string {
  const costStr = `$${Math.round(ctx.annual_cost).toLocaleString()}`;
  const savingsStr = ctx.estimated_savings > 0
    ? ` Actioning this recommendation could recover $${Math.round(ctx.estimated_savings).toLocaleString()} annually.`
    : '';

  let reason = '';
  if (ctx.utilization_score < 10 && ctx.detection_score === 0) {
    reason = 'Utilization is critically low with no active detections contributing to this data.';
  } else if (ctx.detection_score === 0 && ctx.utilization_score < 30) {
    reason = 'No active detections currently use this data and search utilization is limited.';
  } else if (ctx.utilization_score > 60) {
    reason = 'High search utilization indicates active operational use of this data.';
  } else if (ctx.detection_score > 40) {
    reason = 'This sourcetype contributes meaningfully to security or operational detection coverage.';
  } else {
    reason = `Composite score of ${ctx.composite_score.toFixed(1)} reflects moderate value across utilization, detection, and quality dimensions.`;
  }

  const s3note = ctx.is_s3_candidate
    ? ' High volume with zero detection coverage makes this a strong S3 archive candidate.'
    : '';
  const gapNote = ctx.operational_gap
    ? ' Operational use cases exist — review before reducing retention.'
    : '';

  return (
    `${ctx.sourcetype} costs approximately ${costStr} annually. ` +
    `${reason}${s3note}${gapNote} ` +
    `Recommendation: ${ctx.recommended_action}.${savingsStr}`
  ).trim();
}

function templateGovernance(ctx: SourcetypeContext): string {
  return (
    `This recommendation was generated deterministically by the datasensAI scoring engine. ` +
    `Composite score ${ctx.composite_score.toFixed(1)} = ` +
    `(0.35 × ${ctx.utilization_score.toFixed(1)}) + ` +
    `(0.40 × ${ctx.detection_score.toFixed(1)}) + ` +
    `(0.25 × ${ctx.quality_score.toFixed(1)}), ` +
    `placing this sourcetype in the ${ctx.tier} tier (action: ${ctx.recommended_action}). ` +
    `The decision is stored in governance_audit_events and is fully reproducible from stored audit inputs.`
  );
}

// ── Main service ──────────────────────────────────────────────────────────────

export class ExplanationService {
  private router: LLMRouter;

  constructor() {
    this.router = new LLMRouter();
  }

  async explainExecutiveSummary(ctx: PortfolioContext): Promise<ExplanationResult> {
    const start = Date.now();
    const grounding: Record<string, unknown> = { ...ctx };

    try {
      const prompt   = buildExecutiveSummaryPrompt(ctx);
      const { response, provider } = await this.router.generate(prompt, {
        temperature: 0.3,
        maxTokens: 200,
      });
      return {
        explanation_type: 'executive_summary',
        narrative:        response.trim(),
        provider,
        fallback_used:    false,
        latency_ms:       Date.now() - start,
        grounding,
      };
    } catch {
      return {
        explanation_type: 'executive_summary',
        narrative:        templateExecutiveSummary(ctx),
        provider:         'template',
        fallback_used:    true,
        latency_ms:       Date.now() - start,
        grounding,
      };
    }
  }

  async explainSourcetype(ctx: SourcetypeContext): Promise<ExplanationResult> {
    const start = Date.now();
    const grounding: Record<string, unknown> = { ...ctx };

    try {
      const prompt = buildSourcetypePrompt(ctx);
      const { response, provider } = await this.router.generate(prompt, {
        temperature: 0.3,
        maxTokens: 150,
      });
      return {
        explanation_type: 'sourcetype',
        narrative:        response.trim(),
        provider,
        fallback_used:    false,
        latency_ms:       Date.now() - start,
        grounding,
      };
    } catch {
      return {
        explanation_type: 'sourcetype',
        narrative:        templateSourcetype(ctx),
        provider:         'template',
        fallback_used:    true,
        latency_ms:       Date.now() - start,
        grounding,
      };
    }
  }

  async explainGovernance(ctx: SourcetypeContext): Promise<ExplanationResult> {
    const start = Date.now();
    const grounding: Record<string, unknown> = { ...ctx };

    try {
      const prompt = buildGovernancePrompt(ctx);
      const { response, provider } = await this.router.generate(prompt, {
        temperature: 0.1,   // lowest temperature: governance explanations must be precise
        maxTokens: 120,
      });
      return {
        explanation_type: 'governance',
        narrative:        response.trim(),
        provider,
        fallback_used:    false,
        latency_ms:       Date.now() - start,
        grounding,
      };
    } catch {
      return {
        explanation_type: 'governance',
        narrative:        templateGovernance(ctx),
        provider:         'template',
        fallback_used:    true,
        latency_ms:       Date.now() - start,
        grounding,
      };
    }
  }
}
