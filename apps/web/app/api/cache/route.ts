import { NextRequest, NextResponse } from 'next/server';
import { getCacheStatus, listCacheStatuses, setCacheRefreshing, setCacheError, isRefreshing } from '@api/services/cache-service';
import { runAggregation } from '@api/services/aggregation-service';
import { SplunkClient } from '@api/services/splunk-client';
import { query } from '@core/database/connection';

const REFRESH_TIMEOUT_MS = 90000; // 90 seconds — REST index call + one tstats batch

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Refresh timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeout));
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
  try {
    const body = await request.json();
    if (!body?.mcpUrl || !body?.token) {
      return NextResponse.json(
        { error: 'mcpUrl and token are required' },
        { status: 400 }
      );
    }

    const { mcpUrl, token, force = false, disableSslVerify = false } = body;

    const cacheKey = 'index_metrics';

    // Guard: prevent duplicate refresh jobs
    const alreadyRunning = await isRefreshing(cacheKey);
    if (alreadyRunning) {
      return NextResponse.json(
        { error: 'Refresh already in progress', hint: 'Wait for current job to complete' },
        { status: 409 }
      );
    }

    // Set cache to refreshing state
    await setCacheRefreshing(cacheKey);

    // Initialize Splunk client
    const splunk = new SplunkClient({
      mcpUrl,
      token,
      allowInsecureTls: !!disableSslVerify
    });

    // Quick health check first
    const health = await splunk.healthCheckFast();
    if (!health.success) {
      const isFirewall = health.error?.includes('firewall') || health.error?.includes('blocked') || health.error?.includes('Cannot reach');
      await setCacheError(cacheKey, `Splunk unreachable: ${health.error}`);
      return NextResponse.json(
        {
          error: 'Cannot connect to Splunk',
          reason: health.error || 'Connection failed',
          hint: isFirewall
            ? 'Fix: Open TCP 8089 inbound in your server firewall (Vultr/AWS/GCP). Splunk management port must be reachable from this machine.'
            : 'Verify Splunk is running and the token is valid and not expired'
        },
        { status: 500 }
      );
    }

    // Run aggregation
    const result = await withTimeout(
      runAggregation(splunk, {
        lookbackDays: 30,
        incremental: !force,
      }),
      REFRESH_TIMEOUT_MS
    );

    // Partial data detection
    if ((result as any)?.errors > 0) {
      await setCacheError(cacheKey, `Partial data loss: ${(result as any).errors} indices failed`);
      return NextResponse.json(
        {
          error: 'Partial failure during aggregation',
          details: result,
        },
        { status: 500 }
      );
    }

    // Guard: DB empty after refresh
    const countResult = await query(`SELECT COUNT(*) as count FROM telemetry_snapshots`);
    const recordCount = parseInt(countResult.rows[0]?.count || '0', 10);
    if (recordCount === 0) {
      await setCacheError(cacheKey, 'Splunk returned no data');
      return NextResponse.json(
        {
          error: 'Splunk returned no data',
          reason: 'Query returned 0 records',
          hint: 'Check index permissions, sourcetype filters, or time range'
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      cacheKey,
      result,
    });
  } catch (error) {
    let message = error instanceof Error ? error.message : 'Refresh failed';
    let hint = 'Check MCP URL / token / network connectivity';
    if (message.includes('firewall') || message.includes('Port') || message.includes('blocked')) {
      hint = message;
    } else if (message.includes('ECONNREFUSED') || message.includes('ECONNRESET')) {
      hint = 'Port 8089 is actively refused. Ensure Splunk management API is running and TCP 8089 is open in the server firewall.';
    } else if (message.includes('timed out') || message.includes('ETIMEDOUT')) {
      hint = 'Connection timed out — port 8089 is likely blocked by a firewall. Open TCP 8089 inbound on the Splunk server (Vultr/AWS/GCP firewall rules).';
    } else if (message.includes('401') || message.includes('authentication')) {
      hint = 'Token rejected. Use the MCP token from Splunk (Settings → Tokens). Do not add quotes or "Bearer " prefix.';
    }
    await setCacheError('index_metrics', message);
    return NextResponse.json(
      {
        error: 'Splunk connection failed',
        reason: message,
        hint
      },
      { status: 500 }
    );
  }
}
