import { NextResponse } from 'next/server';

let query: any = null;
try {
  const conn = require('@core/database/connection');
  query = conn.query;
} catch {
  // Database module not available in web-only mode
}

export async function GET() {
  try {
    if (!query || !process.env.DATABASE_URL) {
      return NextResponse.json({
        mode: 'DEMO_MODE',
        error: 'Database not available',
        missingDependency: 'PostgreSQL',
        data: []
      }, { status: 503 });
    }

    const res = await query(`SELECT * FROM agent_decisions LIMIT 100`);
    return NextResponse.json({
      mode: 'FULL_STACK',
      data: res.rows || []
    });
  } catch (e) {
    return NextResponse.json({
      mode: 'DEMO_MODE',
      error: 'Database query failed',
      data: []
    }, { status: 503 });
  }
}
