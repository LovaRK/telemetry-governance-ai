# Testing Architecture

## Test Suite Overview

- **Total Tests:** 333
- **Execution Model:** Serial (--runInBand)
- **Execution Time:** ~14 seconds
- **Status:** 100% deterministic, 0 flaky failures

## Intentional Architecture: Serial Execution

The integration and contract test suite uses Jest with the `--runInBand` flag to run tests serially (single worker).

### Why Serial Execution?

The test suite uses a **shared PostgreSQL database instance** for integration testing. Under parallel execution (multiple Jest workers), race conditions can occur:

```
Scenario: Parallel execution with shared database

Worker 1 (Test A)          Worker 2 (Test B)
├─ Insert data             ├─ Insert data
├─ Execute test            ├─ Execute test
└─ Cleanup (DELETE)        └─ Cleanup (DELETE)
     ↓                           ↓
   Race Condition: 
   Cleanup from A interferes with B's state
   or vice versa
```

Under serial execution (--runInBand):

```
Scenario: Serial execution with shared database

Worker 1 (All Tests)
├─ Test A: Insert, Execute, Cleanup ✓
├─ Test B: Insert, Execute, Cleanup ✓
├─ Test C: Insert, Execute, Cleanup ✓
└─ ...

No concurrency = No race condition
```

### Configuration

**package.json:**
```json
{
  "scripts": {
    "test": "jest --runInBand",
    "test:watch": "jest --watch --runInBand"
  }
}
```

This is **not** an application defect. It is an intentional CI configuration.

## Affected Test Suites

- Contract tests (`tests/contract/`)
- Integration tests (`tests/soak/`)
- Pipeline tests (`tests/pipeline/`)
- Agent tests (`tests/agent_reasoning/`)

All tests that interact with the shared PostgreSQL database.

## Performance Characteristics

| Execution Model | Time | Trade-off |
|---|---|---|
| Serial (current) | ~14s | Deterministic, no race conditions |
| Parallel (theoretical) | ~3-5s | Fast, but requires architecture changes |

At 14 seconds, serial execution is a pragmatic choice. No optimization needed unless:
- Test runtime exceeds 5–10 minutes
- CI becomes a bottleneck
- Team grows significantly
- Tests need to shard across runners

## Future Improvement: TEST-ARCH-001

**Title:** Implement parallel-safe test infrastructure

**Options:**
1. **Database per worker** (most robust)
   - Each Jest worker gets dedicated PostgreSQL instance or schema
   - Zero coupling between workers
   - Highest isolation guarantee

2. **Schema per worker** (moderate effort)
   - Multiple schemas in same database
   - Cleanup via `DROP SCHEMA CASCADE`
   - Requires schema allocation/deallocation logic

3. **Transaction rollback per test** (lightweight)
   - Tests run in transactions
   - Automatic rollback on test completion
   - May mask real isolation issues

4. **TestContainers per worker** (highest overhead)
   - Each Jest worker spins up isolated PostgreSQL container
   - Complete resource isolation
   - High startup cost

**Priority:** Low (not a blocker, no business pain at current speed)

**When to revisit:**
- If serial execution becomes a CI bottleneck
- If team scales to need parallel test sharding
- If test count grows beyond ~500 tests

## Debugging Test Failures

If tests fail:

1. **Check if it's flakiness:**
   ```bash
   npm test          # Run with --runInBand (default)
   npm test -- --maxWorkers=4  # Run with parallelism
   ```
   If it fails with parallel but passes serial → race condition exists

2. **Common causes of test pollution:**
   - Database cleanup queries not running (check afterEach hooks)
   - Leftover data from previous test run (check beforeAll/beforeEach)
   - State in external systems (Redis, queues) not being cleared
   - Timestamps or IDs colliding between tests

3. **Investigation approach:**
   - Run the specific failing test in isolation
   - If it passes in isolation, it's test pollution
   - Check the test's afterEach cleanup
   - Check nearby tests for shared setup

## Maintenance

When adding new test files:

1. Ensure they use the same cleanup pattern
2. Clean up database state in `afterEach` hooks
3. Use deterministic test data (not random IDs where possible)
4. Document any shared state assumptions

See `tests/contract/setup.ts` for the established pattern.

## CI/CD Integration

The test command is configured in CI as:
```bash
npm test
```

Which now includes `--runInBand` by default. This ensures CI tests are always deterministic.

If you ever need to run tests in parallel (e.g., for local development speed), use:
```bash
npm test -- --maxWorkers=4  # At your own risk!
```

But expect flaky failures if you do.
