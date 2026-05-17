import { NextRequest, NextResponse } from 'next/server';

// Stub implementation — decision history requires database access
// Available only in full-stack deployment
export async function GET(request: NextRequest) {
  return NextResponse.json(
    { error: 'Decision history not available in this build. Ensure full stack deployment.' },
    { status: 503 }
  );
}
