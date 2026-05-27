import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '@core/database/connection';
import { requireSSEContext } from '@packages/auth/request-context';

/**
 * GET /api/splunk/status
 * Get Splunk configuration status for tenant
 */
export async function GET(request: NextRequest) {
  // Browser calls to this endpoint often rely on auth cookies and do not
  // explicitly send x-tenant-id/x-user-id headers. Use SSE context resolver
  // so authenticated users are not incorrectly treated as unconfigured.
  const context = await requireSSEContext(request);
  if (context instanceof NextResponse) {
    return context;
  }
  const tenantId = context.tenantId;

  try {
    const client = await getClient();
    const result = await client.query(
      `SELECT is_configured,
              splunk_test_status as test_status,
              splunk_test_error as test_error,
              last_splunk_test as last_test,
              splunk_mcp_url,
              splunk_api_url,
              splunk_hec_url,
              splunk_hec_token,
              splunk_rest_auth_secret,
              splunk_username,
              splunk_password
       FROM tenants
       WHERE id = $1`,
      [tenantId]
    );
    client.release();

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const tenant = result.rows[0];
    const hasAnyUrl = Boolean(tenant.splunk_mcp_url || tenant.splunk_api_url || tenant.splunk_hec_url);
    const hasAnyAuth = Boolean(tenant.splunk_hec_token || tenant.splunk_rest_auth_secret || (tenant.splunk_username && tenant.splunk_password));
    const derivedConfigured = Boolean(tenant.is_configured || (hasAnyUrl && hasAnyAuth));

    return NextResponse.json({
      is_configured: derivedConfigured,
      test_status: tenant.test_status || 'not_tested',
      test_error: tenant.test_error,
      last_test: tenant.last_test,
    });
  } catch (error) {
    console.error('Splunk status error:', error);
    return NextResponse.json(
      { error: 'Failed to get Splunk status', details: (error as Error).message },
      { status: 500 }
    );
  }
}
