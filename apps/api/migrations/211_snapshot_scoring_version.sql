-- Migration 211: Snapshot scoring/formula versioning (G2)
--
-- Stamps every snapshot row with the scoring engine version and the formula
-- (methodology) version it was computed under. Answers "why does today's
-- score differ from March?" months later: the version is on the row.
--
-- scoring_version: code version of the deterministic engine (SCORING_VERSION)
-- formula_version: methodology/release tag (e.g. v1.0-handoff)

ALTER TABLE telemetry_snapshots
  ADD COLUMN IF NOT EXISTS scoring_version VARCHAR(32),
  ADD COLUMN IF NOT EXISTS formula_version VARCHAR(64);

COMMENT ON COLUMN telemetry_snapshots.scoring_version IS
  'Deterministic scoring engine code version (SCORING_VERSION constant) used for this row';
COMMENT ON COLUMN telemetry_snapshots.formula_version IS
  'Methodology/release tag (e.g. v1.0-handoff) the formulas were certified under';
