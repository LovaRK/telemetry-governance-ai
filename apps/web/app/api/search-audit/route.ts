import { NextResponse } from 'next/server';
import { query } from '@core/database/connection';

export async function GET() {
  try {
    const res = await query(`
      SELECT search_name, search_type, app, schedule, is_scheduled, is_alert,
             last_run, confidence_score, reason, status, risk_level, is_unused
      FROM search_audit
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM search_audit)
      ORDER BY
        CASE risk_level WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
        confidence_score ASC,
        search_name
      LIMIT 200
    `);
    return NextResponse.json({ data: res.rows || [] });
  } catch {
    return NextResponse.json({ data: [] });
  }
}
