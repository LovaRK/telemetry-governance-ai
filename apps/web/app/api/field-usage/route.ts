import { NextResponse } from 'next/server';

// Stub implementation — field usage requires database queries
// Available only in full-stack deployment with PostgreSQL
export async function GET() {
  return NextResponse.json(
    {
      error: 'Field usage not available in this build. Ensure full stack deployment with PostgreSQL.',
      data: [],
    },
    { status: 503 }
  );
}
