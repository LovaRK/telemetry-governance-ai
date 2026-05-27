/**
 * LLM Decision Agent
 *
 * Architecture (updated — deterministic-first):
 *
 *   Splunk metadata → Deterministic Scoring Engine → LLM Reasoning Layer
 *
 * The deterministic engine computes:
 *   - Utilization Score  (weighted_sum / max × 100)
 *   - Detection Score    (0.40 × potential + 0.60 × realized)
 *   - Quality Score      (max(0, 100 − issue_density × 2000))
 *   - Composite Score    (weighted average with configurable weights)
 *   - Tier Assignment    (hard thresholds: ≥65 Critical, ≥40 Important, ≥20 Nice-to-Have)
 *   - ROI Score          (avg composite across portfolio)
 *   - GainScope %        (Tier1+2 GB / Total GB × 100)
 *
 * The LLM receives pre-computed scores and generates ONLY:
 *   - Action (KEEP/OPTIMIZE/ARCHIVE/ELIMINATE/S3_CANDIDATE)
 *   - Plain-English reasoning (why)
 *   - Evidence signals
 *   - Estimated savings
 *   - Quick win flag
 *   - Confidence score
 *   - Executive summary (agentReasoning)
 *   - Savings staircase (waterfall projection)
 *   - Quick wins list
 *
 * This ensures scores are reproducible and auditable while AI provides
 * the operational intelligence layer on top.
 */

import { LLMRouter } from '../../../agents/reasoning/llm-router';
import { UserConfig } from '../services/config-service';
import type { ScoredSourcetype } from '../services/deterministic-scoring-engine';

export interface RawTelemetryInput {
  index: string;
  sourcetype?: string;
  dailyAvgGb: number;
  totalEvents: number;
  retentionDays: number;
  firstEvent: string;
  lastEvent: string;
  // Pre-computed deterministic scores (injected by aggregation-service)
  // If provided, LLM uses these directly instead of estimating
  precomputedScores?: {
    utilizationScore: number;
    detectionScore: number;
    qualityScore: number;
    compositeScore: number;
    tier: string;
    detectionGap: boolean;
    operationalGap: boolean;
  };
}

export interface LLMDecision {
  index: string;
  sourcetype?: string;
  tier: 'Critical' | 'Important' | 'Nice-to-Have' | 'Low-Value';
  action: 'KEEP' | 'OPTIMIZE' | 'ARCHIVE' | 'ELIMINATE' | 'S3_CANDIDATE';
  compositeScore: number;
  utilizationScore: number;
  detectionScore: number;
  qualityScore: number;
  riskScore: number;
  annualLicenseCost: number;
  estimatedSavings: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceScore: number;
  recommendation: string;
  reasoning: string;
  evidence: string[];
  isQuickWin: boolean;
  isS3Candidate: boolean;
  detectionGap: boolean;
}

export interface AgentDecisionSummary {
  decisions: LLMDecision[];
  roiScore: number;
  gainScopeScore: number;
  totalLicenseSpend: number;
  licenseSpendLowValue: number;
  storageSavingsPotential: number;
  totalDailyGb: number;
  totalSourcetypes: number;
  tierCounts: { critical: number; important: number; niceToHave: number; lowValue: number };
  securityGaps: number;
  operationalGaps: number;
  avgUtilization: number;
  avgDetection: number;
  avgQuality: number;
  avgConfidence: number;
  quickWins: Array<{ index: string; action: string; impact: string; details: string }>;
  savingsStaircase: Array<{ stage: string; amount: number }>;
  agentReasoning: string;
}

interface AgentExecutionOptions {
  signal?: AbortSignal;
  onBatchMetric?: (metric: {
    batch: number;
    totalBatches: number;
    model: string;
    latencyMs: number;
    promptChars: number;
    status: 'success' | 'failed';
    errorCode?: string;
  }) => void;
}

