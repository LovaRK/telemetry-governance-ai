import { NextResponse } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { SplunkClient } from '@api/services/splunk-client';

export const POST = createRoute(async (request: any) => {
  const body = await request.json();
  const {
    mcpUrl, token,
    splunkUrl, apiUrl, authType, username, password, bearerToken,
    disableSslVerify = false, disable_ssl_verify = false,
  } = body;

  const url = apiUrl || splunkUrl || mcpUrl;
  if (!url) {
    return NextResponse.json(
      { error: 'Splunk URL is required', meta: { source: 'system', mode: 'live' } },
      { status: 400 }
    );
  }

  let authHeader: string;
  if (authType === 'basic' && username && password) {
    authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  } else if (authType === 'token' && bearerToken) {
    authHeader = `Bearer ${bearerToken}`;
  } else if (token) {
    authHeader = token.startsWith('Bearer ') || token.startsWith('Splunk ') || token.startsWith('Basic ')
      ? token
      : `Bearer ${token}`;
  } else {
    return NextResponse.json(
      { error: 'Authentication credentials are required', meta: { source: 'system', mode: 'live' } },
      { status: 400 }
    );
  }

  const resolvedMcpUrl = mcpUrl || `${url.replace(/\/$/, '')}/services/mcp`;
  const splunk = new SplunkClient({
    mcpUrl: resolvedMcpUrl,
    token: authHeader,
    allowInsecureTls: !!(disableSslVerify || disable_ssl_verify),
    timeoutMs: 10000,
  });

  const health = await splunk.healthCheckFast();
  if (!health.success) {
    return NextResponse.json(
      { error: `Connection failed: ${health.error || 'Unknown error'}`, meta: { source: 'system', mode: 'live', retryable: true } },
      { status: 503 }
    );
  }

  return {
    data: {
      success: true,
      latencyMs: health.latencyMs,
      message: `Connected to Splunk in ${health.latencyMs}ms`,
    },
    meta: { source: 'system' },
  };
});
