import { PoolClient } from 'pg';
import { SplunkClient } from './splunk-client';
import { runLLMDecisionAgent, RawTelemetryInput, LLMDecision } from '../agents/llm-decision-agent';
import { query, transaction } from '../../../core/database/connection';
import { v4 as uuidv4 } from 'uuid';

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
  config: AggregationConfig = DEFAULT_CONFIG
): Promise<AggregationResult> {
  const start = Date.now();
  const snapshotId = uuidv4();

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
      licenseGbPerDay: config.costPerGbPerDay,
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

  // ── Step 3: LLM agent makes ALL decisions ──────────────────────────────────
  console.log(`[Aggregation] Sending ${allInputs.length} metrics to LLM decision agent...`);
  const agentSummary = await runLLMDecisionAgent(allInputs, config.costPerGbPerDay);
  console.log(`[Aggregation] LLM agent completed. ${agentSummary.decisions.length} decisions received.`);

  // ── Step 4: Persist decisions to DB ────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  let inserted = 0;
  let errors = 0;

  // Batch insert (50 rows per batch) with savepoint per batch
  const BATCH_SIZE = 50;
  const decisions = agentSummary.decisions;

  await transaction(async (client) => {
    // Clear today's rows before inserting to avoid conflicts on re-run
    await client.query(`DELETE FROM telemetry_snapshots WHERE snapshot_date = $1`, [today]);
    await client.query(`DELETE FROM agent_decisions WHERE snapshot_date = $1`, [today]);

    for (let i = 0; i < decisions.length; i += BATCH_SIZE) {
      const batch = decisions.slice(i, i + BATCH_SIZE);
      const sp = `sp_batch_${Math.floor(i / BATCH_SIZE)}`;
      try {
        await client.query(`SAVEPOINT ${sp}`);
        for (const decision of batch) {
          const input = allInputs.find(
            (inp) => inp.index === decision.index && (inp.sourcetype || null) === (decision.sourcetype || null)
          );
          await upsertDecision(client, decision, input, snapshotId, today);
          await upsertAgentDecision(client, decision, snapshotId, today);
          inserted++;
        }
        await client.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        errors += batch.length;
        console.error(`[Aggregation] Batch ${sp} failed:`, e instanceof Error ? e.message : e);
      }
    }

    // Persist executive KPIs
    await upsertExecutiveKpis(client, agentSummary, snapshotId, today);

    // Update cache metadata
    await updateCacheMetadata(client, 'index_metrics', inserted);

    // Search audit (non-critical — log errors, don't fail the pipeline)
    try {
      const savedSearches = await splunk.getSavedSearches();
      if (savedSearches.length > 0) {
        await client.query(`DELETE FROM search_audit WHERE snapshot_date = $1`, [today]);
        const archivedIndexes = new Set(
          decisions.filter(d => d.action === 'ARCHIVE' || d.action === 'ELIMINATE').map(d => d.index)
        );
        for (const s of savedSearches) {
          const isOrphan = s.isScheduled && !s.lastRun;
          const confidence = isOrphan ? 30 : s.isAlert ? 80 : 60;
          const reason = isOrphan ? 'Scheduled search with no recorded execution'
            : s.isAlert ? 'Active alert'
            : 'Saved search';
          await client.query(
            `INSERT INTO search_audit (snapshot_date, search_name, search_type, app, schedule, is_scheduled, is_alert, last_run, confidence_score, reason, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [today, s.name, s.isAlert ? 'alert' : 'scheduled', s.app, s.schedule,
             s.isScheduled, s.isAlert, s.lastRun, confidence, reason,
             isOrphan ? 'orphan' : 'active']
          );
        }
        console.log(`[Aggregation] Search audit: ${savedSearches.length} searches audited.`);
      }
    } catch (e) {
      console.warn('[Aggregation] Search audit skipped (non-fatal):', e instanceof Error ? e.message : e);
    }
  });

  return {
    snapshotId,
    inserted,
    errors,
    durationMs: Date.now() - start,
    agentReasoning: agentSummary.agentReasoning,
  };
}

async function upsertDecision(
  client: PoolClient,
  decision: LLMDecision,
  input: RawTelemetryInput | undefined,
  snapshotId: string,
  today: string
): Promise<void> {
  const granularity = decision.sourcetype ? 'sourcetype' : 'index';
  const parentIndex = decision.sourcetype ? decision.index : null;

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
    ON CONFLICT ON CONSTRAINT uq_snapshot_identity DO UPDATE SET
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
      decision.index,
      decision.sourcetype || null,
      input?.totalEvents ?? 0,
      input?.dailyAvgGb ?? 0,
      input?.retentionDays ?? 90,
      decision.utilizationScore,
      decision.annualLicenseCost,
      decision.riskScore,
      classificationMap[decision.action] || 'KEEP',
      decision.confidenceScore,
      decision.recommendation,
      JSON.stringify({
        ...decision.evidence.map((e) => ({ text: e })),
        reasoning: decision.reasoning,
        tier: decision.tier,
        action: decision.action,
        confidence: decision.confidence,
        isQuickWin: decision.isQuickWin,
        isS3Candidate: decision.isS3Candidate,
        detectionGap: decision.detectionGap,
        estimatedSavings: decision.estimatedSavings,
        compositeScore: decision.compositeScore,
        utilizationScore: decision.utilizationScore,
        detectionScore: decision.detectionScore,
        qualityScore: decision.qualityScore,
      }),
      JSON.stringify({
        firstEvent: input?.firstEvent,
        lastEvent: input?.lastEvent,
        reasoning: decision.reasoning,
        agentDecision: true,
      }),
    ]
  );
}

async function upsertExecutiveKpis(
  client: PoolClient,
  summary: Awaited<ReturnType<typeof runLLMDecisionAgent>>,
  snapshotId: string,
  today: string
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
      summary.roiScore, summary.gainScopeScore,
      summary.totalLicenseSpend, summary.licenseSpendLowValue, summary.storageSavingsPotential,
      summary.totalDailyGb, summary.totalSourcetypes,
      summary.tierCounts.critical, summary.tierCounts.important,
      summary.tierCounts.niceToHave, summary.tierCounts.lowValue,
      summary.securityGaps, summary.operationalGaps,
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
  today: string
): Promise<void> {
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
      is_quick_win, is_s3_candidate, detection_gap
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
`,
    [
      snapshotId,
      today,
      decision.index,
      decision.sourcetype || null,
      decision.tier,
      decision.action,
      decision.compositeScore,
      decision.utilizationScore,
      decision.detectionScore,
      decision.qualityScore,
      decision.riskScore,
      decision.annualLicenseCost,
      decision.estimatedSavings,
      decision.confidence,
      decision.confidenceScore,
      decision.recommendation,
      decision.reasoning,
      JSON.stringify(decision.evidence),
      decision.isQuickWin,
      decision.isS3Candidate,
      decision.detectionGap,
    ]
  );
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
