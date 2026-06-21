-- Phase 5: Medallion Architecture (Bronze / Silver / Gold)
--
-- Three-layer data pipeline with full lineage chain:
--   Bronze  → Immutable raw extraction from Splunk (never rewritten)
--   Silver  → Normalized telemetry (replayable by parser_version)
--   Gold    → Materialized scored KPIs (replayable by scoring_version, APPEND-ONLY)
--
-- CRITICAL INVARIANTS:
-- - Bronze rows are NEVER updated or deleted after insert
-- - Silver rows are NEVER updated after insert; re-run with new parser_version creates new rows
-- - Gold rows are NEVER updated; close the validity window + insert a new row
-- - Every Gold row links: gold.silver_id → silver.bronze_id → bronze.sid → Splunk job
-- - All layers are tenant-scoped (tenant_id on every row)
--
-- Replay Rules:
--   Bronze replay: run silver-normalizer with new parser_version against existing bronze rows
--   Silver replay: run gold-scorer with new scoring_version against existing silver rows
--   Gold:          READ ONLY — never recomputed FROM gold

-- ─────────────────────────────────────────────
-- BRONZE: Immutable raw extraction layer
-- Written once on ingest; never modified.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "bronze_splunk_events" (
  "id"                   TEXT        NOT NULL PRIMARY KEY,
  "tenant_id"            TEXT        NOT NULL,
  "sid"                  TEXT,                          -- Source Splunk SID job
  "index_name"           TEXT        NOT NULL,
  "sourcetype"           TEXT,
  "raw_payload"          JSONB       NOT NULL,           -- Exact Splunk response, no transformation
  "extracted_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "extraction_version"   TEXT        NOT NULL DEFAULT '1.0',
  "pipeline_run_id"      TEXT,
  CONSTRAINT "bronze_splunk_events_tenant_nonempty" CHECK ("tenant_id" <> '')
);

CREATE INDEX IF NOT EXISTS "bronze_splunk_events_tenant_idx"
  ON "bronze_splunk_events" ("tenant_id", "index_name", "extracted_at" DESC);

CREATE INDEX IF NOT EXISTS "bronze_splunk_events_sid_idx"
  ON "bronze_splunk_events" ("sid")
  WHERE "sid" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "bronze_splunk_events_run_idx"
  ON "bronze_splunk_events" ("pipeline_run_id")
  WHERE "pipeline_run_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "bronze_splunk_events_extraction_version_idx"
  ON "bronze_splunk_events" ("extraction_version", "extracted_at" DESC);

-- ─────────────────────────────────────────────
-- SILVER: Normalized telemetry layer
-- Derived from Bronze. Replayable by parser_version + normalization_version.
-- New parser_version = new Silver rows; old rows remain unchanged.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "silver_normalized_telemetry" (
  "id"                      TEXT        NOT NULL PRIMARY KEY,
  "tenant_id"               TEXT        NOT NULL,
  "bronze_id"               TEXT        NOT NULL REFERENCES "bronze_splunk_events"("id"),
  "index_name"              TEXT        NOT NULL,
  "sourcetype"              TEXT,
  "event_count"             BIGINT,
  "distinct_hosts"          INTEGER,
  "parsing_error_rate"      REAL,
  "field_coverage_pct"      REAL,
  "time_span_days"          REAL,
  "normalized_fields"       JSONB,                      -- Canonical field map
  "parser_version"          TEXT        NOT NULL DEFAULT '1.0',
  "normalization_version"   TEXT        NOT NULL DEFAULT '1.0',
  "normalized_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "pipeline_run_id"         TEXT,
  CONSTRAINT "silver_normalized_telemetry_tenant_nonempty" CHECK ("tenant_id" <> ''),
  CONSTRAINT "silver_normalized_telemetry_error_rate_range"
    CHECK ("parsing_error_rate" IS NULL OR ("parsing_error_rate" >= 0 AND "parsing_error_rate" <= 100)),
  CONSTRAINT "silver_normalized_telemetry_coverage_range"
    CHECK ("field_coverage_pct" IS NULL OR ("field_coverage_pct" >= 0 AND "field_coverage_pct" <= 100))
);

CREATE INDEX IF NOT EXISTS "silver_normalized_telemetry_tenant_idx"
  ON "silver_normalized_telemetry" ("tenant_id", "index_name", "normalized_at" DESC);

CREATE INDEX IF NOT EXISTS "silver_normalized_telemetry_bronze_idx"
  ON "silver_normalized_telemetry" ("bronze_id");

CREATE INDEX IF NOT EXISTS "silver_normalized_telemetry_parser_idx"
  ON "silver_normalized_telemetry" ("parser_version", "normalization_version", "normalized_at" DESC);

