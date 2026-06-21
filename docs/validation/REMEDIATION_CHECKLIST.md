# Governance Audit Implementation — Remediation Checklist

**Status:** BLOCKING ISSUE FOR PRODUCTION
**Severity:** CRITICAL
**Target Resolution:** Before prod deployment

---

## Issue Summary

The GOVERNANCE_SYNC pipeline stage is a no-op placeholder. No audit records are created when decisions are made, leaving no audit trail for compliance.

**Current State:**
```
governance_audit_snapshots: 0 rows (should have 6+)
decision_history: 0 rows (should have 6+)
```

**Expected State After Fix:**
```
governance_audit_snapshots: At least 6 rows (one per index analyzed)
decision_history: At least 6 rows (one per decision made)
Pipeline logs: "Recorded governance audit for index X"
```

---

## Implementation Tasks

### TASK 1: Locate Governance Sync Implementation

- [ ] File: `/Users/ramakrishna/Desktop/Teja/Dashboards/docker/worker.ts`
- [ ] Search for: `stage: 'GOVERNANCE_SYNC'`
- [ ] Current code (line ~450):
  ```typescript
  await appendStageEvent({
    runId,
    stage: 'GOVERNANCE_SYNC',
    status: 'SUCCESS',
    requestId,
    metadata: { modelId, promptId },
  });
  ```
- [ ] Status: Found and verified as no-op

### TASK 2: Import Governance Audit Service

- [ ] File: `/Users/ramakrishna/Desktop/Teja/Dashboards/docker/worker.ts`
- [ ] Add import at top:
  ```typescript
  import { recordGovernanceAudit } from '@api/services/governance-telemetry-service';
  ```
- [ ] Alternative import:
  ```typescript
  import { recordGovernanceDecision } from '@core/governance/governance-audit-store';
  ```
- [ ] Verify service exists: `grep -r "export.*recordGovernance" /apps/api/services/`

### TASK 3: Implement Governance Audit Recording

- [ ] File: `/Users/ramakrishna/Desktop/Teja/Dashboards/docker/worker.ts`
- [ ] Location: Just before `GOVERNANCE_SYNC` SUCCESS event (around line 450)
- [ ] Add code to record audit snapshot for each decision:
  ```typescript
  // Record governance audit for each analyzed index
  for (const decision of totalDecisions) {
    await recordGovernanceAudit({
      indexName: decision.index,
      snapshotId: snapshotId,
      tenantId: tenantId,
      modelId: runtime.modelId,
      promptId: runtime.promptId,
      decision: decision.action,
      confidence: decision.confidence_score,
      timestamp: new Date().toISOString(),
    });
  }
  ```
- [ ] Ensure no errors thrown (governance must not block pipeline)
- [ ] Add try-catch if needed:
  ```typescript
  try {
    // audit recording
  } catch (e) {
    console.error('[Worker] Governance audit failed (non-blocking):', e);
  }
  ```

### TASK 4: Populate Decision History

- [ ] File: `/Users/ramakrishna/Desktop/Teja/Dashboards/docker/worker.ts` (or dedicated service)
- [ ] Add logic to insert into `decision_history` table:
  ```sql
  INSERT INTO decision_history (
    snapshot_id, index_name, decision_action,
    confidence_score, model_id, prompt_id,
    created_at, tenant_id
  ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
  ```
- [ ] Link to `agent_decisions` table
- [ ] Verify schema matches `/core/database/schema/decision-history.sql`

### TASK 5: Update Records Processed Counter

- [ ] File: `/Users/ramakrishna/Desktop/Teja/Dashboards/docker/worker.ts`
- [ ] Modify GOVERNANCE_SYNC event to track records:
  ```typescript
  await appendStageEvent({
    runId,
    stage: 'GOVERNANCE_SYNC',
    status: 'SUCCESS',
    requestId,
    records_processed: totalDecisions,  // ← ADD THIS
    metadata: { auditRecordsCreated: totalDecisions, modelId, promptId },
  });
  ```

### TASK 6: Add Logging

- [ ] File: `/Users/ramakrishna/Desktop/Teja/Dashboards/docker/worker.ts`
- [ ] Add debug logs before GOVERNANCE_SYNC:
  ```typescript
  console.log(`[Worker] Recording governance audit for ${totalDecisions} decisions`);
  ```
