import { NextResponse } from 'next/server';

// Stub implementation — cache status requires database queries
// Available only in full-stack deployment with PostgreSQL
export async function GET() {
  return NextResponse.json({
    hasEverRefreshed: false,
    hasData: false,
    hasAgentDecisions: false,
    status: 'unavailable',
    lastRefreshAt: null,
    nextRefreshAt: null,
    recordCount: 0,
    message: 'Cache status check requires full stack deployment with PostgreSQL.',
  });
}
