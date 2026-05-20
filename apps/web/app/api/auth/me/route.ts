import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { verifyAccessToken, extractBearerToken } from '@/lib/auth';

export const GET = createRoute(async (request: NextRequest) => {
  const token = extractBearerToken(request.headers.get('authorization'));
  if (!token) throw new Error('Unauthorized');

  const payload = verifyAccessToken(token);
  return {
    data: { user: payload },
    meta: { source: 'system' },
  };
});
