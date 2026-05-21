#!/usr/bin/env node
/**
 * Initialize default admin user and tenant
 * Runs after migrations to ensure database schema exists
 * Only creates initial user if none exist (idempotent)
 */

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5432/telemetry_os',
});

const DEFAULT_TENANT = {
  name: 'Default Organization',
  slug: 'default',
};

const DEFAULT_ADMIN = {
  email: process.env.ADMIN_EMAIL || 'admin@bitso.com',
  password: process.env.ADMIN_PASSWORD || 'Admin@12345',
  name: 'Admin User',
};

async function initAdmin() {
  let retries = 0;
  const maxRetries = 5;
  let lastError;

  while (retries < maxRetries) {
    try {
      const client = await pool.connect();
      await runInit(client);
      return;
    } catch (error) {
      lastError = error;
      retries++;
      if (retries < maxRetries) {
        const delay = retries * 1000;
        console.log(`[Admin Init] Connection failed, retrying in ${delay}ms... (${retries}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  console.error(`[Admin Init] Failed after ${maxRetries} retries:`, lastError);
  process.exit(1);
}

async function runInit(client) {
  try {
    console.log('[Admin Init] Starting initialization...');

    // Check if any tenants exist
    const tenantCheck = await client.query('SELECT COUNT(*) as count FROM tenants');
    const tenantCount = parseInt(tenantCheck.rows[0].count);

    if (tenantCount > 0) {
      console.log('[Admin Init] ✓ Tenants already exist, skipping initialization');
      client.release();
      return;
    }

    console.log('[Admin Init] Creating default tenant and admin user...');

    // Start transaction
    await client.query('BEGIN');

    try {
      // 1. Create default tenant
      const tenantResult = await client.query(
        `INSERT INTO tenants (name, slug, tenant_status)
         VALUES ($1, $2, 'active')
         ON CONFLICT (slug) DO UPDATE SET tenant_status = 'active'
         RETURNING id`,
        [DEFAULT_TENANT.name, DEFAULT_TENANT.slug]
      );

      const tenantId = tenantResult.rows[0].id;
      console.log(`[Admin Init] Created tenant: ${tenantId}`);

      // 2. Create default tenant config
      await client.query(
        `INSERT INTO tenant_config (tenant_id)
         VALUES ($1)
         ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId]
      );
      console.log('[Admin Init] Created tenant config');

      // 3. Hash password
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(DEFAULT_ADMIN.password, saltRounds);

      // 4. Create admin user
      const userResult = await client.query(
        `INSERT INTO users (tenant_id, email, name, password_hash, role, auth_provider)
         VALUES ($1, $2, $3, $4, 'admin', 'local')
         ON CONFLICT (tenant_id, email) DO NOTHING
         RETURNING id, email`,
        [tenantId, DEFAULT_ADMIN.email, DEFAULT_ADMIN.name, passwordHash]
      );

      if (userResult.rows.length > 0) {
        const user = userResult.rows[0];
        console.log(`[Admin Init] Created admin user: ${user.email} (${user.id})`);
      } else {
        console.log(`[Admin Init] Admin user already exists: ${DEFAULT_ADMIN.email}`);
      }

      // Commit transaction
      await client.query('COMMIT');
      console.log('[Admin Init] ✓ Initialization complete');
      console.log('[Admin Init] Login with:');
      console.log(`  Email: ${DEFAULT_ADMIN.email}`);
      console.log(`  Password: ${DEFAULT_ADMIN.password}`);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    throw error;
  }
}

initAdmin().finally(async () => {
  await pool.end();
});