- [ ] Add success log after:
  ```typescript
  console.log(`[Worker] Governance audit recorded: ${auditRowsInserted} snapshots`);
  ```

### TASK 7: Test with Minimal Case

- [ ] Method: Trigger a single pipeline run
- [ ] Command: `curl -X POST http://localhost:3002/api/cache`
- [ ] Verify: `docker exec docker-postgres-1 psql -U telemetry -d telemetry_os -c "SELECT COUNT(*) FROM governance_audit_snapshots;"`
- [ ] Expected result: At least 1 row (0 → 1+)

### TASK 8: Verify Database Records

After implementation, run these queries:

```sql
-- Check governance audit snapshots created
SELECT COUNT(*) FROM governance_audit_snapshots;

-- Check decision history populated
SELECT COUNT(*) FROM decision_history;

-- Verify linkage to agent_decisions
SELECT ad.id, ad.index_name, dh.decision_action
FROM agent_decisions ad
LEFT JOIN decision_history dh ON ad.snapshot_id = dh.snapshot_id
LIMIT 5;

-- Check pipeline events reflect records_processed
SELECT stage, records_processed, status
FROM pipeline_stage_events
WHERE stage = 'GOVERNANCE_SYNC'
ORDER BY started_at DESC LIMIT 1;
```

Expected results:
```
governance_audit_snapshots count: 6+ (one per index)
decision_history count: 6+ (one per decision)
pipeline_stage_events GOVERNANCE_SYNC records_processed: 6+ (not 0)
```

### TASK 9: End-to-End Integration Test

- [ ] Create test file: `/tests/integration/governance-audit-e2e.test.ts`
- [ ] Test steps:
  1. Call `/api/cache` endpoint
  2. Wait for pipeline to complete (poll `/api/pipeline-runs/{runId}` until status=SUCCEEDED)
  3. Query `governance_audit_snapshots` for new records
  4. Assert: count > 0 and records match decisions made
  5. Verify: each record has valid indexName, snapshotId, modelId, promptId
  6. Verify: timestamp is recent (within 1 minute of test start)
- [ ] Success criteria: All assertions pass

### TASK 10: Update Documentation

- [ ] Update `/docs/GOVERNANCE_AUDIT_IMPLEMENTATION.md` with:
  - What changed in worker.ts
  - New audit records being created
  - How to query audit trail
  - Compliance implications
- [ ] Add to CHANGELOG
- [ ] Update project README if governance is user-facing feature

---

## Verification Commands

### Before Fix (Current State)
```bash
$ docker exec docker-postgres-1 psql -U telemetry -d telemetry_os \
  -c "SELECT COUNT(*) FROM governance_audit_snapshots;"
 count 
-------
     0
(1 row)
```

### After Fix (Expected)
```bash
$ docker exec docker-postgres-1 psql -U telemetry -d telemetry_os \
  -c "SELECT COUNT(*) FROM governance_audit_snapshots;"
 count 
-------
     6
(1 row)

$ docker exec docker-postgres-1 psql -U telemetry -d telemetry_os \
  -c "SELECT COUNT(*) FROM decision_history;"
 count 
-------
     6
(1 row)
```

---

## Rollback Plan

If implementation causes pipeline failures:

1. Revert docker/worker.ts to previous commit
2. Delete added records: `DELETE FROM governance_audit_snapshots WHERE created_at > NOW() - INTERVAL '1 hour';`
3. Restart worker: `docker restart docker-worker-1`
4. Re-run pipeline to confirm stability

---

## Sign-Off

- [ ] Code changes implemented
- [ ] Unit tests pass
- [ ] Integration test passes
- [ ] Database records verified
- [ ] Documentation updated
- [ ] Ready for production deployment

---

## References

- **Related Issue:** governance_audit_snapshots empty after pipeline (2/3 verification gaps)
- **Related Files:**
  - `/docker/worker.ts` — GOVERNANCE_SYNC stage
  - `/core/governance/governance-audit-store.ts` — Audit recording service
  - `/apps/api/services/governance-telemetry-service.ts` — Telemetry recording service
  - `/docs/validation/FIRST_TIME_USER_VALIDATION.md` — Full validation report

---
