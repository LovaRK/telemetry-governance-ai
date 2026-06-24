import { NextRequest, NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { getCacheStatus, listCacheStatuses, setCacheRefreshing, setCacheFresh, setCacheError, isRefreshing } from '@api/services/cache-service';
import { runFastAggregation } from '@api/services/aggregation-service';
import { triggerDashboardTruthAgent } from '@api/services/dashboard-truth-agent-service';
import { SplunkClient, SplunkDataSource } from '@api/services/splunk-client';
import { SplunkMcpAdapter } from '@api/services/splunk-mcp-adapter';
import { SplunkConfigService } from '@api/services/splunk-config-service';
import { pool } from '@core/database/connection';
import { getRuntimeConfig } from '@/lib/runtime-config';
import { requireContext } from '@packages/auth/request-context';
import { v4 as uuidv4 } from 'uuid';
import { buildPipelineProvenance } from '@/lib/pipeline-provenance';
import {
  appendStageEvent,
  buildIdempotencyHash,
  createRunningRun,
  ensurePipelineLedgerSchema,
  getActiveRunByHash,
  releaseIdempotencyHash,
  markRunFailed,
  setRunHashes,
} from '@/lib/pipeline-ledger-service';
import { buildExecutionHash } from '@api/services/pipeline-hash-service';

type LlmFailureCode =
  | 'FAILED_MODEL_UNAVAILABLE'
  | 'FAILED_MODEL_TIMEOUT'
  | 'FAILED_MODEL_REFUSED'
  | 'FAILED_MODEL_CONTEXT'
  | 'FAILED_MODEL_CRASH';

function classifyLlmProbeFailure(reason: string): LlmFailureCode {
  const r = reason.toUpperCase();
  if (r.includes('UNREACHABLE') || r.includes('NO_MODELS') || r.includes('MODEL_NOT_FOUND')) return 'FAILED_MODEL_UNAVAILABLE';
  if (r.includes('ABORT') || r.includes('TIMEOUT')) return 'FAILED_MODEL_TIMEOUT';
  if (r.includes('HTTP_4')) return 'FAILED_MODEL_REFUSED';
  if (r.includes('CONTEXT') || r.includes('NUM_CTX')) return 'FAILED_MODEL_CONTEXT';
  return 'FAILED_MODEL_CRASH';
}

async function checkLocalLlmReadiness(): Promise<{ ok: boolean; reason?: string }> {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434';
  const requiredModel = (process.env.LLM_MODEL || process.env.MODEL_VERSION || 'gemma2:9b').trim();
  // 300s TTL: the worker uses Ollama every ~80s per batch, so if the health cache is
  // <5 min old and shows available, the model is provably running. Re-probing while a
  // batch is in flight blocks on the model queue and times out, causing false UNAVAILABLE.
  const healthTtlSeconds = parseInt(process.env.LLM_HEALTH_CACHE_TTL_SECONDS || '300', 10);
  const provider = 'ollama';
  try {
    const cached = await pool.query<{
      available: boolean;
      last_checked: string;
      running_model: string | null;
      inference_capacity: string | null;
    }>(
      `SELECT available, last_checked, running_model, inference_capacity
       FROM llm_health_cache
       WHERE provider = $1
       LIMIT 1`,
      [provider]
    );
    const row = cached.rows[0];
    if (row) {
      const ageMs = Date.now() - new Date(row.last_checked).getTime();
      if (
        ageMs >= 0 &&
        ageMs <= healthTtlSeconds * 1000 &&
        row.running_model === requiredModel &&
        row.inference_capacity !== 'unhealthy'
      ) {
        if (row.available) return { ok: true };
        return { ok: false, reason: 'HEALTH_CACHE_UNAVAILABLE' };
      }
    }
  } catch {
    // Cache read failure should not block readiness probe.
  }

  // Connectivity + model-presence check via /api/tags (fast, non-blocking).
  // We do NOT run an inference probe here: gemma2:9b takes ~80s per call, so a
  // probe while the worker is mid-batch would queue behind it and time out,
  // producing a false OLLAMA_UNREACHABLE. /api/tags is sufficient — if the model
  // is listed and Ollama responds, inference will work.
  const probeStarted = Date.now();
  try {
    const tagsController = new AbortController();
    const tagsTimeout = setTimeout(() => tagsController.abort(), 10000);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/tags`, { method: 'GET', signal: tagsController.signal });
    } finally {
      clearTimeout(tagsTimeout);
    }
    if (!res.ok) {
      const reason = `OLLAMA_TAGS_HTTP_${res.status}`;
      await pool.query(
        `INSERT INTO llm_health_cache (provider, last_checked, available, response_time_ms, running_model, inference_capacity)
         VALUES ($1, NOW(), FALSE, $2, $3, 'unhealthy')
         ON CONFLICT (provider) DO UPDATE
         SET last_checked = EXCLUDED.last_checked,
             available = EXCLUDED.available,
             response_time_ms = EXCLUDED.response_time_ms,
             running_model = EXCLUDED.running_model,
             inference_capacity = EXCLUDED.inference_capacity`,
        [provider, Date.now() - probeStarted, requiredModel]
      ).catch(() => {});
      return { ok: false, reason };
    }
    const payload = await res.json().catch(() => null);
    const models = payload?.models;
    if (!Array.isArray(models) || models.length === 0) return { ok: false, reason: 'OLLAMA_NO_MODELS' };
    const hasModel = models.some((m: any) => {
      const name = String(m?.name || '').trim();
      const model = String(m?.model || '').trim();
      return name === requiredModel || model === requiredModel || name.startsWith(`${requiredModel}:`) || model.startsWith(`${requiredModel}:`);
    });
    if (!hasModel) return { ok: false, reason: `MODEL_NOT_FOUND:${requiredModel}` };

    await pool.query(
      `INSERT INTO llm_health_cache (provider, last_checked, available, response_time_ms, running_model, inference_capacity)
       VALUES ($1, NOW(), TRUE, $2, $3, 'healthy')
       ON CONFLICT (provider) DO UPDATE
       SET last_checked = EXCLUDED.last_checked,
           available = EXCLUDED.available,
           response_time_ms = EXCLUDED.response_time_ms,
           running_model = EXCLUDED.running_model,
           inference_capacity = EXCLUDED.inference_capacity`,
      [provider, Date.now() - probeStarted, requiredModel]
    ).catch(() => {});
    return { ok: true };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return { ok: false, reason: isAbort ? 'OLLAMA_TAGS_TIMEOUT' : 'OLLAMA_UNREACHABLE' };
  }
}

export const GET = createRoute(async (request: NextRequest) => {
  // Extract and validate RequestContext (fail-closed)
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) {
    return ctxOrError;
  }

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
  // Extract and validate RequestContext FIRST (fail-closed, no fallbacks)
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) {
    return ctxOrError;
  }
  const context = ctxOrError;

  const started = Date.now();
  const requestId = request.headers.get('x-request-id') || uuidv4();
  await ensurePipelineLedgerSchema();

  let body: Record<string, any> = {};
  try {
    body = (await request.json()) as Record<string, any>;
  } catch {
    // Accept empty-body refresh triggers from browser/curl.
    body = {};
  }
  const { disableSslVerify = false, costPerGbPerDay } = body;
  const runtimeConfig = getRuntimeConfig();
  const tenantId = context.tenantId;
  const trigger = body.trigger || 'manual';
  const window = body.window || `${configWindowDays(body)}d`;
  const idempotencyHash = buildIdempotencyHash({ tenantId, trigger, window });
  // Ensure terminal runs cannot block a new refresh due to stale unique hash retention.
  await releaseIdempotencyHash(idempotencyHash);
  const existingRun = await getActiveRunByHash(idempotencyHash);
  if (existingRun) {
    return {
      data: {
        success: true,
        phase: 'already_running',
        requestId,
        runId: existingRun.runId,
        snapshotId: existingRun.snapshotId,
        durationMs: Date.now() - started,
        status: 'RUNNING',
        splunkQueryCount: null,
      },
      meta: { source: 'system', requestId },
    };
  }

  const runId = uuidv4();
  const snapshotId = uuidv4();
  await createRunningRun(
    {
      runId,
      snapshotId,
      tenantId,
      idempotencyHash,
      pipelineVersion: process.env.PIPELINE_VERSION || '1.0.0',
      modelVersion: process.env.MODEL_VERSION || 'gemma2:9b',
      promptVersion: process.env.PROMPT_VERSION || '2.0',
      splunkQueryVersion: process.env.SPLUNK_QUERY_VERSION || '1.0',
      requestId,
      modelName: process.env.LLM_MODEL || process.env.MODEL_VERSION || 'gemma2:9b',
    },
    context
  );
  await appendStageEvent({
    runId,
    stage: 'SPLUNK_FETCH',
    status: 'IN_PROGRESS',
    metadata: {
      requestId,
      tenantId,
      startedAt: new Date(started).toISOString(),
      source: 'api_cache_refresh',
    },
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

  const splunkConfigService = new SplunkConfigService(pool);
  const tenantSplunkConfig = await splunkConfigService.getSplunkConfig(tenantId);
  if (!tenantSplunkConfig?.apiUrl || !tenantSplunkConfig?.hecUrl) {
    await appendStageEvent({
      runId, stage: 'SPLUNK_FETCH', status: 'FAILED',
      errorType: 'UNKNOWN', errorCode: 'RUNTIME',
      errorMessage: 'Tenant Splunk configuration is missing',
      metadata: { requestId, tenantId },
    });
    await markRunFailed(runId, 'Tenant Splunk configuration is missing');
    await setCacheError(cacheKey, 'Tenant Splunk configuration is missing');
    throw new Error('Tenant Splunk configuration is missing');
  }

  // HEC token is optional - only required for HEC data ingestion, not for REST API operations
  // Pipeline uses REST API for authentication, so HEC token is not required to proceed

  // Validate auth credentials based on auth type
  const isTokenAuth = tenantSplunkConfig.restAuthType === 'JWT' || tenantSplunkConfig.restAuthType === 'TOKEN';
  const isBasicAuth = tenantSplunkConfig.restAuthType === 'BASIC' || !tenantSplunkConfig.restAuthType;

  if (isTokenAuth && !tenantSplunkConfig.restAuthSecret) {
    await appendStageEvent({
      runId, stage: 'SPLUNK_FETCH', status: 'FAILED',
      errorType: 'UNKNOWN', errorCode: 'FAILED_SECRET_DECRYPTION',
      errorMessage: 'REST auth secret is missing or failed to decrypt',
      metadata: { requestId, tenantId },
    });
    await markRunFailed(runId, 'REST auth secret is missing or failed to decrypt');
    await setCacheError(cacheKey, 'REST auth secret is missing or failed to decrypt');
    throw new Error('REST auth secret is missing or failed to decrypt');
  }

  if (isBasicAuth && (!tenantSplunkConfig.username || !tenantSplunkConfig.password)) {
    await appendStageEvent({
      runId, stage: 'SPLUNK_FETCH', status: 'FAILED',
      errorType: 'UNKNOWN', errorCode: 'MISSING_BASIC_AUTH',
      errorMessage: 'Splunk username and password are required for BASIC authentication',
      metadata: { requestId, tenantId },
    });
    await markRunFailed(runId, 'Splunk username and password are required');
    await setCacheError(cacheKey, 'Splunk username and password are required');
    throw new Error('Splunk username and password are required');
  }

  const restAuthHeader = tenantSplunkConfig.restAuthType === 'JWT'
    ? `Bearer ${tenantSplunkConfig.restAuthSecret}`
    : tenantSplunkConfig.restAuthType === 'TOKEN'
      ? `Bearer ${tenantSplunkConfig.restAuthSecret}`
      : `Basic ${Buffer.from(`${tenantSplunkConfig.username || ''}:${tenantSplunkConfig.password || ''}`).toString('base64')}`;

  const splunkBase = tenantSplunkConfig.apiUrl || tenantSplunkConfig.url;
  if (!splunkBase) {
    await appendStageEvent({
      runId, stage: 'SPLUNK_FETCH', status: 'FAILED',
      errorType: 'UNKNOWN', errorCode: 'FAILED_SPLUNK_CONFIG',
      errorMessage: 'Missing Splunk API URL',
    });
    await markRunFailed(runId, 'Missing Splunk API URL');
    await setCacheError(cacheKey, 'Missing Splunk API URL');
    throw new Error('Missing Splunk API URL');
  }

  // Defense in depth: in production mode, reject sandbox-only hostnames
  // even if they made it into tenants.splunk_url (e.g. a dev DB restored
  // onto a prod install). Without this guard, a stale dev row pointing at
  // splunk-mock would silently use mock data — a Thamba Policy violation.
  // EnvironmentValidator enforces this at write time; this is the read-time
  // mirror so persisted state can't bypass it.
  const isSandbox = (process.env.APP_ENV || '').toLowerCase() === 'sandbox';
  if (!isSandbox) {
    const SANDBOX_ONLY_HOSTS = ['splunk-mock', 'localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal'];
    let host = '';
    try {
      host = new URL(splunkBase).hostname.toLowerCase();
    } catch {
      host = splunkBase.toLowerCase();
    }
    const sandboxHostHit = SANDBOX_ONLY_HOSTS.find(
      (h) => host === h || host.endsWith(`.${h}`)
    );
    if (sandboxHostHit) {
      const msg = `Refusing to query sandbox host "${host}" in production mode. ` +
        `Tenant ${tenantId} has splunk_url=${splunkBase} which is allowed only when APP_ENV=sandbox. ` +
        `Reconfigure in Settings → Splunk Connection with the real Splunk URL, or set APP_ENV=sandbox if this is intentional.`;
      await appendStageEvent({
        runId, stage: 'SPLUNK_FETCH', status: 'FAILED',
        errorType: 'UNKNOWN', errorCode: 'FAILED_SPLUNK_CONFIG',
        errorMessage: msg,
        metadata: { requestId, tenantId, host, sandboxHostHit },
      });
      await markRunFailed(runId, msg);
      await setCacheError(cacheKey, msg);
      throw new Error(msg);
    }
  }

  const restClient = new SplunkClient({
    mcpUrl: splunkBase,
    token: restAuthHeader,
    allowInsecureTls: tenantSplunkConfig.ssl_verify === false ? true : !!disableSslVerify,
  });

  // MCP feature flag (experimental): if this tenant has splunk_mcp_url
  // configured, route the pipeline through the MCP adapter, which falls back
  // to this same REST client on any MCP failure. Otherwise use REST directly.
  const splunk: SplunkDataSource = tenantSplunkConfig.mcpUrl
    ? (console.log(`[MCP] tenant has splunk_mcp_url — using MCP adapter with REST fallback (${tenantSplunkConfig.mcpUrl})`),
       new SplunkMcpAdapter(tenantSplunkConfig.mcpUrl, restAuthHeader, restClient))
    : restClient;

  const health = await splunk.healthCheckFast();
  if (!health.success) {
    await appendStageEvent({
      runId, stage: 'SPLUNK_FETCH', status: 'FAILED',
      errorType: 'UNKNOWN', errorCode: 'RUNTIME',
      errorMessage: health.error || 'Connection failed',
      metadata: { requestId, tenantId },
    });
    await markRunFailed(runId, `Splunk unreachable: ${health.error}`);
    await setCacheError(cacheKey, `Splunk unreachable: ${health.error}`);
    throw new Error(`Cannot connect to Splunk: ${health.error || 'Connection failed'}`);
  }
  await appendStageEvent({
    runId, stage: 'SPLUNK_FETCH', status: 'SUCCESS',
    metadata: { requestId, tenantId, splunkHealthLatencyMs: health.latencyMs ?? null },
  });

  // Enforce local-first AI availability: do not proceed if LLM runtime is unavailable.
  const llmReadiness = await checkLocalLlmReadiness();
  if (!llmReadiness.ok) {
    const reason = llmReadiness.reason || 'LOCAL_LLM_UNAVAILABLE';
    const mappedCode = classifyLlmProbeFailure(reason);
    await appendStageEvent({
      runId,
      stage: 'AI_DECISIONS',
      status: 'FAILED',
      errorType: 'MODEL_MISSING',
      errorCode: mappedCode,
      errorMessage: `${mappedCode}: ${reason}`,
      metadata: { requestId, tenantId },
    });
    await markRunFailed(runId, `${mappedCode}: ${reason}`);
    await setCacheError(cacheKey, `${mappedCode}: ${reason}`);
    throw new Error(`${mappedCode}: ${reason}`);
  }

  // Fast path: fetch Splunk metadata (<5s) and enqueue LLM job
  let result;
  try {
    await appendStageEvent({ runId, stage: 'SNAPSHOT_WRITE', status: 'IN_PROGRESS', metadata: { requestId, runId, tenantId } });
    await appendStageEvent({ runId, stage: 'KPI_AGGREGATION', status: 'IN_PROGRESS', metadata: { requestId, runId, tenantId } });
    result = await runFastAggregation(
      splunk,
      context,
      { lookbackDays: 30, costPerGbPerDay: effectiveCostPerGbPerDay },
      { snapshotId, runId, requestId }
    );
    await appendStageEvent({
      runId,
      stage: 'SNAPSHOT_WRITE',
      status: 'SUCCESS',
      recordsProcessed: result.inserted,
      metadata: { snapshotId: result.snapshotId, requestId, runId, tenantId },
    });
    await appendStageEvent({
      runId,
      stage: 'KPI_AGGREGATION',
      status: 'SUCCESS',
      recordsProcessed: 1,
      metadata: { snapshotId: result.snapshotId, requestId, runId, tenantId },
    });
    await appendStageEvent({
      runId,
      stage: 'AI_DECISIONS',
      status: 'IN_PROGRESS',
      metadata: { jobId: result.jobId, mode: 'async_enqueued', requestId, runId, tenantId },
    });
    await appendStageEvent({ runId, stage: 'GOVERNANCE_SYNC', status: 'IN_PROGRESS', metadata: { requestId, runId, tenantId } });
  } catch (e: any) {
    await appendStageEvent({
      runId,
      stage: 'SNAPSHOT_WRITE',
      status: 'FAILED',
      errorType: 'UNKNOWN',
      errorCode: 'RUNTIME',
      errorMessage: e?.message || 'Refresh pipeline failed',
      metadata: { requestId, tenantId },
    });
    await markRunFailed(runId, e?.message || 'Refresh pipeline failed');
    await setCacheError(cacheKey, e?.message || 'Refresh pipeline failed');
    throw e;
  }

  // Worker will execute AI_DECISIONS -> GOVERNANCE_SYNC -> PUBLISH atomically on success.
  // Finalize refresh metadata so cache-status can declare the first successful refresh attempt.
  await setCacheFresh(cacheKey, result.inserted);

  // Persist source/snapshot hash immediately. Decision hash is filled by worker on completion.
  const executionHash = buildExecutionHash({
    sourceHash: result.sourceHash,
    snapshotHash: result.snapshotHash,
    decisionHash: null,
    schemaVersion: '1',
  });
  await setRunHashes(runId, {
    sourceHash: result.sourceHash,
    snapshotHash: result.snapshotHash,
    decisionHash: null,
    executionHash,
  });

  // IMPORTANT: Do not fail immediately on zero decisions.
  // LLM decisions are asynchronous via worker; lifecycle remains RUNNING/PARTIAL until worker finalizes.
  const finalPhase: 'snapshot_ready_ai_pending' = 'snapshot_ready_ai_pending';
  const finalStatus: 'RUNNING' = 'RUNNING';

  // Non-blocking trust validation: fire-and-forget, never impact refresh response path.
  triggerDashboardTruthAgent(tenantId);

  const provenance = buildPipelineProvenance({
    tenantId,
    runId,
    requestId,
    updatedAt: new Date().toISOString(),
  });

  return {
    data: {
      success: (finalStatus as string) === 'SUCCEEDED',
      phase: finalPhase,
      requestId,
      runId,
      snapshotId: result.snapshotId,
      jobId: result.jobId,
        inserted: result.inserted,
        durationMs: Date.now() - started,
        status: finalStatus,
      splunkQueryCount: null,
      provenance,
    },
    meta: { source: 'system', requestId, tenantId, runId, lifecycleVersion: 'v1' },
  };
});

function configWindowDays(body: any): number {
  const n = Number(body?.lookbackDays);
  return Number.isFinite(n) && n > 0 ? n : 30;
}
