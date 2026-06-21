-- Phase 4.5: Governance Policy DSL
--
-- Creates the governance_policies table for DB-persisted policy rules.
-- The Runtime Governance Engine reads these rules first, falling back
-- to hardcoded TypeScript rules only when the DB is unavailable.
--
-- Policy rule schema (JSONB):
-- {
--   "type": "AND" | "OR" | "NOT" | "CONDITION",
--   "field": "risk_level" | "actor_type" | "action" | "resource" | "tenant_id" | ...,
--   "operator": "eq" | "neq" | "in" | "not_in" | "gte" | "lte" | "contains" | "matches",
--   "value": <scalar or array>,
--   "children": [ <nested rules> ],    -- for AND/OR/NOT
--   "escalate_to": "REQUIRE_APPROVAL" | "BLOCK" | "SHADOW_BLOCK" | "WARN",
--   "ttl_seconds": <number>,           -- optional TTL for approval requests
--   "required_approvals": <number>,    -- override default quorum
--   "time_window": {                   -- optional time-of-day restriction
--     "days": ["MON","TUE","WED","THU","FRI"],
--     "hours_utc": [8, 18]             -- start hour (inclusive), end hour (exclusive)
--   }
-- }
--
-- Example (block CRITICAL risk outside business hours):
-- {
--   "type": "AND",
--   "children": [
--     { "type": "CONDITION", "field": "risk_level", "operator": "eq", "value": "CRITICAL" },
--     { "type": "NOT", "children": [
--       { "type": "CONDITION", "field": "_time", "operator": "in_window",
--         "value": { "days": ["MON","TUE","WED","THU","FRI"], "hours_utc": [8,18] } }
--     ]}
--   ],
--   "escalate_to": "BLOCK"
-- }

CREATE TABLE IF NOT EXISTS "governance_policies" (
  "id"            TEXT        NOT NULL PRIMARY KEY,
  "name"          TEXT        NOT NULL,
  "description"   TEXT,
  "rule"          JSONB       NOT NULL,
  "priority"      INTEGER     NOT NULL DEFAULT 100,
  "environment"   TEXT        NOT NULL DEFAULT 'both',  -- 'sandbox' | 'production' | 'both'
  "is_active"     BOOLEAN     NOT NULL DEFAULT true,
  "created_by"    TEXT        NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "version"       INTEGER     NOT NULL DEFAULT 1,
  CONSTRAINT "governance_policies_name_unique" UNIQUE ("name"),
  CONSTRAINT "governance_policies_environment_check"
    CHECK ("environment" IN ('sandbox', 'production', 'both')),
  CONSTRAINT "governance_policies_priority_check"
    CHECK ("priority" BETWEEN 1 AND 10000)
);

-- Index for priority-ordered active policy lookup (hot path in RGE)
CREATE INDEX IF NOT EXISTS "governance_policies_active_priority_idx"
  ON "governance_policies" ("is_active", "priority" ASC, "environment")
  WHERE "is_active" = true;

-- Index for environment-scoped lookups
CREATE INDEX IF NOT EXISTS "governance_policies_env_idx"
  ON "governance_policies" ("environment", "is_active");

-- Seed bootstrap policies (additive — will not overwrite existing rows)
-- These mirror the hardcoded TypeScript rules in runtime-governance-engine.ts
-- so the DB takes precedence once available

INSERT INTO "governance_policies" (
  "id", "name", "description", "rule", "priority", "environment", "is_active", "created_by"
) VALUES (
  'policy-require-approval-critical',
  'Require approval for CRITICAL risk actions',
  'Any action with risk_level=CRITICAL must go through the approval workflow before execution. Two-person rule enforced.',
  '{
    "type": "CONDITION",
    "field": "risk_level",
    "operator": "eq",
    "value": "CRITICAL",
    "escalate_to": "REQUIRE_APPROVAL",
    "required_approvals": 2,
    "ttl_seconds": 14400
  }'::jsonb,
  10,
  'both',
  true,
  'migration'
), (
  'policy-require-approval-high',
  'Require approval for HIGH risk actions',
  'Any action with risk_level=HIGH must be approved before execution.',
  '{
    "type": "CONDITION",
    "field": "risk_level",
    "operator": "eq",
    "value": "HIGH",
    "escalate_to": "REQUIRE_APPROVAL",
    "required_approvals": 1,
    "ttl_seconds": 86400
  }'::jsonb,
  20,
  'both',
  true,
  'migration'
), (
  'policy-block-bulk-delete',
  'Block bulk delete operations on all resources',
  'Bulk delete actions are categorically blocked regardless of risk level. Submit an exception request through the governance team.',
  '{
    "type": "CONDITION",
    "field": "action",
    "operator": "matches",
    "value": "^bulk[_-]?delete",
    "escalate_to": "BLOCK"
  }'::jsonb,
  5,
  'both',
  true,
  'migration'
), (
  'policy-warn-moderate-risk',
  'Warn on MODERATE risk actions',
  'MODERATE risk actions are allowed but generate a governance audit warning for operator visibility.',
  '{
    "type": "CONDITION",
    "field": "risk_level",
    "operator": "eq",
    "value": "MODERATE",
    "escalate_to": "WARN"
  }'::jsonb,
  50,
  'both',
  true,
  'migration'
), (
  'policy-service-account-high-resource',
  'Require approval for service accounts accessing high-value resources',
  'Service actor types requesting access to production or critical resources require human approval.',
  '{
    "type": "AND",
    "children": [
      {
        "type": "CONDITION",
        "field": "actor_type",
        "operator": "eq",
        "value": "service"
      },
      {
        "type": "CONDITION",
        "field": "resource",
        "operator": "matches",
        "value": "^(production|prod|critical)/"
      }
    ],
    "escalate_to": "REQUIRE_APPROVAL",
    "required_approvals": 1
  }'::jsonb,
  30,
  'production',
  true,
  'migration'
)
ON CONFLICT ("id") DO NOTHING;
