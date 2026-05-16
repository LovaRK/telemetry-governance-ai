-- ============================================
-- Bootstrap Migration: Schema Management Tables
-- Date: 2026-05-16
-- Description: Create migration tracking and rollback infrastructure
-- Note: This migration runs FIRST, before all numbered migrations
-- ============================================

-- Applied Migrations Table (tracks which migrations have been applied)
CREATE TABLE IF NOT EXISTS applied_migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    checksum VARCHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    execution_time_ms INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed', 'rolled_back'))
);

CREATE INDEX IF NOT EXISTS idx_applied_migrations_name ON applied_migrations(name);
CREATE INDEX IF NOT EXISTS idx_applied_migrations_applied_at ON applied_migrations(applied_at DESC);

-- Migration Rollback History (tracks rollback operations for audit)
CREATE TABLE IF NOT EXISTS migration_rollbacks (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) NOT NULL,
    rolled_back_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason TEXT,
    rolled_back_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_rollbacks_migration_name ON migration_rollbacks(migration_name);
CREATE INDEX IF NOT EXISTS idx_rollbacks_rolled_back_at ON migration_rollbacks(rolled_back_at DESC);

-- Migration Locks (prevents parallel migrations from same container group)
CREATE TABLE IF NOT EXISTS migration_locks (
    id SERIAL PRIMARY KEY,
    lock_key VARCHAR(255) NOT NULL UNIQUE,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_by VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_migration_locks_lock_key ON migration_locks(lock_key);
CREATE INDEX IF NOT EXISTS idx_migration_locks_expires_at ON migration_locks(expires_at);

-- Health Check Table (for monitoring migration system health)
CREATE TABLE IF NOT EXISTS migration_health (
    id SERIAL PRIMARY KEY,
    check_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('healthy', 'warning', 'error')),
    message TEXT,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_migration_health_checked_at ON migration_health(checked_at DESC);
