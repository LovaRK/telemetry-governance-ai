import { NextRequest } from 'next/server';
import { POST as cacheRefreshPost } from '@/app/api/cache/route';

/**
 * Canonical pipeline refresh entrypoint.
 * Delegates to existing refresh orchestration while we migrate callers.
 */
export async function POST(request: NextRequest) {
  return cacheRefreshPost(request);
}

