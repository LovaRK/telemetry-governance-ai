# Database Migrations Guide

## Overview

The dashboard uses a **production-hardened, versioned migration system** for managing PostgreSQL schema evolution. All schema changes are tracked, ordered, idempotent, and protected against corruption.

**Key Benefits:**
- ✅ **Transactional safety** — each migration commits atomically or rolls back completely
- ✅ **Parallel-safe** — advisory locks prevent race conditions in multi-container deployments
- ✅ **Tamper-detected** — SHA256 checksums detect accidental file modifications
- ✅ **Fail-fast** — application won't start if any migration failed
- ✅ **Rollback tracked** — full audit log for undo operations
- ✅ **Reproducible deployments** — all machines get identical schema
- ✅ **Team collaboration** — clear evolution history without conflicts

---

## Hardening Features (Production-Grade)

### 🔒 **Transaction Wrapping**
Each migration runs in an explicit `BEGIN...COMMIT` block:
```javascript
BEGIN;
  -- All SQL statements in migration
COMMIT;
```
If ANY statement fails, the entire migration rolls back atomically. No partial schema states.

### 🔐 **Parallel-Safe Advisory Locks**
When multiple containers start simultaneously, they compete for a migration lock:
- First container acquires lock, others wait
- Lock expires after 30 seconds (prevents deadlock)
- Ensures only ONE container applies migrations at a time
- Race conditions eliminated

### ✅ **Checksum Validation (Tamper Detection)**
Each applied migration records a SHA256 hash of its `.sql` file:
```
001_init.sql applied with checksum: a1b2c3d4...
(later) someone edits 001_init.sql
Next run: ERROR "Checksum mismatch — file may have been modified"
```
Detects accidental edits that could cause schema inconsistency.

### 🚫 **Fail-Fast (Application Won't Start)**
If ANY migration fails:
```
[Migration] ✗ FAILED: 003_agent_decisions.sql
[Migration] ✗ FAILED — APPLICATION WILL NOT START
```
Exit code 1, entrypoint aborts, no degraded state. You must fix the migration.

### 📝 **Rollback Tracking Table**
Full audit trail of:
- What was rolled back
- When it was rolled back
- Why (reason field)
- Who rolled it back (user field)

### 💾 **Pre-Migration Backup Hook**
Before destructive migrations, optionally create backup:
```bash
MIGRATION_BACKUP_ENABLED=true npm run migrate
# Creates: backups/backup_2026-05-16T16-31-45-622Z.sql
```

### 📊 **Health Check Endpoint**
```bash
curl http://localhost:3000/api/health
{
  "status": "healthy",
  "migrations": {
    "healthy": true,
    "applied": 7,
    "failed": 0,
    "message": "7 migrations applied"
  }
}
```

---

## Architecture

### Migrations Directory
```
infrastructure/
  migrations/
    000_bootstrap.sql            ← ⚡ FIRST: Migration infrastructure (locks, health, audit)
    001_init.sql                 ← Core tables: snapshots, cache, traces, jobs
    002_executive_kpis.sql       ← KPI aggregation table
    003_agent_decisions.sql      ← Per-index LLM decisions
    004_search_audit.sql         ← Saved searches tracking
    005_data_quality.sql         ← Field usage, security, quality tables
    006_user_config.sql          ← User-configurable settings
```

### Bootstrap Migration (000_bootstrap.sql)

Runs **first**, before all numbered migrations. Creates hardening infrastructure:

| Table | Purpose |
|-------|---------|
| `applied_migrations` | Tracks which migrations were applied, SHA256 checksums, execution timing, status (success/failed/rolled_back) |
| `migration_rollbacks` | Audit log of rollback operations (for undo operations) |
| `migration_locks` | Advisory lock entries to prevent parallel container races |
| `migration_health` | Health monitoring records for observability |

### Migration Tracking

The enhanced `applied_migrations` table tracks:

```sql
CREATE TABLE applied_migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,      -- e.g. "001_init.sql"
  checksum VARCHAR(64) NOT NULL,          -- SHA256 hash (tamper detection)
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  execution_time_ms INTEGER NOT NULL,     -- How long it took
  status VARCHAR(20) NOT NULL             -- success | failed | rolled_back
);
```

### Auto-Initialization

On startup (Docker or manual), the migration runner:

1. Connects to PostgreSQL
2. Creates `applied_migrations` table if needed
3. Reads all `.sql` files from `infrastructure/migrations/`
4. Compares against applied migrations
5. Runs pending migrations in lexicographic order
6. Logs status and exits

---

## Running Migrations

### Docker (Recommended)

Migrations run **automatically** when you start the stack:

```bash
npm run dev
# Or: docker-compose -f docker/docker-compose.yml up
```

The Docker entrypoint will:
1. Run `npm run migrate` (which calls `node scripts/init-db.js`)
2. Wait for completion
3. Start the Next.js dev server

### Manual (Development)

To run migrations without Docker:

```bash
export DATABASE_URL="postgresql://telemetry:telemetry@localhost:5432/telemetry_os"
npm run migrate
```

### Check Status

After running, migrations are logged:

```
=================================================
DATABASE INITIALIZATION
=================================================
[MigrationService] Starting migrations from: /app/infrastructure/migrations
[MigrationService] Already applied: 2 migration(s)
[MigrationService] Found 6 migration file(s)
[MigrationService] Pending: 4 migration(s)
[MigrationService] Applying migration: 003_agent_decisions.sql
[MigrationService] ✓ Migration applied: 003_agent_decisions.sql
[MigrationService] Applying migration: 004_search_audit.sql
[MigrationService] ✓ Migration applied: 004_search_audit.sql
[MigrationService] Applying migration: 005_data_quality.sql
[MigrationService] ✓ Migration applied: 005_data_quality.sql
[MigrationService] Applying migration: 006_user_config.sql
[MigrationService] ✓ Migration applied: 006_user_config.sql
[MigrationService] ✓ All migrations completed successfully
✓ Database initialization complete
```

