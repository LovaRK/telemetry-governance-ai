import { NextRequest, NextResponse } from 'next/server';

// Stub implementation — telemetry requires database queries
// Available only in full-stack deployment with PostgreSQL
export async function GET(request: NextRequest) {
  return NextResponse.json(
    {
      error: 'Telemetry not available in this build. Ensure full stack deployment with PostgreSQL.',
      snapshots: [],
      kpis: [],
      count: 0,
    },
    { status: 503 }
  );
}
