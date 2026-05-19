# Chaos Testing Setup

## Overview

This document provides setup and execution instructions for the chaos test suite.

## Prerequisites

### System Requirements
- Docker daemon running (for Testcontainers)
- Node.js 18+
- npm or yarn

### Environment

The chaos tests spin up ephemeral containers:
- PostgreSQL 15 (Testcontainers)
- Redis 7 Alpine (Testcontainers)
- WireMock latest (Testcontainers)

All containers are automatically cleaned up after tests complete.

## Installation

### 1. Install Dependencies

```bash
npm install --save-dev vitest @testcontainers/testcontainers @testcontainers/postgresql ioredis node-fetch
```

### 2. Configure Testcontainers

Create `.testcontainersrc` in project root (optional, for advanced config):

```json
{
  "debug": false,
  "customized": false,
  "ryuk.enabled": true,
  "docker.host": "unix:///var/run/docker.sock"
}
```

### 3. Environment Setup

No special environment variables needed for local development. For CI:

```bash
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
export TESTCONTAINERS_RYUK_DISABLED=false
```

## Running Tests

### Local Development

```bash
# Run all chaos tests
npm run test:chaos

# Watch mode (re-run on file changes)
npm run test:chaos:watch

# With coverage
npm run test:chaos:coverage
```

### Individual Scenarios

```bash
# Run specific test file
npx vitest run --config vitest.chaos.config.ts tests/chaos/scenarios/01-db-failure-mid-execution.test.ts

# Run tests matching pattern
npx vitest run --config vitest.chaos.config.ts --grep "DB Failure"
```

### Debugging

Enable detailed logs:

```bash
LOG_LEVEL=debug npm run test:chaos
```

View live test output:

```bash
npm run test:chaos:watch -- --reporter=verbose
```

## Test Scenarios

### 1. DB Failure Mid-Execution
**File:** `tests/chaos/scenarios/01-db-failure-mid-execution.test.ts`

**Validates:**
- Execution journal prevents state inconsistency
- Idempotency keys suppress duplicate executions
- Crash-safe recovery logic

**Key Assertions:**
- Journal entry created for every execution attempt
- Decision stays APPROVED if audit write fails
- Reconciliation repairs state based on external probe

### 2. Redis Lock Expiry
**File:** `tests/chaos/scenarios/02-redis-lock-expiry.test.ts`

**Validates:**
- Distributed lock acquisition and TTL
- SKIP LOCKED semantics in sweeper
- Idempotency of reawaken operations

**Key Assertions:**
- No duplicate reawakenings across concurrent sweepers
- MAX_REAWAKENS guard prevents infinite loops
- Lock expiry handled gracefully

### 3. Splunk 500 / Timeout
**File:** `tests/chaos/scenarios/03-splunk-500-timeout.test.ts`

**Validates:**
- Circuit breaker prevents cascade failures
- Timeout handling is deterministic
- Partial execution is impossible

**Key Assertions:**
- Decision stays APPROVED on external failure
- Journal marked FAILED (safe to retry)
- No partial state between Splunk and DB

### 4. Concurrent Sweep Race
**File:** `tests/chaos/scenarios/04-concurrent-sweep-race.test.ts`

**Validates:**
- FOR UPDATE SKIP LOCKED prevents duplicate processing
- Database-level concurrency control
- State consistency under parallel updates

**Key Assertions:**
- Exactly-once semantics with multiple sweepers
- No deadlocks or race conditions
- reawokenCount remains valid (no explosion)

## Invariants Tested

All chaos tests validate these invariants:

```sql
-- Invariant 1: No Duplicate Execution
SELECT decision_id, COUNT(*)
FROM execution_journal
GROUP BY decision_id
HAVING COUNT(*) > 1;
-- Must return: 0 rows

-- Invariant 2: Every Executed Decision Has Audit
SELECT d.id
FROM decisions d
LEFT JOIN audit_events a ON a.decision_id = d.id
WHERE d.status = 'EXECUTED'
GROUP BY d.id
HAVING COUNT(a.id) = 0;
-- Must return: 0 rows

-- Invariant 3: Blast Radius Never Violated
SELECT tenant_id, COUNT(*)
FROM decisions
WHERE status='EXECUTED' AND executed_at > NOW() - INTERVAL '1 hour'
GROUP BY tenant_id
HAVING COUNT(*) > 5;
-- Must return: 0 rows

-- Invariant 4: Deferred Decisions Eventually Resolve
SELECT id
FROM decisions
WHERE status='DEFERRED' AND deferred_until < NOW() - INTERVAL '7 days';
-- Must return: 0 rows
```

## Troubleshooting

### Container Won't Start

```bash
# Check Docker daemon
docker ps

# Verify Testcontainers config
cat ~/.testcontainersrc

# Try with verbose logging
LOG_LEVEL=debug npm run test:chaos 2>&1 | head -100
```

### Timeout Errors

Increase test timeout in `vitest.chaos.config.ts`:

```typescript
testTimeout: 120000, // 2 minutes
```

### Port Already in Use

If container ports conflict:

```bash
# Stop conflicting containers
docker ps | grep testcontainers | awk '{print $1}' | xargs docker stop

# Clear containers
docker system prune -f
```

### Prisma Client Mismatch

Regenerate Prisma client:

```bash
npx prisma generate
```

## Performance

Expected test suite runtime:

| Scenario | Time |
|----------|------|
| Container startup | 10-15s |
| DB setup | 2-3s |
| Test 1 (DB Failure) | 3-5s |
| Test 2 (Redis Lock) | 2-4s |
| Test 3 (Splunk 500) | 3-5s |
| Test 4 (Concurrent Sweep) | 3-5s |
| **Total** | **25-35s** |

Run with `--reporter=verbose` to see per-test timings.

## CI Integration

### GitHub Actions

Tests run on:
- Push to `main`, `develop`
- Pull requests to `main`
- File changes in `packages/core/**`, `packages/infra/queue/**`, `tests/chaos/**`

See `.github/workflows/chaos-test.yml` for full workflow.

### Pre-commit Hook (Optional)

Add to `.husky/pre-push`:

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npm run test:chaos -- --run
```

## Next Steps

After chaos tests pass:

1. **Staging Drills** — Run same scenarios against deployed system
2. **Alert Validation** — Verify alert routing and escalation
3. **Operator Training** — Show ops team failure recovery flows
4. **Production Deployment** — Deploy with confidence gates

## Metrics & Monitoring

Chaos test results are emitted as Prometheus metrics:

```
governance_chaos_test_duration_seconds
governance_chaos_test_passed_total
governance_chaos_test_failed_total
```

Track these over time to detect regressions.

## Architecture References

- **Execution Journal**: `packages/core/workflow/executor-v2.ts`
- **Reconciliation Worker**: `packages/infra/queue/reconciliation-worker.ts`
- **External Adapters**: `packages/core/adapters/`
- **Testcontainers Setup**: `tests/chaos/testcontainers.setup.ts`

## Questions?

For debugging specific scenarios, add this to test:

```typescript
console.log('=== Test State ===');
const decisions = await db.decision.findMany({ where: { tenantId: 'test-tenant' } });
const journals = await db.executionJournal.findMany();
const audits = await db.auditEvent.findMany();
console.log({ decisions, journals, audits });
```

This gives you full visibility into the test database state.
