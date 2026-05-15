import { NextResponse } from 'next/server';
import { query } from '@core/database/connection';

export async function GET() {
  try {
    // Check if any data exists in the system
    const countResult = await query(`
      SELECT COUNT(*) as total FROM telemetry_snapshots
    `);

    const hasData = parseInt(countResult.rows[0]?.total || '0', 10) > 0;

    // Get latest refresh info
    let lastRefresh = null;
    let refreshStatus = 'empty';

    if (hasData) {
      const latestResult = await query(`
        SELECT MAX(snapshot_date) as latest_date FROM telemetry_snapshots
      `);
      lastRefresh = latestResult.rows[0]?.latest_date;
      refreshStatus = 'fresh';
    } else {
      const errorResult = await query(`
        SELECT error_message FROM refresh_jobs
        WHERE status = 'failed'
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (errorResult.rows.length > 0) {
        refreshStatus = 'failed';
      }
    }

    return NextResponse.json({
      has_data: hasData,
      status: refreshStatus, // 'fresh' | 'failed' | 'empty'
      last_refresh: lastRefresh,
      record_count: parseInt(countResult.rows[0]?.total || '0', 10),
      message: !hasData ? 'No data available. Run refresh from Splunk first.' : 'Dashboard data is ready.'
    });
  } catch (error) {
    return NextResponse.json(
      {
        has_data: false,
        status: 'error',
        message: error instanceof Error ? error.message : 'Cache status check failed'
      },
      { status: 500 }
    );
  }
}
