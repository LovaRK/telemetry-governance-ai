import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      mode: 'DEMO_MODE',
      error: 'Agent decisions not available in demo mode',
      missingDependency: 'PostgreSQL + Ollama',
      reason: 'Requires LLM inference and decision history storage.',
      data: [],
    },
    { status: 503 }
  );
}
