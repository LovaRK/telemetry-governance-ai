import { NextResponse } from 'next/server';

// Stub implementation — executive summary requires database queries
// Available only in full-stack deployment with PostgreSQL
export async function GET() {
  return NextResponse.json(
    {
      mode: 'DEMO_MODE',
      error: 'Executive summary not available in demo mode',
      missingDependency: 'PostgreSQL',
      reason: 'Full-stack deployment required. Use ./scripts/bootstrap.sh to start with Docker.',
      kpis: null,
      snapshots: [],
      decisions: [],
      staircase: [],
      quickWins: [],
      agentReasoning: '',
    },
    { status: 503 }
  );
}
