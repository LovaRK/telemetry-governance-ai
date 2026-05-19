import { NextRequest, NextResponse } from 'next/server';
import { revokeRefreshToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('refresh_token')?.value;
    if (token) await revokeRefreshToken(token);

    const response = NextResponse.json({ success: true });
    response.cookies.delete('refresh_token');
    return response;
  } catch {
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 });
  }
}
