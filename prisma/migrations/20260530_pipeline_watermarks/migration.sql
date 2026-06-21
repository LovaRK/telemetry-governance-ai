-- Phase 3: Incremental Pipeline + Watermark Architecture
--
-- PROBLEM: Current pipeline re-fetches and re-scores ALL indexes on every run.
-- At enterprise scale (500+ indexes, 90-day history) this is O(N×T) — untenable.
--
-- SOLUTION: Watermark-based incremental pipeline.
-- Each pipeline records the last processed timestamp. Next run fetches ONLY
-- the delta since the watermark. Watermark advances only on full success.
--
-- DESIGN:
-- 1. pipeline_watermarks — one row per pipeline, tracks last processed state
-- 2. pipeline_executions_v2 — execution history (separate from analytical state)
--
-- This separates:
--   OPERATIONAL state: (job_queue, pipeline_executions, approval_requests)
--   ANALYTICAL state:  (telemetry_snapshots, executive_kpis, decision_drift_history)

-- ─────────────────────────────────────────────
-- Pipeline watermarks
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "pipeline_watermarks" (
  "pipeline_name"             TEXT        NOT NULL PRIMARY KEY,
  "tenant_id"                 TEXT        NOT NULL DEFAULT 'SYSTEM',
  "last_processed_at"         TIMESTAMPTZ NOT NULL,
  "last_sid"                  TEXT,                 -- Last Splunk job ID processed
  "last_index_count"          INTEGER     NOT NULL DEFAULT 0,
  "consecutive_empty_runs"    INTEGER     NOT NULL DEFAULT 0,
  "last_error"                TEXT,                 -- Last error message if run failed
  "updated_at"                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "pipeline_watermarks_name_length"
    CHECK (LENGTH("pipeline_name") >= 3 AND LENGTH("pipeline_name") <= 128)
);

CREATE INDEX IF NOT EXISTS "pipeline_watermarks_tenant_idx"
  ON "pipeline_watermarks" ("tenant_id");

-- Seed bootstrap watermarks for known pipelines
-- Set to 24 hours ago so first run fetches the previous day
INSERT INTO "pipeline_watermarks" ("pipeline_name", "tenant_id", "last_processed_at")
VALUES
  ('main_aggregation',       'SYSTEM', NOW() - INTERVAL '24 hours'),
  ('incremental_fetch',      'SYSTEM', NOW() - INTERVAL '24 hours'),
  ('quality_metrics',        'SYSTEM', NOW() - INTERVAL '24 hours'),
  ('search_audit',           'SYSTEM', NOW() - INTERVAL '24 hours')
ON CONFLICT ("pipeline_name") DO NOTHING;

-- ─────────────────────────────────────────────
-- Pipeline executions v2 (operational state — separate from snapshots)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "pipeline_executions_v2" (
  "id"                    TEXT        NOT NULL PRIMARY KEY,
  "tenant_id"             TEXT        NOT NULL,
  "pipeline_name"         TEXT        NOT NULL,
  "status"                TEXT        NOT NULL DEFAULT 'pending',
  "watermark_from"        TIMESTAMPTZ,              -- watermark at start of run
  "watermark_to"          TIMESTAMPTZ,              -- watermark advanced to (on success)
  "indexes_fetched"       INTEGER,
  "indexes_new"           INTEGER,
  "indexes_updated"       INTEGER,
  "indexes_unchanged"     INTEGER,
  "duration_ms"           INTEGER,
  "error_message"         TEXT,
  "started_at"            TIMESTAMPTZ,
  "completed_at"          TIMESTAMPTZ,
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "pipeline_executions_v2_status_check"
    CHECK ("status" IN ('pending', 'running', 'completed', 'failed', 'partial'))
);

CREATE INDEX IF NOT EXISTS "pipeline_executions_v2_tenant_idx"
  ON "pipeline_executions_v2" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "pipeline_executions_v2_pipeline_idx"
  ON "pipeline_executions_v2" ("pipeline_name", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "pipeline_executions_v2_running_idx"
  ON "pipeline_executions_v2" ("status")
  WHERE "status" IN ('pending', 'running');
