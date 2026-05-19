-- Create ExecutionJournal table for transactional state recovery
CREATE TABLE "execution_journal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "decisionId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'STARTED',
  "externalState" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "execution_journal_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "execution_journal_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions" ("id") ON DELETE CASCADE
);

-- Indexes for reconciliation queries
CREATE INDEX "execution_journal_status_idx" ON "execution_journal"("status");
CREATE INDEX "execution_journal_decisionId_idx" ON "execution_journal"("decisionId");
CREATE INDEX "execution_journal_tenant_status_idx" ON "execution_journal"("tenantId", "status");

-- Index for finding incomplete executions (for reconciliation)
CREATE INDEX "execution_journal_incomplete_idx" ON "execution_journal"("status") WHERE "status" = 'STARTED';
