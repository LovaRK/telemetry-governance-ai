import { NextRequest, NextResponse } from 'next/server';
import { createStreamRoute } from '@/lib/stream-route-factory';
import { createRoute } from '@/lib/api-route-factory';
import { getTraceId } from '@core/guards/trace-context';
import { requireContext } from '@/lib/auth-context';
import { getJobStatus, getLatestJob, enqueueJob } from '@api/services/job-service';

export const dynamic = 'force-dynamic';

// L3 Compliance: Uses createStreamRoute for trace context injection via AsyncLocalStorage
export const GET = createStreamRoute(async (request: NextRequest) => {
  // Require authentication: fail-closed if missing tenant context
  const ctxOrError = await requireContext(request);
  if (ctxOrError instanceof NextResponse) {
    return ctxOrError;
  }
  const context = ctxOrError;

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const poll = async () => {
        try {
          const job = jobId
            ? await getJobStatus(jobId)
            : await getLatestJob();

          if (!job) {
            send({
              status: 'not_found',
              message: 'No job found',
              source: 'system',
              mode: 'live',
              traceId: getTraceId(),
            });
            controller.close();
            return;
          }

          send({
            status: job.status,
            progress: job.progress,
            snapshotId: job.snapshotId,
            errorMessage: job.errorMessage,
            source: 'system',
            mode: 'live',
            traceId: getTraceId(),
          });

          if (job.status === 'complete' || job.status === 'failed') {
            controller.close();
            return;
          }

          setTimeout(poll, 3000);
        } catch (err) {
          send({
            status: 'error',
            message: err instanceof Error ? err.message : 'Poll error',
            source: 'system',
            mode: 'live',
            traceId: getTraceId(),
          });
          controller.close();
        }
      };

      poll();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

export const POST = createRoute(async (request: Request) => {
  try {
    const body = await request.json();
    const { source = 'splunk', mode = 'live' } = body;

    if (!process.env.DATABASE_URL) {
      throw new Error('Database not available');
    }

    console.log('[POST /api/job-stream] Enqueuing job with source:', source);
    const runId = await enqueueJob({
      jobType: 'pipeline_run',
      payload: { source, mode, triggeredAt: new Date().toISOString() },
    });
    console.log('[POST /api/job-stream] Job enqueued:', runId);

    return {
      data: { runId },
      meta: { source: 'system' },
    };
  } catch (err) {
    console.error('[POST /api/job-stream] Error:', err instanceof Error ? err.message : err);
    throw err;
  }
});
