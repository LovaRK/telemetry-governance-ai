import { createRoute } from '@/lib/api-route-factory';
import { SplunkClient } from '@api/services/splunk-client';

/**
 * Test Splunk Connection Endpoint
 *
 * Validates Splunk connectivity without doing expensive queries.
 * Returns: connection status, latency, and helpful error messages.
 *
 * Uses global route factory for automatic trace + purity enforcement.
 */

export const POST = createRoute(async (request: any) => {
  const body = await request.json();
  // Support both old (mcpUrl+token) and new (splunkUrl+username/password) formats
  const {
    mcpUrl, token,
    splunkUrl, authType, username, password, bearerToken,
    disableSslVerify = false, disable_ssl_verify = false,
  } = body;

  const url = splunkUrl || mcpUrl;
  if (!url) {
    throw new Error('Splunk URL is required');
  }

  // Build auth header
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
    throw new Error('Authentication credentials are required');
  }
  const splunk = new SplunkClient({
    mcpUrl: url,
    token: authHeader,
    allowInsecureTls: !!(disableSslVerify || disable_ssl_verify),
    timeoutMs: 10000,
  });

  // Fast health check (no heavy queries)
  const health = await splunk.healthCheckFast();

  if (!health.success) {
    throw new Error(`Connection failed: ${health.error || 'Unknown error'}`);
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
