import { NextRequest, NextResponse } from 'next/server';
import { SplunkClient } from '@api/services/splunk-client';
import { SplunkConfigService } from '@api/services/splunk-config-service';
import { pool } from '@core/database/connection';
import https from 'https';
import { requireContext } from '@packages/auth/request-context';

export async function GET(request: NextRequest) {
  const context = await requireContext(request);
  if (context instanceof NextResponse) {
    return context;
  }
  const { tenantId } = context;

  const configService = new SplunkConfigService(pool);
  const config = await configService.getSplunkConfig(tenantId);
  if (!config) {
    return NextResponse.json({ error: 'Splunk not configured' }, { status: 404 });
  }

  const sslVerify = config.ssl_verify !== false;
  const agent = new https.Agent({ rejectUnauthorized: sslVerify });

  const diag: Record<string, any> = {
    api: 'unknown',
    api_latency_ms: null,
    rest_auth: 'unknown',
    hec: 'unknown',
    hec_latency_ms: null,
    hec_auth: 'unknown',
    mcp: 'unknown',
    indexes: 0,
    saved_searches: 0,
    rest_auth_type: config.restAuthType || 'unknown',
    auth_secret_version: config.restAuthSecretVersion || 0,
  };

  const restApiUrl = config.apiUrl || config.url;
  if (config.restAuthSecret && restApiUrl) {
    const authHeader = config.restAuthType === 'JWT'
      ? `Bearer ${config.restAuthSecret}`
      : config.restAuthType === 'TOKEN'
        ? `Bearer ${config.restAuthSecret}`
        : `Basic ${Buffer.from(`${config.username || ''}:${config.password || ''}`).toString('base64')}`;

    const restBase = restApiUrl.replace(/\/$/, '');
    const client = new SplunkClient({
      mcpUrl: restBase,
      token: authHeader,
      allowInsecureTls: !sslVerify,
      timeoutMs: 10000,
    });

    const health = await client.healthCheckFast();
    diag.api = health.success ? 'healthy' : 'down';
    diag.api_latency_ms = health.latencyMs;
    diag.rest_auth = health.success ? 'valid' : health.error?.includes('401') ? 'invalid' : 'unknown';

    if (health.success) {
      try {
        const indexes = await client.getIndexMetrics();
        diag.indexes = indexes.length;
      } catch { /* index count is best-effort */ }
      try {
        const searches = await client.getSavedSearches();
        diag.saved_searches = searches.length;
      } catch { /* search count is best-effort */ }
    }
  } else {
    diag.api = 'not_tested';
    diag.rest_auth = 'no_credentials';
  }

  if (config.hecUrl && config.hec_token) {
    const hecStart = Date.now();
    try {
      const hecRes = await fetch(`${config.hecUrl.replace(/\/$/, '')}/services/collector/health`, {
        agent,
      });
      diag.hec_latency_ms = Date.now() - hecStart;
      if (hecRes.ok) {
        diag.hec = 'healthy';
        diag.hec_auth = 'valid';
      } else if (hecRes.status === 401) {
        diag.hec = 'healthy';
        diag.hec_auth = 'invalid';
      } else {
        diag.hec = 'degraded';
        diag.hec_auth = 'unknown';
      }
    } catch (e) {
      diag.hec = 'down';
      diag.hec_latency_ms = Date.now() - hecStart;
      diag.hec_auth = 'unknown';
      diag.hec_error = e instanceof Error ? e.message : 'unknown';
    }
  } else {
    diag.hec = 'not_tested';
    diag.hec_auth = 'no_credentials';
  }

  if (config.mcpUrl) {
    try {
      const mcpRes = await fetch(config.mcpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'health/check', params: {} }),
        agent,
      });
      diag.mcp = mcpRes.ok ? 'reachable' : 'unreachable';
    } catch {
      diag.mcp = 'unreachable';
    }
  } else {
    diag.mcp = 'not_configured';
  }

  const allPass = diag.api === 'healthy' && diag.hec === 'healthy' && diag.rest_auth === 'valid' && diag.hec_auth === 'valid';

  return NextResponse.json({
    ...diag,
    all_pass: allPass,
    timestamp: new Date().toISOString(),
  });
}
