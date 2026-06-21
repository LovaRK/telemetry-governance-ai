# ADR-0001: Serial Test Execution for Shared-State Integration Suite

**Status:** Accepted  
**Date:** 2026-06-02  
**Authors:** Engineering Team

## Decision

Run Jest integration and contract tests using `--runInBand` to enforce serial (single-worker) execution.

## Rationale

### Observed Facts
- Serial execution (`jest --runInBand`): 333/333 tests passing, 100% deterministic
- Parallel execution (default): Intermittent test failures occur

### Inference
Parallel test execution introduces shared-state interference. The exact mechanism is not yet identified, but the evidence is clear: removing parallelism eliminates the interference.

### Why Serial Execution Is Acceptable

The test suite uses a **shared PostgreSQL database** for integration testing. At current scale:

| Metric | Current | Threshold |
|--------|---------|-----------|
| Test count | 333 | 500+ |
| Runtime | 14-20s | 30-60s |
| CI queue impact | Low | Noticeable |

Serial execution introduces no operational burden at this scale.

## Consequences

### Positive
- ✅ Deterministic CI (zero flaky failures)
- ✅ Stable test execution
- ✅ Easy to debug test failures
- ✅ No parallel-safe infrastructure overhead

### Negative
- ❌ No parallel test execution
- ⚠️ Slower feedback loop if test suite grows significantly

## Implementation

**Configuration:** `package.json`
```json
{
  "scripts": {
    "test": "jest --runInBand",
    "test:watch": "jest --watch --runInBand"
  }
}
```

**CI expectation:**
```
Expected: 333 tests in 14-20 seconds
Alert if: >60 seconds
```

## Future Work: TEST-ARCH-001

**Parallel-safe test infrastructure** remains as low-priority technical debt.

**Trigger promotion to Medium priority if:**
- Test runtime exceeds 60 seconds
- Developers begin waiting on CI
- CI parallelization becomes necessary

**Candidate solutions when needed:**
- Database-per-worker (TestContainers or schema isolation)
- Schema-per-worker (lightweight, good isolation)
- Transaction rollback isolation (minimal overhead)

## Monitoring

Add CI metrics to detect drift:

```
Metric: Jest test execution time
Baseline: 14-20 seconds
Warning: >30 seconds
Critical: >60 seconds

Metric: Test count
Baseline: 333
Review: >500 tests (revisit parallel strategy)
```

## Related Documents

- [TESTING.md](../TESTING.md) — Testing architecture and debugging guide
- [TEST-ARCH-001](../RELEASE_READINESS.md#test-arch-001-enable-parallel-safe-test-execution) — Parallel-safe test infrastructure backlog item

## Decision Record Approval

This decision was made based on:
1. Empirical evidence (333/333 serial vs. intermittent parallel failures)
2. Risk assessment (low risk for functional correctness and operations)
3. Cost-benefit analysis (14s acceptable for determinism and stability)

No blockers to shipping with this decision.
