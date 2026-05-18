import { NextRequest, NextResponse } from 'next/server';
import { SplunkClient } from '@api/services/splunk-client';

/**
 * Test Splunk Connection Endpoint
 *
 * Validates Splunk connectivity without doing expensive queries.
 * Returns: connection status, latency, and helpful error messages.
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mcpUrl, token, disableSslVerify = false } = body;

    if (!mcpUrl || !token) {
      return NextResponse.json(
        { error: 'mcpUrl and token are required' },
        { status: 400 }
      );
    }

    const splunk = new SplunkClient({
      mcpUrl,
      token,
      allowInsecureTls: !!disableSslVerify,
      timeoutMs: 10000, // 10s for health check (faster than query timeout)
    });

    // Fast health check (no heavy queries)
    const health = await splunk.healthCheckFast();

    if (!health.success) {
      return NextResponse.json(
        {
          success: false,
          latencyMs: health.latencyMs,
          error: health.error || 'Connection failed',
          hint: generateHint(health.error || ''),
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      latencyMs: health.latencyMs,
      message: `Connected to Splunk in ${health.latencyMs}ms`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        error: 'Test connection failed',
        reason: message,
        hint: generateHint(message),
      },
      { status: 500 }
    );
  }
}

function generateHint(error: string): string {
  if (!error) return 'Check MCP URL and token are correct.';

  if (error.includes('firewall') || error.includes('blocked') || error.includes('Cannot reach')) {
    return 'Splunk is unreachable. Check: (1) Splunk is running, (2) Port 8089 is open in firewall, (3) MCP URL is correct.';
  }

  if (error.includes('401') || error.includes('unauthorized') || error.includes('Invalid')) {
    return 'Token is invalid or expired. Generate a new token in Splunk Settings → Tokens.';
  }

  if (error.includes('403') || error.includes('permission') || error.includes('forbidden')) {
    return 'Token lacks permissions. Grant "list_indexes" and "list_saved_searches" capabilities.';
  }

  if (error.includes('timed out') || error.includes('timeout')) {
    return 'Connection timed out. Splunk may be slow or overloaded. Try again or increase timeout.';
  }

  if (error.includes('ECONNREFUSED')) {
    return 'Connection refused. Ensure Splunk is running on the correct port (default 8089).';
  }

  return 'Connection test failed. Verify MCP URL, token, and network connectivity.';
}
