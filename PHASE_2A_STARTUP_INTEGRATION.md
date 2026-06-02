# Phase 2A: Application Startup Integration

**Status**: Ready to Integrate  
**Date**: 2026-05-28  
**Purpose**: Wire governance infrastructure on application startup

---

## Overview

The governance infrastructure is now complete:
- ✅ Runtime Governance Engine records metrics
- ✅ Metrics collection captures every decision
- ✅ Drift reports can be generated hourly
- ✅ Integrity checks evaluate governance health
- ✅ Observer service monitors continuously

Now the final step: **Initialize the observer service on application startup**.

---

## Integration Points

### 1. Application Startup Sequence

**Location**: Your main application entry point (e.g., `src/main.ts`, `src/server.ts`, or `apps/api/app.ts`)

**Code to Add**:

```typescript
// At the top of your startup sequence
import { initializeGovernanceObserver } from './core/governance/governance-observer';
import { logGovernanceModeStartup } from './core/governance/governance-mode';

// In your startup handler:
async function startApplication() {
  // ... existing startup code ...

  // Initialize governance infrastructure
  console.log('[APP_STARTUP] Initializing governance infrastructure...');
  
  // Log governance mode (helps operators understand current enforcement state)
  logGovernanceModeStartup();
  
  // Start governance observer (continuous monitoring every 5 minutes)
  initializeGovernanceObserver();
  
  console.log('[APP_STARTUP] Governance infrastructure initialized');

  // ... rest of startup sequence ...
}
```

### 2. Graceful Shutdown Sequence

**Location**: Your application shutdown handler

**Code to Add**:

```typescript
import { shutdownGovernanceObserver } from './core/governance/governance-observer';

// In your shutdown handler:
async function shutdownApplication() {
  console.log('[APP_SHUTDOWN] Shutting down governance infrastructure...');
  
  // Stop observer service and clean up
  shutdownGovernanceObserver();
  
  console.log('[APP_SHUTDOWN] Governance infrastructure stopped');

  // ... rest of shutdown sequence ...
}
```

### 3. Environment Variable Configuration

**File**: `.env.example`

**Content to Add**:

```bash
# Governance Configuration
# Controls how governance decisions are enforced
# Options: DISABLED, SHADOW, ENFORCING_LOG_ONLY, ENFORCING_NON_CRITICAL, FULL_ENFORCING
APP_GOVERNANCE_MODE=SHADOW

# Phase 2A Default:
# - sandbox: Always SHADOW (safe for development/testing)
# - staging: ENFORCING_LOG_ONLY (canary before production)
# - production: FULL_ENFORCING (after gates passed, not before)
```

### 4. Docker Configuration

**File**: `Dockerfile`

**Content to Add**:

```dockerfile
# Set governance mode (Phase 2A: Shadow mode for safety)
ENV APP_GOVERNANCE_MODE=SHADOW

# Ensure governance logging is visible
ENV NODE_LOG_LEVEL=info
```

### 5. Docker Compose Configuration

**File**: `docker-compose.yml`

**Content to Add**:

```yaml
services:
  api:
    # ... existing config ...
    environment:
      # Governance configuration
      APP_GOVERNANCE_MODE: ${APP_GOVERNANCE_MODE:-SHADOW}
      # ... rest of environment ...
```

---

## Verification Checklist

After integration, verify that startup produces these log lines:

```
[GOVERNANCE_MODE_STARTUP] mode: SHADOW, enforcing: false, active: true, timestamp: 2026-05-28T14:30:45.123Z

[GOVERNANCE_OBSERVER_START] mode: SHADOW, window_start: 2026-05-28T14:30:45.456Z, timestamp: 2026-05-28T14:30:45.456Z
```

Every 5 minutes, verify these logs appear:

```
[GOVERNANCE_DRIFT_REPORT] {
  "window": "5m",
  "timestamp": "2026-05-28T14:35:45.789Z",
  "summary": {
    "total_evaluations": 24,
    "mismatches": 0,
    "evaluation_failures": 0,
    "shadow_consensus_rate": 100,
    "avg_latency_ms": 3.2,
    "p95_latency_ms": 5.8,
    "p99_latency_ms": 7.2
  },
  ...
}

[GOVERNANCE_OBSERVATION_STATE] {
  "mode": "SHADOW",
  "cumulative_evaluations": 124,
  "cumulative_mismatches": 0,
  "cumulative_failures": 0,
  "latest_consensus_rate": 100,
  "latest_integrity_state": "HEALTHY",
  "stage_transition_ready": true,
  "stage_transition_reason": "SHADOW gates met: 100+ evals, 0 mismatches, 0 failures, 100% consensus",
  "timestamp": "2026-05-28T14:35:45.901Z"
}
```

---

## Testing the Integration

### Unit Test: Startup

```typescript
import { initializeGovernanceObserver, shutdownGovernanceObserver, getGovernanceObservationState } from './governance-observer';

describe('Governance Observer Startup', () => {
  it('should initialize observer on startup', () => {
    initializeGovernanceObserver();
    
    const state = getGovernanceObservationState();
    expect(state.mode).toBe('SHADOW');
    expect(state.observation_window_start).toBeTruthy();
    
    shutdownGovernanceObserver();
  });

  it('should generate drift reports every 5 minutes', (done) => {
    initializeGovernanceObserver();
    
    // Wait for first observation tick (simulated)
    setTimeout(() => {
      const state = getGovernanceObservationState();
      expect(state.latest_drift_report).toBeTruthy();
      
      shutdownGovernanceObserver();
      done();
    }, 100);
  });
});
```

### Integration Test: End-to-End

```typescript
import { governanceEngine } from './governance-engine';
import { getGovernanceObservationState } from './governance-observer';

describe('Governance Metrics End-to-End', () => {
  it('should record decision and update observation state', () => {
    // Perform governance evaluation
    const decision = governanceEngine.evaluate({
      trace_id: 'trace-123',
      correlation_id: 'corr-123',
      causation_id: 'caus-123',
      actor_id: 'human-user-1',
      actor_type: 'human',
      action: 'SAVE_SPLUNK_CONFIG',
      resource: 'splunk:config:https://144.202.48.85:8089',
      policy_snapshot_hash: 'policy-v1-phase-2a'
    });

    expect(decision.decision).toBe('ALLOW');

    // Verify metrics were recorded
    const state = getGovernanceObservationState();
    expect(state.cumulative_evaluations).toBeGreaterThan(0);
    expect(state.latest_integrity_state).toBe('HEALTHY');
  });
});
```

---

## Deployment Readiness Checklist

### Code Integration
```
[ ] initializeGovernanceObserver() wired to startup
[ ] shutdownGovernanceObserver() wired to shutdown
[ ] APP_GOVERNANCE_MODE environment variable configured
[ ] Docker environment includes APP_GOVERNANCE_MODE=SHADOW
[ ] All imports in place (no circular dependencies)
```

### Testing
```
[ ] Unit tests for observer startup pass
[ ] Integration tests for metrics recording pass
[ ] Logs show [GOVERNANCE_DRIFT_REPORT] every 5 minutes
[ ] Logs show [GOVERNANCE_OBSERVATION_STATE] every 5 minutes
[ ] No errors in console on startup
```

### Operations
```
[ ] Documentation ready for operators on monitoring
[ ] Alert thresholds defined (mismatch rate, latency, failures)
[ ] Rollback plan documented (how to revert to SHADOW if issues)
[ ] Manual stage transition documented (how to advance SHADOW → LOG_ONLY)
```

---

## Critical Log Lines for Operations

### Every Startup
```
[GOVERNANCE_MODE_STARTUP] Shows current mode
[GOVERNANCE_OBSERVER_START] Shows observation window start
```

### Every 5 Minutes (Drift Report)
```
[GOVERNANCE_DRIFT_REPORT] Shows:
- total_evaluations (target: 100+ by day 2)
- mismatches (target: 0)
- evaluation_failures (target: 0)
- shadow_consensus_rate (target: 100%)
- latency percentiles (target: p95 < 5ms)
```

