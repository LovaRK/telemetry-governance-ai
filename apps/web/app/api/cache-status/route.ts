import { createRoute } from '@/lib/api-route-factory';
import { getCacheStatus } from '@api/services/cache-service';
import { query } from '@core/database/connection';
import { ensurePipelineLedgerSchema, getLatestPublishedRun, getRunMetrics } from '@/lib/pipeline-ledger-service';
import { NextRequest, NextResponse } from 'next/server';
import { requireContext } from '@packages/auth/request-context';
import { normalizeLifecycle, type LLMStatus, type SnapshotStatus } from '@/lib/pipeline-lifecycle';
import { buildPipelineProvenance } from '@/lib/pipeline-provenance';
import { recoverStaleJobs } from '@api/services/job-service';
import { createHash } from 'crypto';

export const GET = createRoute(async (request: NextRequest) => {
  await ensurePipelineLedgerSchema();

  // Require authentication - this returns tenant-specific data
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) {
    return ctxOrError;
  }
  const context = ctxOrError;
  if (!context?.tenantId) {
    throw new Error('Tenant context required for stale recovery');
  }
  const tenantId = context.tenantId;

  // Lease/heartbeat ownership: normalize stale worker jobs before deriving lifecycle.
  await recoverStaleJobs(5, context);
  // Check cache metadata status
  const cacheMetadata = await getCacheStatus('index_metrics');
  const latestRun = await getLatestPublishedRun(tenantId);
  const runMetrics = latestRun ? await getRunMetrics(latestRun.runId, latestRun.snapshotId, tenantId) : null;

  // Scope readiness flags to the active published snapshot. Historical rows from
  // prior tenants/runs must not enable AI widgets for the current dashboard.
  const snapshotsResult = latestRun
    ? await query(
        `SELECT COUNT(*) as count
         FROM telemetry_snapshots
         WHERE tenant_id = $1 AND snapshot_id = $2`,
        [tenantId, latestRun.snapshotId]
      )
    : { rows: [{ count: '0' }] };
  const recordCount = parseInt(snapshotsResult.rows[0]?.count || '0', 10);
  const hasData = recordCount > 0;

  const decisionCount = runMetrics?.decisionCount || 0;
  const hasAgentDecisions = decisionCount > 0;

  const kpisResult = latestRun
    ? await query(
        `SELECT COUNT(*) as count
         FROM executive_kpis
         WHERE tenant_id = $1 AND snapshot_id = $2`,
        [tenantId, latestRun.snapshotId]
      )
    : { rows: [{ count: '0' }] };
  const kpiCount = parseInt(kpisResult.rows[0]?.count || '0', 10);
  const hasKpis = kpiCount > 0;

  const latestPipelineRun = await query<{
    run_id: string;
    status: 'PENDING' | 'RUNNING' | 'FAILED' | 'SUCCEEDED';
    started_at: string;
    completed_at: string | null;
    request_id: string | null;
    model_name: string | null;
    latency_ms: number | null;
    tokens_in: number | null;
    tokens_out: number | null;
    batch_count: number | null;
    source_hash: string | null;
    snapshot_hash: string | null;
    decision_hash: string | null;
    execution_hash: string | null;
  }>(
    `SELECT pr.run_id, pr.status, pr.started_at, pr.published_at as completed_at,
            pr.request_id, pr.model_name, pr.latency_ms, pr.tokens_in, pr.tokens_out, pr.batch_count,
            pr.source_hash, pr.snapshot_hash, pr.decision_hash, pr.execution_hash
     FROM pipeline_runs pr
     WHERE pr.tenant_id = $1
     ORDER BY pr.started_at DESC
     LIMIT 1`,
    [tenantId]
  );
  const runRow = latestPipelineRun.rows[0] || null;

  const latestCompletedRun = await query<{
    run_id: string;
    status: 'SUCCEEDED' | 'FAILED';
    started_at: string;
    completed_at: string | null;
    request_id: string | null;
  }>(
    `SELECT run_id, status, started_at, published_at as completed_at, request_id
     FROM pipeline_runs
     WHERE tenant_id = $1
       AND status IN ('SUCCEEDED', 'FAILED')
     ORDER BY COALESCE(published_at, started_at) DESC
     LIMIT 1`,
    [tenantId]
  );

  const llmStage = runRow
    ? await query<{ status: 'IN_PROGRESS' | 'SUCCESS' | 'FAILED'; mode: string | null }>(
        `SELECT status,
                metadata_json->>'mode' AS mode
         FROM pipeline_stage_events
         WHERE run_id = $1 AND stage = 'AI_DECISIONS'
         ORDER BY started_at DESC
         LIMIT 1`,
        [runRow.run_id]
      )
    : { rows: [] as Array<{ status: 'IN_PROGRESS' | 'SUCCESS' | 'FAILED'; mode: string | null }> };
  const llmStageStatus = llmStage.rows[0]?.status;
  const llmStageMode = llmStage.rows[0]?.mode || null;

  const runDecisionCount = runRow
    ? await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM agent_decisions
         WHERE run_id = $1
           AND tenant_id = $2`,
        [runRow.run_id, tenantId]
      )
    : { rows: [{ count: '0' }] };
  const decisionCountForRun = Number(runDecisionCount.rows[0]?.count || '0');

  const lastStageAtResult = runRow
    ? await query<{ max_stage_at: string | null }>(
        `SELECT MAX(started_at) AS max_stage_at
         FROM pipeline_stage_events
         WHERE run_id = $1`,
        [runRow.run_id]
      )
    : { rows: [{ max_stage_at: null }] };
  const lastStageAt = lastStageAtResult.rows[0]?.max_stage_at || null;

  const previousFailureResult = runRow
    ? await query<{ error_type: string | null; error_code: string | null; error_message: string | null; run_id: string }>(
        `SELECT error_type, error_code, error_message, run_id
         FROM pipeline_stage_events
         WHERE run_id = $1
           AND status = 'FAILED'
         ORDER BY started_at DESC
         LIMIT 1`,
        [runRow.run_id]
      )
    : { rows: [] as Array<{ error_type: string | null; error_code: string | null; error_message: string | null; run_id: string }> };
  const previousFailureRow = previousFailureResult.rows[0] || null;
  const mappedFailureCode =
    previousFailureRow?.error_code === 'MISSING_DECISIONS'
      ? 'MISSING_DECISIONS'
    : previousFailureRow?.error_code === 'TIMEOUT'
      ? 'TIMEOUT'
    : previousFailureRow?.error_code === 'FAILED_MODEL_UNAVAILABLE'
      ? 'FAILED_MODEL_UNAVAILABLE'
    : previousFailureRow?.error_code === 'FAILED_MODEL_TIMEOUT'
      ? 'FAILED_MODEL_TIMEOUT'
    : previousFailureRow?.error_code === 'FAILED_MODEL_REFUSED'
      ? 'FAILED_MODEL_REFUSED'
    : previousFailureRow?.error_code === 'FAILED_MODEL_CONTEXT'
      ? 'FAILED_MODEL_CONTEXT'
    : previousFailureRow?.error_code === 'FAILED_MODEL_CRASH'
      ? 'FAILED_MODEL_CRASH'
    : previousFailureRow?.error_code === 'WORKER_BATCH_TIMEOUT'
      ? 'TIMEOUT'
    : previousFailureRow?.error_code === 'RUNTIME'
      ? 'RUNTIME'
      : previousFailureRow?.error_type === 'TIMEOUT'
      ? 'TIMEOUT'
      : previousFailureRow?.error_type === 'UNKNOWN'
      ? 'RUNTIME'
      : null;

  // READY only when the pointer references a SUCCEEDED run that has data.
  // A failed refresh attempt does not invalidate an existing published snapshot;
  // but if the pointer itself points to a failed run, the snapshot is not READY.
  const snapshotStatus: SnapshotStatus =
    (hasData || hasKpis) && latestRun?.status === 'SUCCEEDED'
      ? 'READY'
      : runRow?.status === 'FAILED'
      ? 'FAILED'
      : (hasData || hasKpis)
      ? 'READY'
      : 'NOT_READY';

  const llmStatus: LLMStatus =
    runRow?.status === 'FAILED'
      ? 'FAILED'
      : llmStageStatus === 'SUCCESS'
      ? 'READY'
      : llmStageStatus === 'FAILED'
      ? 'FAILED'
      : llmStageStatus === 'IN_PROGRESS'
      ? 'RUNNING'
      : 'NOT_STARTED';
  const normalized = normalizeLifecycle({
    snapshotStatus,
    llmStatus,
    aiDecisionStage: llmStageStatus || null,
    aiDecisionMode: llmStageMode,
    decisionCount: decisionCountForRun,
    lastStageAt,
    runId: runRow?.run_id || null,
    previousFailureCode: mappedFailureCode,
    previousFailureRunId: previousFailureRow?.run_id || null,
  });
  const effectiveFailureCode =
    normalized.failureCode ||
    (previousFailureRow?.error_code === 'FAILED_MODEL_UNAVAILABLE' ? 'FAILED_MODEL_UNAVAILABLE' : null) ||
    (runRow?.status === 'FAILED' ? 'RUNTIME' : null);
  const effectiveFailureReason =
    normalized.failureReason ||
    previousFailureRow?.error_message ||
    (runRow?.status === 'FAILED' ? 'Pipeline failed due to runtime error' : null);

  // Source of truth for "has refreshed" is materialized data. Cache metadata can be
  // transiently "refreshing" while data is already available for detail views.
  const hasEverRefreshed = hasData || hasAgentDecisions || hasKpis;
  const requestId = runRow?.request_id || latestRun?.requestId || latestCompletedRun.rows[0]?.request_id || null;
  const provenance = buildPipelineProvenance({
    tenantId,
    runId: runRow?.run_id || null,
    requestId,
    updatedAt: lastStageAt,
  });
  const publishedState = {
    runId: latestRun?.runId || null,
    snapshotId: latestRun?.snapshotId || null,
    publishedAt: latestRun?.publishedAt || null,
    hasData,
    hasKpis,
    hasAgentDecisions,
    recordCount,
    decisionCount: runMetrics?.decisionCount || 0,
    dailyAvgGb: runMetrics?.dailyAvgGb || 0,
    decisionHash: runMetrics?.decisionCount
      ? (runRow?.decision_hash || createHash('sha256')
          .update(`${latestRun?.runId || 'unknown'}:${runMetrics?.decisionCount || 0}:${latestRun?.snapshotId || 'unknown'}`)
          .digest('hex'))
      : null,
    sourceHash: runRow?.source_hash || null,
    snapshotHash: runRow?.snapshot_hash || null,
    executionHash: runRow?.execution_hash || null,
  };
  const activeState = {
    runId: runRow?.run_id || null,
    requestId: runRow?.request_id || null,
    modelName: runRow?.model_name || null,
    latencyMs: runRow?.latency_ms || null,
    tokensIn: runRow?.tokens_in || null,
    tokensOut: runRow?.tokens_out || null,
    batchCount: runRow?.batch_count || null,
    snapshotStatus,
    llmStatus: normalized.llmStatus,
    pipelineStatus: normalized.pipelineStatus,
    failureCode: effectiveFailureCode,
    failureReason: effectiveFailureReason,
    updatedAt: lastStageAt,
    decisionCount: decisionCountForRun,
    lastRunAt: runRow?.started_at || null,
  };
  return {
    data: {
      hasEverRefreshed,
      hasData: publishedState.hasData,
      hasAgentDecisions: publishedState.hasAgentDecisions,
      hasKpis: publishedState.hasKpis,
      status: latestRun?.published ? 'fresh' : cacheMetadata.status,
      lastRefreshAt: cacheMetadata.lastRefreshAt,
      nextRefreshAt: cacheMetadata.nextRefreshAt,
      recordCount: publishedState.recordCount,
      runId: publishedState.runId,
      snapshotId: publishedState.snapshotId,
      publishedAt: publishedState.publishedAt,
      decisionCount: publishedState.decisionCount,
      dailyAvgGb: publishedState.dailyAvgGb,
      message: hasEverRefreshed ? 'Cache is ready' : 'Awaiting first refresh',
      snapshotStatus: activeState.snapshotStatus,
      llmStatus: activeState.llmStatus,
      pipelineStatus: activeState.pipelineStatus,
      failureCode: activeState.failureCode,
      failureReason: activeState.failureReason,
      lastRunId: activeState.runId,
      lastRunAt: activeState.lastRunAt,
      lastDecisionAt: publishedState.decisionCount ? publishedState.publishedAt || null : null,
      requestId,
      pipelineRunId: activeState.runId,
      activeJobId: activeState.runId,
      modelName: activeState.modelName,
      latencyMs: activeState.latencyMs,
      tokensIn: activeState.tokensIn,
      tokensOut: activeState.tokensOut,
      batchCount: activeState.batchCount,
      lastCompletedRun: latestCompletedRun.rows[0]
        ? {
            runId: latestCompletedRun.rows[0].run_id,
            status: latestCompletedRun.rows[0].status,
            startedAt: latestCompletedRun.rows[0].started_at,
            completedAt: latestCompletedRun.rows[0].completed_at,
            requestId: latestCompletedRun.rows[0].request_id,
          }
        : null,
      updatedAt: activeState.updatedAt,
      sourceHash: publishedState.sourceHash,
      snapshotHash: publishedState.snapshotHash,
      decisionHash: publishedState.decisionHash,
      executionHash: publishedState.executionHash,
      publishedState,
      activeState,
      provenance,
    },
    meta: { source: 'postgres' },
  };
});
