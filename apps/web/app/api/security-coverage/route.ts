import { NextResponse } from 'next/server';
import { query } from '@core/database/connection';

export async function GET() {
  try {
    const res = await query(`
      SELECT sourcetype, coverage_pct, active_alerts, detection_gaps
      FROM security_coverage
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM security_coverage)
      ORDER BY coverage_pct ASC, sourcetype
      LIMIT 100
    `);
    return NextResponse.json({ data: res.rows || [] });
  } catch {
    return NextResponse.json({ data: [] });
  }
}
