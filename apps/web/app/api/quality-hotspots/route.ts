import { NextResponse } from 'next/server';
import { query } from '@core/database/connection';

export async function GET() {
  try {
    const res = await query(`
      SELECT sourcetype, issue_count, quality_score, estimated_impact
      FROM quality_hotspots
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM quality_hotspots)
      ORDER BY quality_score ASC, issue_count DESC
      LIMIT 100
    `);
    return NextResponse.json({ data: res.rows || [] });
  } catch {
    return NextResponse.json({ data: [] });
  }
}
