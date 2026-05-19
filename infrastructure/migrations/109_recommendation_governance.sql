-- Migration 109: Human Governance Workflow
-- Adds recommendation lifecycle: approval, rejection, escalation, feedback, audit trail

BEGIN;

-- Status enum for recommendation lifecycle
DO $$ BEGIN
  CREATE TYPE recommendation_status AS ENUM (
    'NEW',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'DEFERRED',
    'ESCALATED',
    'IMPLEMENTED',
    'ROLLED_BACK'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Core governance actions table
CREATE TABLE IF NOT EXISTS recommendation_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id     INTEGER,                -- references agent_decisions.id (integer PK)
  snapshot_id     UUID NOT NULL,
  index_name      VARCHAR(200) NOT NULL,
  tenant_id       UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',

  -- Lifecycle state
  status          recommendation_status NOT NULL DEFAULT 'NEW',

  -- Who acted
  actor_user_id   UUID,
  actor_email     VARCHAR(255),
  actor_role      VARCHAR(50),

  -- Human feedback
  action_note     TEXT,                   -- reason for rejection, deferral comment, etc.
  escalate_to     VARCHAR(255),           -- email or role to escalate to

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rec_actions_snapshot  ON recommendation_actions(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_rec_actions_index     ON recommendation_actions(index_name);
CREATE INDEX IF NOT EXISTS idx_rec_actions_tenant    ON recommendation_actions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rec_actions_status    ON recommendation_actions(status);

-- Audit trail: every status change is a new row (immutable log)
CREATE TABLE IF NOT EXISTS recommendation_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id       UUID NOT NULL REFERENCES recommendation_actions(id) ON DELETE CASCADE,
  snapshot_id     UUID NOT NULL,
  index_name      VARCHAR(200) NOT NULL,
  tenant_id       UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',

  -- What changed
  from_status     recommendation_status,
  to_status       recommendation_status NOT NULL,

  -- Who + why
  actor_user_id   UUID,
  actor_email     VARCHAR(255),
  note            TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rec_audit_action   ON recommendation_audit_log(action_id);
CREATE INDEX IF NOT EXISTS idx_rec_audit_snapshot ON recommendation_audit_log(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_rec_audit_tenant   ON recommendation_audit_log(tenant_id);

-- Seed NEW status rows for all existing agent_decisions
-- So the UI immediately shows actionable recommendations
INSERT INTO recommendation_actions (
  decision_id, snapshot_id, index_name, tenant_id, status
)
SELECT
  d.id,
  d.snapshot_id,
  d.index_name,
  COALESCE(d.tenant_id, '00000000-0000-0000-0000-000000000001'),
  'NEW'
FROM agent_decisions d
ON CONFLICT DO NOTHING;

COMMIT;