const SYSTEM_PROMPT = `You are a Splunk FinOps and Security intelligence agent.
STRICT OUTPUT MODE: Output ONLY valid JSON. No explanations, no markdown, no text before or after.

IMPORTANT: Each index entry below already contains PRE-COMPUTED deterministic scores:
  - utilization_score: computed from alerts × 3, scheduled × 3, dashboards × 2, users × 2, ad-hoc × 1
  - detection_score: computed from MITRE ATT&CK potential (40%) + realized alert coverage (60%)
  - quality_score: computed from parsing issue density
  - composite_score: weighted average (default: util 35%, detection 40%, quality 25%)
  - tier: already assigned via hard thresholds (≥65 Critical, ≥40 Important, ≥20 Nice-to-Have, <20 Low-Value)

YOUR ROLE: Accept these scores as authoritative. DO NOT change the tier or scores.
You must provide:
1. ACTION: Best operational decision (KEEP/OPTIMIZE/ARCHIVE/ELIMINATE/S3_CANDIDATE)
2. REASONING: 2-3 sentences explaining WHY given the scores and context
3. EVIDENCE: 2-4 specific signals from the data that drove the decision
4. ESTIMATED SAVINGS: Dollar amount recoverable by acting on this recommendation
5. RECOMMENDATION: One clear action sentence for the operator
6. FLAGS: isQuickWin (can be done this week), isS3Candidate, confidence level

Action definitions:
- KEEP: Composite ≥ 65 or security-critical; cost is justified
- OPTIMIZE: Good data, wrong settings (retention too long, fields not pruned)
- ARCHIVE: Some value but rarely queried; route to cold/S3 storage
- ELIMINATE: Low-Value tier (composite < 20), zero detection, minimal use
- S3_CANDIDATE: High volume, low utilization, Lantern use cases exist but unused`;

function buildDecisionPrompt(inputs: RawTelemetryInput[], config: UserConfig): string {
  const dataJson = JSON.stringify(inputs.map((i) => {
    const base = {
      index: i.index,
      sourcetype: i.sourcetype || null,
      daily_gb: i.dailyAvgGb,
      total_events: i.totalEvents,
      retention_days: i.retentionDays,
      first_event: i.firstEvent,
      last_event: i.lastEvent,
      annual_cost_usd: Math.round(i.dailyAvgGb * 365 * config.costPerGbPerDay * 100) / 100,
    };
    // Attach pre-computed deterministic scores if available
    if (i.precomputedScores) {
      return {
        ...base,
        utilization_score: i.precomputedScores.utilizationScore,
        detection_score:   i.precomputedScores.detectionScore,
        quality_score:     i.precomputedScores.qualityScore,
        composite_score:   i.precomputedScores.compositeScore,
        tier:              i.precomputedScores.tier,
        detection_gap:     i.precomputedScores.detectionGap,
        operational_gap:   i.precomputedScores.operationalGap,
      };
    }
    return base;
  }), null, 2);

  const retentionPolicyStr = Object.entries(config.retentionPolicy || {})
    .map(([tier, days]) => `${tier}: ${days} days`)
    .join(', ');

  return `${SYSTEM_PROMPT}

USER CONFIGURATION:
- License cost model: $${config.costPerGbPerDay}/GB/day
- Maximum retention allowed: ${config.maxRetentionDays} days
- Tier-based retention policy: ${retentionPolicyStr || 'Not configured'}

SPLUNK TELEMETRY DATA:
${dataJson}

Analyze every index above and return ONLY a valid JSON object in this exact schema:

{
  "decisions": [
    {
      "index": "string",
      "sourcetype": "string or null",
      "tier": "Critical|Important|Nice-to-Have|Low-Value",
      "action": "KEEP|OPTIMIZE|ARCHIVE|ELIMINATE|S3_CANDIDATE",
      "compositeScore": number (use pre-computed value from input, do not change),
      "utilizationScore": number (use pre-computed value from input, do not change),
      "detectionScore": number (use pre-computed value from input, do not change),
      "qualityScore": number (use pre-computed value from input, do not change),
      "riskScore": 0-100,
      "annualLicenseCost": number,
      "estimatedSavings": number,
      "confidence": "HIGH|MEDIUM|LOW",
      "confidenceScore": 0.0-1.0,
      "recommendation": "one clear action sentence",
      "reasoning": "2-3 sentences explaining why this decision was made based on the scores",
      "evidence": ["signal 1", "signal 2"],
      "isQuickWin": true|false,
      "isS3Candidate": true|false,
      "detectionGap": true|false
    }
  ],
  "roiScore": null,
  "gainScopeScore": null,
  "totalLicenseSpend": number,
  "licenseSpendLowValue": number,
  "storageSavingsPotential": number,
  "avgUtilization": 0-100,
  "avgDetection": 0-100,
  "avgQuality": 0-100,
  "securityGaps": number,
  "operationalGaps": number,
  "quickWins": [
    {
      "index": "string",
      "action": "string",
      "impact": "e.g. Save $12,000/year",
      "details": "specific optimization step"
    }
  ],
  "savingsStaircase": [
    { "stage": "Current Spend", "amount": number },
    { "stage": "After Ingest Actions", "amount": number },
    { "stage": "After Retention Tuning", "amount": number },
    { "stage": "After Archive", "amount": number },
    { "stage": "After S3 Migration", "amount": number },
    { "stage": "Optimized Target", "amount": number }
  ],
  "agentReasoning": "executive summary of the overall telemetry estate, key findings, and top recommendations in 3-4 sentences"
}

Return ONLY the JSON. No explanation text before or after.`;
}

