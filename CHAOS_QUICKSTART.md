# Chaos Testing — Quick Start (5 minutes)

## TL;DR

Run this:

```bash
# 1. Install test dependencies
npm install --save-dev vitest @testcontainers/postgresql @testcontainers/testcontainers ioredis node-fetch

# 2. Run tests
npm run test:chaos

# 3. Expected output (after ~30s):
# ✓ 4 test files
# ✓ 16 tests total
# ✓ All green
```

If tests pass → **You have production-grade fail-closed execution + crash-safe recovery.**

If tests fail → Check `CHAOS_SETUP.md` troubleshooting section.

---

## What You Just Got

| Component | What It Does | Why It Matters |
|-----------|-------------|----------------|
| **ExecutionJournal** | Writes intent before external action | Crash recovery: proves what we tried |
| **Executor V2** | Fail-closed: audit write → then state change | No partial state between systems |
| **Reconciliation Worker** | Finds STARTED journals, probes Splunk, repairs DB | Automatic recovery after crashes |
| **4 Chaos Tests** | Real failures (timeout, 500, DB fail, lock expire) | Proves system survives real disasters |

---

## What Happens in Each Test

### Test 1: DB Failure Mid-Execution
```
1. Executor successfully calls Splunk DELETE
2. DB transaction fails BEFORE committing
3. Decision stays APPROVED (no state change)
4. Journal is STARTED (proof we tried)
5. Reconciliation probes Splunk → finds index deleted
6. Reconciliation repairs DB → EXECUTED with audit
✅ Result: No data loss, no duplicates, audit trail complete
```

### Test 2: Redis Lock Expiry
```
1. Sweeper A acquires lock, pauses (GC stall)
2. Lock TTL expires (60s)
3. Sweeper B acquires lock, processes deferred decisions
4. Sweeper A resumes, tries to process same decisions
5. FOR UPDATE SKIP LOCKED prevents double-processing
✅ Result: Exactly-once semantics, no duplicates
```

### Test 3: Splunk 500 / Timeout
```
1. Executor calls Splunk DELETE
2. Splunk returns 500 (or timeout)
3. Transaction NEVER commits
4. Decision stays APPROVED (safe to retry)
5. Journal marked FAILED (clear state)
✅ Result: No partial executions, safe retry path
```

### Test 4: Concurrent Sweep Race
```
1. Two sweepers run simultaneously
2. Both try to reawaken same deferred decisions
3. First sweeper wins via database-level locking
4. Second sweeper skips locked rows (SKIP LOCKED)
5. Both complete without error, no duplicates
✅ Result: Truly distributed, race-condition safe
```

---

## Files Generated

```
prisma/
  schema.prisma                          # ExecutionJournal model
  migrations/20260518_.../migration.sql  # Create journal table

packages/core/
  adapters/
    external-system.adapter.ts          # Interface (prod + test)
    splunk-http.adapter.ts              # Splunk implementation
  workflow/
    executor-v2.ts                      # Fail-closed executor

packages/infra/queue/
  reconciliation-worker.ts              # Recovery logic

tests/chaos/
  testcontainers.setup.ts               # Postgres + Redis + WireMock
  scenarios/
    01-db-failure-mid-execution.test.ts
    02-redis-lock-expiry.test.ts
    03-splunk-500-timeout.test.ts
    04-concurrent-sweep-race.test.ts

.github/workflows/
  chaos-test.yml                        # CI/CD automation

vitest.chaos.config.ts                  # Test runner config
package.json                            # Scripts: test:chaos*
CHAOS_SETUP.md                          # Full setup guide
CHAOS_GENERATED_SUMMARY.md              # Architecture details
CHAOS_QUICKSTART.md                     # This file
```

---

## Key Guarantees

After these tests pass, you have:

```
✅ No Duplicate Execution
   Even if system crashes mid-execution

✅ No Data Loss
   Reconciliation proves what happened externally, repairs DB

✅ Crash-Safe Recovery
   Automatic (runs every 5 minutes)

✅ Audit Trail Complete
   Every execution has immutable proof

✅ Distributed Concurrency
   Multiple sweepers don't corrupt state

✅ Deterministic Failure
   Circuit breaker prevents cascade failures
```

---

## Common Questions

**Q: Why Testcontainers instead of mocks?**  
A: Real containers = real network failures (timeout, connection reset, slow read). Mocks only test happy paths.

**Q: Why WireMock instead of HTTP stubbing?**  
A: WireMock is a real HTTP server. You test the same code paths as production.

**Q: What if I add a new feature?**  
A: Add a test scenario to `tests/chaos/scenarios/`. Follow the pattern, re-run suite.

**Q: Do I need to change production code?**  
A: Only to use `executor-v2.ts` instead of old executor. Everything else is additive.

**Q: When do I run staging drills?**  
A: After local tests pass. Staging drills are the same failures, but against real infrastructure.

---

## Commands You'll Use

```bash
# Run all tests
npm run test:chaos

# Watch mode (re-run on file change)
npm run test:chaos:watch

# Run one test file
npx vitest run --config vitest.chaos.config.ts tests/chaos/scenarios/01-*.test.ts

# Debug: verbose output
npm run test:chaos:watch -- --reporter=verbose

# With coverage
npm run test:chaos:coverage
```

---

## Next: Staging Drills (Week 2)

Once local tests pass, you'll run the same scenarios against deployed system:

```bash
# Kill Redis mid-sweep
bash chaos/scenarios/redis-kill.sh
# Expect: System recovers in next sweep cycle (5 min)

# Delay approvals artificially
bash chaos/scenarios/approval-delay.sh
# Expect: Escalation fires at 2h, 6h, 12h thresholds

# Simulate Splunk API failure
bash chaos/scenarios/splunk-500.sh
# Expect: Decision stays APPROVED, safe to retry

# Kill audit pipeline
bash chaos/scenarios/audit-pipeline-break.sh
# Expect: Audit DLQ captures, replayed after recovery
```

Each drill:
1. Injects failure
2. Verifies system behavior
3. Checks alerts fired
4. Validates runbook accuracy
5. Cleans up

---

## Success Criteria

✅ All tests pass locally  
✅ CI/CD green on PR  
✅ Staging drills succeed  
✅ Ops team walks through recovery  
✅ Production deployment gates on test pass  

**Then you have: A resilient, auditable, enterprise-ready governance platform.**

---

## Support

- **Can't get Docker working?** → `CHAOS_SETUP.md` → Troubleshooting
- **Test fails, not sure why?** → Run `npm run test:chaos:watch`, add `console.log()` in test
- **Want to add a scenario?** → Copy `01-*.test.ts`, modify, run

---

## TL;DR of TL;DR

```bash
npm install --save-dev vitest @testcontainers/postgresql @testcontainers/testcontainers ioredis node-fetch
npm run test:chaos
# ✅ = system is production-grade
# ❌ = fix, debug, iterate
```

Done. 🚀
