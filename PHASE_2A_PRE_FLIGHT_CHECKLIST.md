# Phase 2A Pre-Flight Checklist

**Purpose**: Verify all systems are ready before deploying to sandbox.

**Estimated Time**: 1 hour

**Sign-Off Required**: Technical Lead + Operations Lead

**STATUS UPDATE (2026-05-28)**: Architecture validation COMPLETE. Feature development underway (Tier 1: Audit Persistence).  
All pre-deployment checks ready to execute. Deployment can begin after Tier 1 features complete.

---

## Section 1: Code Verification (15 min)

### Imports and Dependencies

- [ ] `governance-snapshot.ts` compiles without errors
  ```bash
  npm run build -- --include core/governance/governance-snapshot.ts
  ```
  
- [ ] `governance-replay.ts` compiles without errors
  ```bash
  npm run build -- --include core/governance/governance-replay.ts
  ```

- [ ] `governance-integrity.ts` imports resolve
  ```bash
  grep "import.*governance-replay" core/governance/governance-integrity.ts
  grep "import.*governance-snapshot" core/governance/governance-integrity.ts
  ```
  **Expected**: Both imports present

- [ ] `runtime-governance-engine.ts` snapshot capture wired
  ```bash
  grep "captureGovernanceSnapshot" core/governance/engine/runtime-governance-engine.ts
  ```
  **Expected**: Function called in evaluate() method

- [ ] `governance-observer.ts` imports present
  ```bash
  grep "import.*governance-replay" core/governance/governance-observer.ts
  grep "replaySampler" core/governance/governance-observer.ts
  ```
  **Expected**: Both present

### No Circular Dependencies

- [ ] Run dependency check
  ```bash
  npm run build 2>&1 | grep -i "circular\|cycle"
  ```
  **Expected**: No circular dependency errors

### All Tests Pass

- [ ] Unit tests pass
  ```bash
  npm test -- governance
  ```
  **Expected**: All tests pass (or list any known failures)

- [ ] Integration tests pass
  ```bash
  npm test -- governance-integration
  ```
  **Expected**: All integration tests pass

---

## Section 2: Environment Configuration (10 min)

### Environment Variables

- [ ] `.env` file has `APP_GOVERNANCE_MODE=SHADOW`
  ```bash
  grep "APP_GOVERNANCE_MODE" .env
  ```
  **Expected**: `APP_GOVERNANCE_MODE=SHADOW`

- [ ] `docker-compose.yml` has environment variable
  ```bash
  grep "APP_GOVERNANCE_MODE" docker-compose.yml
  ```
  **Expected**: Variable present in api service

- [ ] `Dockerfile` supports the variable
  ```bash
  grep "APP_GOVERNANCE_MODE" Dockerfile
  ```
  **Expected**: Either documented or used in startup

### Startup Integration

- [ ] Startup code calls `initializeGovernanceObserver()`
  ```bash
  grep "initializeGovernanceObserver" apps/api/src/main.ts
  ```
  **Expected**: Found in startup sequence

- [ ] Shutdown code calls `shutdownGovernanceObserver()`
  ```bash
  grep "shutdownGovernanceObserver" apps/api/src/main.ts
  ```
  **Expected**: Found in shutdown sequence

### Logging Configuration

- [ ] Logs are written to `logs/*.json`
  ```bash
  ls -la logs/
  ```
  **Expected**: Directory exists and is writable

- [ ] Log format supports JSON (not text)
  **Check**: Ensure logger is configured for JSON output

---

## Section 3: Deployment Readiness (20 min)

### Build Verification

- [ ] Full build completes without errors
  ```bash
  npm run build
  ```
  **Expected**: Build succeeds, no warnings in governance code

- [ ] Build output size is reasonable
  ```bash
  ls -lh dist/
  ```
  **Expected**: No unexpectedly large files

### Docker Build

- [ ] Docker image builds successfully
  ```bash
  docker build -t governance:test .
  ```
  **Expected**: Build completes, no errors

- [ ] Container starts without errors
  ```bash
  docker run --rm -it -e APP_GOVERNANCE_MODE=SHADOW governance:test
  ```
  **Expected**: Container starts, initial logs appear

### Dependency Sizes

- [ ] No new external dependencies added
  ```bash
  grep "governance" package.json | grep "dependencies"
  ```
  **Expected**: No new large dependencies introduced

---

## Section 4: Log Verification (15 min)

### Start Application in SHADOW Mode

