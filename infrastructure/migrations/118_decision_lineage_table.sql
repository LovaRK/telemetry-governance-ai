-- Migration 118: Create decision_lineage table
-- Tracks the full deterministic + cognitive signal lineage for each agent decision.
-- Used by DecisionReviewQueue and decision-lineage API routes.

CREATE TABLE IF NOT EXISTS decision_lineage (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id           UUID NOT NULL,
  index_name            VARCHAR(200) NOT NULL,
  sourcetype            VARCHAR(200),
  deterministic_signals JSONB NOT NULL DEFAULT '{}',
  cognitive_signals     JSONB,
  decision_status       VARCHAR(30) NOT NULL DEFAULT 'PROPOSED'
                          CHECK (decision_status IN ('PROPOSED','REVIEW_QUEUE','APPLIED','DISMISSED')),
  reviewed_by           VARCHAR(200),
  reviewed_at           TIMESTAMPTZ,
  applied_at            TIMESTAMPTZ,
  dismissal_reason      TEXT,
  fingerprint_version   VARCHAR(50),
  calibrated_confidence DECIMAL(5,4),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_lineage_snapshot ON decision_lineage(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_decision_lineage_index   ON decision_lineage(index_name);
CREATE INDEX IF NOT EXISTS idx_decision_lineage_status  ON decision_lineage(decision_status);

-- Unique per index+sourcetype per snapshot
CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_lineage_identity
  ON decision_lineage(snapshot_id, index_name, COALESCE(sourcetype, ''));

-- Back-fill from agent_decisions so the queue is immediately populated
INSERT INTO decision_lineage (
  snapshot_id, index_name, sourcetype,
  deterministic_signals, cognitive_signals,
  decision_status, fingerprint_version
)
SELECT
  ad.snapshot_id,
  ad.index_name,
  ad.sourcetype,
  jsonb_build_object(
    'utilization_pct',    ad.utilization_score,
    'cost_per_year_usd',  ad.annual_license_cost,
    'signal_source',      'DETERMINISTIC'
  ),
  jsonb_build_object(
    'confidence_score',   ad.confidence_score,
    'reasoning',          COALESCE(ad.reasoning, ''),
    'signal_source',      'AI'
  ),
  'REVIEW_QUEUE',
  'v1'
FROM agent_decisions ad
ON CONFLICT DO NOTHING;
