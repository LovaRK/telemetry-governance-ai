import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { getCacheStatus, listCacheStatuses, setCacheRefreshing, setCacheFresh, setCacheError, isRefreshing } from '@api/services/cache-service';
import { runFastAggregation } from '@api/services/aggregation-service';
import { SplunkClient } from '@api/services/splunk-client';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { v4 as uuidv4 } from 'uuid';
import {
  appendStageEvent,
  buildIdempotencyHash,
  createRunningRun,
  ensurePipelineLedgerSchema,
  getActiveRunByHash,
  markRunFailed,
} from '@/lib/pipeline-ledger-service';

export const GET = createRoute(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');
  if (key) {
    const status = await getCacheStatus(key);
    return {
      data: status,
      meta: { source: 'system' },
    };
  }
  const statuses = await listCacheStatuses();
  return {
    data: { caches: statuses },
    meta: { source: 'system' },
  };
});

export const POST = createRoute(async (request: NextRequest) => {
  const started = Date.now();
  await ensurePipelineLedgerSchema();

  const body = await request.json();
  if (!body?.mcpUrl) {
    throw new Error('mcpUrl is required');
  }

  let authToken = body.token;
  if (!authToken && body.username && body.password) {
    const credentials = Buffer.from(`${body.username}:${body.password}`).toString('base64');
    authToken = `Basic ${credentials}`;
  }

  if (!authToken) {
    throw new Error('Authentication required: Provide token OR (username + password)');
  }

  const { mcpUrl, disableSslVerify = false, costPerGbPerDay } = body;
  const runtimeConfig = getRuntimeConfig();
  const tenantId = body.tenantId || request.headers.get('x-tenant-id') || 'default';
  const trigger = body.trigger || 'manual';
  const window = body.window || `${configWindowDays(body)}d`;
  const idempotencyHash = buildIdempotencyHash({ tenantId, trigger, window });
  const existingRun = await getActiveRunByHash(idempotencyHash);
  if (existingRun) {
    return {
      data: {
        success: true,
        phase: 'already_running',
        runId: existingRun.runId,
        snapshotId: existingRun.snapshotId,
        durationMs: Date.now() - started,
      },
      meta: { source: 'system' },
    };
  }

  const runId = uuidv4();
  const snapshotId = uuidv4();
  await createRunningRun({
    runId,
    snapshotId,
    tenantId,
    idempotencyHash,
    pipelineVersion: process.env.PIPELINE_VERSION || '1.0.0',
    modelVersion: process.env.MODEL_VERSION || 'gemma2:9b',
    promptVersion: process.env.PROMPT_VERSION || '2.0',
    splunkQueryVersion: process.env.SPLUNK_QUERY_VERSION || '1.0',
  });

  const effectiveCostPerGbPerDay =
    typeof costPerGbPerDay === 'number' && Number.isFinite(costPerGbPerDay)
      ? costPerGbPerDay
      : runtimeConfig.costPerGbPerDay;
  const cacheKey = 'index_metrics';

  const alreadyRunning = await isRefreshing(cacheKey);
  if (alreadyRunning) {
    throw new Error('Refresh already in progress: Wait for current job to complete');
  }

  await setCacheRefreshing(cacheKey);

  const splunk = new SplunkClient({ mcpUrl, token: authToken, allowInsecureTls: !!disableSslVerify });

  await appendStageEvent({ runId, stage: 'SPLUNK_FETCH', status: 'IN_PROGRESS' });
  const health = await splunk.healthCheckFast();
  if (!health.success) {
    await appendStageEvent({ runId, stage: 'SPLUNK_FETCH', status: 'FAILED', errorMessage: health.error || 'Connection failed' });
    await markRunFailed(runId, `Splunk unreachable: ${health.error}`);
    await setCacheError(cacheKey, `Splunk unreachable: ${health.error}`);
    throw new Error(`Cannot connect to Splunk: ${health.error || 'Connection failed'}`);
  }
  await appendStageEvent({ runId, stage: 'SPLUNK_FETCH', status: 'SUCCESS' });

  // Fast path: fetch Splunk metadata (<5s) and enqueue LLM job
  let result;
  try {
    await appendStageEvent({ runId, stage: 'SNAPSHOT_WRITE', status: 'IN_PROGRESS' });
    await appendStageEvent({ runId, stage: 'KPI_AGGREGATION', status: 'IN_PROGRESS' });
    result = await runFastAggregation(
      splunk,
      { lookbackDays: 30, costPerGbPerDay: effectiveCostPerGbPerDay },
      { snapshotId, runId, tenantId }
    );
    await appendStageEvent({
      runId,
      stage: 'SNAPSHOT_WRITE',
      status: 'SUCCESS',
      recordsProcessed: result.inserted,
      metadata: { snapshotId: result.snapshotId },
    });
    await appendStageEvent({
      runId,
      stage: 'KPI_AGGREGATION',
      status: 'SUCCESS',
      recordsProcessed: 1,
      metadata: { snapshotId: result.snapshotId },
    });
    await appendStageEvent({
      runId,
      stage: 'AI_DECISIONS',
      status: 'IN_PROGRESS',
      metadata: { jobId: result.jobId, mode: 'async_enqueued' },
    });
    await appendStageEvent({ runId, stage: 'GOVERNANCE_SYNC', status: 'IN_PROGRESS' });
  } catch (e: any) {
    await appendStageEvent({ runId, stage: 'SNAPSHOT_WRITE', status: 'FAILED', errorMessage: e?.message || 'Refresh pipeline failed' });
    await markRunFailed(runId, e?.message || 'Refresh pipeline failed');
    await setCacheError(cacheKey, e?.message || 'Refresh pipeline failed');
    throw e;
  }

  // Worker will execute AI_DECISIONS -> GOVERNANCE_SYNC -> PUBLISH atomically on success.
  // Finalize refresh metadata so cache-status can declare the first successful refresh attempt.
  await setCacheFresh(cacheKey, result.inserted);

  return {
    data: {
      success: true,
      phase: 'fast_complete',
      snapshotId: result.snapshotId,
      runId,
      jobId: result.jobId,
      inserted: result.inserted,
      durationMs: Date.now() - started,
    },
    meta: { source: 'system' },
  };
});

function configWindowDays(body: any): number {
  const n = Number(body?.lookbackDays);
  return Number.isFinite(n) && n > 0 ? n : 30;
}
