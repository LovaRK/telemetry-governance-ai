import { NextResponse } from 'next/server';

// Stub implementation — security coverage requires database queries
// Available only in full-stack deployment with PostgreSQL
export async function GET() {
  return NextResponse.json(
    {
      mode: 'DEMO_MODE',
      error: 'Security coverage not available in demo mode',
      missingDependency: 'PostgreSQL + Splunk',
      reason: 'Requires full-stack deployment with Splunk queries.',
      data: [],
    },
    { status: 503 }
  );
}
