import { NextResponse } from 'next/server';

// Stub implementation — executive summary requires database queries
// Available only in full-stack deployment with PostgreSQL
export async function GET() {
  return NextResponse.json(
    {
      error: 'Executive summary not available in this build. Ensure full stack deployment with PostgreSQL.',
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