### Every 5 Minutes (Observation State)
```
[GOVERNANCE_OBSERVATION_STATE] Shows:
- cumulative_evaluations (accumulating)
- cumulative_mismatches (should stay 0)
- cumulative_failures (should stay 0)
- latest_integrity_state (should be HEALTHY)
- stage_transition_ready (when true: gates are met)
- stage_transition_reason (explains readiness)
```

### On Mismatch (Critical Alert)
```
[GOVERNANCE_DECISION] Shows mismatch: true
Followed by [GOVERNANCE_CLASSIFIED_MISMATCH] with type
```

### On Integrity Failure (Critical Alert)
```
[GOVERNANCE_INTEGRITY_CHECK:error] Shows state: FAILED
Recommendation: "ROLLBACK to SHADOW mode immediately"
```

---

## Next Steps After Integration

### Day 1: Verify Logs
1. Deploy with APP_GOVERNANCE_MODE=SHADOW
2. Check that [GOVERNANCE_OBSERVER_START] appears in logs
3. Wait 5 minutes for first [GOVERNANCE_DRIFT_REPORT]
4. Verify evaluation count > 0

### Day 2: Monitor for 24 Hours
1. Watch for mismatches (target: 0)
2. Monitor latency p95 (target: < 5ms)
3. Verify integrity state (should be HEALTHY)
4. Collect at least 100 evaluations

### Day 3: Review Gates
1. Review [GOVERNANCE_OBSERVATION_STATE] for `stage_transition_ready: true`
2. If true, all SHADOW gates are met
3. Get operator sign-off
4. Plan progression to Stage 2 (ENFORCING_LOG_ONLY)

---

## Troubleshooting

### Problem: No governance logs appear
**Solution**: Check that APP_GOVERNANCE_MODE is set and non-empty
```bash
echo $APP_GOVERNANCE_MODE  # Should print SHADOW
```

### Problem: Observer logs appear but no evaluations
**Solution**: No Splunk config requests being made. Observer is working but governance not being exercised.
```
Action: Make test request to save Splunk config
Expected: Evaluation count increases in next drift report
```

### Problem: Integrity state = DEGRADED
**Solution**: Check which check is failing
```
Example: evaluation_failures 8% > threshold 5%
Action: Investigate RGE failures (check logs for [GOVERNANCE_EVALUATION_FAILED])
```

### Problem: Mismatches > 0
**Solution**: RGE producing different decisions than old validator
```
Action: Review [GOVERNANCE_DECISION] logs with mismatch: true
Check: mismatch_type to understand category (POLICY, ENVIRONMENT, etc.)
```

---

## Success Criteria

Integration is successful when:

1. ✅ Application starts without errors
2. ✅ [GOVERNANCE_MODE_STARTUP] log appears
3. ✅ [GOVERNANCE_OBSERVER_START] log appears
4. ✅ [GOVERNANCE_DRIFT_REPORT] appears every 5 minutes
5. ✅ [GOVERNANCE_OBSERVATION_STATE] appears every 5 minutes
6. ✅ Evaluation count increases with real traffic
7. ✅ No mismatches in first 24 hours
8. ✅ Integrity state = HEALTHY
9. ✅ After 100+ evaluations: stage_transition_ready = true

---

## Files Modified

- ✅ `core/governance/runtime-governance-engine.ts` — Metrics recording wired
- ✅ `core/governance/governance-metrics.ts` — Collection infrastructure ready
- ✅ `core/governance/governance-integrity.ts` — Health checks ready
- ✅ `core/governance/governance-observer.ts` — Monitoring service ready
- ⏳ `src/main.ts` or `apps/api/app.ts` — **NEEDS WIRING**
- ⏳ `.env.example` — **NEEDS UPDATE**
- ⏳ `Dockerfile` — **NEEDS UPDATE**
- ⏳ `docker-compose.yml` — **NEEDS UPDATE**

---

## Estimated Effort

- ⏰ Startup integration: 15 minutes
- ⏰ Environment configuration: 10 minutes
- ⏰ Testing and verification: 30 minutes
- ⏰ **Total: ~1 hour**

Ready for production shadow validation after integration.
