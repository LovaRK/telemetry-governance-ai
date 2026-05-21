import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { revokeRefreshToken } from '@packages/auth/auth';

export const POST = createRoute(async (request: NextRequest) => {
  const token = request.cookies.get('refresh_token')?.value;
  if (token) await revokeRefreshToken(token);

  return {
    data: { success: true },
    meta: { source: 'system' },
  };
});
