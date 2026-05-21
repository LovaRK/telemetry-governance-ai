import { NextRequest, NextResponse } from 'next/server';
import { rotateRefreshToken } from '@/lib/auth';
import { initTraceFromRequest, withTraceContext } from '@core/guards/trace-context';

export async function POST(request: NextRequest) {
  const traceId = initTraceFromRequest(request);

  return await withTraceContext(traceId, async () => {
    const oldToken =
      request.cookies.get('refreshToken')?.value ||
      request.cookies.get('refresh_token')?.value;

    if (!oldToken) {
      return NextResponse.json(
        { error: 'No refresh token', meta: { source: 'system', mode: 'live', traceId } },
        { status: 401 }
      );
    }

    const result = await rotateRefreshToken(oldToken);
    if (!result) {
      return NextResponse.json(
        { error: 'Invalid or expired refresh token', meta: { source: 'system', mode: 'live', traceId } },
        { status: 401 }
      );
    }

    const response = NextResponse.json({
      data: {
        accessToken: result.accessToken,
        user: result.user,
        refreshToken: result.refreshToken,
      },
      meta: { source: 'system', mode: 'live', traceId },
    });

    // Keep SSE/auth cookies in sync on refresh.
    response.cookies.set('accessToken', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 900,
    });

    response.cookies.set('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 604800,
    });

    return response;
  });
}
