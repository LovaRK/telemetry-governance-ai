import { NextRequest, NextResponse } from 'next/server';
import { getCacheStatus, listCacheStatuses, setCacheRefreshing, setCacheFresh, setCacheError, isRefreshing } from '@api/services/cache-service';
import { runFastAggregation } from '@api/services/aggregation-service';
import { SplunkClient } from '@api/services/splunk-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    if (key) {
      const status = await getCacheStatus(key);
      return NextResponse.json(status);
    }
    const statuses = await listCacheStatuses();
    return NextResponse.json({ caches: statuses });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch cache status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const started = Date.now();
  try {
    const body = await request.json();
    if (!body?.mcpUrl) {
      return NextResponse.json({ error: 'mcpUrl is required' }, { status: 400 });
    }

    let authToken = body.token;
    if (!authToken && body.username && body.password) {
      const credentials = Buffer.from(`${body.username}:${body.password}`).toString('base64');
      authToken = `Basic ${credentials}`;
    }

    if (!authToken) {
      return NextResponse.json(
        { error: 'Authentication required', hint: 'Provide token OR (username + password)' },
        { status: 400 }
      );
    }

    const { mcpUrl, disableSslVerify = false, costPerGbPerDay = 0.5 } = body;
    const cacheKey = 'index_metrics';

    const alreadyRunning = await isRefreshing(cacheKey);
    if (alreadyRunning) {
      return NextResponse.json(
        { error: 'Refresh already in progress', hint: 'Wait for current job to complete' },
        { status: 409 }
      );
    }

    await setCacheRefreshing(cacheKey);

    const splunk = new SplunkClient({ mcpUrl, token: authToken, allowInsecureTls: !!disableSslVerify });

    const health = await splunk.healthCheckFast();
    if (!health.success) {
      await setCacheError(cacheKey, `Splunk unreachable: ${health.error}`);
      const isFirewall = health.error?.includes('firewall') || health.error?.includes('blocked') || health.error?.includes('Cannot reach');
      return NextResponse.json(
        {
          error: 'Cannot connect to Splunk',
          reason: health.error || 'Connection failed',
          hint: isFirewall
            ? 'Open TCP 8089 inbound in your server firewall.'
            : 'Verify Splunk is running and the token is valid.',
        },
        { status: 500 }
      );
    }

    // Fast path: fetch Splunk metadata (<5s) and enqueue LLM job
    const result = await runFastAggregation(splunk, { lookbackDays: 30, costPerGbPerDay });

    // Cache is fast_complete — worker will call setCacheFresh when LLM finishes
    return NextResponse.json({
      success: true,
      phase: 'fast_complete',
      snapshotId: result.snapshotId,
      jobId: result.jobId,
      inserted: result.inserted,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Refresh failed';
    await setCacheError('index_metrics', message).catch(() => {});

    let hint = 'Check MCP URL, token, and network connectivity';
    if (message.includes('Ollama')) hint = 'Start Ollama: run "ollama serve" in a terminal';
    else if (message.includes('ECONNREFUSED') || message.includes('ECONNRESET')) hint = 'Port 8089 refused — ensure Splunk management API is running';
    else if (message.includes('401')) hint = 'Token rejected. Verify your Splunk token is valid.';

    return NextResponse.json({ error: 'Refresh failed', reason: message, hint }, { status: 500 });
  }
}
