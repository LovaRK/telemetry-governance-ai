import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'login') {
    return handleLogin(request);
  } else if (action === 'logout') {
    return handleLogout(request);
  } else if (action === 'me') {
    return handleGetMe(request);
  } else if (action === 'change-password') {
    return handleChangePassword(request);
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

async function handleLogin(request: NextRequest) {
  try {
    const { email, password, tenant_slug } = await request.json();

    if (!email || !password || !tenant_slug) {
      return NextResponse.json(
        { error: 'Email, password, and tenant_slug are required' },
        { status: 400 }
      );
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
      return NextResponse.json(error, { status: response.status });
    }

    const session = await response.json();

    // Set httpOnly cookie with token
    const cookieResponse = NextResponse.json(
      {
        user_id: session.user_id,
        email: session.email,
        name: session.name,
        role: session.role,
        tenant_id: session.tenant_id,
      },
      { status: 200 }
    );

    cookieResponse.cookies.set('auth_token', session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return cookieResponse;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}

async function handleLogout(request: NextRequest) {
  try {
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

    const response = NextResponse.json({ success: true }, { status: 200 });
    response.cookies.delete('auth_token');
    return response;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 });
  }
}

async function handleGetMe(request: NextRequest) {
  try {
    const token = request.cookies.get('auth_token')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Call backend to verify session
    const response = await fetch(
      `${process.env.BACKEND_URL || 'http://localhost:3001'}/auth/me`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await response.json();
    return NextResponse.json(user, { status: 200 });
  } catch (error) {
    console.error('Get me error:', error);
    return NextResponse.json({ error: 'Failed to get user info' }, { status: 500 });
  }
}

async function handleChangePassword(request: NextRequest) {
  try {
    const token = request.cookies.get('auth_token')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { old_password, new_password } = await request.json();

    if (!old_password || !new_password) {
      return NextResponse.json(
        { error: 'Old password and new password are required' },
        { status: 400 }
      );
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
      return NextResponse.json(error, { status: response.status });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 });
  }
}
