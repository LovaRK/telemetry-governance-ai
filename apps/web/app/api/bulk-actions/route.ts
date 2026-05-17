import { NextRequest, NextResponse } from 'next/server';

// Stub implementation — bulk actions require database access
// Available only in full-stack deployment
export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: 'Bulk actions not available in this build. Ensure full stack deployment.' },
    { status: 503 }
  );
}
