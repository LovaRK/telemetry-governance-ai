/**
 * Background LLM Worker
 *
 * Polls job_queue for pending jobs, processes them with local Ollama.
 * LLM is NEVER called from the HTTP request path — only here.
 *
 * Architecture:
 *   web container  → enqueues job → returns fast
 *   worker (this)  → claims job  → calls Ollama on host → writes decisions → done
 */

import { claimNextJob, updateJobProgress, checkpointJob, setJobComplete, setJobFailed, recoverStaleJobs, setJobExecutionMetrics } from '../apps/api/services/job-service';
import { runLLMDecisionAgent, RawTelemetryInput } from '../apps/api/agents/llm-decision-agent';
import { loadUserConfig } from '../apps/api/services/config-service';
import { pool, query, transaction } from '../core/database/connection';
import { ModelGovernanceService, RuntimeFingerprint } from '../apps/api/services/model-governance-service';
import { appendStageEvent, markRunFailed, publishRunAtomic, setRunExecutionMetrics } from '../apps/api/services/pipeline-ledger-service';
import { startSelfObservability, stopSelfObservability } from '../apps/api/services/governance-self-observability';

const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '5000', 10);
const BATCH_SIZE = 1; // One index at a time — local Ollama memory constraint
const WORKER_BATCH_TIMEOUT_MS = parseInt(process.env.WORKER_BATCH_TIMEOUT_MS || '240000', 10);
const governanceService = new ModelGovernanceService(pool);

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resolveValidatedRunId(runId: string | null, tenantId: string): Promise<string | null> {
  if (!runId) return null;
  const result = await query<{ runId: string }>(
    `SELECT run_id as "runId"
     FROM pipeline_runs
     WHERE run_id = $1
       AND tenant_id = $2
     LIMIT 1`,
    [runId, tenantId]
  );
  return result.rows[0]?.runId ?? null;
}

async function loadFallbackInputsFromSnapshot(snapshotId: string, tenantId: string): Promise<RawTelemetryInput[]> {
  const result = await query<{
    indexName: string;
    sourcetype: string | null;
    dailyAvgGb: string;
    totalEvents: string;
    retentionDays: number | null;
    createdAt: string;
  }>(
    `SELECT
       index_name as "indexName",
       sourcetype,
       daily_avg_gb::text as "dailyAvgGb",
       total_events::text as "totalEvents",
       retention_days as "retentionDays",
       created_at as "createdAt"
     FROM telemetry_snapshots
     WHERE snapshot_id = $1
       AND tenant_id = $2
       AND granularity IN ('sourcetype','index')
     ORDER BY CASE WHEN granularity = 'sourcetype' THEN 0 ELSE 1 END, daily_avg_gb DESC`,
    [snapshotId, tenantId]
  );

  return result.rows.map((row) => {
    const ts = row.createdAt || new Date().toISOString();
    return {
      index: row.indexName,
      sourcetype: row.sourcetype || undefined,
      dailyAvgGb: Number(row.dailyAvgGb || '0'),
      totalEvents: Number(row.totalEvents || '0'),
      retentionDays: Number(row.retentionDays || 30),
      firstEvent: ts,
      lastEvent: ts,
    };
  });
}

