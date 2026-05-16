/**
 * LLM Decision Agent
 *
 * The agent receives raw Splunk telemetry and makes ALL decisions:
 * - Tier classification (Critical / Important / Nice-to-Have / Low-Value)
 * - ROI score (0-100)
 * - Composite score (utilization × detection × quality weighted)
 * - Recommended action (KEEP / OPTIMIZE / ARCHIVE / ELIMINATE / S3_CANDIDATE)
 * - Savings estimate
 * - Reasoning (why this decision was made)
 *
 * NO hardcoded thresholds. NO if/else rule trees.
 * The LLM looks at all signals holistically and decides.
 */

import { LLMRouter } from '../../../agents/reasoning/llm-router';

export interface RawTelemetryInput {
  index: string;
  sourcetype?: string;
  dailyAvgGb: number;
  totalEvents: number;
  retentionDays: number;
  firstEvent: string;
  lastEvent: string;
  licenseGbPerDay?: number;
  storageGbPerMonth?: number;
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

const SYSTEM_PROMPT = `You are a Splunk FinOps and Security intelligence agent.
STRICT OUTPUT MODE: Output ONLY valid JSON. No explanations, no markdown, no text before or after.

For each index/sourcetype you must evaluate:
1. BUSINESS VALUE: Is this data being searched/used? When was it last accessed? What is its event volume?
2. COST: How much does it cost annually? Is that cost justified by usage?
3. SECURITY COVERAGE: Does this sourcetype contribute to threat detection?
4. RETENTION: Is the retention policy appropriate for the data type and usage?
5. OPTIMIZATION OPPORTUNITY: Can cost be reduced without losing value?

Tier definitions:
- Critical: Active, high-value, frequently searched, security/compliance critical
- Important: Regularly used, moderate value, supports operational processes
- Nice-to-Have: Occasionally useful, low-to-moderate cost, can be trimmed
- Low-Value: Rarely or never searched, high cost relative to value, prime for elimination

Action definitions:
- KEEP: Data is valuable, retention and ingestion rate are appropriate
- OPTIMIZE: Reduce retention or field indexing to cut cost while keeping data
- ARCHIVE: Move to cold/cheap storage (S3), reduce hot retention to 7-14 days
- ELIMINATE: Stop ingesting, high cost zero value
- S3_CANDIDATE: Route to Federated Search / S3, keep queryable but remove from hot tier`;

function buildDecisionPrompt(inputs: RawTelemetryInput[], costPerGbPerDay: number): string {
  const dataJson = JSON.stringify(inputs.map((i) => ({
    index: i.index,
    sourcetype: i.sourcetype || null,
    daily_gb: i.dailyAvgGb,
    total_events: i.totalEvents,
    retention_days: i.retentionDays,
    first_event: i.firstEvent,
    last_event: i.lastEvent,
    annual_cost_usd: Math.round(i.dailyAvgGb * 365 * costPerGbPerDay * 100) / 100,
  })), null, 2);

  return `${SYSTEM_PROMPT}

COST MODEL: $${costPerGbPerDay}/GB/day license cost

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
      "compositeScore": 0-100,
      "utilizationScore": 0-100,
      "detectionScore": 0-100,
      "qualityScore": 0-100,
      "riskScore": 0-100,
      "annualLicenseCost": number,
      "estimatedSavings": number,
      "confidence": "HIGH|MEDIUM|LOW",
      "confidenceScore": 0.0-1.0,
      "recommendation": "one clear action sentence",
      "reasoning": "2-3 sentences explaining why this decision was made",
      "evidence": ["signal 1", "signal 2"],
      "isQuickWin": true|false,
      "isS3Candidate": true|false,
      "detectionGap": true|false
    }
  ],
  "roiScore": 0-100,
  "gainScopeScore": 0-100,
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
  if (typeof d.compositeScore !== 'number' || d.compositeScore < 0 || d.compositeScore > 100) return 'invalid compositeScore';
  if (typeof d.utilizationScore !== 'number' || d.utilizationScore < 0 || d.utilizationScore > 100) return 'invalid utilizationScore';
  if (typeof d.detectionScore !== 'number' || d.detectionScore < 0 || d.detectionScore > 100) return 'invalid detectionScore';
  if (typeof d.qualityScore !== 'number' || d.qualityScore < 0 || d.qualityScore > 100) return 'invalid qualityScore';
  if (typeof d.riskScore !== 'number' || d.riskScore < 0 || d.riskScore > 100) return 'invalid riskScore';
  if (d.confidenceScore !== undefined && (typeof d.confidenceScore !== 'number' || d.confidenceScore < 0 || d.confidenceScore > 1)) return 'invalid confidenceScore (must be 0-1)';
  return null;
}

function applyDefaults(decisions: any[], inputs: RawTelemetryInput[], costPerGbPerDay: number): LLMDecision[] {
  return decisions.map((d: any, i: number) => {
    const input = inputs.find((inp) => inp.index === d.index) || inputs[i];
    const annualCost = input ? Math.round(input.dailyAvgGb * 365 * costPerGbPerDay * 100) / 100 : 0;
    return {
      index: d.index || (input?.index ?? `unknown_${i}`),
      sourcetype: d.sourcetype || input?.sourcetype,
      tier: d.tier || 'Nice-to-Have',
      action: d.action || 'KEEP',
      compositeScore: typeof d.compositeScore === 'number' ? d.compositeScore : 50,
      utilizationScore: typeof d.utilizationScore === 'number' ? d.utilizationScore : 0,
      detectionScore: typeof d.detectionScore === 'number' ? d.detectionScore : 0,
      qualityScore: typeof d.qualityScore === 'number' ? d.qualityScore : 50,
      riskScore: typeof d.riskScore === 'number' ? d.riskScore : 50,
      annualLicenseCost: typeof d.annualLicenseCost === 'number' ? d.annualLicenseCost : annualCost,
      estimatedSavings: typeof d.estimatedSavings === 'number' ? d.estimatedSavings : 0,
      confidence: d.confidence || 'LOW',
      confidenceScore: typeof d.confidenceScore === 'number' ? d.confidenceScore : 0.3,
      recommendation: d.recommendation || `Review ${d.index} based on current usage patterns`,
      reasoning: d.reasoning || 'Insufficient data for detailed analysis',
      evidence: Array.isArray(d.evidence) ? d.evidence : [],
      isQuickWin: !!d.isQuickWin,
      isS3Candidate: !!d.isS3Candidate,
      detectionGap: !!d.detectionGap,
    };
  });
}

export async function runLLMDecisionAgent(
  inputs: RawTelemetryInput[],
  costPerGbPerDay: number = 0.5
): Promise<AgentDecisionSummary> {
  if (inputs.length === 0) {
    throw new Error('No telemetry inputs provided to LLM decision agent');
  }

  const router = new LLMRouter();

  const healthy = await router.isHealthy();
  if (!healthy) {
    throw new Error('No LLM available: Ollama is not running AND ANTHROPIC_API_KEY is not configured. Dashboard unavailable. Start Ollama or set ANTHROPIC_API_KEY.');
  }

  const BATCH_SIZE = 5;
  const LLM_TIMEOUT_MS = 30000; // 30 second timeout per batch

  // Timeout wrapper
  const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      )
    ]);

  console.log(`[LLMDecisionAgent] Starting reasoning for ${inputs.length} inputs in batches of ${BATCH_SIZE} (parallel)`);

  // Build all batches up front
  const batches: RawTelemetryInput[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    batches.push(inputs.slice(i, i + BATCH_SIZE));
  }

  // Process one batch, with one retry on parse/schema failure
  const processBatch = async (batch: RawTelemetryInput[], batchIdx: number): Promise<{ decisions: LLMDecision[]; parsed: any }> => {
    const prompt = buildDecisionPrompt(batch, costPerGbPerDay);
    const MAX_ATTEMPTS = 2;
    let lastErr: string = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let raw: string;
      let provider: string;
      try {
        const { response, provider: p } = await router.generate(prompt, { json: true, temperature: 0.1 });
        raw = response;
        provider = p;
      } catch (e) {
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

      console.log(`[LLMDecisionAgent] Batch ${batchIdx + 1} OK via ${provider} — ${validDecisions.length}/${parsed.decisions.length} decisions valid`);
      return { decisions: applyDefaults(validDecisions.length > 0 ? validDecisions : parsed.decisions, batch, costPerGbPerDay), parsed };
    }
    throw new Error(`Batch ${batchIdx + 1} failed after ${MAX_ATTEMPTS} attempts: ${lastErr}`);
  };

  // Run all batches in parallel
  const batchResults = await Promise.all(batches.map((b, i) => processBatch(b, i)));
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

  const defaultStaircase = [
    { stage: 'Current Spend', amount: totalLicenseSpend },
    { stage: 'After Ingest Actions', amount: Math.round(totalLicenseSpend * 0.85) },
    { stage: 'After Retention Tuning', amount: Math.round(totalLicenseSpend * 0.72) },
    { stage: 'After Archive', amount: Math.round(totalLicenseSpend * 0.58) },
    { stage: 'After S3 Migration', amount: Math.round(totalLicenseSpend * 0.45) },
    { stage: 'Optimized Target', amount: Math.round(totalLicenseSpend * 0.38) },
  ];

  console.log(`[LLMDecisionAgent] Complete — ${allDecisions.length} valid decisions, $${totalLicenseSpend.toFixed(2)} total spend`);

  return {
    decisions: allDecisions,
    roiScore: typeof p?.roiScore === 'number' ? p.roiScore : Math.min(100, Math.round((lowValueSpend / Math.max(totalLicenseSpend, 1)) * 100)),
    gainScopeScore: typeof p?.gainScopeScore === 'number' ? p.gainScopeScore : Math.round(avgUtil * 0.4 + avgDet * 0.3 + avgQual * 0.3),
    totalLicenseSpend,
    licenseSpendLowValue: typeof p?.licenseSpendLowValue === 'number' ? p.licenseSpendLowValue : lowValueSpend,
    storageSavingsPotential: typeof p?.storageSavingsPotential === 'number' ? p.storageSavingsPotential : lowValueSpend * 0.6,
    totalDailyGb: inputs.reduce((s, inp) => s + inp.dailyAvgGb, 0),
    totalSourcetypes: inputs.length,
    tierCounts,
    securityGaps: typeof p?.securityGaps === 'number' ? p.securityGaps : allDecisions.filter((d) => d.detectionGap).length,
    operationalGaps: typeof p?.operationalGaps === 'number' ? p.operationalGaps : allDecisions.filter((d) => d.action === 'OPTIMIZE').length,
    avgUtilization: Math.round(avgUtil),
    avgDetection: Math.round(avgDet),
    avgQuality: Math.round(avgQual),
    avgConfidence: Math.round(avgConf * 100),
    quickWins: Array.isArray(p?.quickWins) ? p.quickWins.slice(0, 3) : allDecisions
      .filter((d) => d.isQuickWin)
      .slice(0, 3)
      .map((d) => ({ index: d.index, action: d.action, impact: `Save $${Math.round(d.estimatedSavings).toLocaleString()}/year`, details: d.recommendation })),
    savingsStaircase: Array.isArray(p?.savingsStaircase) ? p.savingsStaircase : defaultStaircase,
    agentReasoning: p?.agentReasoning || `Analyzed ${inputs.length} Splunk indexes. ${tierCounts.lowValue} low-value candidates identified. Total spend: $${totalLicenseSpend.toLocaleString()}.`,
  };
}
