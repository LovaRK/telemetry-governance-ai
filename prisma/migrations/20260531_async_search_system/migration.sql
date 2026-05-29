-- Phase 3.5: Async SID Job System + Query Budget Enforcement
--
-- PROBLEM: Heavy analytics queries (NLQ, root-cause, trend analysis) cannot
-- run synchronously — they block the request thread and time out at enterprise scale.
--
-- SOLUTION: Async SID lifecycle + budget enforcement
-- 1. Create Splunk search job → get SID
-- 2. Poll status asynchronously
-- 3. Stream/store results when ready
-- 4. Clean up expired SIDs
-- 5. Budget limits prevent runaway cost explosions

-- ─────────────────────────────────────────────
-- Splunk Search Jobs (SID lifecycle tracking)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "splunk_search_jobs" (
  "sid"             TEXT        NOT NULL PRIMARY KEY,
  "tenant_id"       TEXT        NOT NULL,
  "query_hash"      TEXT        NOT NULL,          -- SHA256 of normalized SPL (for dedup)
  "spl"             TEXT        NOT NULL,           -- actual SPL query
  "status"          TEXT        NOT NULL DEFAULT 'pending',
  "started_at"      TIMESTAMPTZ,
  "completed_at"    TIMESTAMPTZ,
  "expires_at"      TIMESTAMPTZ,                   -- TTL for Splunk-side job cleanup
  "result_count"    INTEGER,
  "runtime_ms"      INTEGER,
  "scan_volume_mb"  REAL,
  "error_message"   TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "splunk_search_jobs_status_check"
    CHECK ("status" IN ('pending', 'running', 'partial', 'completed', 'failed', 'expired', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS "splunk_search_jobs_tenant_idx"
  ON "splunk_search_jobs" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "splunk_search_jobs_status_idx"
  ON "splunk_search_jobs" ("status", "expires_at");

CREATE INDEX IF NOT EXISTS "splunk_search_jobs_query_hash_idx"
  ON "splunk_search_jobs" ("query_hash", "tenant_id", "created_at" DESC);

-- ─────────────────────────────────────────────
-- Query Budget Limits (per-tenant throttling)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "query_budget_limits" (
  "tenant_id"           TEXT        NOT NULL PRIMARY KEY,
  "daily_scan_gb"       REAL        NOT NULL DEFAULT 100,   -- max GB scanned per day
  "max_runtime_ms"      INTEGER     NOT NULL DEFAULT 30000, -- max single query runtime (30s)
  "max_concurrent_jobs" INTEGER     NOT NULL DEFAULT 5,     -- max concurrent SID jobs
  "enforcement_mode"    TEXT        NOT NULL DEFAULT 'WARN', -- WARN | THROTTLE | REQUIRE_APPROVAL | DENY
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "query_budget_limits_enforcement_check"
    CHECK ("enforcement_mode" IN ('WARN', 'THROTTLE', 'REQUIRE_APPROVAL', 'DENY'))
);

-- Seed default budget for SYSTEM tenant
INSERT INTO "query_budget_limits" ("tenant_id")
VALUES ('SYSTEM')
ON CONFLICT ("tenant_id") DO NOTHING;

-- ─────────────────────────────────────────────
-- Daily query usage tracking (for budget enforcement)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "query_daily_usage" (
  "tenant_id"        TEXT        NOT NULL,
  "usage_date"       DATE        NOT NULL DEFAULT CURRENT_DATE,
  "total_scan_gb"    REAL        NOT NULL DEFAULT 0,
  "total_jobs"       INTEGER     NOT NULL DEFAULT 0,
  "denied_jobs"      INTEGER     NOT NULL DEFAULT 0,
  "throttled_jobs"   INTEGER     NOT NULL DEFAULT 0,
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("tenant_id", "usage_date")
);

CREATE INDEX IF NOT EXISTS "query_daily_usage_tenant_idx"
  ON "query_daily_usage" ("tenant_id", "usage_date" DESC);
