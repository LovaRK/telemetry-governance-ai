import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { rotateRefreshToken } from '@/lib/auth';

export const POST = createRoute(async (request: NextRequest) => {
  const oldToken = request.cookies.get('refresh_token')?.value;
  if (!oldToken) {
    throw new Error('No refresh token');
  }

  const result = await rotateRefreshToken(oldToken);
  if (!result) {
    throw new Error('Invalid or expired refresh token');
  }

  return {
    data: {
      accessToken: result.accessToken,
      user: result.user,
      refreshToken: result.refreshToken,  // Client will manage storage
    },
    meta: { source: 'system' },
  };
});
