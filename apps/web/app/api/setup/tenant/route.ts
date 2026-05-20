import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '@core/database/connection';

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      error: 'Database not configured or available',
    }, { status: 503 });
  }

  const client = await getClient();

  try {
    const { name, slug } = await request.json();

    if (!name || !slug) {
      return NextResponse.json({
        error: 'Name and slug are required',
      }, { status: 400 });
    }

    // Validate slug format (lowercase alphanumeric and hyphens)
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json({
        error: 'Slug must contain only lowercase letters, numbers, and hyphens',
      }, { status: 400 });
    }

    // Check if slug already exists
    const existingTenant = await client.query(
      `SELECT id FROM tenants WHERE slug = $1`,
      [slug]
    );

    if (existingTenant.rows.length > 0) {
      return NextResponse.json({
        error: 'Organization slug already exists',
      }, { status: 409 });
    }

    // Create tenant
    const result = await client.query(
      `
      INSERT INTO tenants (name, slug, tenant_status)
      VALUES ($1, $2, 'active')
      RETURNING id, name, slug
      `,
      [name, slug]
    );

    const tenant = result.rows[0];

    // Create default tenant configuration
    await client.query(
      `
      INSERT INTO tenant_config (tenant_id)
      VALUES ($1)
      `,
      [tenant.id]
    );

    return NextResponse.json(tenant, { status: 201 });
  } catch (error) {
    console.error('Create tenant error:', error);
    return NextResponse.json({
      error: 'Failed to create tenant',
      reason: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  } finally {
    client.release();
  }
}