To verify in SQL:

```sql
SELECT name, applied_at FROM applied_migrations ORDER BY name;
```

---

## Adding New Migrations

When you need to evolve the schema:

1. **Freeze** your current migration number. If `006_user_config.sql` is the latest, next is `007_*`.

2. **Create** the new migration file:
   ```bash
   touch infrastructure/migrations/007_my_new_table.sql
   ```

3. **Write SQL** with idempotent (`IF NOT EXISTS`) statements:
   ```sql
   -- ============================================
   -- Migration 007: My New Feature
   -- Date: 2026-05-16
   -- ============================================
   
   CREATE TABLE IF NOT EXISTS my_new_table (
     id SERIAL PRIMARY KEY,
     name VARCHAR(255) NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   
   CREATE INDEX IF NOT EXISTS idx_my_new_table_name ON my_new_table(name);
   ```

4. **Test locally**:
   ```bash
   npm run migrate
   # Verify in PostgreSQL that the table exists
   ```

5. **Deploy** — the next `npm run dev` or Docker start will apply it automatically.

---

## Backward Compatibility

**Important:** Migrations are permanent once applied in production.

- ✅ **Safe:** Adding columns, adding tables, creating indexes
- ✅ **Safe:** `IF NOT EXISTS` clauses (idempotent)
- ⚠️ **Risky:** Dropping columns, renaming columns, `ALTER TYPE`
- ❌ **Unsafe:** `DROP TABLE` without careful planning

If you must revert a migration, create a **new migration** that undoes the changes (e.g., `007_undo_feature.sql`). Never delete or edit applied migrations.

---

## Production Considerations

### Fresh Deployment

New servers automatically get full schema on first startup:

```bash
export DATABASE_URL="postgresql://prod-user:password@prod-host/telemetry_os"
npm run migrate
# All 6 migrations apply automatically
```

### Multi-Environment

Same migrations work on dev, staging, and production:

```bash
# Dev
DATABASE_URL=pg://dev:pwd@localhost/telemetry npm run migrate

# Staging
DATABASE_URL=pg://stage:pwd@stage-db.internal/telemetry npm run migrate

# Production
DATABASE_URL=pg://prod:pwd@prod-db.internal/telemetry npm run migrate
```

### Monitoring

The `applied_migrations` table serves as an audit log:

```sql
-- See what migrations were applied and when
SELECT name, applied_at FROM applied_migrations ORDER BY applied_at;

-- Check if all 6 migrations are applied
SELECT COUNT(*) FROM applied_migrations;
-- Expected: 6 (or higher if more were added)
```

---

## Troubleshooting

### Migration Fails with "Already exists"

Cause: `CREATE TABLE` without `IF NOT EXISTS`.

Fix: Migration should be idempotent. Update the `.sql` file to use `IF NOT EXISTS`:

```sql
-- ❌ Wrong
CREATE TABLE my_table (id SERIAL PRIMARY KEY);

-- ✅ Right
CREATE TABLE IF NOT EXISTS my_table (id SERIAL PRIMARY KEY);
```

### Migration Never Runs

Cause: Migration filename already in `applied_migrations` table but table doesn't exist in schema.

Fix: Check `applied_migrations` and compare with actual schema:

```sql
-- See applied migrations
SELECT * FROM applied_migrations;

-- Check if tables exist
\dt telemetry_snapshots
\dt executive_kpis
```

### Reset Database (Dangerous!)

If you need to start completely fresh:

```bash
# ⚠️ DESTRUCTIVE: Deletes all data
docker-compose down -v
docker-compose up --build
```

This recreates the database volume from scratch, applying all migrations cleanly.

---

## Related Files

- **Migration runner:** `scripts/init-db.js` — executes pending migrations
- **Docker entrypoint:** `docker/entrypoint.sh` — calls migration runner on startup
- **Schema snapshot:** `infrastructure/schema.sql` — reference view (deprecated)
- **Package script:** `package.json` → `npm run migrate` → `node scripts/init-db.js`

---

## Monitoring & Health

### Health Check Endpoint

Monitor migration and database health:

```bash
curl http://localhost:3000/api/health
```

Response (healthy):
```json
{
  "status": "healthy",
  "timestamp": "2026-05-16T16:31:45.123Z",
  "database": {
    "healthy": true,
    "message": "Connected"
  },
  "migrations": {
    "healthy": true,
    "applied": 7,
    "failed": 0,
    "message": "7 migrations applied"
  },
  "lastCheck": "healthy"
}
```

Response (unhealthy):
```json
{
  "status": "unhealthy",
  "timestamp": "2026-05-16T16:31:45.123Z",
  "error": "relation \"telemetry_snapshots\" does not exist",
  "message": "Health check failed"
}
```

---

## Timeline

- **2026-05-16:** Migrations system implemented
  - Split monolithic `schema.sql` into 6 versioned files
  - Built `applied_migrations` tracking table
  - Created auto-running migration system in Docker entrypoint
  - Marked `schema.sql` as deprecated reference snapshot

- **2026-05-16:** Production hardening implemented
  - Transaction wrapping for atomic commits/rollbacks
  - Advisory locking to prevent parallel races
  - SHA256 checksum validation (tamper detection)
  - Fail-fast behavior (app won't start on migration failure)
  - Rollback tracking table for audit trail
  - Pre-migration backup hook
  - Health check endpoint (`/api/health`)

