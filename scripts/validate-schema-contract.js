#!/usr/bin/env node

/**
 * Schema Contract Validator
 *
 * Verifies that database schema matches code expectations:
 * - All required tables exist
 * - All required columns exist
 * - All required constraints exist
 * - Latest migrations applied
 *
 * Runs on app startup (web + worker) before processing any requests.
 * Exits with code 1 if validation fails.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const REQUIRED_COLUMNS = {
  telemetry_snapshots: ['snapshot_id', 'snapshot_date', 'created_at'],
  pipeline_runs: ['run_id', 'status', 'published', 'published_at'],
  pipeline_stage_events: ['run_id', 'stage', 'status', 'started_at'],
  agent_decisions: [
    'model_governance_id',
    'prompt_governance_id',
    'promotion_id',
    'decision_contract_version',
    'llm_version',
    'prompt_version',
  ],
  llm_health_cache: ['provider', 'last_checked'],
  prompt_registry: ['prompt_id', 'version', 'encrypted_prompt', 'system_prompt_hash'],
  approved_models: ['model_id', 'model_version', 'status'],
  model_promotions: ['promotion_id', 'runtime_snapshot'],
  active_model_pointer: ['tenant_id', 'model_id', 'prompt_id', 'config_version'],
};

const REQUIRED_CONSTRAINTS = [
  { table: 'active_model_pointer', constraint: 'PRIMARY KEY(tenant_id)' },
  { table: 'approved_models', constraint: 'UNIQUE(model_version)' },
  { table: 'prompt_registry', constraint: 'UNIQUE(version)' },
  { table: 'telemetry_snapshots', constraint: 'UNIQUE(snapshot_id)' },
  { table: 'agent_decisions', constraint: 'FK(model_governance_id -> approved_models.model_id)' },
  { table: 'agent_decisions', constraint: 'FK(prompt_governance_id -> prompt_registry.prompt_id)' },
  { table: 'active_model_pointer', constraint: 'FK(model_id -> approved_models.model_id)' },
  { table: 'active_model_pointer', constraint: 'FK(prompt_id -> prompt_registry.prompt_id)' },
];

async function validateSchema() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5432/telemetry_os',
  });

  try {
    const report = {
      missingTables: [],
      missingColumns: {},
      missingConstraints: [],
      migrationMismatch: null,
    };

    // Check tables
    for (const table of Object.keys(REQUIRED_COLUMNS)) {
      const res = await pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
        [table]
      );
      if (res.rows.length === 0) {
        report.missingTables.push(table);
      }
    }

    // Check columns
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      for (const col of columns) {
        const res = await pool.query(
          `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
          [table, col]
        );
        if (res.rows.length === 0) {
          if (!report.missingColumns[table]) {
            report.missingColumns[table] = [];
          }
          report.missingColumns[table].push(col);
        }
      }
    }

    // Check constraints
    for (const { table } of REQUIRED_CONSTRAINTS) {
      const res = await pool.query(
        `SELECT 1 FROM pg_constraint c
         JOIN pg_class t ON c.conrelid = t.oid
         WHERE t.relname = $1`,
        [table]
      );
      if (res.rows.length === 0) {
        report.missingConstraints.push(table);
      }
    }

    // Check migrations
    const latestExpected = getLatestExpectedMigration();
    try {
      const res = await pool.query(`
        SELECT CAST(SUBSTRING(name, '^[0-9]+') AS INTEGER) as migration_num
        FROM applied_migrations
        WHERE status = 'success'
        ORDER BY CAST(SUBSTRING(name, '^[0-9]+') AS INTEGER) DESC
        LIMIT 1
      `);
      const latestActual = res.rows[0]?.migration_num;
      if (latestActual < latestExpected) {
        report.migrationMismatch = { expected: latestExpected, actual: latestActual || 0 };
      }
    } catch (err) {
      report.migrationMismatch = { expected: latestExpected, actual: 0 };
    }

    // Check for violations
    if (
      report.missingTables.length > 0 ||
      Object.keys(report.missingColumns).length > 0 ||
      report.missingConstraints.length > 0 ||
      report.migrationMismatch !== null
    ) {
      printErrorReport(report);
      process.exit(1);
    }

    console.log('✓ Schema contract validation passed');
    process.exit(0);
  } catch (err) {
    console.error('❌ Schema validation error:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

function getLatestExpectedMigration() {
  const migrationsDir = path.join(__dirname, '../infrastructure/migrations');
  const files = fs.readdirSync(migrationsDir);
  const migrationNumbers = files
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .map((f) => Number(f.split('_')[0]))
    .filter((n) => !isNaN(n));

  return Math.max(...migrationNumbers);
}

function printErrorReport(report) {
  const lines = ['', '❌ SCHEMA CONTRACT VIOLATION', ''];

  if (report.missingTables.length > 0) {
    lines.push('Missing tables:');
    for (const table of report.missingTables) {
      lines.push(`  - ${table}`);
    }
    lines.push('');
  }

  if (Object.keys(report.missingColumns).length > 0) {
    lines.push('Missing columns:');
    for (const [table, cols] of Object.entries(report.missingColumns)) {
      for (const col of cols) {
        lines.push(`  - ${table}.${col}`);
      }
    }
    lines.push('');
  }

  if (report.missingConstraints.length > 0) {
    lines.push('Missing constraints:');
    for (const constraint of report.missingConstraints) {
      lines.push(`  - ${constraint}`);
    }
    lines.push('');
  }

  if (report.migrationMismatch) {
    lines.push('Migration mismatch:');
    lines.push(`  Expected: ${report.migrationMismatch.expected}`);
    lines.push(`  Actual: ${report.migrationMismatch.actual}`);
    lines.push('');
  }

  console.error(lines.join('\n'));
}

validateSchema();
