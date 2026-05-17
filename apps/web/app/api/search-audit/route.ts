import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      mode: 'DEMO_MODE',
      error: 'Search audit not available in demo mode',
      missingDependency: 'PostgreSQL + Splunk',
      reason: 'Requires Splunk saved search analysis and database storage.',
      data: [],
    },
    { status: 503 }
  );
}
