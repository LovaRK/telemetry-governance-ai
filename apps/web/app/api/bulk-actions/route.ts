import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  return NextResponse.json(
    {
      mode: 'DEMO_MODE',
      error: 'Bulk actions not available in demo mode',
      missingDependency: 'PostgreSQL',
      reason: 'Requires full-stack deployment with transaction support.',
    },
    { status: 503 }
  );
}
