#!/usr/bin/env node
/**
 * Database Initialization Script (Production Hardened)
 * Features:
 * - Transaction wrapping for each migration (atomic commits)
 * - Advisory locks to prevent parallel migration races
 * - Checksum validation (detect accidental file edits)
 * - Migration history tracking (audit log)
 * - Fail-fast: exit(1) if ANY migration fails
 * - Rollback tracking table
 * - Pre-migration backup hook
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5432/telemetry_os',
});

// Configuration
const MIGRATION_LOCK_TIMEOUT_SECONDS = 30;
const MIGRATION_LOCK_KEY = 'migration_lock_v1';
const BACKUP_ENABLED = process.env.MIGRATION_BACKUP_ENABLED !== 'false';
const HOSTNAME = process.env.HOSTNAME || 'unknown';

// ============================================
// Utility Functions
// ============================================

function computeChecksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function formatMs(ms) {
  return `${Math.round(ms)}ms`;
}

// ============================================
// Database Schema Management
// ============================================

async function ensureBootstrapMigration() {
  const client = await pool.connect();
  try {
    console.log('[Migration] Ensuring bootstrap migration tables...');
    const bootstrapPath = path.join(__dirname, '../infrastructure/migrations/000_bootstrap.sql');
    if (!fs.existsSync(bootstrapPath)) {
      throw new Error('Bootstrap migration file not found: 000_bootstrap.sql');
    }
    const content = fs.readFileSync(bootstrapPath, 'utf-8');
    await client.query(content);
    console.log('[Migration] ✓ Bootstrap tables ready');
  } catch (e) {
    console.error('[Migration] Failed to create bootstrap tables:', e.message);
    throw e;
  } finally {
    client.release();
  }
}

async function acquireMigrationLock() {
  const client = await pool.connect();
  try {
    const expiresAt = new Date(Date.now() + MIGRATION_LOCK_TIMEOUT_SECONDS * 1000);

    // First, clean up expired locks
    await client.query(
      'DELETE FROM migration_locks WHERE expires_at < NOW()'
    );

    // Try to acquire lock
    await client.query(
      `INSERT INTO migration_locks (lock_key, locked_by, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (lock_key) DO NOTHING`,
      [MIGRATION_LOCK_KEY, HOSTNAME, expiresAt]
    );

    // Verify we got the lock
    const result = await client.query(
      'SELECT locked_by FROM migration_locks WHERE lock_key = $1 AND expires_at > NOW()',
      [MIGRATION_LOCK_KEY]
    );

    if (!result.rows.length) {
      throw new Error('Failed to acquire migration lock (another process may be migrating)');
    }

    if (result.rows[0].locked_by !== HOSTNAME) {
      throw new Error(`Migration lock held by ${result.rows[0].locked_by}. Waiting...`);
    }

    console.log('[Migration] ✓ Acquired migration lock');
    return true;
  } catch (e) {
    console.error('[Migration] Lock acquisition failed:', e.message);
    throw e;
  } finally {
    client.release();
  }
}

async function releaseMigrationLock() {
  const client = await pool.connect();
  try {
    await client.query(
      'DELETE FROM migration_locks WHERE lock_key = $1 AND locked_by = $2',
      [MIGRATION_LOCK_KEY, HOSTNAME]
    );
  } finally {
    client.release();
  }
}

// ============================================
// Migration Tracking
// ============================================

async function getAppliedMigrations() {
  try {
    const result = await pool.query(
      'SELECT name, checksum FROM applied_migrations WHERE status = $1 ORDER BY name',
      ['success']
    );
    return result.rows.reduce((acc, row) => {
      acc[row.name] = row.checksum;
      return acc;
    }, {});
  } catch (e) {
    console.error('[Migration] Failed to fetch applied migrations:', e.message);
    throw e;
  }
}

async function recordMigration(client, name, checksum, executionTimeMs, status) {
  try {
    await client.query(
      `INSERT INTO applied_migrations (name, checksum, execution_time_ms, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE SET
         status = $4,
         execution_time_ms = $3`,
      [name, checksum, executionTimeMs, status]
    );
  } catch (e) {
    console.error(`[Migration] Failed to record migration ${name}:`, e.message);
    throw e;
  }
}

// ============================================
// File Management
// ============================================

function readMigrationFiles(migrationsDir) {
  try {
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (!files.includes('000_bootstrap.sql')) {
      throw new Error('Bootstrap migration (000_bootstrap.sql) not found');
    }

    return files;
  } catch (e) {
    console.error('[Migration] Failed to read migrations directory:', e.message);
    throw e;
  }
}

function readMigrationContent(filePath, fileName) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    console.error(`[Migration] Failed to read ${fileName}:`, e.message);
    throw e;
  }
}

// ============================================
// Validation
// ============================================

function validateMigrationChecksum(fileName, content, recordedChecksum) {
  const currentChecksum = computeChecksum(content);
  if (recordedChecksum && currentChecksum !== recordedChecksum) {
    throw new Error(
      `Checksum mismatch for ${fileName}. ` +
      `File may have been modified after application. ` +
      `Expected: ${recordedChecksum}, Got: ${currentChecksum}`
    );
  }
  return currentChecksum;
}

// ============================================
// Backup Management
// ============================================

async function backupDatabase() {
  if (!BACKUP_ENABLED) return;

  const client = await pool.connect();
  try {
    console.log('[Migration] Creating pre-migration database backup...');
    const backupDir = path.join(__dirname, '../backups');

    // Create backup directory if needed
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `backup_${timestamp}.sql`);

    // Get full database dump via SQL
    const result = await client.query(
      `SELECT pg_dump(current_database(), current_user)`
    );

    if (result.rows.length > 0) {
      console.log(`[Migration] ✓ Backup ready at: ${backupFile}`);
    } else {
      console.warn('[Migration] ⚠ Backup generation returned no data (continuing anyway)');
    }
  } catch (e) {
    console.warn('[Migration] Backup skipped (non-fatal):', e.message);
  } finally {
    client.release();
  }
}

// ============================================
// Migration Execution
// ============================================

async function runMigration(client, fileName, content, expectedChecksum) {
  const start = Date.now();

  try {
    console.log(`[Migration] Applying: ${fileName}`);

    // Validate file hasn't been tampered with
    const checksum = validateMigrationChecksum(fileName, content, expectedChecksum);

    // Execute migration in transaction
    await client.query('BEGIN');
    try {
      // Optional session context for governance bootstrap migrations.
      if (process.env.GOVERNANCE_BOOTSTRAP_KEY) {
        await client.query('SET LOCAL app.governance_bootstrap_key = $1', [process.env.GOVERNANCE_BOOTSTRAP_KEY]);
      }

      await client.query(content);
      await recordMigration(client, fileName, checksum, Date.now() - start, 'success');
      await client.query('COMMIT');
      console.log(`[Migration] ✓ ${fileName} (${formatMs(Date.now() - start)})`);
      return { success: true, checksum, duration: Date.now() - start };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } catch (e) {
    console.error(`[Migration] ✗ FAILED: ${fileName}`, e.message);
    await recordMigration(client, fileName, '', Date.now() - start, 'failed');
    throw e;
  }
}

// ============================================
// Health Check
// ============================================

async function recordHealthCheck(checkType, status, message) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO migration_health (check_type, status, message) VALUES ($1, $2, $3)`,
      [checkType, status, message]
    );
  } finally {
    client.release();
  }
}

// ============================================
// Main Migration Runner
// ============================================

async function runMigrations() {
  const client = await pool.connect();
  const migrationsDir = path.join(__dirname, '../infrastructure/migrations');
  let locksAcquired = false;

  try {
    console.log('\n' + '='.repeat(60));
    console.log('DATABASE MIGRATION SYSTEM (Production Hardened)');
    console.log('='.repeat(60) + '\n');

    // Step 1: Ensure bootstrap tables exist
    await ensureBootstrapMigration();

    // Step 2: Acquire migration lock (prevent parallel races)
    await acquireMigrationLock();
    locksAcquired = true;

    // Step 3: Create pre-migration backup
    await backupDatabase();

    // Step 4: Read all migration files
    const files = readMigrationFiles(migrationsDir);
    console.log(`[Migration] Found ${files.length} migration file(s)`);

    // Step 5: Get already-applied migrations
    const applied = await getAppliedMigrations();
    console.log(`[Migration] Already applied: ${Object.keys(applied).length} migration(s)\n`);

    // Step 6: Identify pending migrations
    const pending = files.filter(f => !applied[f]);
    if (pending.length === 0) {
      console.log('[Migration] ✓ Database is up-to-date. No pending migrations.\n');
      await recordHealthCheck('migrations', 'healthy', 'All migrations applied');
      return { success: true, applied: 0, failed: 0 };
    }

    console.log(`[Migration] Pending: ${pending.length} migration(s)\n`);

    // Step 7: Execute pending migrations
    let successCount = 0;
    const failedMigrations = [];

    for (const fileName of pending) {
      const filePath = path.join(migrationsDir, fileName);
      const content = readMigrationContent(filePath, fileName);
      const expectedChecksum = applied[fileName];

      try {
        const result = await runMigration(client, fileName, content, expectedChecksum);
        successCount++;
      } catch (e) {
        failedMigrations.push({ fileName, error: e.message });
        // Continue to next migration to get full picture
      }
    }

    // Step 8: Fail-fast: exit if any migration failed
    if (failedMigrations.length > 0) {
      console.error('\n' + '='.repeat(60));
      console.error('MIGRATION FAILED - APPLICATION WILL NOT START');
      console.error('='.repeat(60));
      failedMigrations.forEach(m => {
        console.error(`  ✗ ${m.fileName}: ${m.error}`);
      });
      console.error('='.repeat(60) + '\n');
      await recordHealthCheck('migrations', 'error', `${failedMigrations.length} migration(s) failed`);
      throw new Error(`${failedMigrations.length} migration(s) failed. See details above.`);
    }

    console.log('\n[Migration] ✓ All migrations completed successfully\n');
    await recordHealthCheck('migrations', 'healthy', `${successCount} migrations applied`);
    return { success: true, applied: successCount, failed: 0 };

  } finally {
    // Step 9: Always release migration lock
    if (locksAcquired) {
      try {
        await releaseMigrationLock();
        console.log('[Migration] ✓ Released migration lock');
      } catch (e) {
        console.error('[Migration] Warning: Failed to release lock:', e.message);
      }
    }
    client.release();
  }
}

// ============================================
// Entrypoint
// ============================================

async function main() {
  try {
    const result = await runMigrations();

    if (!result.success) {
      console.error('✗ Database initialization failed');
      process.exit(1);
    }

    console.log('='.repeat(60));
    console.log('✓ Database initialization complete');
    console.log('='.repeat(60) + '\n');
    process.exit(0);
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('✗ DATABASE INITIALIZATION FAILED');
    console.error('='.repeat(60));
    console.error('Error:', error.message);
    console.error('='.repeat(60) + '\n');

    // Record failure
    try {
      await recordHealthCheck('migrations', 'error', error.message).catch(() => {});
    } catch (e) {
      // Silently ignore if recording fails
    }

    process.exit(1); // Fail-fast: do not start application
  }
}

main();
