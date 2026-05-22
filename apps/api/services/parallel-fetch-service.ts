export type ParallelFetchStatus = 'fulfilled' | 'rejected';

export interface ParallelFetchItem {
  sourceType: string;
}

export interface ParallelFetchResult<T = unknown> {
  sourceType: string;
  durationMs: number;
  status: ParallelFetchStatus;
  payload?: T;
  error?: string;
}

export type SourceFetcher<T = unknown> = (sourceType: string) => Promise<T>;

/**
 * P8.1: Parallel source fetch abstraction.
 * Uses Promise.allSettled so one source failure does not fail the whole refresh batch.
 */
export async function fetchSourcesParallel<T = unknown>(
  sources: string[],
  fetcher: SourceFetcher<T>
): Promise<ParallelFetchResult<T>[]> {
  const timed = sources.map((sourceType) => {
    const started = Date.now();
    return fetcher(sourceType)
      .then((payload) => ({
        sourceType,
        durationMs: Date.now() - started,
        status: 'fulfilled' as const,
        payload,
      }))
      .catch((err: any) => ({
        sourceType,
        durationMs: Date.now() - started,
        status: 'rejected' as const,
        error: normalizeError(err),
      }));
  });

  // Preserve source order while isolating per-source failures.
  const settled = await Promise.allSettled(timed);
  return settled.map((s, idx) => {
    if (s.status === 'fulfilled') {
      return s.value;
    }
    return {
      sourceType: sources[idx],
      durationMs: 0,
      status: 'rejected' as const,
      error: normalizeError(s.reason),
    };
  });
}

function normalizeError(err: any): string {
  if (!err) return 'UNKNOWN_ERROR';
  if (typeof err === 'string') return err;
  if (err.message) return String(err.message);
  return 'UNKNOWN_ERROR';
}