```bash
export APP_GOVERNANCE_MODE=SHADOW
npm run start
```

**Wait for startup to complete (30 seconds)**

### Verify Startup Logs

- [ ] `[GOVERNANCE_MODE_STARTUP]` log appears
  ```bash
  tail -f logs/*.json | grep GOVERNANCE_MODE_STARTUP
  ```
  **Expected**:
  ```json
  {
    "timestamp": "2026-05-28T...",
    "mode": "SHADOW"
  }
  ```

- [ ] `[GOVERNANCE_ENGINE_INITIALIZED]` log appears
  ```bash
  grep GOVERNANCE_ENGINE_INITIALIZED logs/*.json
  ```
  **Expected**: Found with environment (sandbox or production)

- [ ] `[GOVERNANCE_OBSERVER_START]` log appears
  ```bash
  grep GOVERNANCE_OBSERVER_START logs/*.json
  ```
  **Expected**: Found with window_start timestamp

### Trigger a Governance Evaluation

Generate a test request:
```bash
curl -X POST http://localhost:3000/api/governance/test \
  -H "Content-Type: application/json" \
  -d '{
    "action": "test_action",
    "resource": "test://resource",
    "actor_id": "test-actor",
    "actor_type": "agent"
  }'
```

- [ ] `[GOVERNANCE_DECISION]` log appears
  ```bash
  tail -f logs/*.json | grep GOVERNANCE_DECISION
  ```
  **Expected**:
  ```json
  {
    "decision": "ALLOW",
    "decision_id": "decision-...",
    "input_fingerprint": "input-...",
    "evaluation_ms": 2.5
  }
  ```

- [ ] `[GOVERNANCE_SNAPSHOT]` log appears
  ```bash
  tail -f logs/*.json | grep GOVERNANCE_SNAPSHOT
  ```
  **Expected**:
  ```json
  {
    "decision_id": "decision-...",
    "versions": {
      "normalization_version": "1.0",
      "policy_schema_version": "1.0",
      "governance_schema_version": "1.0",
      "governance_engine_version": "1.0"
    }
  }
  ```

- [ ] Replay sampler receives snapshot
  **Check**: Sampler buffer has at least 1 item
  ```bash
  # This would require a test endpoint to verify sampler state
  # For now, verify logs indicate snapshot was processed
  grep "GOVERNANCE_SNAPSHOT" logs/*.json | wc -l
  ```
  **Expected**: Count increases with each request

### Verify Observation Loop

Wait 5-10 minutes for observation tick:

- [ ] `[GOVERNANCE_OBSERVATION_STATE]` appears every 5 minutes
  ```bash
  tail -f logs/*.json | grep GOVERNANCE_OBSERVATION_STATE
  ```
  **Expected**:
  ```json
  {
    "mode": "SHADOW",
    "cumulative_evaluations": 1,
    "cumulative_mismatches": 0,
    "cumulative_failures": 0,
    "latest_integrity_state": "HEALTHY",
    "stage_transition_ready": false
  }
  ```

- [ ] `[GOVERNANCE_INTEGRITY_CHECK]` appears every 5 minutes
  ```bash
  tail -f logs/*.json | grep GOVERNANCE_INTEGRITY_CHECK
  ```
  **Expected**: All checks present, state is HEALTHY

- [ ] `[GOVERNANCE_DRIFT_REPORT]` appears every 5 minutes
  ```bash
  tail -f logs/*.json | grep GOVERNANCE_DRIFT_REPORT
  ```
  **Expected**: Summary with total_evaluations, mismatches, failures

---

## Section 5: Metrics Infrastructure (10 min)

### Metrics Collection

- [ ] Metrics are being recorded
  ```bash
  # Verify recordGovernanceDecision is called
  grep "recordGovernanceDecision" logs/*.json | wc -l
  ```
  **Expected**: Count > 0 after test requests

- [ ] Shadow consensus rate calculable
  ```bash
  # Verify getShadowConsensusRate is available
  grep "consensus" logs/*.json
  ```
  **Expected**: Consensus rate appears in reports

- [ ] Latency percentiles calculable
  ```bash
  # Verify evaluation_ms is recorded
  grep "evaluation_ms" logs/*.json | head -3
  ```
  **Expected**: Latency values present

### Replay Sampler

- [ ] Sampler buffer size tracked
  ```bash
  grep "sample_buffer_size" logs/*.json
  ```
  **Expected**: Buffer size increases with evaluations

