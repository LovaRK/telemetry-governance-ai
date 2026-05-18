import { NextResponse } from 'next/server';

let transaction: any = null;
let calculateModelTrustScore: any = null;

try {
  const conn = require('@core/database/connection');
  transaction = conn.transaction;
  try {
    const service = require('@api/services/trust-decay-service');
    calculateModelTrustScore = service.calculateModelTrustScore;
  } catch {
    // Trust decay service not available (dependencies like mathjs not in web-only build)
  }
} catch {
  // Database module not available in web-only mode
}

export async function GET() {
  try {
    if (!transaction || !process.env.DATABASE_URL) {
      return NextResponse.json({
        mode: 'DEMO_MODE',
        error: 'Database not available',
        missingDependency: 'PostgreSQL'
      }, { status: 503 });
    }

    const snapshotDate = new Date().toISOString().split('T')[0];

    let data = null;

    await transaction(async (client: any) => {
      data = await calculateModelTrustScore(client, snapshotDate);
    });

    return NextResponse.json({
      mode: 'FULL_STACK',
      data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[API] Model health error:', message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
