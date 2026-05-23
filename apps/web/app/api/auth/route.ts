import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { verifyTokenEdge, extractBearerToken } from '@packages/auth/auth-edge';

export const GET = createRoute(async (request: NextRequest) => {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'me') {
    return await handleGetMe(request);
  }

  throw new Error('Invalid action');
});

export const POST = createRoute(async (request: NextRequest) => {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'login') {
    return await handleLogin(request);
  } else if (action === 'logout') {
    return await handleLogout(request);
  } else if (action === 'me') {
    return await handleGetMe(request);
  } else if (action === 'change-password') {
    return await handleChangePassword(request);
  }

  throw new Error('Invalid action');
});

async function handleLogin(request: NextRequest) {
  const { email, password, tenant_slug } = await request.json();

  if (!email || !password || !tenant_slug) {
    throw new Error('Email, password, and tenant_slug are required');
  }

  // Call backend API
  const response = await fetch(`${process.env.BACKEND_URL || 'http://localhost:3001'}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': request.headers.get('x-forwarded-for') || 'unknown',
    },
    body: JSON.stringify({ email, password, tenant_slug }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Login failed');
  }

  const session = await response.json();

  return {
    data: {
      user_id: session.user_id,
      email: session.email,
      name: session.name,
      role: session.role,
      tenant_id: session.tenant_id,
      token: session.token,
    },
    meta: { source: 'system' },
  };
}

async function handleLogout(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;

  if (token) {
    // Call backend to revoke session
    await fetch(
      `${process.env.BACKEND_URL || 'http://localhost:3001'}/auth/logout`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }
    ).catch(() => {
      // Ignore errors, still logout locally
    });
  }

  return {
    data: { success: true },
    meta: { source: 'system' },
  };
}

async function handleGetMe(request: NextRequest) {
  // Try cookie first (for browser-side fetches via useAuth hook), then Authorization header
  const token =
    request.cookies.get('accessToken')?.value ??
    extractBearerToken(request.headers.get('authorization'));

  if (!token) {
    throw new Error('Not authenticated');
  }

  let payload;
  try {
    payload = await verifyTokenEdge(token);
  } catch {
    throw new Error('Token expired or invalid');
  }

  return {
    data: {
      user_id: payload.sub,
      email: payload.email,
      role: payload.role,
      tenant_id: payload.tenantId,
      name: null,
    },
    meta: { source: 'jwt' },
  };
}

async function handleChangePassword(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;

  if (!token) {
    throw new Error('Not authenticated');
  }

  const { old_password, new_password } = await request.json();

  if (!old_password || !new_password) {
    throw new Error('Old password and new password are required');
  }

  const response = await fetch(
    `${process.env.BACKEND_URL || 'http://localhost:3001'}/auth/change-password`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ old_password, new_password }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to change password');
  }

  return {
    data: { success: true },
    meta: { source: 'system' },
  };
}
