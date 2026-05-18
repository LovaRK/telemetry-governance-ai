import { NextResponse } from 'next/server';
import { query } from '@core/database/connection';

export async function GET() {
  try {
    const res = await query(`
      SELECT sourcetype, fields_indexed, fields_used, optimization_pct
      FROM field_usage
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM field_usage)
      ORDER BY optimization_pct ASC, sourcetype
      LIMIT 100
    `);
    return NextResponse.json({ data: res.rows || [] });
  } catch {
    return NextResponse.json({ data: [] });
  }
}
