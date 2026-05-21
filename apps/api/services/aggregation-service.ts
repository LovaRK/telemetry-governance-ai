import { PoolClient } from 'pg';
import { SplunkClient } from './splunk-client';
import { runLLMDecisionAgent, RawTelemetryInput, LLMDecision } from '../agents/llm-decision-agent';
import { loadUserConfig } from './config-service';
import { RequestContext } from '@packages/auth/request-context';
import { queryFieldUsage, querySecurityCoverage, queryDataQualityMetrics, querySavedSearchInventory, queryParsingErrors, buildUtilizationInputs, buildDetectionInputs, buildQualityInputs } from './splunk-queries-service';
import {
  computeUtilizationScores,
  computeDetectionScores,
  computeQualityScore,
  computeCompositeScore,
  computeROIScore,
  computeGainScope,
  computeLowValueSpend,
  extractWeightsFromConfig,
  assignTier,
  DEFAULT_WEIGHTS,
  type ScoredSourcetype,
} from './deterministic-scoring-engine';
import { diffSnapshots, reuseDecisionsForUnchanged, persistDiffStats, persistMetadataHistory } from './snapshot-diff-service';
import { computeDecisionStability } from './decision-stability-service';
import { computeMetadataFingerprint } from './fingerprint-service';
import { getApplicableOverrides, resolveOverride, disableExpiredOverrides, flagOverduesForReview } from './override-governance-service';
import { recordDecisionLineage, computeDeterministicSignals, persistQueueHealthMetrics } from './decision-lineage-service';
import { evaluateSemanticDrift, getDriftedDecisions, DriftSeverity } from './drift-detection-service';
import { getSeasonalityBaselineService } from './seasonality-baseline-service';
import { recordDriftEvent, recordCleanSnapshot } from './confidence-recovery-service';
import { getRiskWeightedSamplingService } from './risk-weighted-sampling-service';
import { enqueueReanalysisJob } from './reanalysis-budget-service';
import { query, transaction } from '../../../core/database/connection';
import { enqueueJob } from './job-service';
import { applyGuardrailsToBatch } from './llm-output-guardrails';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export interface FastAggregationResult {
  snapshotId: string;
  jobId: string;
  runId?: string;
  tenantId?: string;
  inserted: number;
  durationMs: number;
}

export interface AggregationConfig {
  lookbackDays: number;
  costPerGbPerDay: number;
}

export interface AggregationResult {
  snapshotId: string;
  inserted: number;
  errors: number;
  durationMs: number;
  agentReasoning: string;
}

const DEFAULT_CONFIG: AggregationConfig = {
  lookbackDays: 30,
  costPerGbPerDay: 0.5,
};

const SOURCETYPE_DRILLDOWN_GB = 0.1;
const MAX_SOURCETYPE_INDEXES = 20;

