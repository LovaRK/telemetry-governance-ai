import { NextRequest, NextResponse } from 'next/server';
import { validateCredentials, signAccessToken, createRefreshToken } from '@/lib/auth';
import { initTraceFromRequest, withTraceContext, getTraceId } from '@core/guards/trace-context';

export async function POST(request: NextRequest) {
  const traceId = initTraceFromRequest(request);

  return await withTraceContext(traceId, async () => {
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
      const refreshToken = await createRefreshToken(user.id, user.tenant_id);

      // Create response with tokens
      const response = NextResponse.json({
        data: {
          accessToken,
          user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenant_id },
          refreshToken,
        },
        meta: { source: 'system', mode: 'live', traceId },
      });

      // Set accessToken as httpOnly cookie for EventSource/SSE requests
      // (EventSource doesn't support Authorization headers, only cookies)
      response.cookies.set('accessToken', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Only secure in production
        sameSite: 'lax',
        maxAge: 900, // 15 minutes (same as JWT expiry)
      });

      // Set refreshToken as separate cookie
      response.cookies.set('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 604800, // 7 days
      });

      return response;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Login failed';
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }
  });
}