function extractJson(raw: string): string {
  // Try direct parse first
  try {
    JSON.parse(raw);
    return raw;
  } catch { /* not direct JSON */ }
  
  // Try to find JSON block
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      JSON.parse(jsonMatch[0]);
      return jsonMatch[0];
    } catch { /* invalid JSON in block */ }
  }
  
  // Try to extract decisions array
  const arrMatch = raw.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return JSON.stringify({ decisions: parsed });
      }
    } catch { /* invalid array */ }
  }
  
  throw new Error('No valid JSON found in LLM response. Response may contain markdown or explanations.');
}

const VALID_TIERS = new Set(['Critical', 'Important', 'Nice-to-Have', 'Low-Value']);
const VALID_ACTIONS = new Set(['KEEP', 'OPTIMIZE', 'ARCHIVE', 'ELIMINATE', 'S3_CANDIDATE']);
const VALID_CONFIDENCE = new Set(['HIGH', 'MEDIUM', 'LOW']);

function validateDecision(d: any): string | null {
  if (!d || typeof d !== 'object') return 'not an object';
  if (typeof d.index !== 'string' || d.index.trim() === '') return 'missing index';
  if (!VALID_TIERS.has(d.tier)) return `invalid tier: ${d.tier}`;
  if (!VALID_ACTIONS.has(d.action)) return `invalid action: ${d.action}`;

  // Check all numeric fields
  const numericFields = [
    ['compositeScore', 0, 100],
    ['utilizationScore', 0, 100],
    ['detectionScore', 0, 100],
    ['qualityScore', 0, 100],
    ['riskScore', 0, 100],
    ['annualLicenseCost', -Infinity, Infinity],
    ['estimatedSavings', -Infinity, Infinity],
  ] as const;

  for (const [field, min, max] of numericFields) {
    if (typeof d[field] !== 'number' || d[field] < min || d[field] > max) {
      return `invalid ${field}: got ${JSON.stringify(d[field])} (expected number ${min}-${max})`;
    }
  }

  if (d.confidenceScore !== undefined && (typeof d.confidenceScore !== 'number' || d.confidenceScore < 0 || d.confidenceScore > 1)) {
    return `invalid confidenceScore: got ${JSON.stringify(d.confidenceScore)} (expected 0-1)`;
  }
  return null;
}

function applyDefaults(decisions: any[], inputs: RawTelemetryInput[], config: UserConfig): LLMDecision[] {
  return decisions.map((d: any, i: number) => {
    const input = inputs.find((inp) => inp.index === d.index) || inputs[i];
    const annualCost = input ? Math.round(input.dailyAvgGb * 365 * config.costPerGbPerDay * 100) / 100 : 0;
    return {
      index: d.index || (input?.index ?? `unknown_${i}`),
      sourcetype: d.sourcetype || input?.sourcetype,
      tier: d.tier || null,
      action: d.action || null,
      compositeScore: typeof d.compositeScore === 'number' ? d.compositeScore : null,
      utilizationScore: typeof d.utilizationScore === 'number' ? d.utilizationScore : null,
      detectionScore: typeof d.detectionScore === 'number' ? d.detectionScore : null,
      qualityScore: typeof d.qualityScore === 'number' ? d.qualityScore : null,
      riskScore: typeof d.riskScore === 'number' ? d.riskScore : null,
      annualLicenseCost: typeof d.annualLicenseCost === 'number' ? d.annualLicenseCost : annualCost,
      estimatedSavings: typeof d.estimatedSavings === 'number' ? d.estimatedSavings : null,
      confidence: d.confidence || null,
      confidenceScore: typeof d.confidenceScore === 'number' ? d.confidenceScore : null,
      recommendation: d.recommendation || null,
      reasoning: d.reasoning || null,
      evidence: Array.isArray(d.evidence) ? d.evidence : [],
      isQuickWin: !!d.isQuickWin,
      isS3Candidate: !!d.isS3Candidate,
      detectionGap: !!d.detectionGap,
    };
  });
}

