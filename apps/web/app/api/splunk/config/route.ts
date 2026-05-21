import { NextRequest, NextResponse } from 'next/server';
import { getClient, pool } from '@core/database/connection';

/**
 * GET /api/splunk/config
 * Get stored Splunk configuration (without password)
 */
export async function GET(request: NextRequest) {
  const tenantId = request.headers.get('x-tenant-id');
  const userId = request.headers.get('x-user-id');

  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = await getClient();
    const result = await client.query(
      `SELECT splunk_url, splunk_username, splunk_ssl_verify
       FROM tenants
       WHERE id = $1`,
      [tenantId]
    );
    client.release();

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const tenant = result.rows[0];
    return NextResponse.json({
      url: tenant.splunk_url || '',
      username: tenant.splunk_username || '',
      ssl_verify: tenant.splunk_ssl_verify !== false,
    });
  } catch (error) {
    console.error('Get splunk config error:', error);
    return NextResponse.json(
      { error: 'Failed to get Splunk configuration', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/splunk/config
 * Save Splunk configuration for tenant
 */
export async function POST(request: NextRequest) {
  const tenantId = request.headers.get('x-tenant-id');
  const userId = request.headers.get('x-user-id');
  const userRole = request.headers.get('x-user-role');

  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (userRole !== 'admin') {
    return NextResponse.json({ error: 'Forbidden - admin only' }, { status: 403 });
  }

  try {
    const { url, hec_token, username, password, ssl_verify } = await request.json();

    if (!url || !hec_token) {
      return NextResponse.json(
        { error: 'URL and HEC token are required' },
        { status: 400 }
      );
    }

    const client = await getClient();

    // Update tenant with Splunk configuration
    await client.query(
      `UPDATE tenants
       SET splunk_url = $1,
           splunk_hec_token = $2,
           splunk_username = $3,
           splunk_password = $4,
           splunk_ssl_verify = $5,
           is_configured = true,
           updated_at = NOW()
       WHERE id = $6`,
      [url, hec_token, username || null, password || null, ssl_verify !== false, tenantId]
    );

    // Log this action
    await client.query(
      `SELECT log_tenant_action($1, $2, 'SPLUNK_CONFIG_UPDATED', 'tenants', $3, $4, $5)`,
      [
        tenantId,
        userId,
        tenantId,
        JSON.stringify({
          splunk_url: url,
          splunk_username: username || null,
        }),
        request.headers.get('x-forwarded-for') || null,
      ]
    );

    client.release();

    // Return updated status
    const statusClient = await getClient();
    const statusResult = await statusClient.query(
      `SELECT is_configured, splunk_test_status, splunk_test_error, last_splunk_test
       FROM tenants
       WHERE id = $1`,
      [tenantId]
    );
    statusClient.release();

    const tenant = statusResult.rows[0];
    return NextResponse.json({
      is_configured: tenant.is_configured,
      test_status: tenant.splunk_test_status || 'not_tested',
      test_error: tenant.splunk_test_error,
      last_test: tenant.last_splunk_test,
    });
  } catch (error) {
    console.error('Splunk config error:', error);
    return NextResponse.json(
      { error: 'Failed to save Splunk configuration', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/splunk/config
 * Clear Splunk configuration
 */
export async function DELETE(request: NextRequest) {
  const tenantId = request.headers.get('x-tenant-id');
  const userId = request.headers.get('x-user-id');
  const userRole = request.headers.get('x-user-role');

  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (userRole !== 'admin') {
    return NextResponse.json({ error: 'Forbidden - admin only' }, { status: 403 });
  }

  try {
    const client = await getClient();

    await client.query(
      `UPDATE tenants
       SET splunk_url = NULL,
           splunk_hec_token = NULL,
           splunk_username = NULL,
           splunk_password = NULL,
           is_configured = false,
           updated_at = NOW()
       WHERE id = $1`,
      [tenantId]
    );

    // Log this action
    await client.query(
      `SELECT log_tenant_action($1, $2, 'SPLUNK_CONFIG_DELETED', 'tenants', $3, NULL, $4)`,
      [tenantId, userId, tenantId, request.headers.get('x-forwarded-for') || null]
    );

    client.release();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete splunk config error:', error);
    return NextResponse.json(
      { error: 'Failed to delete Splunk configuration', details: (error as Error).message },
      { status: 500 }
    );
  }
}
