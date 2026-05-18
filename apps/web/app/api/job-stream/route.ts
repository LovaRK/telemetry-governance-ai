import { NextRequest } from 'next/server';
import { getJobStatus, getLatestJob } from '@api/services/job-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
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
            send({ status: 'not_found', message: 'No job found' });
            controller.close();
            return;
          }

          send({
            status: job.status,
            progress: job.progress,
            snapshotId: job.snapshotId,
            errorMessage: job.errorMessage,
          });

          if (job.status === 'complete' || job.status === 'failed') {
            controller.close();
            return;
          }

          setTimeout(poll, 3000);
        } catch (err) {
          send({ status: 'error', message: err instanceof Error ? err.message : 'Poll error' });
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
}
