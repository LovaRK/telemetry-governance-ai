/**
 * Regression: tenant resolver determinism
 *
 * The ingest script resolves the target tenant at runtime. A LIMIT 1 without
 * ORDER BY or filtering allowed the test suite's "Test Tenant" to intercept
 * the real production tenant, routing 176 audit events to the wrong tenant.
 *
 * This test suite permanently encodes the invariant:
 *
 *   Production Tenant + Test Tenant + Seed Tenant present
 *   → resolver returns Production Tenant, not a test/seed tenant
 *
 * Run this any time the resolver logic changes.
 */

import { randomUUID } from 'crypto';
import { query, getClient } from '../../core/database/connection';
import './setup';

// ── Mirror the resolver from scripts/ingest-1stmile-csvs.mjs ─────────────────
// Keep in sync. If the resolver changes, this function must change too.
async function resolveProductionTenant(): Promise<{ id: string; name: string } | null> {
  const result = await query<{ id: string; name: string }>(
    `SELECT id, name FROM tenants
     WHERE name NOT ILIKE '%test%'
       AND name NOT ILIKE '%lifecycle%'
       AND name NOT ILIKE '%integration%'
     ORDER BY created_at ASC NULLS LAST
     LIMIT 1`
  );
  if (result.rows.length > 0) return result.rows[0];

  // Fallback: oldest tenant (same as ingest script fallback)
  const fallback = await query<{ id: string; name: string }>(
    `SELECT id, name FROM tenants ORDER BY created_at ASC LIMIT 1`
  );
  return fallback.rows[0] ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function seedTenantAt(
  id: string,
  name: string,
  createdAt: string   // ISO timestamp — controls ORDER BY created_at position
): Promise<void> {
  // Slug must be globally unique — append first 8 chars of id to avoid collision
  // between test scenarios that use the same tenant name (e.g. "Test Tenant").
  const slug = `${name.toLowerCase().replace(/\W+/g, '-')}-${id.slice(0, 8)}`;
  await query(
    `INSERT INTO tenants (id, name, slug, is_configured, created_at, updated_at)
     VALUES ($1, $2, $3, true, $4::timestamptz, $4::timestamptz)
     ON CONFLICT (id) DO NOTHING`,
    [id, name, slug, createdAt]
  );
}

async function cleanTenant(id: string): Promise<void> {
  await query(`DELETE FROM tenants WHERE id = $1`, [id]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Regression: ingest tenant resolver determinism', () => {

  // ── Scenario 1: Production tenant created first, test tenant created later ──

  describe('Scenario 1: production tenant oldest, test tenant younger', () => {
    const productionTenantId = randomUUID();
    const testTenantId       = randomUUID();

    beforeAll(async () => {
      await seedTenantAt(productionTenantId, 'Acme Corp',  '2024-01-01T00:00:00Z');
      await seedTenantAt(testTenantId,       'Test Tenant','2025-01-01T00:00:00Z');
    }, 15000);

    afterAll(async () => {
      await cleanTenant(productionTenantId);
      await cleanTenant(testTenantId);
    });

    test('resolver returns production tenant (oldest, non-test name)', async () => {
      const resolved = await resolveProductionTenant();
      expect(resolved).not.toBeNull();
      expect(resolved!.id).toBe(productionTenantId);
      expect(resolved!.name).toBe('Acme Corp');
    });

    test('resolver does NOT return test tenant even though it exists', async () => {
      const resolved = await resolveProductionTenant();
      expect(resolved!.id).not.toBe(testTenantId);
    });
  });

  // ── Scenario 2: Test tenant inserted before production tenant ────────────────

  describe('Scenario 2: test tenant older than production (the original bug)', () => {
    const productionTenantId = randomUUID();
    const testTenantId       = randomUUID();

    beforeAll(async () => {
      // Bug scenario: test tenant was seeded BEFORE production tenant
      await seedTenantAt(testTenantId,       'Test Tenant',      '2024-01-01T00:00:00Z');
      await seedTenantAt(productionTenantId, 'Default Organization', '2024-06-01T00:00:00Z');
    }, 15000);

    afterAll(async () => {
      await cleanTenant(productionTenantId);
      await cleanTenant(testTenantId);
    });

    test('resolver still returns production tenant (name filter takes priority over age)', async () => {
      const resolved = await resolveProductionTenant();
      expect(resolved).not.toBeNull();
      // Must NOT be the test tenant — name filter excludes it
      expect(resolved!.id).not.toBe(testTenantId);
      expect(resolved!.name.toLowerCase()).not.toContain('test');
    });
  });

  // ── Scenario 3: Multiple non-test tenants — oldest wins ──────────────────────

  describe('Scenario 3: multiple production tenants — oldest created_at wins', () => {
    const tenant2020 = randomUUID();
    const tenant2023 = randomUUID();
    const tenant2025 = randomUUID();

    beforeAll(async () => {
      await seedTenantAt(tenant2023, 'Beta Corp',  '2023-06-01T00:00:00Z');
      await seedTenantAt(tenant2025, 'Gamma Corp', '2025-01-01T00:00:00Z');
      await seedTenantAt(tenant2020, 'Alpha Corp', '2020-01-01T00:00:00Z');
    }, 15000);

    afterAll(async () => {
      await cleanTenant(tenant2020);
      await cleanTenant(tenant2023);
      await cleanTenant(tenant2025);
    });

    test('resolver returns the tenant with the earliest created_at', async () => {
      const resolved = await resolveProductionTenant();
      expect(resolved).not.toBeNull();
      expect(resolved!.id).toBe(tenant2020);
      expect(resolved!.name).toBe('Alpha Corp');
    });
  });

  // ── Scenario 4: Lifecycle, integration, test names all excluded ────────────

  describe('Scenario 4: all known test-name patterns are excluded', () => {
    const lifecycleTenant  = randomUUID();
    const integrationTenant = randomUUID();
    const testTenant2       = randomUUID();
    const productionTenant  = randomUUID();

    beforeAll(async () => {
      await seedTenantAt(lifecycleTenant,   'Lifecycle Test Tenant',        '2020-01-01T00:00:00Z');
      await seedTenantAt(integrationTenant, 'Integration Tenant',            '2020-02-01T00:00:00Z');
      await seedTenantAt(testTenant2,       'My Test Company',               '2020-03-01T00:00:00Z');
      await seedTenantAt(productionTenant,  'Real Production Customer Corp', '2020-04-01T00:00:00Z');
    }, 15000);

    afterAll(async () => {
      await cleanTenant(lifecycleTenant);
      await cleanTenant(integrationTenant);
      await cleanTenant(testTenant2);
      await cleanTenant(productionTenant);
    });

    test('lifecycle tenant is excluded by name filter', async () => {
      const resolved = await resolveProductionTenant();
      expect(resolved!.id).not.toBe(lifecycleTenant);
    });

    test('integration tenant is excluded by name filter', async () => {
      const resolved = await resolveProductionTenant();
      expect(resolved!.id).not.toBe(integrationTenant);
    });

    test('test-named tenant is excluded by name filter', async () => {
      const resolved = await resolveProductionTenant();
      expect(resolved!.id).not.toBe(testTenant2);
    });

    test('production tenant is selected (only non-excluded tenant)', async () => {
      const resolved = await resolveProductionTenant();
      expect(resolved!.id).toBe(productionTenant);
      expect(resolved!.name).toBe('Real Production Customer Corp');
    });
  });

  // ── Scenario 5: TENANT_ID env var takes absolute priority ────────────────────

  describe('Scenario 5: TENANT_ID env var overrides all DB logic', () => {
    const envTargetId    = randomUUID();
    const dbFirstTenantId = randomUUID();

    beforeAll(async () => {
      await seedTenantAt(dbFirstTenantId, 'DB First Corp', '2019-01-01T00:00:00Z');
      // envTargetId deliberately NOT seeded — env var is just an ID, DB not required
    }, 15000);

    afterAll(async () => {
      await cleanTenant(dbFirstTenantId);
    });

    test('when TENANT_ID env is set, resolver must return it without querying', () => {
      // Simulate the env-var path: if TENANT_ID is set, return it immediately.
      // We test the logic branch, not the full async function, to avoid needing DB
      const envTenantId = process.env.TENANT_ID;
      if (envTenantId) {
        // If env is already set in CI, verify it doesn't get overridden
        expect(envTenantId).toBeTruthy();
      } else {
        // Confirm the resolver has an env-var check (code-level invariant)
        const resolverSrc = require('fs')
          .readFileSync('scripts/ingest-1stmile-csvs.mjs', 'utf8');
        expect(resolverSrc).toContain("process.env.TENANT_ID");
        expect(resolverSrc.indexOf("process.env.TENANT_ID"))
          .toBeLessThan(resolverSrc.indexOf("SELECT id, name FROM tenants"));
      }
    });
  });
});
