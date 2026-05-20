/**
 * Phase 2C.1: Data Purity Guardrails Migration
 *
 * Adds data purity tracking to enforce system invariant:
 * All runtime data MUST originate from Splunk, PostgreSQL, or system code.
 * NO synthetic data, mocks, fallbacks, or defaults at persistence layer.
 */

-- Create enum type for data sources
CREATE TYPE data_source AS ENUM ('splunk', 'postgres', 'system');

-- Create enum type for data mode
CREATE TYPE data_mode AS ENUM ('live');

-- Add data purity columns to execution_journal table
-- These columns track the origin and lineage of every persisted execution
ALTER TABLE "execution_journal"
  ADD COLUMN source TEXT,
  ADD COLUMN mode TEXT,
  ADD COLUMN "traceId" UUID;

-- Create index on traceId for audit trail queries
CREATE INDEX "execution_journal_traceId_idx" ON "execution_journal"("traceId");

-- Create index on (source, createdAt) for data provenance analysis
CREATE INDEX "execution_journal_source_time_idx" ON "execution_journal"(source, "createdAt" DESC);

-- Create data purity audit table for immutable event logging
CREATE TABLE "data_purity_audit" (
  "id" BIGSERIAL PRIMARY KEY,
  "executionJournalId" TEXT NOT NULL REFERENCES "execution_journal"("id") ON DELETE CASCADE,
  source data_source NOT NULL,
  mode data_mode NOT NULL,
  "traceId" UUID NOT NULL,
  "violationType" VARCHAR(64),
  "violationMessage" TEXT,
  "validationTimestamp" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for audit queries
CREATE INDEX "data_purity_audit_executionJournalId_idx" ON "data_purity_audit"("executionJournalId", "validationTimestamp" DESC);
CREATE INDEX "data_purity_audit_traceId_idx" ON "data_purity_audit"("traceId", "createdAt" DESC);
CREATE INDEX "data_purity_audit_violationType_idx" ON "data_purity_audit"("violationType", "createdAt" DESC);

-- L3 Database Hardening: Add constraints to prevent invalid data
ALTER TABLE "execution_journal"
ALTER COLUMN mode SET NOT NULL;

ALTER TABLE "execution_journal"
ADD CONSTRAINT chk_mode_live CHECK (mode = 'live');

ALTER TABLE "data_purity_audit"
ADD CONSTRAINT chk_source_valid
CHECK (source IN ('splunk', 'postgres', 'system'));

-- Comments for clarity
COMMENT ON COLUMN "execution_journal".source IS
  'Data source: splunk, postgres, or system. Every execution must originate from one of these.';
COMMENT ON COLUMN "execution_journal".mode IS
  'Data mode: ONLY "live" allowed. Enforced by CHECK constraint.';
COMMENT ON COLUMN "execution_journal"."traceId" IS
  'W3C Trace Context correlation ID for end-to-end distributed tracing and lineage.';
