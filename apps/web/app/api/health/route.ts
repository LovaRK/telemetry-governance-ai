import { NextResponse } from 'next/server';
import { startLlmHealthDaemon, llmHealthDaemonState } from '@/lib/llm-health-daemon';

/**
 * Public Health Check Endpoint
 *
 * Returns 200 OK if the server is running.
 * No authentication required - used by Docker health checks.
 */
export async function GET() {
  startLlmHealthDaemon();
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    llmDaemon: llmHealthDaemonState(),
  });
}