async function processJob(job: any): Promise<void> {
  const { inputs = [], candidateReasons, config, checkpoint = 0 } = job.payload as {
    inputs: RawTelemetryInput[];
    candidateReasons?: Array<{ index: string; sourcetype?: string; reasons: string[] }>;
    config: any;
    checkpoint: number;
  };

  const today = new Date().toISOString().split('T')[0];
  const snapshotId = job.snapshotId || job.payload.snapshotId;
  const rawRunId = (job.payload as any)?.runId || null;
  const tenantId = (job.payload as any)?.tenantId || 'default';
  const requestId = (job.payload as any)?.requestId || null;
  const runId = await resolveValidatedRunId(rawRunId, tenantId);

  if (rawRunId && !runId) {
    throw new Error(`MISSING_PIPELINE_RUN: run_id ${rawRunId} not found for tenant ${tenantId}`);
  }

  let effectiveInputs = inputs;
  if (effectiveInputs.length === 0) {
    const fallbackInputs = await loadFallbackInputsFromSnapshot(snapshotId, tenantId);
    if (fallbackInputs.length > 0) {
      console.log(`[Worker] Job ${job.jobId}: candidate filter empty — using ${fallbackInputs.length} fallback snapshot inputs`);
      effectiveInputs = fallbackInputs;
    }
  }

  if (effectiveInputs.length === 0) {
    console.log(`[Worker] Job ${job.jobId}: no material AI candidates; publishing Splunk-derived snapshot only`);
    if (runId) {
      await appendStageEvent({
        runId,
        stage: 'AI_DECISIONS',
        status: 'SUCCESS',
        recordsProcessed: 0,
        requestId,
        metadata: { jobId: job.jobId, snapshotId, mode: 'no_material_candidates', requestId },
      });
      await appendStageEvent({
        runId,
        stage: 'GOVERNANCE_SYNC',
        status: 'SUCCESS',
        requestId,
        metadata: { mode: 'no_material_candidates', requestId },
      });
      await appendStageEvent({ runId, stage: 'PUBLISH', status: 'IN_PROGRESS', requestId });
      await publishRunAtomic({ runId, snapshotId, tenantId, snapshotSource: 'splunk_live' });
      await appendStageEvent({ runId, stage: 'PUBLISH', status: 'SUCCESS', requestId });
    }
    await setJobComplete(job.jobId, snapshotId);
    return;
  }

  // Phase 1G-C: Resolve authoritative runtime fingerprint at job boundary.
  // If no active pointer exists, fail fast to avoid ungoverned decisions.
  let runtime: RuntimeFingerprint;
  try {
    if (runId) {
      await appendStageEvent({
        runId,
        stage: 'AI_DECISIONS',
        status: 'IN_PROGRESS',
        requestId,
        metadata: { jobId: job.jobId, snapshotId, requestId },
      });
    }
    runtime = await governanceService.getActiveRuntime();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (runId) {
      await appendStageEvent({
        runId,
        stage: 'AI_DECISIONS',
        status: 'FAILED',
        requestId,
        errorType: 'UNKNOWN',
        errorCode: 'NO_ACTIVE_MODEL_POINTER',
        errorMessage: msg,
        metadata: { jobId: job.jobId, snapshotId, requestId },
      });
      await markRunFailed(runId, msg);
    }
    await setJobFailed(job.jobId, `FAILED_MODEL_UNAVAILABLE: ${msg}`);
    return;
  }

  // Map candidate reasons for quick lookup
  const reasonsMap = new Map<string, string[]>();
  if (candidateReasons) {
    for (const cr of candidateReasons) {
      const key = cr.sourcetype ? `${cr.index}:${cr.sourcetype}` : cr.index;
      reasonsMap.set(key, cr.reasons);
    }
  }

  console.log(`[Worker] Processing job ${job.jobId}: ${effectiveInputs.length} inputs, resuming from checkpoint ${checkpoint}`);

  // Split into batches of 1 (memory-safe for local Ollama)
  const batches: RawTelemetryInput[][] = [];
  for (let i = 0; i < effectiveInputs.length; i += BATCH_SIZE) {
    batches.push(effectiveInputs.slice(i, i + BATCH_SIZE));
  }

  const userConfig = await loadUserConfig();
  let totalDecisions = 0;
  let totalLatencyMs = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let observedModelName: string | null = (job.payload as any)?.modelName || null;
  let observedBatchCount = 0;
  let failedBatches = 0;
  let localLlmUnavailable = false;
  let workerBatchTimeout = false;
  let failedCheckpoint = checkpoint;
  let lastFailureMessage: string | null = null;

  // Resume from checkpoint (handles worker restart mid-job)
  for (let i = checkpoint; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`[Worker] Batch ${i + 1}/${batches.length}: analyzing ${batch.map(b => b.index).join(', ')}`);
    const batchMessage = `Analyzing ${batch[0]?.index}${batch[0]?.sourcetype ? ':' + batch[0].sourcetype : ''}`;
    const batchHeartbeatProgress = {
      batch: i + 1,
      totalBatches: batches.length,
      decisionsWritten: totalDecisions,
      message: batchMessage,
    };
    await updateJobProgress(job.jobId, batchHeartbeatProgress);
    const heartbeatInterval = setInterval(() => {
      void checkpointJob(job.jobId, i, batchHeartbeatProgress).catch((e) => {
        console.warn('[Worker] Batch heartbeat checkpoint warning:', e instanceof Error ? e.message : String(e));
      });
      void updateJobProgress(job.jobId, batchHeartbeatProgress).catch((e) => {
        console.warn('[Worker] Batch heartbeat progress warning:', e instanceof Error ? e.message : String(e));
      });
    }, 15000);

    try {
      const batchController = new AbortController();
      const batchTimeout = setTimeout(() => batchController.abort(), WORKER_BATCH_TIMEOUT_MS);
      const batchSummary = await (async () => {
        try {
          return await runLLMDecisionAgent(batch, userConfig, {
            signal: batchController.signal,
            onBatchMetric: (metric) => {
              observedModelName = metric.model || observedModelName;
              totalLatencyMs += Number(metric.latencyMs || 0);
              observedBatchCount = Math.max(observedBatchCount, Number(metric.batch || 0));
              void checkpointJob(job.jobId, i, {
                batch: metric.batch,
                totalBatches: metric.totalBatches,
                decisionsWritten: totalDecisions,
                message: `${metric.model} ${metric.status} · ${metric.latencyMs}ms · prompt ${metric.promptChars} chars`,
              }).catch((e) => {
                console.warn('[Worker] Batch metric checkpoint warning:', e instanceof Error ? e.message : String(e));
              });
            },
          });
        } finally {
          clearTimeout(batchTimeout);
        }
      })();
      const decisions = batchSummary.decisions;

      // Write decisions incrementally (partial results appear in dashboard)
      await transaction(async (client) => {
        for (const decision of decisions) {
          const reasonKey = decision.sourcetype ? `${decision.index}:${decision.sourcetype}` : decision.index;
          const candidateReason = reasonsMap.get(reasonKey) || [];
          await writeDecisionToDb(client, decision, snapshotId, today, tenantId, runId, requestId, candidateReason, runtime);
        }
      });

      totalDecisions += decisions.length;

      const progress = {
        batch: i + 1,
        totalBatches: batches.length,
        decisionsWritten: totalDecisions,
        message: `Analyzed ${batch[0]?.index}${batch[0]?.sourcetype ? ':' + batch[0].sourcetype : ''}`,
      };

      // Save checkpoint so we can resume if worker restarts
      await checkpointJob(job.jobId, i + 1, progress);
      await updateJobProgress(job.jobId, progress);

      console.log(`[Worker] Batch ${i + 1}/${batches.length} complete — ${totalDecisions} total decisions written`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastFailureMessage = msg;
      if (/timed out after|aborted|FAILED_MODEL_TIMEOUT/i.test(msg)) {
        workerBatchTimeout = true;
        failedCheckpoint = i;
        failedBatches = batches.length;
        if (runId) {
          await appendStageEvent({
            runId,
            stage: 'AI_DECISIONS',
            status: 'FAILED',
            requestId,
            errorType: 'TIMEOUT',
            errorCode: 'FAILED_MODEL_TIMEOUT',
            errorMessage: msg,
            metadata: {
              jobId: job.jobId,
              snapshotId,
              batch: i + 1,
              totalBatches: batches.length,
              checkpoint: i,
              batchTimeoutMs: WORKER_BATCH_TIMEOUT_MS,
              requestId,
            },
          });
        }
        console.error(`[Worker] Batch ${i + 1} timed out: ${msg}`);
        break;
      }
      if (/No local LLM available|Ollama is not running|Inference unavailable/i.test(msg)) {
        localLlmUnavailable = true;
        failedBatches = batches.length;
        if (runId) {
          await appendStageEvent({
            runId,
            stage: 'AI_DECISIONS',
            status: 'FAILED',
            requestId,
            errorType: 'MODEL_MISSING',
            errorCode: 'FAILED_MODEL_UNAVAILABLE',
            errorMessage: msg,
            metadata: {
              jobId: job.jobId,
              snapshotId,
              batch: i + 1,
              totalBatches: batches.length,
              checkpoint: i,
              requestId,
            },
          });
        }
        console.error(`[Worker] Batch ${i + 1} failed: ${msg}`);
        break;
      }
      if (runId) {
        await appendStageEvent({
          runId,
          stage: 'AI_DECISIONS',
          status: 'FAILED',
          requestId,
          errorType: 'UNKNOWN',
          errorCode: 'FAILED_MODEL_RUNTIME',
          errorMessage: msg,
          metadata: {
            jobId: job.jobId,
            snapshotId,
            batch: i + 1,
            totalBatches: batches.length,
            checkpoint: i,
            requestId,
          },
        });
      }
      console.error(`[Worker] Batch ${i + 1} failed:`, msg);
      failedBatches += 1;
      // Continue to next batch — partial results are still useful
    } finally {
      clearInterval(heartbeatInterval);
    }
  }

  if (failedBatches > 0) {
    const failureMessage = workerBatchTimeout
      ? (lastFailureMessage || `WORKER_BATCH_TIMEOUT: batch ${failedCheckpoint + 1}/${batches.length} exceeded ${WORKER_BATCH_TIMEOUT_MS}ms`)
      : localLlmUnavailable
      ? 'FAILED_MODEL_UNAVAILABLE: local model is unavailable for this run'
      : (lastFailureMessage || `AI_DECISIONS_FAILED: ${failedBatches} batch(es) failed`);
    const failureCode = workerBatchTimeout
      ? 'FAILED_MODEL_TIMEOUT'
      : localLlmUnavailable
      ? 'FAILED_MODEL_UNAVAILABLE'
      : 'AI_DECISIONS_FAILED';
    const failureType = workerBatchTimeout
      ? 'TIMEOUT'
      : localLlmUnavailable
      ? 'MODEL_MISSING'
      : 'UNKNOWN';
    if (runId) {
      await appendStageEvent({
        runId,
        stage: 'AI_DECISIONS',
        status: 'FAILED',
        requestId,
        errorType: failureType,
        errorCode: failureCode,
        errorMessage: failureMessage,
        metadata: { jobId: job.jobId, snapshotId, failedBatches, checkpoint: failedCheckpoint, batchTimeoutMs: WORKER_BATCH_TIMEOUT_MS, requestId },
      });
      await setRunExecutionMetrics({
        runId,
        modelName: observedModelName,
        latencyMs: totalLatencyMs || null,
        tokensIn: totalTokensIn || null,
        tokensOut: totalTokensOut || null,
        batchCount: observedBatchCount || batches.length,
      });
      await markRunFailed(runId, failureMessage);
    }
    await setJobExecutionMetrics(job.jobId, {
      modelName: observedModelName,
      latencyMs: totalLatencyMs || null,
      tokensIn: totalTokensIn || null,
      tokensOut: totalTokensOut || null,
      batchCount: observedBatchCount || batches.length,
    });
    await setJobFailed(job.jobId, `${failureCode}: ${failureMessage}`);
    return;
  }

  if (totalDecisions === 0) {
    const failureMessage = failedBatches > 0
      ? `AI_DECISIONS_FAILED: all ${failedBatches} batch(es) failed`
      : 'AI_DECISIONS_FAILED: no decisions produced';
    if (runId) {
      await appendStageEvent({
        runId,
        stage: 'AI_DECISIONS',
        status: 'FAILED',
        requestId,
        errorType: 'UNKNOWN',
        errorCode: 'AI_DECISIONS_EMPTY',
        errorMessage: failureMessage,
        metadata: { jobId: job.jobId, snapshotId, failedBatches, requestId },
      });
      await setRunExecutionMetrics({
        runId,
        modelName: observedModelName,
        latencyMs: totalLatencyMs || null,
        tokensIn: totalTokensIn || null,
        tokensOut: totalTokensOut || null,
        batchCount: observedBatchCount || batches.length,
      });
      await markRunFailed(runId, failureMessage);
    }
    await setJobExecutionMetrics(job.jobId, {
      modelName: observedModelName,
      latencyMs: totalLatencyMs || null,
      tokensIn: totalTokensIn || null,
      tokensOut: totalTokensOut || null,
      batchCount: observedBatchCount || batches.length,
    });
    await setJobFailed(job.jobId, `AI_DECISIONS_EMPTY: ${failureMessage}`);
    return;
  }

  // Final: rebuild executive KPIs from all decisions in DB
  try {
    await rebuildExecutiveKpis(snapshotId, today, tenantId);
    console.log(`[Worker] Executive KPIs rebuilt for snapshot ${snapshotId}`);
  } catch (err) {
    console.warn('[Worker] KPI rebuild warning:', err instanceof Error ? err.message : err);
  }

  // Populate secondary tables from decisions
  try {
    await populateSecondaryTables(snapshotId, today);
  } catch (err) {
    console.warn('[Worker] Secondary tables warning:', err instanceof Error ? err.message : err);
  }

  if (runId) {
    await appendStageEvent({
      runId,
      stage: 'AI_DECISIONS',
      status: 'SUCCESS',
      requestId,
      recordsProcessed: totalDecisions,
      metadata: {
        jobId: job.jobId,
        snapshotId,
        requestId,
        modelId: runtime.modelId,
        promptId: runtime.promptId,
        promotionId: runtime.promotionId,
        contractVersion: runtime.contractVersion,
      },
    });
    await appendStageEvent({
      runId,
      stage: 'GOVERNANCE_SYNC',
      status: 'SUCCESS',
      requestId,
      metadata: {
        requestId,
        modelId: runtime.modelId,
        promptId: runtime.promptId,
        promotionId: runtime.promotionId,
      },
    });
    await appendStageEvent({ runId, stage: 'PUBLISH', status: 'IN_PROGRESS', requestId });
    try {
      await publishRunAtomic({ runId, snapshotId, tenantId, snapshotSource: 'splunk_live' });
      await appendStageEvent({ runId, stage: 'PUBLISH', status: 'SUCCESS', requestId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await appendStageEvent({
        runId,
        stage: 'PUBLISH',
        status: 'FAILED',
        requestId,
        errorType: 'UNKNOWN',
        errorCode: 'PUBLISH_FAILED',
        errorMessage: msg,
      });
      await setRunExecutionMetrics({
        runId,
        modelName: observedModelName,
        latencyMs: totalLatencyMs || null,
        tokensIn: totalTokensIn || null,
        tokensOut: totalTokensOut || null,
        batchCount: observedBatchCount || batches.length,
      });
      await markRunFailed(runId, msg);
      throw err;
    }
  }
  if (runId) {
    await setRunExecutionMetrics({
      runId,
      modelName: observedModelName,
      latencyMs: totalLatencyMs || null,
      tokensIn: totalTokensIn || null,
      tokensOut: totalTokensOut || null,
      batchCount: observedBatchCount || batches.length,
    });
  }
  await setJobExecutionMetrics(job.jobId, {
    modelName: observedModelName,
    latencyMs: totalLatencyMs || null,
    tokensIn: totalTokensIn || null,
    tokensOut: totalTokensOut || null,
    batchCount: observedBatchCount || batches.length,
  });
  await setJobComplete(job.jobId, snapshotId);
  console.log(`[Worker] Job ${job.jobId} complete — ${totalDecisions} decisions written`);
}

async function writeDecisionToDb(
  client: any,
  decision: any,
  snapshotId: string,
  today: string,
  tenantId: string,
  runId: string | null,
  requestId: string | null,
  candidateReason: string[] = [],
  runtime?: RuntimeFingerprint
) {
  const confidenceMap: Record<string, number> = { 'HIGH': 0.9, 'MEDIUM': 0.5, 'LOW': 0.3 };
  const classificationMap: Record<string, string> = {
    KEEP: 'KEEP', OPTIMIZE: 'OPTIMIZE', ARCHIVE: 'ARCHIVE',
    ELIMINATE: 'ELIMINATE', S3_CANDIDATE: 'ARCHIVE', INVESTIGATE: 'INVESTIGATE',
  };

  const granularity = decision.sourcetype ? 'sourcetype' : 'index';
  const parentIndex = decision.sourcetype ? decision.index : null;
  const confidence = typeof decision.confidence === 'string'
    ? (confidenceMap[decision.confidence] || 0.5)
    : (Number(decision.confidence) || 0.5);

  // Upsert telemetry_snapshots with LLM scores
  await client.query(`
    UPDATE telemetry_snapshots SET
      risk_score     = $1,
      classification = $2,
      confidence     = $3,
      recommendation = $4,
      evidence       = $5,
      utilization_pct = $6,
      updated_at     = NOW()
    WHERE snapshot_date = $7
      AND tenant_id = $8
      AND index_name = $9
      AND (sourcetype IS NOT DISTINCT FROM $10)
  `, [
    Number(decision.riskScore) || 0,
    classificationMap[decision.action] || 'INVESTIGATE',
    confidence,
    decision.recommendation || '',
    JSON.stringify(decision.evidence || []),
    Number(decision.utilizationScore) || 0,
    today,
    tenantId,
    decision.index,
    decision.sourcetype || null,
  ]);

  // Delete existing row first to handle NULL sourcetype (NULLs not matched by ON CONFLICT)
  await client.query(`
    DELETE FROM agent_decisions
    WHERE tenant_id = $1 AND snapshot_id = $2 AND index_name = $3 AND (sourcetype IS NOT DISTINCT FROM $4)
  `, [tenantId, snapshotId, decision.index, decision.sourcetype || null]);

  // Insert agent_decisions — idempotent: ON CONFLICT updates in place
  await client.query(`
    INSERT INTO agent_decisions (
      tenant_id, run_id,
      request_id,
      snapshot_id, snapshot_date, index_name, sourcetype,
      tier, action, composite_score, utilization_score, detection_score,
      quality_score, risk_score, annual_license_cost, estimated_savings,
      confidence, confidence_score, recommendation, reasoning, evidence,
      is_quick_win, is_s3_candidate, detection_gap, candidate_reason,
      model_governance_id, prompt_governance_id, promotion_id,
      decision_contract_version, model_version, prompt_version, system_prompt_hash
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
    ON CONFLICT (tenant_id, snapshot_id, index_name, sourcetype) DO UPDATE SET
      run_id             = EXCLUDED.run_id,
      request_id         = EXCLUDED.request_id,
      tier              = EXCLUDED.tier,
      action            = EXCLUDED.action,
      composite_score   = EXCLUDED.composite_score,
      utilization_score = EXCLUDED.utilization_score,
      detection_score   = EXCLUDED.detection_score,
      quality_score     = EXCLUDED.quality_score,
      risk_score        = EXCLUDED.risk_score,
      estimated_savings = EXCLUDED.estimated_savings,
      confidence        = EXCLUDED.confidence,
      confidence_score  = EXCLUDED.confidence_score,
      recommendation    = EXCLUDED.recommendation,
      reasoning         = EXCLUDED.reasoning,
      evidence          = EXCLUDED.evidence,
      is_quick_win      = EXCLUDED.is_quick_win,
      is_s3_candidate   = EXCLUDED.is_s3_candidate,
      detection_gap     = EXCLUDED.detection_gap,
      candidate_reason  = EXCLUDED.candidate_reason,
      model_governance_id = EXCLUDED.model_governance_id,
      prompt_governance_id = EXCLUDED.prompt_governance_id,
      promotion_id        = EXCLUDED.promotion_id,
      decision_contract_version = EXCLUDED.decision_contract_version,
      model_version       = EXCLUDED.model_version,
      prompt_version      = EXCLUDED.prompt_version,
      system_prompt_hash  = EXCLUDED.system_prompt_hash
  `, [
    tenantId, runId, requestId, snapshotId, today, decision.index, decision.sourcetype || null,
    decision.tier, decision.action,
    Number(decision.compositeScore) || 0,
    Number(decision.utilizationScore) || 0,
    Number(decision.detectionScore) || 0,
    Number(decision.qualityScore) || 0,
    Number(decision.riskScore) || 0,
    Number(decision.annualLicenseCost) || 0,
    Number(decision.estimatedSavings) || 0,
    confidence,
    Number(decision.confidenceScore) || confidence,
    decision.recommendation || '',
    decision.reasoning || '',
    JSON.stringify(decision.evidence || []),
    Boolean(decision.isQuickWin),
    Boolean(decision.isS3Candidate),
    Boolean(decision.detectionGap),
    candidateReason,
    runtime?.modelId || null,
    runtime?.promptId || null,
    runtime?.promotionId || null,
    runtime?.contractVersion || null,
    runtime?.modelVersion || null,
    runtime?.promptVersion || null,
    runtime?.systemPromptHash || null,
  ]);
}

async function rebuildExecutiveKpis(snapshotId: string, today: string, tenantId: string) {
  const decisionStatsResult = await query<any>(
    `
    SELECT
      COUNT(*) FILTER (WHERE tier = 'Critical') AS tier_critical,
      COUNT(*) FILTER (WHERE tier = 'Important') AS tier_important,
      COUNT(*) FILTER (WHERE tier = 'Nice-to-Have') AS tier_nice,
      COUNT(*) FILTER (WHERE tier = 'Low-Value') AS tier_low,
      COUNT(*) FILTER (WHERE detection_gap = true) AS security_gaps,
      ROUND(AVG(composite_score)::numeric, 2) AS roi_score,
      ROUND(AVG(utilization_score)::numeric, 1) AS avg_util,
      ROUND(AVG(detection_score)::numeric, 1) AS avg_det,
      ROUND(AVG(quality_score)::numeric, 1) AS avg_qual,
      ROUND(AVG(confidence_score)::numeric * 100, 1) AS avg_conf,
      COALESCE(SUM(estimated_savings), 0) AS savings
    FROM agent_decisions
    WHERE tenant_id = $1 AND snapshot_id = $2
    `,
    [tenantId, snapshotId]
  );

  const volumeStatsResult = await query<any>(
    `
    WITH decision_volume AS (
      SELECT
        ad.tier,
        COALESCE(ts.daily_avg_gb, 0) AS daily_avg_gb,
        COALESCE(ts.cost_per_year, 0) AS cost_per_year
      FROM agent_decisions ad
      JOIN telemetry_snapshots ts
        ON ts.tenant_id = ad.tenant_id
       AND ts.snapshot_id = ad.snapshot_id
       AND ts.index_name = ad.index_name
       AND ts.sourcetype IS NOT DISTINCT FROM ad.sourcetype
      WHERE ad.tenant_id = $1
        AND ad.snapshot_id = $2
    )
    SELECT
      COALESCE(SUM(cost_per_year), 0) AS total_spend,
      COALESCE(SUM(daily_avg_gb), 0) AS total_daily_gb,
      COUNT(*) AS total_sourcetypes,
      COALESCE(SUM(CASE WHEN tier IN ('Critical', 'Important') THEN daily_avg_gb ELSE 0 END), 0) AS tier_12_gb,
      COALESCE(SUM(CASE WHEN tier IN ('Nice-to-Have', 'Low-Value') THEN cost_per_year ELSE 0 END), 0) AS low_value_spend
    FROM decision_volume
    `,
    [tenantId, snapshotId]
  );

  const stats = decisionStatsResult.rows[0] || {};
  const volume = volumeStatsResult.rows[0] || {};
  const totalDailyGb = Number(volume.total_daily_gb) || 0;
  const gainScopeScore = totalDailyGb > 0
    ? Math.round(((Number(volume.tier_12_gb) || 0) / totalDailyGb) * 10000) / 100
    : 0;

  await query(
    `
    INSERT INTO executive_kpis (
      tenant_id, snapshot_id, snapshot_date,
      roi_score, gainscope_score,
      total_license_spend, license_spend_low_value, storage_savings_potential,
      total_daily_gb, total_sourcetypes,
      tier_critical, tier_important, tier_nice_to_have, tier_low_value,
      security_gaps, operational_gaps,
      avg_utilization, avg_detection, avg_quality, avg_confidence
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    ON CONFLICT (tenant_id, snapshot_id) DO UPDATE SET
      roi_score                 = EXCLUDED.roi_score,
      gainscope_score           = EXCLUDED.gainscope_score,
      total_license_spend       = EXCLUDED.total_license_spend,
      license_spend_low_value   = EXCLUDED.license_spend_low_value,
      storage_savings_potential = EXCLUDED.storage_savings_potential,
      total_daily_gb            = EXCLUDED.total_daily_gb,
      total_sourcetypes         = EXCLUDED.total_sourcetypes,
      tier_critical             = EXCLUDED.tier_critical,
      tier_important            = EXCLUDED.tier_important,
      tier_nice_to_have         = EXCLUDED.tier_nice_to_have,
      tier_low_value            = EXCLUDED.tier_low_value,
      security_gaps             = EXCLUDED.security_gaps,
      operational_gaps          = EXCLUDED.operational_gaps,
      avg_utilization           = EXCLUDED.avg_utilization,
      avg_detection             = EXCLUDED.avg_detection,
      avg_quality               = EXCLUDED.avg_quality,
      avg_confidence            = EXCLUDED.avg_confidence,
      updated_at                = NOW()
    `,
    [
      tenantId,
      snapshotId,
      today,
      Number(stats.roi_score) || 0,
      gainScopeScore,
      Number(volume.total_spend) || 0,
      Number(volume.low_value_spend) || 0,
      Number(stats.savings) || 0,
      totalDailyGb,
      Number(volume.total_sourcetypes) || 0,
      Number(stats.tier_critical) || 0,
      Number(stats.tier_important) || 0,
      Number(stats.tier_nice) || 0,
      Number(stats.tier_low) || 0,
      Number(stats.security_gaps) || 0,
      0,
      Number(stats.avg_util) || 0,
      Number(stats.avg_det) || 0,
      Number(stats.avg_qual) || 0,
      Number(stats.avg_conf) || 0,
    ]
  );
}

const MITRE_MAP: Record<string, string[]> = {
  'WinEventLog:Security':    ['T1078', 'T1003', 'T1021', 'T1055'],
  'WinEventLog:System':      ['T1547', 'T1112', 'T1489'],
  'WinEventLog:Application': ['T1059', 'T1036'],
  'pan_traffic':             ['T1071', 'T1572', 'T1008'],
  'cisco_asa':               ['T1190', 'T1078', 'T1133'],
  'cisco_ios':               ['T1110', 'T1046', 'T1040'],
  'linux_secure':            ['T1078', 'T1021', 'T1136'],
  'auditd':                  ['T1055', 'T1003', 'T1059'],
  'aws_cloudtrail':          ['T1078', 'T1530', 'T1537'],
  'o365':                    ['T1078', 'T1114', 'T1566'],
  'syslog':                  ['T1562', 'T1059'],
  'firewall':                ['T1071', 'T1190'],
  'dns':                     ['T1071', 'T1568'],
  'http':                    ['T1071', 'T1566'],
  'netflow':                 ['T1046', 'T1571'],
};

async function populateSecondaryTables(snapshotId: string, today: string) {
  const decisions = await query<any>(`
    SELECT index_name, sourcetype, quality_score, detection_score, detection_gap,
           utilization_score, annual_license_cost, estimated_savings, reasoning, evidence
    FROM agent_decisions WHERE snapshot_date = $1
  `, [today]);

  for (const d of decisions.rows) {
    // Quality hotspots — low quality score items
    if (Number(d.quality_score) < 50) {
      const issueType = extractIssueType(d.evidence);
      await query(`
        INSERT INTO quality_hotspots (snapshot_date, sourcetype, issue_count, quality_score, impact, issue_type, daily_gb)
        VALUES ($1, $2, 1, $3, $4, $5, 0)
      `, [today, d.sourcetype || d.index_name, Number(d.quality_score), Number(d.annual_license_cost), issueType]).catch(() => {});
    }

    // Security coverage — detection gaps
    if (d.detection_gap) {
      const sourceKey = d.sourcetype || '';
      const techniques = MITRE_MAP[sourceKey] || [];
      await query(`
        INSERT INTO security_coverage (snapshot_date, sourcetype, coverage_pct, active_alerts, detection_gaps, mitre_techniques)
        VALUES ($1, $2, $3, 0, 1, $4)
      `, [today, d.sourcetype || d.index_name, Number(d.detection_score), JSON.stringify(techniques)]).catch(() => {});
    }

    // Field usage — estimation from utilization
    await query(`
      INSERT INTO field_usage (snapshot_date, sourcetype, fields_indexed, fields_used, optimization_pct)
      VALUES ($1, $2, 1, 0, $3)
    `, [today, d.sourcetype || d.index_name, Math.round(100 - Number(d.utilization_score))]).catch(() => {});
  }

  console.log(`[Worker] Secondary tables populated for ${decisions.rows.length} decisions`);
}

function extractIssueType(evidence: any): string {
  if (!evidence) return 'Unknown';
  const text = Array.isArray(evidence) ? evidence.join(' ') : String(evidence);
  if (/parse|parsing|error/i.test(text)) return 'DataParseFailure';
  if (/break|event break/i.test(text)) return 'EventBreakIssue';
  if (/format|schema/i.test(text)) return 'SchemaInconsistency';
  if (/duplicate|dup/i.test(text)) return 'DuplicateData';
  return 'QualityDegradation';
}

// ── Main polling loop ──────────────────────────────────────────────────────

async function validateSchemaContract() {
  // Dynamic schema validation — same contract as web service
  const REQUIRED_COLUMNS: { [key: string]: string[] } = {
    telemetry_snapshots: ['snapshot_id', 'snapshot_date', 'created_at'],
    pipeline_runs: ['run_id', 'status', 'published', 'published_at'],
    pipeline_stage_events: ['run_id', 'stage', 'status', 'started_at'],
    agent_decisions: [
      'model_governance_id',
      'prompt_governance_id',
      'promotion_id',
      'decision_contract_version',
      'llm_version',
      'prompt_version',
    ],
    llm_health_cache: ['provider', 'last_checked'],
    prompt_registry: ['prompt_id', 'version', 'encrypted_prompt', 'system_prompt_hash'],
    approved_models: ['model_id', 'model_version', 'status'],
    model_promotions: ['promotion_id', 'runtime_snapshot'],
    active_model_pointer: ['tenant_id', 'model_id', 'prompt_id', 'config_version'],
  };

  const violations: string[] = [];

  // Check tables
  for (const table of Object.keys(REQUIRED_COLUMNS)) {
    const res = await query<any>(`
      SELECT 1 FROM information_schema.tables WHERE table_name = $1
    `, [table]);
    if (res.rows.length === 0) {
      violations.push(`Missing table: ${table}`);
    }
  }

  // Check columns
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const col of columns) {
      const res = await query<any>(`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = $1 AND column_name = $2
      `, [table, col]);
      if (res.rows.length === 0) {
        violations.push(`Missing column: ${table}.${col}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error('❌ SCHEMA CONTRACT VIOLATION');
    console.error(violations.join('\n'));
    process.exit(1);
  }

  console.log('[Worker] ✓ Schema contract validation passed');
}

async function validateDataPurity() {
  // Allow synthetic data in test/dev environments
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.ALLOW_SYNTHETIC_DATA === 'true' ||
    process.env.NODE_ENV !== 'production'
  ) {
    console.log('[Worker] 🔍 Data purity validation skipped (development mode)');
    return;
  }

  // Reject synthetic data from production database
  console.log('[Worker] 🔍 Validating data purity...');

  const violations: string[] = [];

  // Check for demo tenants
  const demoTenantsRes = await query<any>(`
    SELECT COUNT(*) as count FROM tenants
    WHERE LOWER(slug) ILIKE '%demo%' OR LOWER(name) ILIKE '%demo%'
  `, []);

  if ((demoTenantsRes.rows[0]?.count || 0) > 0) {
    violations.push(`Demo tenant rows: ${demoTenantsRes.rows[0].count}`);
  }

  // Check for synthetic snapshots
  const syntheticRes = await query<any>(`
    SELECT COUNT(*) as count FROM telemetry_snapshots
    WHERE snapshot_id ILIKE '%demo%'
       OR snapshot_id ILIKE '%synthetic%'
  `, []);

  if ((syntheticRes.rows[0]?.count || 0) > 0) {
    violations.push(`Synthetic snapshots: ${syntheticRes.rows[0].count}`);
  }

  // Check for hardcoded KPIs (demo tenant)
  const kpisRes = await query<any>(`
    SELECT COUNT(*) as count FROM executive_kpis
    WHERE tenant_id = 'demo' OR tenant_id ILIKE '%fake%'
  `, []);

  if ((kpisRes.rows[0]?.count || 0) > 0) {
    violations.push(`Hardcoded KPIs: ${kpisRes.rows[0].count}`);
  }

  if (violations.length > 0) {
    console.error('❌ DATA PURITY VIOLATION');
    console.error('Synthetic data detected:', violations.join(', '));
    process.exit(1);
  }

  console.log('[Worker] ✓ Data purity validation passed');
}

async function main() {
  console.log('[Worker] Starting. Polling job_queue every', POLL_INTERVAL_MS, 'ms');
  console.log('[Worker] OLLAMA_BASE_URL:', process.env.OLLAMA_BASE_URL || 'http://localhost:11434');

  // Phase 13: Start governance self-observability collector (5-minute window)
  startSelfObservability(5 * 60_000);

  // Validate schema contract on startup
  try {
    await validateSchemaContract();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Worker] Schema contract validation failed:', msg);
    process.exit(1);
  }

  // Validate data purity on startup
  try {
    await validateDataPurity();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Worker] Data purity validation failed:', msg);
    process.exit(1);
  }

  // Recover stale jobs from previous crashed/restarted worker sessions.
  try {
    const recovered = await recoverStaleJobs(parseInt(process.env.WORKER_STALE_JOB_MINUTES || '5', 10));
    if (recovered > 0) {
      console.warn(`[Worker] Recovered ${recovered} stale running/partial job(s) as failed`);
    }
    const staleRuns = await query<any>(`
      UPDATE pipeline_runs
      SET status = 'FAILED',
          published = false,
          error_message = COALESCE(error_message, 'Recovered stale running run after worker restart'),
          idempotency_hash = NULL
      WHERE status = 'RUNNING'
        AND started_at < NOW() - (COALESCE($1::text, '5') || ' minutes')::interval
      RETURNING run_id
    `, [process.env.WORKER_STALE_RUN_MINUTES || '5']);
    if ((staleRuns.rows || []).length > 0) {
      console.warn(`[Worker] Recovered ${staleRuns.rows.length} stale running pipeline run(s) as failed`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Worker] Stale job recovery skipped due to error:', msg);
  }

  while (true) {
    try {
      // Continuous lease recovery so orphaned RUNNING jobs are reclaimed even after worker restarts.
      try {
        await recoverStaleJobs(parseInt(process.env.WORKER_STALE_JOB_MINUTES || '5', 10));
      } catch (e) {
        console.warn('[Worker] Periodic stale job recovery warning:', e instanceof Error ? e.message : String(e));
      }

      const job = await claimNextJob();
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      console.log(`[Worker] Claimed job ${job.jobId} (type: ${job.jobType})`);
      await processJob(job);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Worker] Unhandled error in poll loop:', msg);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

main().catch(err => {
  console.error('[Worker] Fatal error:', err);
  process.exit(1);
});

const shutdown = async () => {
  try {
    stopSelfObservability();    // Phase 13: stop observability collector before exit
    await governanceService.shutdown();
  } catch (e) {
    console.error('[Worker] Governance shutdown warning:', e);
  }
};

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
