/**
 * Contract Test Setup
 *
 * Ensures the test admin user exists in the database before running tests.
 * This is called once before all contract tests via Jest setupFilesAfterEnv.
 */

import { query } from '../../core/database/connection';
import bcrypt from 'bcryptjs';
// Note: RequestContext not imported here; setup only creates DB records for test user

const TEST_USER_EMAIL = 'admin@bitso.com';
const TEST_USER_PASSWORD = 'Admin@12345';
const TEST_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

async function ensureTestAdminUserExists() {
  try {
    // Check if test tenant exists
    const tenantResult = await query(
      `SELECT id FROM tenants WHERE id = $1`,
      [TEST_TENANT_ID]
    );

    if (tenantResult.rows.length === 0) {
      console.log('[Contract Setup] Creating test tenant...');
      await query(
        `INSERT INTO tenants (id, name, slug, tenant_status, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [TEST_TENANT_ID, 'Test Tenant', 'test-tenant', 'active']
      );
    }

    // Check if test user exists
    const userResult = await query(
      `SELECT id FROM users WHERE email = $1`,
      [TEST_USER_EMAIL]
    );

    if (userResult.rows.length === 0) {
      console.log('[Contract Setup] Creating test admin user...');
      const passwordHash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
      await query(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active, login_attempts, is_locked, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          'test-admin-user',
          TEST_TENANT_ID,
          TEST_USER_EMAIL,
          passwordHash,
          'Test Admin',
          'admin',
          true,
          0,
          false,
        ]
      );
      console.log('[Contract Setup] ✓ Test admin user created');
    } else {
      console.log('[Contract Setup] ✓ Test admin user exists');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      console.warn('[Contract Setup] ⚠ Database not available - contract tests will fail on loginAndGetToken()');
      console.warn('  To fix: Start PostgreSQL (docker-compose up) before running tests');
    } else {
      console.error('[Contract Setup] Failed to set up test data:', error instanceof Error ? error.message : error);
    }
    // Don't throw - let tests run anyway and fail naturally
  }
}

// Run setup once when this file is loaded
ensureTestAdminUserExists().catch(console.error);
