import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      mode: 'DEMO_MODE',
      error: 'Quality hotspots not available in demo mode',
      missingDependency: 'PostgreSQL + Splunk',
      reason: 'Requires Splunk parse error queries and database storage.',
      data: [],
    },
    { status: 503 }
  );
}
