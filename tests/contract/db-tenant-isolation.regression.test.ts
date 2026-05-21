/**
 * Regression Tests: DB Tenant Isolation — set_config() enforcement
 *
 * BUG: "syntax error at or near '$1'"
 * Root cause: PostgreSQL SET does not accept parameterized values.
 *   BROKEN:  SET app.current_tenant = $1
 *   FIXED:   SELECT set_config('app.current_tenant', $1, true)
 *
 * These tests catch a regression at two levels:
 *   1. Unit: setTenantContext() actually writes the tenant value via set_config
 *   2. Integration: API calls that trigger tenant-scoped queries return 200, not 500
 */

import { loginAndGetToken, authGet, BASE_URL, TEST_TENANT_ID } from './_helpers';

// ---------------------------------------------------------------------------
// Unit: verify setTenantContext() uses set_config, not SET (static assertion)
// ---------------------------------------------------------------------------
describe('Regression: setTenantContext must use set_config() not SET', () => {
  test('connection.ts source must not contain "SET app.current_tenant"', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../core/database/connection.ts'),
      'utf8'
    );
    // Exact pattern: "SET app.current_tenant =" (with =) — precise enough to
    // avoid matching comments while still catching any reversion to the broken approach.
    expect(src).not.toMatch(/SET app\.current_tenant\s*=/);
    expect(src).not.toMatch(/SET LOCAL app\.current_tenant\s*=/);
    // The correct pattern must be present
    expect(src).toContain('set_config');
    expect(src).toContain("'app.current_tenant'");
  });
});

// ---------------------------------------------------------------------------
// Integration: API calls that hit setTenantContext() must not return 500
// A 500 with "syntax error at or near '$1'" is the signature of the regression.
// ---------------------------------------------------------------------------
describe('Regression: tenant-scoped API calls succeed (no DB SET syntax crash)', () => {
  let token: string;

  beforeAll(async () => {
    token = await loginAndGetToken();
  });

  test('GET /api/cache-status with valid tenant UUID → not 500', async () => {
    const res = await authGet('/api/cache-status', token, TEST_TENANT_ID);
    expect(res.status).not.toBe(500);
    expect([200, 204]).toContain(res.status);
  });

  test('GET /api/executive-summary with valid tenant UUID → not 500', async () => {
    const res = await authGet('/api/executive-summary', token, TEST_TENANT_ID);
    // 200 = data found, 503 = governance config missing — both valid non-crash states
    expect(res.status).not.toBe(500);
    expect([200, 503]).toContain(res.status);
  });

  test('GET /api/agent-decisions with valid tenant UUID → not 500', async () => {
    const res = await authGet('/api/agent-decisions', token, TEST_TENANT_ID);
    expect(res.status).not.toBe(500);
    expect([200, 404]).toContain(res.status);
  });

  // Security: UUID validation in requireContext fires BEFORE setTenantContext.
  // A SQL-injection-like tenant ID must be rejected at the auth layer (401),
  // never reaching the DB (which would be 500 if set_config was bypassed).
  test('malformed x-tenant-id → 401 at auth layer, never reaches DB', async () => {
    const res = await fetch(`${BASE_URL}/api/cache-status`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-tenant-id': "'; DROP TABLE tenants; --",
        'x-user-id': 'test-user',
        'x-user-role': 'admin',
      },
    });
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(500);
  });
});
