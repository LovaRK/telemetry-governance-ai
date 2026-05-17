import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  return NextResponse.json(
    {
      mode: 'DEMO_MODE',
      error: 'Decision history not available in demo mode',
      missingDependency: 'PostgreSQL',
      reason: 'Requires full-stack deployment with audit trail storage.',
    },
    { status: 503 }
  );
}
