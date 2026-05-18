import { NextResponse } from 'next/server';

let getTrustInspectionPayload: any = null;
try {
  const module = require('@api/services/trust-inspection-service');
  getTrustInspectionPayload = module.getTrustInspectionPayload;
} catch {
  // Trust inspection service not available
}

export async function GET(request: Request) {
  const indexName = new URL(request.url).searchParams.get('indexName');

  if (!indexName) {
    return NextResponse.json(
      { error: 'Missing required parameter: indexName' },
      { status: 400 }
    );
  }

  try {
    // Check if service is available
    if (!getTrustInspectionPayload || !process.env.DATABASE_URL) {
      return NextResponse.json(
        {
          mode: 'DEMO_MODE',
          error: 'Trust inspection not available',
          missingDependency: 'PostgreSQL',
          reason: 'Run in full-stack mode with DATABASE_URL set',
        },
        { status: 503 }
      );
    }

    const payload = await getTrustInspectionPayload(indexName);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Trust Inspection] Error for ${indexName}:`, message);

    // Check if index not found vs other errors
    if (message.includes('No decision found')) {
      return NextResponse.json(
        { error: 'Index not found', details: message },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch trust inspection data', details: message },
      { status: 500 }
    );
  }
}
