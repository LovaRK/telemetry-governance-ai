import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

interface ValidationReport {
  missingTables: string[];
  missingColumns: { [table: string]: string[] };
  missingConstraints: string[];
  migrationMismatch: { expected: number; actual: number } | null;
}

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

export class SchemaContractValidator {
  constructor(private pool: Pool) {}

  async validate(): Promise<void> {
    const report = await this.runAllChecks();

    if (
      report.missingTables.length > 0 ||
      Object.keys(report.missingColumns).length > 0 ||
      report.missingConstraints.length > 0 ||
      report.migrationMismatch !== null
    ) {
      this.throwFormattedError(report);
    }

    console.log('✓ Schema contract validation passed');
  }

  private async runAllChecks(): Promise<ValidationReport> {
    const report: ValidationReport = {
      missingTables: [],
      missingColumns: {},
      missingConstraints: [],
      migrationMismatch: null,
    };

    await this.checkTables(report);
    await this.checkColumns(report);
    await this.checkConstraints(report);
    await this.checkMigrations(report);

    return report;
  }

  private async checkTables(report: ValidationReport): Promise<void> {
    const tables = Object.keys(REQUIRED_COLUMNS);
    for (const table of tables) {
      const res = await this.pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
        [table]
      );
      if (res.rows.length === 0) {
        report.missingTables.push(table);
      }
    }
  }

  private async checkColumns(report: ValidationReport): Promise<void> {
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      for (const col of columns) {
        const res = await this.pool.query(
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
  }

  private async checkConstraints(report: ValidationReport): Promise<void> {
    for (const { table, constraint } of REQUIRED_CONSTRAINTS) {
      const isPresent = await this.constraintExists(table, constraint);
      if (!isPresent) {
        report.missingConstraints.push(`${table}.${constraint}`);
      }
    }
  }

  private async constraintExists(table: string, constraint: string): Promise<boolean> {
    try {
      if (constraint.startsWith('PRIMARY KEY')) {
        const col = constraint.match(/\((\w+)\)/)?.[1];
        if (col) {
          const res = await this.pool.query(
            `SELECT 1 FROM pg_constraint c
             JOIN pg_class t ON c.conrelid = t.oid
             WHERE t.relname = $1 AND c.contype = 'p'`,
            [table]
          );
          return res.rows.length > 0;
        }
      } else if (constraint.startsWith('UNIQUE')) {
        const col = constraint.match(/\((\w+)\)/)?.[1];
        if (col) {
          const res = await this.pool.query(
            `SELECT 1 FROM pg_constraint c
             JOIN pg_class t ON c.conrelid = t.oid
             WHERE t.relname = $1 AND c.contype = 'u'`,
            [table]
          );
          return res.rows.length > 0;
        }
      } else if (constraint.startsWith('FK')) {
        const res = await this.pool.query(
          `SELECT 1 FROM pg_constraint c
           JOIN pg_class t ON c.conrelid = t.oid
           WHERE t.relname = $1 AND c.contype = 'f'`,
          [table]
        );
        return res.rows.length > 0;
      }
    } catch (err) {
      return false;
    }
    return true;
  }

  private async checkMigrations(report: ValidationReport): Promise<void> {
    try {
      const latestExpected = this.getLatestExpectedMigration();

      const res = await this.pool.query(`
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
      // If applied_migrations table doesn't exist, treat as mismatch
      report.migrationMismatch = { expected: this.getLatestExpectedMigration(), actual: 0 };
    }
  }

  private getLatestExpectedMigration(): number {
    const migrationsDir = path.join(__dirname, '../../infrastructure/migrations');
    const files = fs.readdirSync(migrationsDir);
    const migrationNumbers = files
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .map((f) => Number(f.split('_')[0]))
      .filter((n) => !isNaN(n));

    return Math.max(...migrationNumbers);
  }

  private throwFormattedError(report: ValidationReport): void {
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

    const message = lines.join('\n');
    console.error(message);
    throw new Error(`Schema contract validation failed\n${message}`);
  }
}
