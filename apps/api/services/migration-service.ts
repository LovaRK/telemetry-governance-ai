import * as fs from 'fs';
import * as path from 'path';
import { query, transaction } from '@core/database/connection';
import { PoolClient } from 'pg';

export interface MigrationRecord {
  id: number;
  name: string;
  applied_at: string;
}

/**
 * Ensures applied_migrations table exists
 */
async function ensureMigrationsTable(): Promise<void> {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS applied_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch (e) {
    console.error('[MigrationService] Failed to create applied_migrations table:', e);
    throw e;
  }
}

/**
 * Gets list of already-applied migrations
 */
async function getAppliedMigrations(): Promise<string[]> {
  try {
    const result = await query('SELECT name FROM applied_migrations ORDER BY name');
    return result.rows.map((row: any) => row.name);
  } catch (e) {
    console.error('[MigrationService] Failed to fetch applied migrations:', e);
    throw e;
  }
}

/**
 * Reads migration files from directory in order
 */
function readMigrationFiles(migrationsDir: string): string[] {
  try {
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Lexicographic order ensures 001, 002, 003, etc.
    return files;
  } catch (e) {
    console.error('[MigrationService] Failed to read migrations directory:', e);
    throw e;
  }
}

/**
 * Runs a single migration file
 */
async function runMigration(client: PoolClient, migrationName: string, content: string): Promise<void> {
  try {
    console.log(`[MigrationService] Applying migration: ${migrationName}`);
    await client.query(content);
    await client.query(
      'INSERT INTO applied_migrations (name) VALUES ($1)',
      [migrationName]
    );
    console.log(`[MigrationService] ✓ Migration applied: ${migrationName}`);
  } catch (e) {
    console.error(`[MigrationService] Failed to apply migration ${migrationName}:`, e);
    throw e;
  }
}

/**
 * Main migration runner — applies all pending migrations in order
 */
export async function runMigrations(migrationsDir: string = path.join(__dirname, '../../..', 'infrastructure/migrations')): Promise<void> {
  try {
    console.log(`[MigrationService] Starting migrations from: ${migrationsDir}`);

    // Ensure table exists
    await ensureMigrationsTable();

    // Get applied migrations
    const applied = await getAppliedMigrations();
    console.log(`[MigrationService] Already applied: ${applied.length} migration(s)`);

    // Read all migration files
    const files = readMigrationFiles(migrationsDir);
    console.log(`[MigrationService] Found ${files.length} migration file(s)`);

    // Filter to pending migrations
    const pending = files.filter(f => !applied.includes(f));
    if (pending.length === 0) {
      console.log('[MigrationService] No pending migrations. Database is up-to-date.');
      return;
    }

    console.log(`[MigrationService] Pending: ${pending.length} migration(s)`);

    // Run pending migrations in a transaction (one transaction per migration for isolation)
    for (const migrationFile of pending) {
      const filePath = path.join(migrationsDir, migrationFile);
      const content = fs.readFileSync(filePath, 'utf-8');

      await transaction(async (client) => {
        await runMigration(client, migrationFile, content);
      });
    }

    console.log(`[MigrationService] ✓ All migrations completed successfully`);
  } catch (e) {
    console.error('[MigrationService] Migration failed:', e);
    throw e;
  }
}

/**
 * Utility: Print migration status
 */
export async function printMigrationStatus(): Promise<void> {
  try {
    await ensureMigrationsTable();
    const applied = await getAppliedMigrations();
    console.log('\n--- Migration Status ---');
    console.log(`Total applied: ${applied.length}`);
    applied.forEach(m => console.log(`  ✓ ${m}`));
    console.log('------------------------\n');
  } catch (e) {
    console.error('Failed to print migration status:', e);
  }
}
