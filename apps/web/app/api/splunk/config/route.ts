import { NextRequest, NextResponse } from 'next/server';
import { getClient, pool } from '@core/database/connection';
import { SplunkConfigService } from '@api/services/splunk-config-service';
import { requireSSEContext } from '@packages/auth/request-context';

const configService = new SplunkConfigService(pool);

export async function GET(request: NextRequest) {
  const context = await requireSSEContext(request);
  if (context instanceof NextResponse) return context;
  const tenantId = context.tenantId;

  try {
    const cfg = await configService.getSplunkConfig(tenantId);
    if (!cfg) {
      return NextResponse.json({ apiUrl: '', hecUrl: '', mcpUrl: '', username: '', ssl_verify: true });
    }
    return NextResponse.json({
      url: cfg.url || '',
      apiUrl: cfg.apiUrl || '',
      hecUrl: cfg.hecUrl || '',
      mcpUrl: cfg.mcpUrl || '',
      username: cfg.username || '',
      ssl_verify: cfg.ssl_verify !== false,
      restAuthType: cfg.restAuthType || '',
    });
  } catch (error) {
    console.error('Get splunk config error:', error);
    return NextResponse.json(
      { error: 'Failed to get Splunk configuration', details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const context = await requireSSEContext(request);
  if (context instanceof NextResponse) return context;
  const tenantId = context.tenantId;
  const userId = context.userId;
  if (context.role !== 'admin') return NextResponse.json({ error: 'Forbidden - admin only' }, { status: 403 });

  try {
    const { url, apiUrl, hecUrl, mcpUrl, hec_token, username, password, ssl_verify, restAuthType, restAuthSecret } = await request.json();
    const hasToken = typeof hec_token === 'string' && hec_token.trim().length > 0;
    const resolvedApiUrl = apiUrl || url;
    if (!resolvedApiUrl && !hecUrl) {
      return NextResponse.json({ error: 'API URL or HEC URL is required' }, { status: 400 });
    }

    await configService.saveSplunkConfig(tenantId, {
      url,
      apiUrl: apiUrl || url,
      hecUrl: hecUrl || url,
      mcpUrl,
      hec_token: hasToken ? hec_token : null,
      username: username || undefined,
      password: password || undefined,
      ssl_verify: ssl_verify !== false,
      restAuthType: restAuthType || undefined,
      restAuthSecret: restAuthSecret || undefined,
    });

    await configService.pool.query(
      `SELECT log_tenant_action($1, $2, 'SPLUNK_CONFIG_UPDATED', 'tenants', $3, $4, $5)`,
      [tenantId, userId, tenantId, JSON.stringify({ splunk_api_url: resolvedApiUrl }), request.headers.get('x-forwarded-for') || null]
    );

    const status = await configService.getSplunkStatus(tenantId);
    return NextResponse.json({
      is_configured: status?.is_configured || false,
      test_status: status?.test_status || 'not_tested',
      test_error: status?.test_error,
      last_test: status?.last_test,
    });
  } catch (error) {
    console.error('Splunk config error:', error);
    return NextResponse.json(
      { error: 'Failed to save Splunk configuration', details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const context = await requireSSEContext(request);
  if (context instanceof NextResponse) return context;
  const tenantId = context.tenantId;
  const userId = context.userId;
  if (context.role !== 'admin') return NextResponse.json({ error: 'Forbidden - admin only' }, { status: 403 });

  try {
    const client = await getClient();
    await client.query(
      `UPDATE tenants SET
        splunk_url = NULL, splunk_api_url = NULL, splunk_hec_url = NULL, splunk_mcp_url = NULL,
        splunk_hec_token = NULL, splunk_username = NULL, splunk_password = NULL,
        splunk_rest_auth_type = NULL, splunk_rest_auth_secret = NULL,
        splunk_rest_auth_secret_version = NULL, splunk_rest_auth_updated_at = NULL,
        is_configured = false, updated_at = NOW()
      WHERE id = $1`,
      [tenantId]
    );
    await client.query(
      `SELECT log_tenant_action($1, $2, 'SPLUNK_CONFIG_DELETED', 'tenants', $3, NULL, $4)`,
      [tenantId, userId, tenantId, request.headers.get('x-forwarded-for') || null]
    );
    client.release();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete splunk config error:', error);
    return NextResponse.json({ error: 'Failed to delete Splunk configuration', details: (error as Error).message }, { status: 500 });
  }
}
