-- Phase 13: Governance Self-Observability — Replay Certification tables
-- Additive-only migration — governance_operational_metrics was created in Phase 11.

-- ─────────────────────────────────────────────────────────────────────────────
-- SCORING REPLAY CERTIFICATIONS
-- Records the outcome of each scoring version replay run.
-- A scoring profile CANNOT be promoted to active without an approved certification.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scoring_replay_certifications (
  id                  TEXT        PRIMARY KEY,
  scoring_version     TEXT        NOT NULL,
  replay_dataset      TEXT        NOT NULL,     -- 'last_30d' | 'last_7d' | custom label
  replay_started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replay_completed_at TIMESTAMPTZ,
  total_snapshots     INTEGER     NOT NULL DEFAULT 0,
  drifted_snapshots   INTEGER     NOT NULL DEFAULT 0,
  drift_percentage    REAL        NOT NULL DEFAULT 0,
  max_drift           REAL        NOT NULL DEFAULT 0,  -- worst-case single-snapshot drift
  classification      TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (classification IN ('pending', 'safe', 'minor_drift', 'major_drift', 'breaking')),
  approved_by         TEXT,
  approved_at         TIMESTAMPTZ,
  blocked_at          TIMESTAMPTZ,               -- set when classification='breaking' and blocked
  blocked_by          TEXT,
  notes               TEXT,
  sample_drifts       JSONB       NOT NULL DEFAULT '[]',  -- [{index_name, old, new, delta}]
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS src_version_idx
  ON scoring_replay_certifications (scoring_version, created_at DESC);

CREATE INDEX IF NOT EXISTS src_classification_idx
  ON scoring_replay_certifications (classification)
  WHERE approved_at IS NULL AND blocked_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- PARSER REPLAY CERTIFICATIONS
-- Records the outcome of each parser version replay run.
-- Silver re-normalization requires an approved parser certification.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS parser_replay_certifications (
  id                     TEXT        PRIMARY KEY,
  parser_version         TEXT        NOT NULL,
  normalization_version  TEXT        NOT NULL,
  replay_dataset         TEXT        NOT NULL,
  replay_started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replay_completed_at    TIMESTAMPTZ,
  total_records          INTEGER     NOT NULL DEFAULT 0,
  failed_records         INTEGER     NOT NULL DEFAULT 0,
  failure_pct            REAL        NOT NULL DEFAULT 0,
  unresolved_field_delta REAL        NOT NULL DEFAULT 0,  -- change in unresolved field rate
  classification         TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (classification IN ('pending', 'safe', 'minor_drift', 'major_drift', 'breaking')),
  approved_by            TEXT,
  approved_at            TIMESTAMPTZ,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS prc_version_idx
  ON parser_replay_certifications (parser_version, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- PIPELINE REPLAY RUNS
-- Tracks when a full medallion pipeline was replayed (Bronze→Silver→Gold).
-- Used by the governance CLI and the replay certification flow.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pipeline_replay_runs (
  id                    TEXT        PRIMARY KEY,
  tenant_id             TEXT        NOT NULL,
  triggered_by          TEXT        NOT NULL,   -- 'scheduler' | 'operator' | 'certification'
  replay_from_layer     TEXT        NOT NULL    -- 'bronze' | 'silver' | 'gold'
                          CHECK (replay_from_layer IN ('bronze', 'silver', 'gold')),
  replay_scope          TEXT        NOT NULL DEFAULT 'full',  -- 'full' | 'partial' | 'sample'
  scoring_version       TEXT,
  parser_version        TEXT,
  certification_id      TEXT,                   -- FK to scoring_replay_certifications
  status                TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'running', 'completed', 'failed', 'aborted')),
  bronze_rows_processed INTEGER,
  silver_rows_produced  INTEGER,
  gold_rows_produced    INTEGER,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  error_message         TEXT,
  metadata              JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS prr_tenant_idx
  ON pipeline_replay_runs (tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS prr_status_idx
  ON pipeline_replay_runs (status)
  WHERE status IN ('pending', 'running');
