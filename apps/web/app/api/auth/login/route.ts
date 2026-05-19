import { NextRequest, NextResponse } from 'next/server';
import { validateCredentials, signAccessToken, createRefreshToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const result = await validateCredentials(email, password);
    if (!result) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const { user } = result;
    const payload = { sub: user.id, tenantId: user.tenant_id, email: user.email, role: user.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = await createRefreshToken(user.id);

    const response = NextResponse.json({
      accessToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenant_id },
    });

    response.cookies.set('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/api/auth/refresh',
    });

    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Login failed';
    const status = msg.includes('locked') ? 423 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
