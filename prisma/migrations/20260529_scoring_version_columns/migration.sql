-- Phase 2: Scoring Materialization + Snapshot Immutability
--
-- 1. Add scoring version and profile columns to telemetry_snapshots
--    — every snapshot now records WHICH scoring formula produced it
--    — enables point-in-time replay: "what score would this index get under v1.0?"
--
-- 2. Add snapshot immutability chain (snapshot_hash + previous_snapshot_hash)
--    — tamper evidence: any change to a snapshot breaks the hash
--    — replay traceability: chain links each snapshot to its predecessor
--
-- 3. Create scoring_profiles table (DB-persisted, not hardcoded config)
--    — profiles are now a first-class entity with audit trail
--    — no code deploy required to add/change profiles
--
-- 4. Create scoring_replay_certifications table
--    — no scoring version may become active without a certification record
--    — records replay drift % and human approval

-- ─────────────────────────────────────────────
-- 1. Scoring version columns on telemetry_snapshots
-- ─────────────────────────────────────────────

ALTER TABLE "telemetry_snapshots"
  ADD COLUMN IF NOT EXISTS "scoring_version"         TEXT    NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS "scoring_profile"         TEXT    NOT NULL DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS "minimum_activity_gated"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "weight_utilization"      REAL    NOT NULL DEFAULT 0.35,
  ADD COLUMN IF NOT EXISTS "weight_detection"        REAL    NOT NULL DEFAULT 0.40,
  ADD COLUMN IF NOT EXISTS "weight_quality"          REAL    NOT NULL DEFAULT 0.25;

-- Index for querying by scoring version (audit, replay analysis)
CREATE INDEX IF NOT EXISTS "telemetry_snapshots_scoring_version_idx"
  ON "telemetry_snapshots" ("scoring_version");

CREATE INDEX IF NOT EXISTS "telemetry_snapshots_scoring_profile_idx"
  ON "telemetry_snapshots" ("scoring_profile");

CREATE INDEX IF NOT EXISTS "telemetry_snapshots_minimum_activity_gated_idx"
  ON "telemetry_snapshots" ("minimum_activity_gated")
  WHERE "minimum_activity_gated" = true;

-- ─────────────────────────────────────────────
-- 2. Snapshot immutability chain
-- ─────────────────────────────────────────────

ALTER TABLE "telemetry_snapshots"
  ADD COLUMN IF NOT EXISTS "snapshot_hash"          TEXT,   -- SHA256 of canonical fields
  ADD COLUMN IF NOT EXISTS "previous_snapshot_hash" TEXT;   -- links to predecessor

-- Index for chain integrity verification (find next/prev in chain)
CREATE INDEX IF NOT EXISTS "telemetry_snapshots_hash_idx"
  ON "telemetry_snapshots" ("snapshot_hash");

CREATE INDEX IF NOT EXISTS "telemetry_snapshots_prev_hash_idx"
  ON "telemetry_snapshots" ("previous_snapshot_hash")
  WHERE "previous_snapshot_hash" IS NOT NULL;

-- ─────────────────────────────────────────────
-- 3. Scoring profiles table
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "scoring_profiles" (
  "id"                 TEXT        NOT NULL PRIMARY KEY,
  "name"               TEXT        NOT NULL UNIQUE,
  "description"        TEXT,
  "weight_utilization" REAL        NOT NULL,
  "weight_detection"   REAL        NOT NULL,
  "weight_quality"     REAL        NOT NULL,
  "created_by"         TEXT        NOT NULL DEFAULT 'system',
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "is_active"          BOOLEAN     NOT NULL DEFAULT false,
  "version"            TEXT        NOT NULL DEFAULT '1.0',
  CONSTRAINT "scoring_profiles_weights_sum"
    CHECK (ABS(("weight_utilization" + "weight_detection" + "weight_quality") - 1.0) < 0.001)
);

-- Seed the four built-in profiles (idempotent)
INSERT INTO "scoring_profiles"
  ("id", "name", "description", "weight_utilization", "weight_detection", "weight_quality", "is_active", "created_by")
VALUES
  ('profile-balanced',          'balanced',          'Balanced security and operations weighting',          0.35, 0.40, 0.25, true,  'migration'),
  ('profile-security-first',    'security_first',    'Prioritizes detection coverage over utilization',     0.25, 0.50, 0.25, false, 'migration'),
  ('profile-operations-first',  'operations_first',  'Prioritizes operational utilization and dashboards',  0.50, 0.25, 0.25, false, 'migration'),
  ('profile-data-quality',      'data_quality',      'Emphasizes data quality and parsing correctness',     0.30, 0.30, 0.40, false, 'migration')
ON CONFLICT ("id") DO NOTHING;

-- ─────────────────────────────────────────────
-- 4. Scoring replay certifications
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "scoring_replay_certifications" (
  "id"                 TEXT        NOT NULL PRIMARY KEY,
  "scoring_version"    TEXT        NOT NULL,
  "profile_id"         TEXT        REFERENCES "scoring_profiles"("id"),
  "replay_dataset"     TEXT        NOT NULL,   -- description of snapshot set used
  "total_snapshots"    INTEGER     NOT NULL,
  "drifted_snapshots"  INTEGER     NOT NULL DEFAULT 0,
  "drift_percentage"   REAL        NOT NULL DEFAULT 0,
  "classification"     TEXT        NOT NULL,   -- 'safe' | 'minor_drift' | 'major_drift' | 'breaking'
  "approved_by"        TEXT,
  "approved_at"        TIMESTAMPTZ,
  "rejected_by"        TEXT,
  "rejected_at"        TIMESTAMPTZ,
  "notes"              TEXT,
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "scoring_replay_certifications_classification_check"
    CHECK ("classification" IN ('safe', 'minor_drift', 'major_drift', 'breaking'))
);

CREATE INDEX IF NOT EXISTS "scoring_replay_certifications_version_idx"
  ON "scoring_replay_certifications" ("scoring_version");

CREATE INDEX IF NOT EXISTS "scoring_replay_certifications_approved_idx"
  ON "scoring_replay_certifications" ("approved_by", "approved_at")
  WHERE "approved_by" IS NOT NULL;
