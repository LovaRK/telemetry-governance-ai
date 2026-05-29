-- Create governance_audit_events table for immutable decision audit trail
-- CRITICAL: This is the foundation for compliance, approval workflows, and revocation tracking
-- Every governance decision is logged here for forensic analysis and operator visibility
CREATE TABLE "governance_audit_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "decisionId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "riskLevel" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'sandbox',
  "traceId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "causationId" TEXT,
  "integrityState" TEXT,
  "governanceMode" TEXT NOT NULL DEFAULT 'SHADOW',
  "policySnapshotHash" TEXT,
  "matchedPolicies" TEXT,
  "reasons" JSONB,
  "evaluationMs" REAL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB
);

-- Indexes for compliance and forensic queries
CREATE INDEX "governance_audit_events_decision_id_idx" ON "governance_audit_events"("decisionId");
CREATE INDEX "governance_audit_events_trace_id_idx" ON "governance_audit_events"("traceId");
CREATE INDEX "governance_audit_events_correlation_id_idx" ON "governance_audit_events"("correlationId");
CREATE INDEX "governance_audit_events_actor_idx" ON "governance_audit_events"("actorId", "actor");
CREATE INDEX "governance_audit_events_action_idx" ON "governance_audit_events"("action");
CREATE INDEX "governance_audit_events_decision_idx" ON "governance_audit_events"("decision");
CREATE INDEX "governance_audit_events_risk_idx" ON "governance_audit_events"("riskLevel");
CREATE INDEX "governance_audit_events_environment_idx" ON "governance_audit_events"("environment");
CREATE INDEX "governance_audit_events_created_at_idx" ON "governance_audit_events"("createdAt");

-- Composite indexes for common audit queries
CREATE INDEX "governance_audit_events_actor_date_idx" ON "governance_audit_events"("actorId", "createdAt" DESC);
CREATE INDEX "governance_audit_events_action_date_idx" ON "governance_audit_events"("action", "createdAt" DESC);
CREATE INDEX "governance_audit_events_decision_date_idx" ON "governance_audit_events"("decision", "createdAt" DESC);
CREATE INDEX "governance_audit_events_environment_date_idx" ON "governance_audit_events"("environment", "createdAt" DESC);

-- Index for time-range searches (compliance reporting)
CREATE INDEX "governance_audit_events_created_idx" ON "governance_audit_events"("createdAt" DESC);

-- Index for approval workflow filtering (Phase 2B)
CREATE INDEX "governance_audit_events_policy_idx" ON "governance_audit_events"("policySnapshotHash");

-- Index for integrity health tracking
CREATE INDEX "governance_audit_events_integrity_idx" ON "governance_audit_events"("integrityState");
