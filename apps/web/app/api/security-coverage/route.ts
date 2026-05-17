import { NextResponse } from 'next/server';

// Stub implementation — security coverage requires database queries
// Available only in full-stack deployment with PostgreSQL
export async function GET() {
  return NextResponse.json(
    {
      error: 'Security coverage not available in this build. Ensure full stack deployment with PostgreSQL.',
      data: [],
    },
    { status: 503 }
  );
}
