-- Phase 4: Governance Approval Workflows
--
-- Creates the approval request state machine table.
-- This is distinct from the existing governance_workflow tables which track
-- index-level review decisions. This table tracks governance policy enforcement
-- approval requests triggered by REQUIRE_APPROVAL decisions from the RGE.
--
-- State machine: pending → approved | denied → revoked | expired
-- Every state transition is auditable.

CREATE TABLE IF NOT EXISTS "governance_approval_requests" (
  "id"                  TEXT        NOT NULL PRIMARY KEY,
  "decision_id"         TEXT        NOT NULL,       -- RGE decision that triggered this
  "tenant_id"           TEXT        NOT NULL,
  "actor_id"            TEXT        NOT NULL,       -- who made the request
  "actor_type"          TEXT        NOT NULL,       -- 'human' | 'agent' | 'service'
  "action"              TEXT        NOT NULL,
  "resource"            TEXT        NOT NULL,
  "risk_level"          TEXT        NOT NULL,
  "state"               TEXT        NOT NULL DEFAULT 'pending',
  "required_approvals"  INTEGER     NOT NULL DEFAULT 1,
  "received_approvals"  JSONB       NOT NULL DEFAULT '[]',  -- array of approval records
  "justification"       TEXT,                        -- requester's reason
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expires_at"          TIMESTAMPTZ,                 -- auto-deny after this time
  "resolved_at"         TIMESTAMPTZ,
  "resolved_by"         TEXT,
  "resolution_reason"   TEXT,
  "metadata"            JSONB,
  CONSTRAINT "governance_approval_requests_state_check"
    CHECK ("state" IN ('pending', 'approved', 'denied', 'revoked', 'expired')),
  CONSTRAINT "governance_approval_requests_actor_type_check"
    CHECK ("actor_type" IN ('human', 'agent', 'service'))
);

CREATE INDEX IF NOT EXISTS "approval_requests_state_idx"
  ON "governance_approval_requests" ("state", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "approval_requests_tenant_actor_idx"
  ON "governance_approval_requests" ("tenant_id", "actor_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "approval_requests_decision_idx"
  ON "governance_approval_requests" ("decision_id");

CREATE INDEX IF NOT EXISTS "approval_requests_pending_idx"
  ON "governance_approval_requests" ("state", "expires_at")
  WHERE "state" = 'pending';

CREATE INDEX IF NOT EXISTS "approval_requests_tenant_pending_idx"
  ON "governance_approval_requests" ("tenant_id", "state")
  WHERE "state" = 'pending';
