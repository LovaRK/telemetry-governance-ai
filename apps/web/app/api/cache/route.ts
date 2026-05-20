import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { getCacheStatus, listCacheStatuses, setCacheRefreshing, setCacheFresh, setCacheError, isRefreshing } from '@api/services/cache-service';
import { runFastAggregation } from '@api/services/aggregation-service';
import { SplunkClient } from '@api/services/splunk-client';

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

  const { mcpUrl, disableSslVerify = false, costPerGbPerDay = 0.5 } = body;
  const cacheKey = 'index_metrics';

  const alreadyRunning = await isRefreshing(cacheKey);
  if (alreadyRunning) {
    throw new Error('Refresh already in progress: Wait for current job to complete');
  }

  await setCacheRefreshing(cacheKey);

  const splunk = new SplunkClient({ mcpUrl, token: authToken, allowInsecureTls: !!disableSslVerify });

  const health = await splunk.healthCheckFast();
  if (!health.success) {
    await setCacheError(cacheKey, `Splunk unreachable: ${health.error}`);
    throw new Error(`Cannot connect to Splunk: ${health.error || 'Connection failed'}`);
  }

  // Fast path: fetch Splunk metadata (<5s) and enqueue LLM job
  const result = await runFastAggregation(splunk, { lookbackDays: 30, costPerGbPerDay });

  return {
    data: {
      success: true,
      phase: 'fast_complete',
      snapshotId: result.snapshotId,
      jobId: result.jobId,
      inserted: result.inserted,
      durationMs: Date.now() - started,
    },
    meta: { source: 'system' },
  };
});
