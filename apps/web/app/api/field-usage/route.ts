import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      mode: 'DEMO_MODE',
      error: 'Field usage not available in demo mode',
      missingDependency: 'PostgreSQL + Splunk',
      reason: 'Requires Splunk tstats queries and database storage.',
      data: [],
    },
    { status: 503 }
  );
}
