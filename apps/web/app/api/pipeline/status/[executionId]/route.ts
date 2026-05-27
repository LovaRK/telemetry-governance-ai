import { NextRequest } from 'next/server';
import { GET as getRunById } from '@/app/api/pipeline-runs/[runId]/route';

/**
 * Canonical pipeline status endpoint by execution_id.
 * execution_id is mapped to existing run_id.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ executionId: string }> }
) {
  const { executionId } = await context.params;
  return getRunById(request, { params: Promise.resolve({ runId: executionId }) });
}

