import { NextRequest, NextResponse } from 'next/server';

// Stub implementation — health check requires database connectivity
// Available only in full-stack deployment with PostgreSQL
export async function GET(request: NextRequest) {
  return NextResponse.json(
    {
      mode: 'DEMO_MODE',
      status: 'unavailable',
      timestamp: new Date().toISOString(),
      error: 'Health check not available in demo mode',
      missingDependency: 'PostgreSQL + Ollama',
      reason: 'Health checks require database and LLM connectivity. Use ./scripts/bootstrap.sh to start with Docker.',
      message: 'Database and LLM connectivity checks unavailable in demo mode',
    },
    { status: 503 }
  );
}