export async function runLLMDecisionAgent(
  inputs: RawTelemetryInput[],
  config: UserConfig,
  execOpts?: AgentExecutionOptions
): Promise<AgentDecisionSummary> {
  if (inputs.length === 0) {
    throw new Error('No telemetry inputs provided to LLM decision agent');
  }

  const router = new LLMRouter();

  const healthy = await router.isHealthy();
  if (!healthy) {
    throw new Error('No local LLM available: Ollama is not running. Dashboard unavailable. Start Ollama. Anthropic is optional and only used when explicitly enabled in settings.');
  }

  const BATCH_SIZE = 1; // Reduced from 5 for local Ollama memory constraint (gemma2:9b is 5.4GB + batch overhead)
  // Keep local-demo feedback loop fast: fail the batch quickly instead of
  // appearing stuck for many minutes.
  const MODEL_NAME = process.env.LLM_MODEL || 'gemma2:9b';

  console.log(`[LLMDecisionAgent] Starting reasoning for ${inputs.length} inputs in batches of ${BATCH_SIZE} (sequential)`);

  // Build all batches up front
  const batches: RawTelemetryInput[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    batches.push(inputs.slice(i, i + BATCH_SIZE));
  }

  // Process one batch, with one retry on parse/schema failure
  const processBatch = async (batch: RawTelemetryInput[], batchIdx: number): Promise<{ decisions: LLMDecision[]; parsed: any }> => {
    const prompt = buildDecisionPrompt(batch, config);
    const MAX_ATTEMPTS = 2;
    let lastErr: string = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let raw: string;
      let provider: string;
      const startedAt = Date.now();
      try {
        const { response, provider: p } = await router.generate(prompt, {
          json: true,
          temperature: 0.1,
          signal: execOpts?.signal,
        });
        raw = response;
        provider = p;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isAbort = /aborted|timed out/i.test(msg);
        execOpts?.onBatchMetric?.({
          batch: batchIdx + 1,
          totalBatches: batches.length,
          model: MODEL_NAME,
          latencyMs: Date.now() - startedAt,
          promptChars: prompt.length,
          status: 'failed',
          errorCode: isAbort ? 'FAILED_MODEL_TIMEOUT' : 'FAILED_MODEL_RUNTIME',
        });
        if (execOpts?.signal?.aborted) {
          throw new Error(`LLM batch ${batchIdx + 1} aborted`);
        }
        throw new Error(`LLM call failed (batch ${batchIdx + 1}, attempt ${attempt}): ${e instanceof Error ? e.message : String(e)}`);
      }

      let parsed: any;
      try {
        parsed = JSON.parse(extractJson(raw));
      } catch {
        lastErr = `Invalid JSON (attempt ${attempt}). Raw: ${raw.slice(0, 200)}`;
        continue;
      }

      if (!Array.isArray(parsed.decisions)) {
        lastErr = `Missing "decisions" array (attempt ${attempt})`;
        continue;
      }

      // Validate each decision; reject invalid ones rather than silently defaulting
      const validDecisions: any[] = [];
      for (const d of parsed.decisions) {
        const err = validateDecision(d);
        if (err) {
          console.warn(`[LLMDecisionAgent] Batch ${batchIdx + 1} skipping invalid decision (${err}):`, JSON.stringify(d).slice(0, 120));
        } else {
          validDecisions.push(d);
        }
      }

      if (validDecisions.length === 0 && attempt < MAX_ATTEMPTS) {
        lastErr = `All decisions failed validation (attempt ${attempt})`;
        continue;
      }

      execOpts?.onBatchMetric?.({
        batch: batchIdx + 1,
        totalBatches: batches.length,
        model: MODEL_NAME,
        latencyMs: Date.now() - startedAt,
        promptChars: prompt.length,
        status: 'success',
      });

      console.log(`[LLMDecisionAgent] Batch ${batchIdx + 1} OK via ${provider} — ${validDecisions.length}/${parsed.decisions.length} decisions valid`);
      return { decisions: applyDefaults(validDecisions.length > 0 ? validDecisions : parsed.decisions, batch, config), parsed };
    }
    execOpts?.onBatchMetric?.({
      batch: batchIdx + 1,
      totalBatches: batches.length,
      model: MODEL_NAME,
      latencyMs: 0,
      promptChars: prompt.length,
      status: 'failed',
      errorCode: 'FAILED_MODEL_RUNTIME',
    });
    throw new Error(`Batch ${batchIdx + 1} failed after ${MAX_ATTEMPTS} attempts: ${lastErr}`);
  };

  // Run batches sequentially (parallel_batches = 1)
  const batchResults = [];
  for (let i = 0; i < batches.length; i++) {
    batchResults.push(await processBatch(batches[i], i));
  }
  const allDecisions: LLMDecision[] = batchResults.flatMap(r => r.decisions);
  const firstParsed = batchResults[0]?.parsed;

  // Aggregate all decisions across parallel batches
  const p = firstParsed; // use first-batch KPI fields where present; fall back to aggregated values

  const totalLicenseSpend = typeof p?.totalLicenseSpend === 'number'
    ? p.totalLicenseSpend
    : allDecisions.reduce((s, d) => s + d.annualLicenseCost, 0);

  const lowValueSpend = allDecisions
    .filter((d) => d.tier === 'Low-Value' || d.action === 'ELIMINATE' || d.action === 'ARCHIVE')
    .reduce((s, d) => s + d.annualLicenseCost, 0);

  const tierCounts = allDecisions.reduce(
    (acc, d) => {
      if (d.tier === 'Critical') acc.critical++;
      else if (d.tier === 'Important') acc.important++;
      else if (d.tier === 'Nice-to-Have') acc.niceToHave++;
      else acc.lowValue++;
      return acc;
    },
    { critical: 0, important: 0, niceToHave: 0, lowValue: 0 }
  );

  const n = allDecisions.length;
  const avgUtil = allDecisions.reduce((s, d) => s + d.utilizationScore, 0) / n;
  const avgDet = allDecisions.reduce((s, d) => s + d.detectionScore, 0) / n;
  const avgQual = allDecisions.reduce((s, d) => s + d.qualityScore, 0) / n;
  const avgConf = allDecisions.reduce((s, d) => s + d.confidenceScore, 0) / n;

  console.log(`[LLMDecisionAgent] Complete — ${allDecisions.length} valid decisions, $${totalLicenseSpend.toFixed(2)} total spend`);

  // roiScore and gainScopeScore are NOW computed deterministically in aggregation-service.
  // The LLM returns null for these — we accept that and override below.
  // storageSavingsPotential still comes from LLM (requires reasoning about excess retention).
  const storageSavings = typeof p?.storageSavingsPotential === 'number' && p.storageSavingsPotential >= 0
    ? p.storageSavingsPotential
    : allDecisions
        .filter(d => d.action === 'ELIMINATE' || d.action === 'ARCHIVE' || d.action === 'OPTIMIZE')
        .reduce((s, d) => s + (d.estimatedSavings || 0), 0);

  return {
    decisions: allDecisions,
    roiScore: 0,           // overridden by aggregation-service with deterministic avg(composite)
    gainScopeScore: 0,     // overridden by aggregation-service with Tier1+2 GB / Total GB × 100
    totalLicenseSpend,
    licenseSpendLowValue: p?.licenseSpendLowValue || lowValueSpend,
    storageSavingsPotential: storageSavings,
    totalDailyGb: inputs.reduce((s, inp) => s + inp.dailyAvgGb, 0),
    totalSourcetypes: inputs.length,
    tierCounts,
    securityGaps: p.securityGaps ?? 0,
    operationalGaps: p.operationalGaps ?? 0,
    avgUtilization: Math.round(avgUtil),
    avgDetection: Math.round(avgDet),
    avgQuality: Math.round(avgQual),
    avgConfidence: Math.round(avgConf * 100),
    quickWins: p.quickWins || [],
    savingsStaircase: p.savingsStaircase,
    agentReasoning: p?.agentReasoning || null,
  };
}
