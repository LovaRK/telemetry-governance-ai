import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  return NextResponse.json(
    {
      mode: 'DEMO_MODE',
      error: 'Telemetry not available in demo mode',
      missingDependency: 'PostgreSQL + Splunk + Ollama',
      reason: 'Requires full data pipeline: Splunk queries, LLM decisions, database storage.',
      snapshots: [],
      kpis: [],
      count: 0,
    },
    { status: 503 }
  );
}