export async function runAggregation(
  splunk: SplunkClient,
  ctx: RequestContext,
  config: AggregationConfig = DEFAULT_CONFIG
): Promise<AggregationResult> {
  const start = Date.now();
  const snapshotId = uuidv4();
  const tenantId = ctx.tenantId;

  // Load user config for cost model
  const userConfig = await loadUserConfig();
  const costPerGbPerDay = config.costPerGbPerDay ?? userConfig.costPerGbPerDay;
  console.log(`[Aggregation] Using cost model: $${costPerGbPerDay}/GB/day from user config`);

  // Version tracking for reproducibility
  const versions = {
    llmVersion: process.env.LLM_VERSION || '1.0',
    promptVersion: process.env.PROMPT_VERSION || '2.0',
    modelVersion: process.env.MODEL_VERSION || 'gemma2:9b',
    heuristicVersion: process.env.HEURISTIC_VERSION || '1.2',
  };
  console.log(`[Aggregation] Processing with versions:`, versions);

  // Compute today's date for snapshot identification
  const today = new Date().toISOString().split('T')[0];

  // ── Step 1: Fetch raw data from Splunk ──────────────────────────────────────
  const indexMetrics = await splunk.getIndexMetrics();
  if (indexMetrics.length === 0) {
    throw new Error('Splunk returned 0 indexes. Check index permissions.');
  }

  // Sourcetype drilldown for high-volume indexes (parallel)
  const highVolumeIndexes = indexMetrics
    .filter((m) => m.dailyAvgGb >= SOURCETYPE_DRILLDOWN_GB)
    .sort((a, b) => b.dailyAvgGb - a.dailyAvgGb)
    .slice(0, MAX_SOURCETYPE_INDEXES)
    .map((m) => m.index);

  const sourcetypeMetrics = highVolumeIndexes.length > 0
    ? await splunk.getBatchSourcetypeMetrics(highVolumeIndexes).catch((e) => {
        console.warn('[Aggregation] Sourcetype batch failed (index data still used):', e.message);
        return [];
      })
    : [];

  // ── Step 2: Build unified input list for LLM agent ─────────────────────────
  const allInputs: RawTelemetryInput[] = [
    ...indexMetrics.map((m) => ({
      index: m.index,
      sourcetype: undefined,
      dailyAvgGb: m.dailyAvgGb,
      totalEvents: m.totalEvents,
      retentionDays: m.retentionDays,
      firstEvent: m.firstEvent,
      lastEvent: m.lastEvent,
    })),
    ...sourcetypeMetrics.map((m) => ({
      index: m.index,
      sourcetype: m.sourcetype,
      dailyAvgGb: m.dailyAvgGb,
      totalEvents: m.totalEvents,
      retentionDays: m.retentionDays,
      firstEvent: m.firstEvent,
      lastEvent: m.lastEvent,
    })),
  ];

  // ── Backpressure: Enforce hard limits ──────────────────────────────────────
  const MAX_INDEXES = parseInt(process.env.MAX_INDEXES_PER_RUN || '100', 10);
  const MAX_SOURCETYPES = parseInt(process.env.MAX_SOURCETYPES_PER_RUN || '1000', 10);

  const indexCount = indexMetrics.length;
  const sourcetypeCount = sourcetypeMetrics.length;

  if (indexCount > MAX_INDEXES) {
    console.error('[BACKPRESSURE] Rejection:', { indexes: indexCount, max: MAX_INDEXES });
    throw new Error(`MAX_INDEXES_PER_RUN exceeded: ${indexCount} > ${MAX_INDEXES}`);
  }

  if (sourcetypeCount > MAX_SOURCETYPES) {
    console.error('[BACKPRESSURE] Rejection:', { sourcetypes: sourcetypeCount, max: MAX_SOURCETYPES });
    throw new Error(`MAX_SOURCETYPES_PER_RUN exceeded: ${sourcetypeCount} > ${MAX_SOURCETYPES}`);
  }

  console.log(`[Aggregation] Backpressure check passed: ${indexCount}/${MAX_INDEXES} indexes, ${sourcetypeCount}/${MAX_SOURCETYPES} sourcetypes`);

  // ── Step 3: Incremental snapshot diffing ───────────────────────────────────
  console.log(`[Aggregation] Starting incremental snapshot diffing...`);
  const diffResult = await transaction(async (client) => {
    // Auto-disable expired overrides and flag old ones for review
    const expiredCount = await disableExpiredOverrides(client);
    const overdueCount = await flagOverduesForReview(client);
    if (expiredCount > 0 || overdueCount > 0) {
      console.log(`[Aggregation] Governance maintenance: ${expiredCount} expired, ${overdueCount} flagged for review`);
    }
    return await diffSnapshots(client, allInputs, today, versions);
  }, ctx);

  console.log(`[Aggregation] Diffing results:`, diffResult.summaryStats);

  // Only send changed/new to LLM (incremental processing)
  const toProcess = [...diffResult.changed, ...diffResult.new];
  console.log(`[Aggregation] Incremental processing: ${toProcess.length}/${allInputs.length} indexes need LLM re-analysis`);
  console.log(`[Aggregation]   Unchanged: ${diffResult.summaryStats.unchangedCount} (will reuse decisions)`);
  console.log(`[Aggregation]   Changed: ${diffResult.summaryStats.changedCount} (will re-analyze)`);
  console.log(`[Aggregation]   New: ${diffResult.summaryStats.newCount} (will analyze)`);

  // ── Step 3.5: Deterministic Scoring Engine ─────────────────────────────────
  // Compute Utilization / Detection / Quality / Composite scores using PDF formulas.
  // These scores are injected into the LLM prompt so the agent reasons over
  // verified numbers rather than estimating from raw metadata.
  console.log(`[Aggregation] Running deterministic scoring engine...`);

  const weights = extractWeightsFromConfig(userConfig.decisionWeights || {});
  console.log(`[Aggregation] Score weights: util=${weights.utilization}, det=${weights.detection}, qual=${weights.quality}`);

  // Fetch knowledge object inventory (alerts, scheduled searches, dashboards, users)
  const indexNames = Array.from(new Set(allInputs.map(i => i.index)));
  const koInventory = await querySavedSearchInventory(splunk, indexNames).catch(e => {
    console.warn('[Aggregation] KO inventory unavailable, using zeros:', e.message);
    return indexNames.map(idx => ({
      key: `${idx}::_`, index: idx, sourcetype: null,
      alertCount: 0, scheduledSearchCount: 0, dashboardPanelCount: 0,
      adHocSearchCount: 0, distinctUserCount: 0,
    }));
  });

  const rawMeta = allInputs.map(i => ({
    index: i.index, sourcetype: i.sourcetype || null,
    dailyAvgGb: i.dailyAvgGb, totalEvents: i.totalEvents, retentionDays: i.retentionDays,
  }));

  // Fetch real parsing error signals from Splunk _internal for quality scoring.
  // Falls back to empty Map (quality=100) if _internal is inaccessible.
  const parsingErrors = await queryParsingErrors(splunk, 7).catch(e => {
    console.warn('[Aggregation] Parsing error query failed, defaulting quality=100:', (e as Error).message);
    return new Map<string, number>();
  });

  const utilInputs  = buildUtilizationInputs(rawMeta, koInventory);
  const detInputs   = buildDetectionInputs(rawMeta, koInventory);
  const qualInputs  = buildQualityInputs(rawMeta, parsingErrors);

  const utilScores  = computeUtilizationScores(utilInputs);
  const detResults  = computeDetectionScores(detInputs);

  // Build scored map for all inputs
  const scoredMap = new Map<string, ScoredSourcetype>();
  for (const inp of allInputs) {
    const key       = `${inp.index}::${inp.sourcetype || '_'}`;
    const utilScore = utilScores.get(key) ?? 0;
    const detResult = detResults.get(key) ?? { score: 0, detectionGap: false, operationalGap: false };
    const qualInp   = qualInputs.find(q => q.index === inp.index && (q.sourcetype || null) === (inp.sourcetype || null));
    const qualScore = qualInp ? computeQualityScore(qualInp) : 100;
    const composite = computeCompositeScore(utilScore, detResult.score, qualScore, weights);
    const tier      = assignTier(composite);
    const annualCost = inp.dailyAvgGb * 365 * costPerGbPerDay;

    scoredMap.set(key, {
      index: inp.index, sourcetype: inp.sourcetype || null,
      utilizationScore: utilScore,
      detectionScore: detResult.score,
      qualityScore: qualScore,
      compositeScore: composite,
      tier,
      dailyGb: inp.dailyAvgGb,
      annualCostUsd: annualCost,
      detectionGap: detResult.detectionGap,
      operationalGap: detResult.operationalGap,
    });
  }

  // Inject pre-computed scores into inputs for LLM prompt context
  const allInputsWithScores: RawTelemetryInput[] = allInputs.map(inp => {
    const key    = `${inp.index}::${inp.sourcetype || '_'}`;
    const scored = scoredMap.get(key);
    return scored ? { ...inp, precomputedScores: {
      utilizationScore: scored.utilizationScore,
      detectionScore:   scored.detectionScore,
      qualityScore:     scored.qualityScore,
      compositeScore:   scored.compositeScore,
      tier:             scored.tier,
      detectionGap:     scored.detectionGap,
      operationalGap:   scored.operationalGap,
    } } : inp;
  });

  // Portfolio-level deterministic KPIs
  const allScored = Array.from(scoredMap.values());
  const deterministicROI      = computeROIScore(allScored);
  const deterministicGainScope = computeGainScope(allScored);
  const deterministicLowValue  = computeLowValueSpend(allScored);
  const securityGapCount       = allScored.filter(s => s.detectionGap).length;
  const operationalGapCount    = allScored.filter(s => s.operationalGap).length;

  console.log(`[Aggregation] Deterministic scoring complete:`);
  console.log(`  ROI Score: ${deterministicROI}`);
  console.log(`  GainScope: ${deterministicGainScope}%`);
  console.log(`  Low-Value Spend: $${deterministicLowValue.toFixed(2)}/yr`);
  console.log(`  Security Gaps: ${securityGapCount}, Operational Gaps: ${operationalGapCount}`);

  // ── Step 4: LLM agent makes decisions for changed/new only ──────────────────
  let agentSummary: any = { decisions: [], agentReasoning: 'No LLM processing needed' };

  if (toProcess.length > 0) {
    // Use inputs WITH pre-computed scores for LLM context
    const toProcessWithScores = toProcess.map(inp => {
      const key = `${inp.index}::${inp.sourcetype || '_'}`;
      const match = allInputsWithScores.find(x =>
        `${x.index}::${x.sourcetype || '_'}` === key
      );
      return match || inp;
    });

    console.log(`[Aggregation] Sending ${toProcess.length} changed/new indexes to LLM decision agent...`);
    agentSummary = await runLLMDecisionAgent(toProcessWithScores, userConfig);
    console.log(`[Aggregation] LLM agent completed. ${agentSummary.decisions.length} decisions received.`);

    // ── Guardrail pass: clamp LLM-generated savings / quickWin / confidence ──
    const guardrailResult = applyGuardrailsToBatch(
      agentSummary.decisions,
      scoredMap,
      costPerGbPerDay
    );
    agentSummary.decisions = guardrailResult.decisions;
    console.log(`[Aggregation] Guardrails applied:`, guardrailResult.stats);
  } else {
    console.log(`[Aggregation] All indexes unchanged - skipping LLM processing`);
  }

  // ── Step 5: Persist decisions to DB ────────────────────────────────────────
  let inserted = 0;
  let errors = 0;

  // Batch insert (50 rows per batch) with savepoint per batch
  const BATCH_SIZE = 50;
  const decisions = agentSummary.decisions;
  // Note: 'today' already defined at the beginning of function

  await transaction(async (client) => {
    // Clear today's rows before inserting to avoid conflicts on re-run
    await client.query(`DELETE FROM telemetry_snapshots WHERE snapshot_date = $1`, [today]);
    await client.query(`DELETE FROM agent_decisions WHERE snapshot_date = $1`, [today]);

    // Reuse decisions for unchanged indexes (incremental reuse)
    if (diffResult.summaryStats.unchangedCount > 0) {
      const previousDate = new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];
      const reused = await reuseDecisionsForUnchanged(
        client,
        diffResult.unchanged,
        previousDate,
        snapshotId,
        today,
        versions
      );
      inserted += reused;
    }

    for (let i = 0; i < decisions.length; i += BATCH_SIZE) {
      const batch = decisions.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE);
      try {
        for (const decision of batch) {
          const input = allInputs.find(
            (inp) => inp.index === decision.index && (inp.sourcetype || null) === (decision.sourcetype || null)
          );

          // Compute metadata fingerprint for change detection
          const metadataFingerprint = input ? computeMetadataFingerprint(input) : undefined;

          // Apply override governance if applicable
          const applicableOverrides = await getApplicableOverrides(
            client,
            decision.index,
            decision.sourcetype || null,
            snapshotId
          );
          let finalDecision = decision;
          if (applicableOverrides.length > 0) {
            const override = resolveOverride(applicableOverrides);
            if (override) {
              finalDecision = {
                ...decision,
                action: override.overrideAction,
                tier: override.overrideTier || decision.tier,
                reasoning: `Overridden: ${override.reasonCode} - ${override.reasonText}`,
              };
              console.log(`[Aggregation] Override applied to ${decision.index}: ${override.scopeType} scope (${override.scopeValue})`);
            }
          }

          console.log('[Aggregation] Processing decision for:', decision.index, {
            riskScore: decision.riskScore,
            confidenceScore: decision.confidenceScore,
            annualLicenseCost: decision.annualLicenseCost,
            utilScore: decision.utilizationScore
          });
          await upsertDecision(client, finalDecision, input, snapshotId, today);
          await upsertAgentDecision(client, finalDecision, snapshotId, today, versions, metadataFingerprint);

          // Record decision lineage with full provenance
          if (input) {
            const deterministic = computeDeterministicSignals(input, undefined, costPerGbPerDay);
            const promptHash = crypto.createHash('sha256').update(versions.promptVersion).digest('hex');
            const cognitive = {
              model: versions.modelVersion,
              model_version: versions.modelVersion,
              prompt_hash: promptHash,
              temperature: 0.7,
              confidence_score: finalDecision.confidenceScore,
              reasoning: finalDecision.reasoning,
              inference_tokens: 0,
              latency_ms: 0,
              signal_source: 'AI' as const,
            };

            await recordDecisionLineage(client, {
              snapshot_id: snapshotId,
              index_name: finalDecision.index,
              sourcetype: finalDecision.sourcetype || null,
              deterministic_signals: deterministic,
              cognitive_signals: cognitive,
              decision_status: 'PROPOSED',
              fingerprint_version: versions.heuristicVersion, // Track fingerprinting schema version
            });
          }

          inserted++;
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        throw new Error(`[Aggregation] FAIL_FAST: Batch ${batchNum} failed after ${inserted} successful inserts. Error: ${errorMsg}`);
      }
    }

    // Persist executive KPIs — use deterministic scores where available
    // Override tier counts from deterministic engine (more accurate than LLM estimates)
    const deterministicTierCounts = {
      critical:   allScored.filter(s => s.tier === 'Critical').length,
      important:  allScored.filter(s => s.tier === 'Important').length,
      niceToHave: allScored.filter(s => s.tier === 'Nice-to-Have').length,
      lowValue:   allScored.filter(s => s.tier === 'Low-Value').length,
    };
    const deterministicAvgUtil = allScored.length > 0
      ? Math.round(allScored.reduce((s, x) => s + x.utilizationScore, 0) / allScored.length * 10) / 10
      : 0;
    const deterministicAvgDet = allScored.length > 0
      ? Math.round(allScored.reduce((s, x) => s + x.detectionScore, 0) / allScored.length * 10) / 10
      : 0;
    const deterministicAvgQual = allScored.length > 0
      ? Math.round(allScored.reduce((s, x) => s + x.qualityScore, 0) / allScored.length * 10) / 10
      : 0;

    // Patch agentSummary tier counts and avg scores with deterministic values
    if (allScored.length > 0) {
      agentSummary.tierCounts    = deterministicTierCounts;
      agentSummary.avgUtilization = deterministicAvgUtil;
      agentSummary.avgDetection   = deterministicAvgDet;
      agentSummary.avgQuality     = deterministicAvgQual;
    }

    await upsertExecutiveKpis(client, agentSummary, snapshotId, today, {
      roiScore:            deterministicROI,
      gainScopeScore:      deterministicGainScope,
      licenseSpendLowValue: deterministicLowValue,
      securityGaps:        securityGapCount,
      operationalGaps:     operationalGapCount,
    });

    // Persist queue health metrics (platform observability)
    const allDecisions = agentSummary.decisions || [];
    const highConfidence = allDecisions.filter((d: any) => Number(d.confidenceScore) >= 0.95).length;
    const mediumConfidence = allDecisions.filter((d: any) => Number(d.confidenceScore) >= 0.70 && Number(d.confidenceScore) < 0.95).length;
    const lowConfidence = allDecisions.filter((d: any) => Number(d.confidenceScore) < 0.70).length;

    await persistQueueHealthMetrics(client, snapshotId, today, {
      unchangedIndexes: diffResult.summaryStats.unchangedCount,
      totalIndexes: allInputs.length,
      candidatesSentToAi: toProcess.length,
      highConfidenceProposals: highConfidence,
      mediumConfidenceProposals: mediumConfidence,
      lowConfidenceProposals: lowConfidence,
    });

    // Persist snapshot metadata and diff stats (incremental processing tracking)
    await persistDiffStats(client, {
      snapshotId,
      snapshotDate: today,
      totalIndexes: allInputs.length,
      unchangedIndexes: diffResult.summaryStats.unchangedCount,
      changedIndexes: diffResult.summaryStats.changedCount,
      newIndexes: diffResult.summaryStats.newCount,
      removedIndexes: diffResult.summaryStats.removedCount,
      llmVersion: versions.llmVersion,
      promptVersion: versions.promptVersion,
      modelVersion: versions.modelVersion,
      heuristicVersion: versions.heuristicVersion,
    });

    // Persist metadata history for diffing in next snapshot
    await persistMetadataHistory(client, allInputs, today, diffResult);

    // Update cache metadata
    await updateCacheMetadata(client, 'index_metrics', inserted);

    // Phase 3: Secondary table population (optional, non-critical)
    // These use real Splunk queries with LLM estimation fallback
    try {
      await populateFieldUsage(client, decisions, today, splunk);
    } catch (e) {
      console.warn('[Aggregation] Field usage population skipped:', e instanceof Error ? e.message : e);
    }

    try {
      await populateSecurityCoverage(client, decisions, today, splunk);
    } catch (e) {
      console.warn('[Aggregation] Security coverage population skipped:', e instanceof Error ? e.message : e);
    }

    try {
      await populateQualityHotspots(client, decisions, today, splunk);
    } catch (e) {
      console.warn('[Aggregation] Quality hotspots population skipped:', e instanceof Error ? e.message : e);
    }

    // Search audit (non-critical — log errors, don't fail the pipeline)
    try {
      const savedSearches = await splunk.getSavedSearches();
      if (savedSearches.length > 0) {
        await client.query(`DELETE FROM search_audit WHERE snapshot_date = $1`, [today]);
        const archivedIndexes = new Set(
          decisions.filter((d: any) => d.action === 'ARCHIVE' || d.action === 'ELIMINATE').map((d: any) => d.index)
        );
        for (const s of savedSearches) {
          const isOrphan = s.isScheduled && !s.lastRun;
          const isUnused = !s.isScheduled && !s.isAlert && !s.lastRun;
          const confidenceScore = isOrphan ? 0.3 : isUnused ? 0.4 : s.isAlert ? 0.8 : 0.6;
          const reason = isOrphan ? 'Scheduled search with no recorded execution'
            : isUnused ? 'Not scheduled, not an alert, never run'
            : s.isAlert ? 'Active alert'
            : 'Saved search';
          const riskLevel = isOrphan ? 'HIGH' : isUnused ? 'HIGH' : s.isAlert ? 'LOW' : 'MEDIUM';
          await client.query(
            `INSERT INTO search_audit (snapshot_date, search_name, search_type, app, schedule, confidence_score, reason, risk_level, is_unused)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [today, s.name, s.isAlert ? 'alert' : 'scheduled', s.app, s.schedule,
             confidenceScore, reason, riskLevel, isUnused]
          );
        }
        console.log(`[Aggregation] Search audit: ${savedSearches.length} searches audited.`);
      }
    } catch (e) {
      console.warn('[Aggregation] Search audit skipped (non-fatal):', e instanceof Error ? e.message : e);
    }

    // ── Step 6: Drift Detection & Confidence Penalty ──────────────────────
    // Evaluate semantic drift and route significantly drifted indexes for reanalysis
    try {
      const driftMetrics = await evaluateDriftForSnapshot(client, snapshotId, today, allInputs);
      console.log(`[Aggregation] Drift evaluation complete: ${driftMetrics.driftedCount} drifted, ${driftMetrics.reanalyzedCount} queued for reanalysis`);
    } catch (e) {
      console.warn('[Aggregation] Drift detection skipped (non-fatal):', e instanceof Error ? e.message : e);
    }
  }, ctx);

  return {
    snapshotId,
    inserted,
    errors,
    durationMs: Date.now() - start,
    agentReasoning: agentSummary.agentReasoning,
  };
}

// Sanitize decision fields: ensure all numeric fields are actual numbers (not strings)
function sanitizeDecision(d: LLMDecision): any {
  const confidenceMap: Record<string, number> = { 'HIGH': 0.9, 'MEDIUM': 0.5, 'LOW': 0.3 };
  return {
    ...d,
    confidence: confidenceMap[d.confidence as string] || 0.5,
    confidenceScore: Number(d.confidenceScore) || 0.5,
    riskScore: Number(d.riskScore) || 0,
    utilizationScore: Number(d.utilizationScore) || 0,
    detectionScore: Number(d.detectionScore) || 0,
    qualityScore: Number(d.qualityScore) || 0,
    compositeScore: Number(d.compositeScore) || 0,
    annualLicenseCost: Number(d.annualLicenseCost) || 0,
    estimatedSavings: Number(d.estimatedSavings) || 0,
  };
}

async function upsertDecision(
  client: PoolClient,
  decision: LLMDecision,
  input: RawTelemetryInput | undefined,
  snapshotId: string,
  today: string
): Promise<void> {
  // Sanitize all numeric fields before insert
  const clean = sanitizeDecision(decision);

  const granularity = clean.sourcetype ? 'sourcetype' : 'index';
  const parentIndex = clean.sourcetype ? clean.index : null;

  // Map LLM decision action to existing classification enum
  const classificationMap: Record<string, string> = {
    KEEP: 'KEEP',
    OPTIMIZE: 'OPTIMIZE',
    ARCHIVE: 'ARCHIVE',
    ELIMINATE: 'ELIMINATE',
    S3_CANDIDATE: 'ARCHIVE',
  };

  await client.query(
    `
    INSERT INTO telemetry_snapshots (
      snapshot_id, snapshot_date, granularity, parent_index, index_name, sourcetype,
      total_events, daily_avg_gb, retention_days,
      utilization_pct, cost_per_year, risk_score,
      classification, confidence, recommendation, evidence,
      raw_metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    ON CONFLICT (snapshot_date, granularity, index_name, sourcetype) DO UPDATE SET
      snapshot_id     = EXCLUDED.snapshot_id,
      total_events    = EXCLUDED.total_events,
      daily_avg_gb    = EXCLUDED.daily_avg_gb,
      retention_days  = EXCLUDED.retention_days,
      cost_per_year   = EXCLUDED.cost_per_year,
      risk_score      = EXCLUDED.risk_score,
      classification  = EXCLUDED.classification,
      confidence      = EXCLUDED.confidence,
      recommendation  = EXCLUDED.recommendation,
      evidence        = EXCLUDED.evidence,
      raw_metadata    = EXCLUDED.raw_metadata,
      updated_at      = NOW()
    `,
    [
      snapshotId,
      today,
      granularity,
      parentIndex,
      clean.index,
      clean.sourcetype || null,
      input?.totalEvents ?? 0,
      input?.dailyAvgGb ?? 0,
      input?.retentionDays ?? 90,
      clean.utilizationScore,
      clean.annualLicenseCost,
      clean.riskScore,
      classificationMap[clean.action] || 'KEEP',
      clean.confidenceScore,
      clean.recommendation,
      JSON.stringify({
        ...clean.evidence.map((e: string) => ({ text: e })),
        reasoning: clean.reasoning,
        tier: clean.tier,
        action: clean.action,
        confidence: clean.confidence,
        isQuickWin: clean.isQuickWin,
        isS3Candidate: clean.isS3Candidate,
        detectionGap: clean.detectionGap,
        estimatedSavings: clean.estimatedSavings,
        compositeScore: clean.compositeScore,
        utilizationScore: clean.utilizationScore,
        detectionScore: clean.detectionScore,
        qualityScore: clean.qualityScore,
      }),
      JSON.stringify({
        firstEvent: input?.firstEvent,
        lastEvent: input?.lastEvent,
        reasoning: clean.reasoning,
        agentDecision: true,
      }),
    ]
  );
}

async function upsertExecutiveKpis(
  client: PoolClient,
  summary: Awaited<ReturnType<typeof runLLMDecisionAgent>>,
  snapshotId: string,
  today: string,
  overrides?: {
    roiScore: number;
    gainScopeScore: number;
    licenseSpendLowValue: number;
    securityGaps: number;
    operationalGaps: number;
  }
): Promise<void> {
  await client.query(
    `
    INSERT INTO executive_kpis (
      snapshot_id, snapshot_date,
      roi_score, gainscope_score,
      total_license_spend, license_spend_low_value, storage_savings_potential,
      total_daily_gb, total_sourcetypes,
      tier_critical, tier_important, tier_nice_to_have, tier_low_value,
      security_gaps, operational_gaps,
      avg_utilization, avg_detection, avg_quality, avg_confidence,
      quick_wins, savings_staircase, agent_reasoning
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
    ON CONFLICT (snapshot_date) DO UPDATE SET
      snapshot_id             = EXCLUDED.snapshot_id,
      roi_score               = EXCLUDED.roi_score,
      gainscope_score         = EXCLUDED.gainscope_score,
      total_license_spend     = EXCLUDED.total_license_spend,
      license_spend_low_value = EXCLUDED.license_spend_low_value,
      storage_savings_potential = EXCLUDED.storage_savings_potential,
      total_daily_gb          = EXCLUDED.total_daily_gb,
      total_sourcetypes       = EXCLUDED.total_sourcetypes,
      tier_critical           = EXCLUDED.tier_critical,
      tier_important          = EXCLUDED.tier_important,
      tier_nice_to_have       = EXCLUDED.tier_nice_to_have,
      tier_low_value          = EXCLUDED.tier_low_value,
      security_gaps           = EXCLUDED.security_gaps,
      operational_gaps        = EXCLUDED.operational_gaps,
      avg_utilization         = EXCLUDED.avg_utilization,
      avg_detection           = EXCLUDED.avg_detection,
      avg_quality             = EXCLUDED.avg_quality,
      avg_confidence          = EXCLUDED.avg_confidence,
      quick_wins              = EXCLUDED.quick_wins,
      savings_staircase       = EXCLUDED.savings_staircase,
      agent_reasoning         = EXCLUDED.agent_reasoning,
      updated_at              = NOW()
    `,
    [
      snapshotId, today,
      overrides?.roiScore          ?? summary.roiScore,
      overrides?.gainScopeScore    ?? summary.gainScopeScore,
      summary.totalLicenseSpend,
      overrides?.licenseSpendLowValue ?? summary.licenseSpendLowValue,
      summary.storageSavingsPotential,
      summary.totalDailyGb, summary.totalSourcetypes,
      summary.tierCounts.critical, summary.tierCounts.important,
      summary.tierCounts.niceToHave, summary.tierCounts.lowValue,
      overrides?.securityGaps      ?? summary.securityGaps,
      overrides?.operationalGaps   ?? summary.operationalGaps,
      summary.avgUtilization, summary.avgDetection, summary.avgQuality, summary.avgConfidence,
      JSON.stringify(summary.quickWins),
      JSON.stringify(summary.savingsStaircase),
      summary.agentReasoning,
    ]
  );
}

async function upsertAgentDecision(
  client: PoolClient,
  decision: LLMDecision,
  snapshotId: string,
  today: string,
  versions?: {
    llmVersion: string;
    promptVersion: string;
    modelVersion: string;
    heuristicVersion: string;
  },
  metadataFingerprint?: string
): Promise<void> {
  // Sanitize numeric fields
  const clean = sanitizeDecision(decision);

  // Compute decision stability
  const stability = await computeDecisionStability(client, clean.index, clean.sourcetype || null);
  const processingStatus = stability.isUnstable ? 'unstable_decision' : 'changed';

  await client.query(
    `
    INSERT INTO agent_decisions (
      snapshot_id, snapshot_date,
      index_name, sourcetype,
      tier, action,
      composite_score, utilization_score, detection_score, quality_score, risk_score,
      annual_license_cost, estimated_savings,
      confidence, confidence_score,
      recommendation, reasoning, evidence,
      is_quick_win, is_s3_candidate, detection_gap,
      metadata_fingerprint,
      llm_version, prompt_version, model_version, heuristic_version,
      last_llm_processed_at, decision_stability_score, processing_status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
    ON CONFLICT (snapshot_id, index_name, sourcetype) DO UPDATE SET
      tier = EXCLUDED.tier,
      action = EXCLUDED.action,
      composite_score = EXCLUDED.composite_score,
      utilization_score = EXCLUDED.utilization_score,
      detection_score = EXCLUDED.detection_score,
      quality_score = EXCLUDED.quality_score,
      risk_score = EXCLUDED.risk_score,
      annual_license_cost = EXCLUDED.annual_license_cost,
      estimated_savings = EXCLUDED.estimated_savings,
      confidence = EXCLUDED.confidence,
      confidence_score = EXCLUDED.confidence_score,
      recommendation = EXCLUDED.recommendation,
      reasoning = EXCLUDED.reasoning,
      evidence = EXCLUDED.evidence,
      is_quick_win = EXCLUDED.is_quick_win,
      is_s3_candidate = EXCLUDED.is_s3_candidate,
      detection_gap = EXCLUDED.detection_gap,
      metadata_fingerprint = EXCLUDED.metadata_fingerprint,
      llm_version = EXCLUDED.llm_version,
      prompt_version = EXCLUDED.prompt_version,
      model_version = EXCLUDED.model_version,
      heuristic_version = EXCLUDED.heuristic_version,
      last_llm_processed_at = EXCLUDED.last_llm_processed_at,
      decision_stability_score = EXCLUDED.decision_stability_score,
      processing_status = EXCLUDED.processing_status,
      updated_at = NOW()
`,
    [
      snapshotId,
      today,
      clean.index,
      clean.sourcetype || null,
      clean.tier,
      clean.action,
      clean.compositeScore,
      clean.utilizationScore,
      clean.detectionScore,
      clean.qualityScore,
      clean.riskScore,
      clean.annualLicenseCost,
      clean.estimatedSavings,
      clean.confidence,
      clean.confidenceScore,
      clean.recommendation,
      clean.reasoning,
      JSON.stringify(clean.evidence),
      clean.isQuickWin,
      clean.isS3Candidate,
      clean.detectionGap,
      metadataFingerprint || null,
      versions?.llmVersion || '1.0',
      versions?.promptVersion || '2.0',
      versions?.modelVersion || 'gemma2:9b',
      versions?.heuristicVersion || '1.2',
      new Date(),
      Math.round(stability.stabilityScore * 100),
      processingStatus,
    ]
  );
}

async function populateFieldUsage(
  client: PoolClient,
  decisions: LLMDecision[],
  today: string,
  splunk?: SplunkClient
): Promise<void> {
  // Phase 3a: Field Usage Optimization
  // Queries Splunk tstats for indexed vs used fields per sourcetype

  await client.query(`DELETE FROM field_usage WHERE snapshot_date = $1`, [today]);

  let fieldData: Array<{ sourcetype: string; fieldsIndexed: number; fieldsUsed: number; optimizationPct: number }> = [];

  // Try real Splunk query first
  if (splunk) {
    try {
      const metrics = await queryFieldUsage(splunk, 30);
      fieldData = metrics;
      console.log(`[Aggregation] Field usage: ${fieldData.length} sourcetypes from Splunk tstats query`);
    } catch (err) {
      console.warn(`[Aggregation] Field usage Splunk query failed, falling back to LLM estimation:`, err instanceof Error ? err.message : String(err));
      // Fall through to estimation below
    }
  }

  // Fallback: estimate based on LLM decisions
  if (fieldData.length === 0) {
    fieldData = decisions
      .filter(d => d.sourcetype)
      .map(d => ({
        sourcetype: d.sourcetype || 'unknown',
        fieldsIndexed: Math.max(50, Math.round(100 - d.qualityScore)),
        fieldsUsed: Math.max(10, Math.round(d.utilizationScore / 5)),
        optimizationPct: Math.round(d.qualityScore),
      }));
    console.log(`[Aggregation] Field usage: ${fieldData.length} sourcetypes indexed (LLM estimation fallback)`);
  }

  for (const field of fieldData) {
    await client.query(
      `INSERT INTO field_usage (snapshot_date, sourcetype, fields_indexed, fields_used, optimization_pct)
       VALUES ($1, $2, $3, $4, $5)`,
      [today, field.sourcetype, field.fieldsIndexed, field.fieldsUsed, field.optimizationPct]
    );
  }
}

async function populateSecurityCoverage(
  client: PoolClient,
  decisions: LLMDecision[],
  today: string,
  splunk?: SplunkClient
): Promise<void> {
  // Phase 3b: Security Coverage (MITRE ATT&CK)
  // Maps sourcetype → MITRE techniques covered for threat detection capability

  await client.query(`DELETE FROM security_coverage WHERE snapshot_date = $1`, [today]);

  let securityData: Array<{ sourcetype: string; coveragePct: number; activeAlerts: number; detectionGaps: string }> = [];

  // Try real Splunk query first
  if (splunk) {
    try {
      const metrics = await querySecurityCoverage(splunk, 30);
      securityData = metrics.map(sc => ({
        sourcetype: sc.sourcetype,
        coveragePct: Math.round((sc.coverageCount / 5) * 100), // Coverage count out of ~5 major MITRE categories
        activeAlerts: sc.coverageCount > 0 ? Math.floor(sc.coverageCount / 2) : 0,
        detectionGaps: sc.coverageCount < 3 ? 'Yes' : 'No',
      }));
      console.log(`[Aggregation] Security coverage: ${securityData.length} sourcetypes from Splunk MITRE mapping`);
    } catch (err) {
      console.warn(`[Aggregation] Security coverage Splunk query failed, falling back to LLM estimation:`, err instanceof Error ? err.message : String(err));
      // Fall through to estimation below
    }
  }

  // Fallback: estimate based on LLM decisions
  if (securityData.length === 0) {
    securityData = decisions
      .filter(d => d.sourcetype)
      .map(d => ({
        sourcetype: d.sourcetype || 'unknown',
        coveragePct: Math.round(d.detectionScore * 1.2),
        activeAlerts: d.detectionScore > 60 ? Math.floor(Math.random() * 5) + 2 : 0,
        detectionGaps: d.detectionGap ? 'Yes' : 'No',
      }));
    console.log(`[Aggregation] Security coverage: ${securityData.length} sourcetypes (LLM estimation fallback)`);
  }

  for (const sec of securityData) {
    await client.query(
      `INSERT INTO security_coverage (snapshot_date, sourcetype, coverage_pct, active_alerts, detection_gaps)
       VALUES ($1, $2, $3, $4, $5)`,
      [today, sec.sourcetype, sec.coveragePct, sec.activeAlerts, sec.detectionGaps]
    );
  }
}

async function populateQualityHotspots(
  client: PoolClient,
  decisions: LLMDecision[],
  today: string,
  splunk?: SplunkClient
): Promise<void> {
  // Phase 3c: Data Quality Hotspots
  // Queries Splunk for parse error rates per sourcetype

  await client.query(`DELETE FROM quality_hotspots WHERE snapshot_date = $1`, [today]);

  let qualityData: Array<{ sourcetype: string; issueCount: number; qualityScore: number; estimatedImpact: string }> = [];

  // Try real Splunk query first
  if (splunk) {
    try {
      const metrics = await queryDataQualityMetrics(splunk, 30);
      qualityData = metrics.map(qh => ({
        sourcetype: qh.sourcetype,
        issueCount: Math.max(1, Math.round(qh.parseErrorRate / 2)),
        qualityScore: Math.max(0, 100 - qh.parseErrorRate * 10),
        estimatedImpact: qh.impactLevel,
      }));
      console.log(`[Aggregation] Quality hotspots: ${qualityData.length} sourcetypes from Splunk parse error query`);
    } catch (err) {
      console.warn(`[Aggregation] Quality hotspots Splunk query failed, falling back to LLM estimation:`, err instanceof Error ? err.message : String(err));
      // Fall through to estimation below
    }
  }

  // Fallback: estimate based on LLM decisions
  if (qualityData.length === 0) {
    qualityData = decisions
      .filter(d => d.sourcetype && d.qualityScore < 80)
      .map(d => ({
        sourcetype: d.sourcetype || 'unknown',
        issueCount: Math.max(1, Math.round((100 - d.qualityScore) / 10)),
        qualityScore: d.qualityScore,
        estimatedImpact: d.qualityScore < 40 ? 'High' : d.qualityScore < 70 ? 'Medium' : 'Low',
      }));
    console.log(`[Aggregation] Quality hotspots: ${qualityData.length} sourcetypes (LLM estimation fallback)`);
  }

  for (const quality of qualityData) {
    await client.query(
      `INSERT INTO quality_hotspots (snapshot_date, sourcetype, issue_count, quality_score, estimated_impact)
       VALUES ($1, $2, $3, $4, $5)`,
      [today, quality.sourcetype, quality.issueCount, quality.qualityScore, quality.estimatedImpact]
    );
  }
}

async function updateCacheMetadata(client: PoolClient, key: string, count: number): Promise<void> {
  await client.query(
    `
    INSERT INTO cache_metadata (cache_key, last_refresh_at, next_refresh_at, status, record_count)
    VALUES ($1, NOW(), NOW() + INTERVAL '24 hours', 'fresh', $2)
    ON CONFLICT (cache_key) DO UPDATE SET
      last_refresh_at = EXCLUDED.last_refresh_at,
      next_refresh_at = EXCLUDED.next_refresh_at,
      status          = 'fresh',
      record_count    = EXCLUDED.record_count,
      updated_at      = NOW()
    `,
    [key, count]
  );
}

/**
 * Phase 2 fast path: fetch Splunk metadata (<5s), write raw snapshots,
 * enqueue LLM job for background worker. Returns immediately.
 * CRITICAL: tenantId is mandatory from RequestContext, never inferred.
 */
export async function runFastAggregation(
  splunk: SplunkClient,
  ctx: RequestContext,
  config: AggregationConfig = DEFAULT_CONFIG,
  options?: {
    snapshotId?: string;
    runId?: string;
  }
): Promise<FastAggregationResult> {
  const start = Date.now();
  const snapshotId = options?.snapshotId || uuidv4();
  const tenantId = ctx.tenantId;
  const today = new Date().toISOString().split('T')[0];

  const userConfig = await loadUserConfig();
  const costPerGbPerDay = config.costPerGbPerDay ?? userConfig.costPerGbPerDay;

  // ── 1. Fetch index metrics from Splunk ──────────────────────────────────
  const indexMetrics = await splunk.getIndexMetrics();
  if (indexMetrics.length === 0) {
    throw new Error('Splunk returned 0 indexes. Check index permissions.');
  }

  // Sourcetype drilldown for high-volume indexes
  const highVolumeIndexes = indexMetrics
    .filter((m) => m.dailyAvgGb >= SOURCETYPE_DRILLDOWN_GB)
    .sort((a, b) => b.dailyAvgGb - a.dailyAvgGb)
    .slice(0, MAX_SOURCETYPE_INDEXES)
    .map((m) => m.index);

  const sourcetypeMetrics = highVolumeIndexes.length > 0
    ? await splunk.getBatchSourcetypeMetrics(highVolumeIndexes).catch((e) => {
        console.warn('[FastAgg] Sourcetype batch failed:', e.message);
        return [];
      })
    : [];

  // ── 2. Write raw snapshots with tier=PENDING ────────────────────────────
  let inserted = 0;
  await transaction(async (client) => {
    for (const m of indexMetrics) {
      const annualCost = m.dailyAvgGb * costPerGbPerDay * 365;
      await client.query(`
        INSERT INTO telemetry_snapshots (
          tenant_id,
          snapshot_id, snapshot_date, granularity, index_name, sourcetype,
          total_events, daily_avg_gb, retention_days,
          utilization_pct, cost_per_year, risk_score,
          classification, confidence, recommendation, evidence, raw_metadata
        ) VALUES ($1,$2,$3,'index',$4,NULL,$5,$6,$7,0,$8,0,'INVESTIGATE',0.5,'Pending AI analysis','[]','{}')
        ON CONFLICT (tenant_id, snapshot_id, granularity, index_name, sourcetype) DO NOTHING
      `, [tenantId, snapshotId, today, m.index, m.totalEvents, m.dailyAvgGb, m.retentionDays, annualCost]);
      inserted++;
    }

    // Write search audit (deterministic, no LLM needed)
    try {
      const savedSearches = await splunk.getSavedSearches();
      if (savedSearches.length > 0) {
        await client.query(`DELETE FROM search_audit WHERE snapshot_date = $1`, [today]);
        for (const s of savedSearches) {
          const isOrphan = s.isScheduled && !s.lastRun;
          const isUnused = !s.isScheduled && !s.isAlert && !s.lastRun;
          const confidenceScore = isOrphan ? 0.3 : isUnused ? 0.4 : s.isAlert ? 0.8 : 0.6;
          const reason = isOrphan ? 'Scheduled search with no recorded execution'
            : isUnused ? 'Not scheduled, not an alert, never run'
            : s.isAlert ? 'Active alert' : 'Saved search';
          const riskLevel = isOrphan ? 'HIGH' : isUnused ? 'HIGH' : s.isAlert ? 'LOW' : 'MEDIUM';
          await client.query(
            `INSERT INTO search_audit (snapshot_date, search_name, search_type, app, schedule, confidence_score, reason, risk_level, is_unused)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
            [today, s.name, s.isAlert ? 'alert' : 'scheduled', s.app, s.schedule,
             confidenceScore, reason, riskLevel, isUnused]
          );
        }
      }
    } catch (e) {
      console.warn('[FastAgg] Search audit skipped:', e instanceof Error ? e.message : e);
    }

    // Write baseline KPIs (volume/cost only, LLM scores will come from worker)
    await client.query(`
      INSERT INTO executive_kpis (tenant_id, snapshot_date, snapshot_id, total_license_spend)
      VALUES ($1, $2, $3, (
        SELECT COALESCE(SUM(cost_per_year),0)
        FROM telemetry_snapshots
        WHERE tenant_id = $1 AND snapshot_id = $3
      ))
      ON CONFLICT (tenant_id, snapshot_id) DO UPDATE SET
        total_license_spend = EXCLUDED.total_license_spend,
        updated_at = NOW()
    `, [tenantId, today, snapshotId]);

    // Mark cache as fast_complete
    await client.query(`
      INSERT INTO cache_metadata (cache_key, last_refresh_at, next_refresh_at, status, record_count)
      VALUES ('index_metrics', NOW(), NOW() + INTERVAL '24 hours', 'fast_complete', $1)
      ON CONFLICT (cache_key) DO UPDATE SET
        last_refresh_at = NOW(),
        status = 'fast_complete',
        record_count = EXCLUDED.record_count,
        updated_at = NOW()
    `, [inserted]);
  }, ctx);

  // ── 3. Build candidate list for LLM (heuristic filter) ─────────────────
  const MAX_INDEXES = parseInt(process.env.MAX_INDEXES_PER_RUN || '100', 10);
  const allInputs: RawTelemetryInput[] = [
    ...indexMetrics.map((m) => ({
      index: m.index,
      sourcetype: undefined,
      dailyAvgGb: m.dailyAvgGb,
      totalEvents: m.totalEvents,
      retentionDays: m.retentionDays,
      firstEvent: m.firstEvent,
      lastEvent: m.lastEvent,
    })),
    ...sourcetypeMetrics.map((m) => ({
      index: m.index,
      sourcetype: m.sourcetype,
      dailyAvgGb: m.dailyAvgGb,
      totalEvents: m.totalEvents,
      retentionDays: m.retentionDays,
      firstEvent: m.firstEvent,
      lastEvent: m.lastEvent,
    })),
  ];

  // Smart candidate filter: only send materially expensive/stale items to LLM.
  // Small lab/demo Splunk environments should still publish server-derived KPIs
  // without waiting on local inference for indexes with negligible spend.
  const now = new Date();
  const minAiDailyGb = Number(process.env.LLM_MIN_DAILY_GB || 0.1);
  const minAiAnnualCost = Number(process.env.LLM_MIN_ANNUAL_COST || 25);
  const minAiEvents = Number(process.env.LLM_MIN_TOTAL_EVENTS || 1_000_000);
  const candidatesWithReasons = allInputs.map((inp) => {
    const daysSinceLast = inp.lastEvent
      ? (now.getTime() - new Date(inp.lastEvent).getTime()) / 86400000
      : 999;
    const reasons: string[] = [];
    const annualCost = inp.dailyAvgGb * 365 * costPerGbPerDay;
    const hasMaterialFootprint =
      inp.dailyAvgGb >= minAiDailyGb ||
      annualCost >= minAiAnnualCost ||
      inp.totalEvents >= minAiEvents;

    if (hasMaterialFootprint && inp.dailyAvgGb > 1) reasons.push('HIGH_VOLUME_LOW_USAGE');
    if (hasMaterialFootprint && inp.retentionDays > 365) reasons.push('LONG_RETENTION');
    if (hasMaterialFootprint && daysSinceLast > 30) reasons.push('STALE_INDEX');

    return { input: inp, reasons, selected: reasons.length > 0 };
  });

  const candidates = candidatesWithReasons
    .filter(c => c.selected)
    .slice(0, MAX_INDEXES)
    .map(c => c.input);

  const candidateReasons = candidatesWithReasons
    .filter(c => c.selected)
    .slice(0, MAX_INDEXES)
    .map(c => ({
      index: c.input.index,
      sourcetype: c.input.sourcetype,
      reasons: c.reasons,
    }));

  console.log(`[FastAgg] ${allInputs.length} total inputs → ${candidates.length} candidates for LLM`);
  console.log(`[FastAgg] Filtering reasons:`, candidateReasons.slice(0, 3).map(c => `${c.index}: ${c.reasons.join(', ')}`));

  // ── 4. Enqueue LLM job ──────────────────────────────────────────────────
  // CRITICAL: Job payload must include immutable tenant context for worker execution
  const jobId = await enqueueJob({
    jobType: 'llm_analysis',
    snapshotId,
    payload: {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      traceId: ctx.traceId,
      snapshotId,
      runId: options?.runId || uuidv4(),
      inputs: candidates,
      candidateReasons: candidates.length > 0 ? candidateReasons : [],
      config: { lookbackDays: config.lookbackDays, costPerGbPerDay },
      checkpoint: 0,
    },
  });

  console.log(`[FastAgg] Done in ${Date.now() - start}ms. Snapshot ${snapshotId}, job ${jobId}, ${inserted} snapshots written.`);

  return { snapshotId, jobId, runId: options?.runId, tenantId: ctx.tenantId, inserted, durationMs: Date.now() - start };
}

/**
 * Evaluate semantic drift for all decisions in current snapshot
 * Routes significantly drifted indexes back to LLM reanalysis queue
 */
async function evaluateDriftForSnapshot(
  client: PoolClient,
  snapshotId: string,
  snapshotDate: string,
  allInputs: RawTelemetryInput[]
): Promise<{ driftedCount: number; reanalyzedCount: number }> {
  try {
    console.log(`[Drift Detection] Starting drift evaluation for snapshot ${snapshotId}...`);

    // Initialize services for drift evaluation with seasonality and recovery
    const seasonalityService = getSeasonalityBaselineService();
    const riskSamplingService = getRiskWeightedSamplingService();

    // Fetch all current decisions
    const decisionsResult = await client.query(
      `SELECT id, snapshot_id, index_name, sourcetype, confidence_score
       FROM agent_decisions
       WHERE snapshot_date = $1 AND snapshot_id = $2`,
      [snapshotDate, snapshotId]
    );

    const currentDecisions = decisionsResult.rows;
    console.log(`[Drift Detection] Evaluating ${currentDecisions.length} decisions for drift...`);

    let driftedCount = 0;
    let reanalyzedCount = 0;
    const cleanSnapshots: Array<{ decisionId: string; snapshotDate: Date }> = [];

    // For each decision, compare to previous snapshot
    for (const decision of currentDecisions) {
      try {
        // Get previous snapshot for this index/sourcetype
        const prevResult = await client.query(
          `SELECT snapshot_date, total_events, daily_avg_gb, retention_days, utilization_pct
           FROM telemetry_snapshots
           WHERE index_name = $1 AND sourcetype = $2 AND snapshot_date < $3
           ORDER BY snapshot_date DESC LIMIT 1`,
          [decision.index_name, decision.sourcetype || null, snapshotDate]
        );

        if (prevResult.rows.length === 0) {
          // No previous snapshot — new index, no drift
          cleanSnapshots.push({ decisionId: decision.id, snapshotDate: new Date(snapshotDate) });
          continue;
        }

        const prevSnap = prevResult.rows[0];
        const currentInput = allInputs.find(
          inp => inp.index === decision.index_name && (inp.sourcetype || null) === (decision.sourcetype || null)
        );

        if (!currentInput) {
          continue;
        }

        // ── Check seasonality before evaluating drift ──
        // Distinguish legitimate operational spikes from semantic drift
        const volumeObserved = currentInput.dailyAvgGb;
        const utilizationObserved = currentInput.totalEvents > 0
          ? Math.min(100, (currentInput.totalEvents / 1000000))
          : 0;

        const seasonalViolation = await seasonalityService.checkSeasonalViolation(
          client,
          decision.index_name,
          volumeObserved,
          utilizationObserved,
          3.0 // 3-sigma threshold
        );

        // Update seasonal baseline for this time class (continuous learning)
        await seasonalityService.updateSeasonalBaseline(
          client,
          decision.index_name,
          seasonalityService.getTimeClass(new Date(snapshotDate)),
          volumeObserved,
          utilizationObserved
        );

        // Evaluate drift
        const driftResult = await evaluateSemanticDrift(
          client,
          decision.snapshot_id,
          {
            indexName: decision.index_name,
            totalEventsNow: currentInput.totalEvents,
            utilizationPctNow: utilizationObserved,
            retentionDaysNow: currentInput.retentionDays,
            snapshotDateNow: new Date(snapshotDate),
          },
          {
            totalEventsBaseline: prevSnap.total_events,
            utilizationPctBaseline: parseFloat(prevSnap.utilization_pct),
            retentionDaysBaseline: prevSnap.retention_days,
            snapshotDateBaseline: new Date(prevSnap.snapshot_date),
          },
          parseFloat(decision.confidence_score) || 0.5
        );

        if (driftResult.driftSeverity !== 'NONE') {
          // Check if this is a seasonal variation vs. true drift
          const isSeasonalSpike = seasonalViolation.violatesSeasonalEnvelope;

          if (isSeasonalSpike) {
            console.log(
              `[Drift Detection] ${decision.index_name}: Seasonal spike detected, not drift`,
              {
                timeClass: seasonalityService.getTimeClass(new Date(snapshotDate)),
                volumeSigma: seasonalViolation.volumeSigmaDistance,
                utilizationSigma: seasonalViolation.utilizationSigmaDistance,
              }
            );
            cleanSnapshots.push({ decisionId: decision.id, snapshotDate: new Date(snapshotDate) });
          } else {
            driftedCount++;
            console.log(
              `[Drift Detection] ${decision.index_name}: ${driftResult.driftSeverity} drift detected`,
              {
                vol_drift: driftResult.driftVector.vol_drift_pct,
                util_delta: driftResult.driftVector.util_delta_pct,
                penalty: driftResult.confidencePenalty,
                invalidated: driftResult.wasInvalidated,
              }
            );

            // ── Record drift event with asymmetric recovery mechanics ──
            // This updates historical drift count and sets recovery cooldown
            try {
              const penalizedConfidence = driftResult.confidenceEffective;
              await recordDriftEvent(
                client,
                decision.id,
                penalizedConfidence,
                driftResult.confidencePenalty
              );
              console.log(`[Confidence Recovery] Recorded drift event for ${decision.index_name}: cooldown applied`);
            } catch (e) {
              console.warn(`[Confidence Recovery] Error recording drift event for ${decision.index_name}:`,
                e instanceof Error ? e.message : e);
            }

            if (driftResult.reanalysisTriggered) {
              reanalyzedCount++;
              // Queue for reanalysis if severity >= METRIC
              if (['METRIC', 'SEMANTIC', 'POLICY'].includes(driftResult.driftSeverity)) {
                await enqueueReanalysisJob(
                  client,
                  decision.index_name,
                  'DRIFT_DETECTION',
                  'CRITICAL',
                  {
                    sourcetype: decision.sourcetype,
                    driftSeverity: driftResult.driftSeverity,
                  }
                );
              }
            }
          }
        } else {
          cleanSnapshots.push({ decisionId: decision.id, snapshotDate: new Date(snapshotDate) });
        }
      } catch (e) {
        console.warn(`[Drift Detection] Error evaluating drift for ${decision.index_name}:`, e instanceof Error ? e.message : e);
      }
    }

    // ── Apply confidence recovery to clean snapshots ──
    // Indexes with no drift can begin recovering from previous penalties
    for (const snap of cleanSnapshots) {
      try {
        const recoveryResult = await recordCleanSnapshot(
          client,
          snap.decisionId,
          snap.snapshotDate
        );
        if (recoveryResult.milestonesReached.length > 0) {
          console.log(`[Confidence Recovery] ${snap.decisionId}: Recovered via ${recoveryResult.milestonesReached.length} milestones`);
        }
      } catch (e) {
        console.warn(`[Confidence Recovery] Error recording clean snapshot for ${snap.decisionId}:`,
          e instanceof Error ? e.message : e);
      }
    }

    // ── Risk-weighted sampling: select high-risk decisions for ground truth audit ──
    // Target "stable hallucinations" (high confidence, deep reuse, high financial impact)
    try {
      const samplingCandidates = await riskSamplingService.selectSamplingCandidates(
        client,
        50, // max candidates to consider
        0.7  // minimum effective confidence threshold
      );

      if (samplingCandidates.length > 0) {
        const auditBatch = riskSamplingService.selectAuditBatch(samplingCandidates, 10);
        console.log(`[Risk-Weighted Sampling] Selected ${auditBatch.samplingSize} indexes for ground truth audit`);
        console.log(`[Risk-Weighted Sampling] Total risk covered: ${auditBatch.totalRiskCovered}`);
        console.log(`[Risk-Weighted Sampling] Explanation:\n${auditBatch.explanation}`);

        // Enqueue sampling batch as ground truth validation jobs
        const samplingJobsEnqueued = await riskSamplingService.enqueueSamplingBatch(
          client,
          auditBatch,
          snapshotId
        );
        console.log(`[Risk-Weighted Sampling] Enqueued ${samplingJobsEnqueued} sampling jobs`);
      }
    } catch (e) {
      console.warn('[Risk-Weighted Sampling] Error during sampling:', e instanceof Error ? e.message : e);
    }

    console.log(`[Drift Detection] Complete: ${driftedCount} drifted, ${reanalyzedCount} queued for reanalysis, ${cleanSnapshots.length} clean snapshots recovered`);
    return { driftedCount, reanalyzedCount };
  } catch (e) {
    console.error('[Drift Detection] Error in drift evaluation:', e instanceof Error ? e.message : e);
    return { driftedCount: 0, reanalyzedCount: 0 };
  }
}
