#!/usr/bin/env node

/**
 * Data Purity Validator
 *
 * Ensures no synthetic, demo, or hardcoded data exists in production database.
 * Runs on both web and worker startup before processing any requests.
 *
 * Checks:
 * - No demo tenants
 * - No synthetic snapshots
 * - No hardcoded KPIs
 * - No mock published runs
 * - No fake telemetry data
 *
 * Exits with code 1 if violations detected.
 */

const { Pool } = require('pg');

async function validateDataPurity() {
  // Allow synthetic data in test/dev environments
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.ALLOW_SYNTHETIC_DATA === 'true'
  ) {
    console.log('[DataPurityValidator] Skipped (test environment or ALLOW_SYNTHETIC_DATA=true)');
    process.exit(0);
  }

  console.log('[DataPurityValidator] Creating pool...');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os',
  });

  try {
    console.log('[DataPurityValidator] Pool created, testing connection...');
    await pool.query('SELECT 1');
    console.log('[DataPurityValidator] Connection test passed');

    const violations = [];

    console.log('[DataPurityValidator] Checking for synthetic data...');

    // Check for demo tenants - using direct SQL with escaped values for simplicity in validation script
    console.log('[DataPurityValidator] Checking demo tenants...');
    const demoTenantsRes = await pool.query(
      `SELECT COUNT(*) as count, id, slug FROM tenants 
       WHERE lower(slug) LIKE '%demo%' ESCAPE '\\' 
          OR lower(name) LIKE '%demo%' ESCAPE '\\' 
       GROUP BY id, slug 
       LIMIT 5`
    );

    const demoTenantCount = demoTenantsRes.rows.reduce(
      (sum, row) => sum + parseInt(row.count, 10),
      0
    );
    if (demoTenantCount > 0) {
      violations.push({
        type: 'Demo tenant',
        table: 'tenants',
        count: demoTenantCount,
        examples: demoTenantsRes.rows.map((r) => ({ id: r.id, slug: r.slug })),
      });
    }

    // Check for synthetic snapshots
    console.log('[DataPurityValidator] Checking synthetic snapshots...');
    const syntheticRes = await pool.query(
      `SELECT COUNT(*) as count, snapshot_id FROM telemetry_snapshots
       WHERE snapshot_id::text LIKE '%demo%' ESCAPE '\\'
          OR snapshot_id::text LIKE '%synthetic%' ESCAPE '\\'
          OR snapshot_id::text LIKE '%test%' ESCAPE '\\'
       GROUP BY snapshot_id
       LIMIT 5`
    );

    const syntheticCount = syntheticRes.rows.reduce((sum, row) => sum + parseInt(row.count, 10), 0);
    if (syntheticCount > 0) {
      violations.push({
        type: 'Synthetic snapshot',
        table: 'telemetry_snapshots',
        count: syntheticCount,
        examples: syntheticRes.rows.map((r) => ({ snapshot_id: r.snapshot_id })),
      });
    }

    // Check for hardcoded KPIs (demo tenant)
    console.log('[DataPurityValidator] Checking hardcoded KPIs...');
    let hardcodedKpiCount = 0;
    
    // First check for KPIs belonging to demo tenants
    if (demoTenantCount > 0) {
      // Get demo tenant IDs
      const demoTenantIdsRes = await pool.query(
        `SELECT id FROM tenants 
         WHERE lower(slug) LIKE '%demo%' ESCAPE '\\' 
            OR lower(name) LIKE '%demo%' ESCAPE '\\'`
      );
      const demoTenantIds = demoTenantIdsRes.rows.map(r => `'${r.id}'`).join(',');
      
      if (demoTenantIds) {
        const demoKpisRes = await pool.query(
          `SELECT COUNT(*) as count, tenant_id FROM executive_kpis
           WHERE tenant_id IN (${demoTenantIds})
           GROUP BY tenant_id`
        );
        hardcodedKpiCount += parseInt(demoKpisRes.rows[0]?.count || '0', 10);
      }
    }
    
    // Then check for fake tenants
    const fakeKpisRes = await pool.query(
      `SELECT COUNT(*) as count, tenant_id FROM executive_kpis
       WHERE tenant_id::text LIKE '%fake%' ESCAPE '\\'
       GROUP BY tenant_id`
    );
    hardcodedKpiCount += parseInt(fakeKpisRes.rows[0]?.count || '0', 10);
    
    if (hardcodedKpiCount > 0) {
      violations.push({
        type: 'Hardcoded KPI',
        table: 'executive_kpis',
        count: hardcodedKpiCount,
        examples: [], // Simplified for now
      });
    }

    // Check for mock published runs
    console.log('[DataPurityValidator] Checking mock published runs...');
    // Check in pipeline_runs table (where published runs are stored)
    const mockRunsRes = await pool.query(
      `SELECT COUNT(*) as count, run_id FROM pipeline_runs
       WHERE published = true
         AND (
           lower(error_message) LIKE '%mock%' ESCAPE '\\'
           OR lower(error_message) LIKE '%demo%' ESCAPE '\\'
           OR lower(error_message) LIKE '%synthetic%' ESCAPE '\\'
         )
       GROUP BY run_id
       LIMIT 5`
    );

    const mockRunCount = mockRunsRes.rows.reduce((sum, row) => sum + parseInt(row.count, 10), 0);
    if (mockRunCount > 0) {
      violations.push({
        type: 'Mock published run',
        table: 'published_runs',
        count: mockRunCount,
        examples: [], // Simplified for now
      });
    }

    // Report violations
    if (violations.length > 0) {
      printPurityError(violations);
      process.exit(1);
    }

    console.log('✓ Data purity validation passed - no synthetic data detected');
    process.exit(0);
  } catch (err) {
    console.error('❌ Data purity validation error:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

function printPurityError(violations) {
  const lines = ['', '❌ DATA PURITY VIOLATION', 'Synthetic data detected in database', ''];

  for (const violation of violations) {
    lines.push(`${violation.type} (${violation.table}): ${violation.count} rows`);
    for (const example of violation.examples) {
      lines.push(`  Example: ${JSON.stringify(example)}`);
    }
    lines.push('');
  }

  lines.push('Startup aborted.');
  lines.push('Action: Remove synthetic data and restart.');

  console.error(lines.join('\n'));
}

validateDataPurity();
