import { NextResponse } from 'next/server';

// Stub implementation — agent decisions requires database queries
// Available only in full-stack deployment with PostgreSQL
export async function GET() {
  return NextResponse.json(
    {
      error: 'Agent decisions not available in this build. Ensure full stack deployment with PostgreSQL.',
      data: [],
    },
    { status: 503 }
  );
}
