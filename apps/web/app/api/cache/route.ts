import { NextRequest, NextResponse } from 'next/server';
import { getCacheStatus, listCacheStatuses, setCacheRefreshing, setCacheError, isRefreshing } from '@api/services/cache-service';
import { runAggregation } from '@api/services/aggregation-service';
import { SplunkClient } from '@api/services/splunk-client';
import { query } from '@core/database/connection';

// Blocking refresh — no polling, no background jobs.
// POST /api/cache awaits the full pipeline and returns when done.
const REFRESH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (LLM scoring adds time)

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Refresh timed out after ${Math.round(timeoutMs / 1000)}s. The LLM agent is processing data — try again.`));
    }, timeoutMs);
    promise.then(resolve).catch(reject).finally(() => clearTimeout(timeout));
  });
}

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

    // Auth priority: token > username/password
    let authToken = body.token;
    if (!authToken && body.username && body.password) {
      // Fallback to Basic Auth if token not provided
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

    // Blocking: await full pipeline including LLM agent scoring
    const result = await withTimeout(
      runAggregation(splunk, { lookbackDays: 30, costPerGbPerDay }),
      REFRESH_TIMEOUT_MS
    );

    if (result.errors > 0) {
      await setCacheError(cacheKey, `Partial failure: ${result.errors} records failed`);
    }

    const countResult = await query(`SELECT COUNT(*) as count FROM telemetry_snapshots`);
    const recordCount = parseInt(countResult.rows[0]?.count || '0', 10);
    if (recordCount === 0) {
      await setCacheError(cacheKey, 'No data stored after refresh');
      return NextResponse.json(
        { error: 'No data returned from Splunk', hint: 'Check index permissions and time range' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      snapshotId: result.snapshotId,
      inserted: result.inserted,
      errors: result.errors,
      durationMs: Date.now() - started,
      agentReasoning: result.agentReasoning,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Refresh failed';
    await setCacheError('index_metrics', message).catch(() => {});

    let hint = 'Check MCP URL, token, and network connectivity';
    if (message.includes('Ollama')) hint = 'Start Ollama: run "ollama serve" in a terminal';
    else if (message.includes('ECONNREFUSED') || message.includes('ECONNRESET')) hint = 'Port 8089 refused — ensure Splunk management API is running';
    else if (message.includes('timed out')) hint = 'Refresh timed out — the LLM agent may need more time. Try again.';
    else if (message.includes('401')) hint = 'Token rejected. Verify your Splunk token is valid.';

    return NextResponse.json({ error: 'Refresh failed', reason: message, hint }, { status: 500 });
  }
}
