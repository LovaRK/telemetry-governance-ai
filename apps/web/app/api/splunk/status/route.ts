import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '@core/database/connection';

/**
 * GET /api/splunk/status
 * Get Splunk configuration status for tenant
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
      `SELECT is_configured, splunk_test_status as test_status, splunk_test_error as test_error, last_splunk_test as last_test
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
      is_configured: tenant.is_configured,
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
