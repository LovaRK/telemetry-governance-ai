import { NextResponse } from 'next/server';
import { query } from '@core/database/connection';

export async function GET() {
  try {
    const res = await query(`SELECT * FROM agent_decisions LIMIT 100`);
    return NextResponse.json({ data: res.rows || [] });
  } catch (e) {
    return NextResponse.json({ data: [] });
  }
}
