import { NextRequest, NextResponse } from 'next/server';
import { query } from '@core/database/connection';

export async function GET(request: NextRequest) {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({
        is_set_up: false,
        tenant_count: 0,
        mode: 'DEMO_MODE',
      }, { status: 200 });
    }

    const result = await query(`SELECT COUNT(*) as count FROM tenants`);
    const tenantCount = parseInt(result.rows[0].count, 10);

    return NextResponse.json({
      is_set_up: tenantCount > 0,
      tenant_count: tenantCount,
      mode: 'FULL_STACK',
    }, { status: 200 });
  } catch (error) {
    console.error('Setup status error:', error);
    return NextResponse.json({
      error: 'Failed to get setup status',
      reason: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
