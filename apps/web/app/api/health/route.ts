import { NextRequest, NextResponse } from 'next/server';

// Stub implementation — health check requires database connectivity
// Available only in full-stack deployment with PostgreSQL
export async function GET(request: NextRequest) {
  return NextResponse.json(
    {
      status: 'unavailable',
      timestamp: new Date().toISOString(),
      error: 'Health check not available in this build. Ensure full stack deployment with PostgreSQL.',
      message: 'Database connectivity checks unavailable',
    },
    { status: 503 }
  );
}