CREATE INDEX IF NOT EXISTS "silver_normalized_telemetry_run_idx"
  ON "silver_normalized_telemetry" ("pipeline_run_id")
  WHERE "pipeline_run_id" IS NOT NULL;

-- ─────────────────────────────────────────────
-- GOLD: Materialized scored KPIs layer
-- Derived from Silver. APPEND-ONLY — never UPDATE historical scores.
-- New scoring_version = new Gold rows; old rows remain with their scored_at intact.
-- validity_closed_at is set when a newer Gold row for the same index supersedes this one.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "gold_telemetry_snapshots" (
  "id"                      TEXT        NOT NULL PRIMARY KEY,
  "tenant_id"               TEXT        NOT NULL,
  "silver_id"               TEXT        NOT NULL REFERENCES "silver_normalized_telemetry"("id"),
  "index_name"              TEXT        NOT NULL,
  "utilization_score"       REAL        NOT NULL,
  "detection_score"         REAL        NOT NULL,
  "quality_score"           REAL        NOT NULL,
  "composite_score"         REAL        NOT NULL,
  "tier"                    TEXT        NOT NULL,
  "minimum_activity_gated"  BOOLEAN     NOT NULL DEFAULT false,
  "scoring_version"         TEXT        NOT NULL DEFAULT '1.0',
  "scoring_profile"         TEXT        NOT NULL DEFAULT 'balanced',
  "weight_utilization"      REAL        NOT NULL DEFAULT 0.35,
  "weight_detection"        REAL        NOT NULL DEFAULT 0.40,
  "weight_quality"          REAL        NOT NULL DEFAULT 0.25,
  "snapshot_hash"           TEXT        NOT NULL,
  "previous_snapshot_hash"  TEXT,                       -- Links to prior row (tamper-evident chain)
  "scored_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "validity_closed_at"      TIMESTAMPTZ,                -- Set when superseded by a newer row
  "pipeline_run_id"         TEXT,
  CONSTRAINT "gold_telemetry_snapshots_tenant_nonempty" CHECK ("tenant_id" <> ''),
  CONSTRAINT "gold_telemetry_snapshots_tier_check"
    CHECK ("tier" IN ('critical', 'high-value', 'medium-value', 'low-value', 'inactive')),
  CONSTRAINT "gold_telemetry_snapshots_score_range_u"
    CHECK ("utilization_score" BETWEEN 0 AND 100),
  CONSTRAINT "gold_telemetry_snapshots_score_range_d"
    CHECK ("detection_score" BETWEEN 0 AND 100),
  CONSTRAINT "gold_telemetry_snapshots_score_range_q"
    CHECK ("quality_score" BETWEEN 0 AND 100),
  CONSTRAINT "gold_telemetry_snapshots_score_range_c"
    CHECK ("composite_score" BETWEEN 0 AND 100),
  CONSTRAINT "gold_telemetry_snapshots_weights_check"
    CHECK (
      ABS("weight_utilization" + "weight_detection" + "weight_quality" - 1.0) < 0.001
    )
);

-- Primary query pattern: latest valid Gold row per index per tenant
CREATE INDEX IF NOT EXISTS "gold_telemetry_snapshots_tenant_idx"
  ON "gold_telemetry_snapshots" ("tenant_id", "index_name", "scored_at" DESC)
  WHERE "validity_closed_at" IS NULL;

-- Full history (including superseded rows) — for replay and certification
CREATE INDEX IF NOT EXISTS "gold_telemetry_snapshots_history_idx"
  ON "gold_telemetry_snapshots" ("tenant_id", "index_name", "scored_at" DESC);

-- Tier distribution queries
CREATE INDEX IF NOT EXISTS "gold_telemetry_snapshots_tier_idx"
  ON "gold_telemetry_snapshots" ("tenant_id", "tier", "scored_at" DESC)
  WHERE "validity_closed_at" IS NULL;

-- Silver lineage lookup
CREATE INDEX IF NOT EXISTS "gold_telemetry_snapshots_silver_idx"
  ON "gold_telemetry_snapshots" ("silver_id");

-- Scoring version lookup (for replay certification comparisons)
CREATE INDEX IF NOT EXISTS "gold_telemetry_snapshots_version_idx"
  ON "gold_telemetry_snapshots" ("scoring_version", "scored_at" DESC);

-- Pipeline run lookup
CREATE INDEX IF NOT EXISTS "gold_telemetry_snapshots_run_idx"
  ON "gold_telemetry_snapshots" ("pipeline_run_id")
  WHERE "pipeline_run_id" IS NOT NULL;
