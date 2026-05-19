import { NextRequest, NextResponse } from 'next/server';
import { rotateRefreshToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const oldToken = request.cookies.get('refresh_token')?.value;
    if (!oldToken) {
      return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
    }

    const result = await rotateRefreshToken(oldToken);
    if (!result) {
      return NextResponse.json({ error: 'Invalid or expired refresh token' }, { status: 401 });
    }

    const response = NextResponse.json({ accessToken: result.accessToken, user: result.user });

    response.cookies.set('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/api/auth/refresh',
    });

    return response;
  } catch {
    return NextResponse.json({ error: 'Token refresh failed' }, { status: 500 });
  }
}
