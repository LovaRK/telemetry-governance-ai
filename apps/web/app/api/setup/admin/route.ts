import { NextRequest, NextResponse } from 'next/server';
import { getClient, pool } from '@core/database/connection';
import { AuthService } from '@api/services/auth-service';

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      error: 'Database or Auth Service not configured or available',
    }, { status: 503 });
  }

  const client = await getClient();
  const authService = new AuthService(pool);

  try {
    const { tenant_id, email, password, name } = await request.json();

    if (!tenant_id || !email || !password || !name) {
      return NextResponse.json({
        error: 'tenant_id, email, password, and name are required',
      }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({
        error: 'Password must be at least 8 characters',
      }, { status: 400 });
    }

    // Verify tenant exists
    const tenantCheck = await client.query(
      `SELECT id FROM tenants WHERE id = $1`,
      [tenant_id]
    );

    if (tenantCheck.rows.length === 0) {
      return NextResponse.json({
        error: 'Tenant not found',
      }, { status: 404 });
    }

    // Create admin user
    const user = await authService.createUser(tenant_id, email, password, name, 'admin');

    // Log this action
    await client.query(
      `
      SELECT log_tenant_action($1, $2, 'ADMIN_USER_CREATED', 'users', $3, $4, $5)
      `,
      [
        tenant_id,
        user.user_id,
        user.user_id,
        JSON.stringify({ email: user.email, role: 'admin' }),
        request.headers.get('x-forwarded-for') || null,
      ]
    );

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    console.error('Create admin error:', error);

    if ((error as any).code === '23505' || (error instanceof Error && error.message === 'User already exists')) {
      return NextResponse.json({
        error: 'User already exists',
      }, { status: 409 });
    }

    return NextResponse.json({
      error: 'Failed to create admin user',
      reason: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  } finally {
    client.release();
  }
}