- [ ] Drift types classified
  ```bash
  grep "divergence_classification" logs/*.json
  ```
  **Expected**: Drift type field present (will be UNKNOWN until divergence)

---

## Section 6: Safety Verification (10 min)

### Fail-Closed Defaults

- [ ] Invalid mode defaults to SHADOW
  ```bash
  export APP_GOVERNANCE_MODE=INVALID_MODE
  npm run start 2>&1 | grep -i "shadow\|default"
  ```
  **Expected**: System logs defaulting to SHADOW

### Rollback Readiness

- [ ] Rollback procedure tested (simulate)
  ```bash
  # Verify mode can be changed
  export APP_GOVERNANCE_MODE=SHADOW
  # (already running, can change env and restart)
  ```
  **Expected**: Mode change takes effect on restart

- [ ] Old validator still accessible
  ```bash
  # Verify old governance decision path still works
  curl http://localhost:3000/api/old-governance/decision
  ```
  **Expected**: Old endpoint still functional

### No Data Loss on Restart

- [ ] Logs are durable across restart
  ```bash
  DECISION_COUNT_BEFORE=$(grep GOVERNANCE_DECISION logs/*.json | wc -l)
  # Restart service
  DECISION_COUNT_AFTER=$(grep GOVERNANCE_DECISION logs/*.json | wc -l)
  # Should be equal or higher
  ```
  **Expected**: `DECISION_COUNT_AFTER >= DECISION_COUNT_BEFORE`

---

## Section 7: Documentation Readiness (5 min)

### Operator Resources

- [ ] `PHASE_2A_OPERATOR_QUICK_REFERENCE.md` reviewed
  - [ ] Operator can find log grep commands
  - [ ] Operator can identify red flags
  - [ ] Operator can follow stage progression

- [ ] `PHASE_2A_SHADOW_VALIDATION_CHECKLIST.md` available
  - [ ] Integration checklist present
  - [ ] Metrics to watch identified
  - [ ] Success criteria clear

- [ ] `PHASE_2A_STARTUP_INTEGRATION.md` completed
  - [ ] Startup integration steps done
  - [ ] Environment configuration complete
  - [ ] Verification checklist passed

### Alert Procedures

- [ ] Alert on mismatch defined
  ```bash
  grep GOVERNANCE_DECISION logs/*.json | grep "mismatch: true"
  ```
  **Expected**: Procedure to alert if found

- [ ] Alert on failure defined
  ```bash
  grep GOVERNANCE_EVALUATION_FAILED logs/*.json
  ```
  **Expected**: Procedure to alert if found

- [ ] Alert on integrity degradation defined
  ```bash
  grep "state: DEGRADED\|state: FAILED" logs/*.json
  ```
  **Expected**: Procedure to alert if found

---

## Sign-Off Section

### Technical Lead Verification

- [ ] All code checks passed: **YES / NO**
- [ ] All environment checks passed: **YES / NO**
- [ ] All log verification passed: **YES / NO**
- [ ] No blockers remain: **YES / NO**

**Technical Lead Name**: ___________________  
**Technical Lead Signature**: ___________________  
**Date/Time**: ___________________

### Operations Lead Verification

- [ ] Operator documentation reviewed: **YES / NO**
- [ ] Alert procedures understood: **YES / NO**
- [ ] Rollback procedure verified: **YES / NO**
- [ ] Team is ready to monitor: **YES / NO**

**Operations Lead Name**: ___________________  
**Operations Lead Signature**: ___________________  
**Date/Time**: ___________________

---

## Deployment Authorization

- [ ] Technical Lead approves deployment
- [ ] Operations Lead approves deployment
- [ ] All checklist items complete

**APPROVED FOR PHASE A DEPLOYMENT**: **YES / NO**

**Approval Date/Time**: ___________________

---

## If Any Item Fails

**DO NOT PROCEED.** For each failed item:

1. **Document the failure**
   - What was expected?
   - What was observed?
   - Why did it fail?

2. **Root cause analysis**
   - Is this a code issue?
   - Is this an environment issue?
   - Is this a configuration issue?

3. **Remediation**
   - Fix the issue
   - Re-run the verification
   - Document the fix

4. **Re-sign-off**
   - Re-verify the failed item
   - Update this checklist
   - Get fresh sign-off from leads

---

**Checklist Version**: 1.0  
**Created**: 2026-05-28  
**Status**: Ready for use
