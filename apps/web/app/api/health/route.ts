import { NextResponse } from 'next/server';

/**
 * Public Health Check Endpoint
 *
 * Returns 200 OK if the server is running.
 * No authentication required - used by Docker health checks.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}

