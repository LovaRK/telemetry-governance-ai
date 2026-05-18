# TOTAL PENDING WORK — HONEST BREAKDOWN
**Date:** 2026-05-17  
**Reality Check:** Build succeeds ≠ System works. 15% end-to-end, 8-10% production-ready.

---

## CURRENT STATE BY LAYER

| Layer | Status | Real % | Risk |
|-------|--------|--------|------|
| UI Components | Works | 70% | Works but orphaned—needs real data |
| Docker/Infra | Works | 70% | Schema exists, needs writes |
| Splunk Fetch | Partial | 40% | Code exists, untested with real data |
| LLM Runtime | Partial | 30% | Ollama ready, never executed under load |
| DB Persistence | Untested | 40% | Schema ready, no actual inserts verified |
| API Routes | Partial | 35% | Routes exist, may have fallbacks/defaults |
| End-to-End Truth Chain | Broken | 15% | Never tested: Splunk→LLM→DB→API→UI |
| Production Readiness | — | 8-10% | Still mostly mock/stubbed |

---

## BLOCKING ISSUE: UNVERIFIED END-TO-END

**What we know works:**
- ✅ Splunk REST API responds (real indexes, real event counts)
- ✅ Code compiles (Next.js build succeeds)
- ✅ Schema exists (tables created)

**What's NEVER been tested:**
- ❌ Splunk→SplunkClient→aggregation-service flow (actual execution, not code review)
- ❌ aggregation-service→LLM agent flow (does Ollama execute? does it respond?)
- ❌ LLM→PostgreSQL persistence (do rows actually INSERT?)
- ❌ PostgreSQL→API query (do SELECTs return non-empty?)
- ❌ API→Dashboard render (does UI show real data or fallback?)

**Current hypothesis:** At least 3 of these 5 stages are broken or have fallbacks.

---

## CRITICAL PATH: VERIFY BEFORE IMPLEMENTING

### PHASE 0: UNBLOCK (1-2 hours)

**0.1 - Test /api/cache with real Splunk** (30 min)
- Status: ❌ UNTESTED
- Action: POST to /api/cache with Splunk credentials
  ```bash
  curl -X POST http://localhost:3002/api/cache \
    -H 'Content-Type: application/json' \
    -d '{
      "mcpUrl": "https://144.202.48.85:8089",
      "token": "YOUR_TOKEN",
      "disableSslVerify": true
    }'
  ```
- Expected: Returns 200 with snapshotId + inserted count
- If fails: Debug which stage breaks (Splunk, LLM, or DB)

**0.2 - Verify DB inserts** (15 min)
- Status: ❌ UNTESTED
- Action:
  ```sql
  SELECT COUNT(*) FROM telemetry_snapshots;
  SELECT COUNT(*) FROM agent_decisions;
  SELECT COUNT(*) FROM executive_kpis;
  ```
- Expected: All > 0 after refresh
- If zero: Pipeline broke somewhere, debug logs

**0.3 - Verify LLM executed** (15 min)
- Status: ❌ UNTESTED
- Action:
  ```bash
  docker logs docker-web-1 | grep -i "ollama\|llm\|gemma" | tail -20
  ```
- Expected: See LLM prompt, response, parsed decisions
- If missing: Ollama timeout or not called at all

**0.4 - Test /api/executive-summary** (10 min)
- Status: ⚠️ PARTIAL (route exists but may have fallbacks)
- Action:
  ```bash
  curl http://localhost:3002/api/executive-summary
  ```
- Expected: Returns 200 with real data, mode='FULL_STACK'
- If 503 or mode='DEMO_MODE': DB query failed or returned empty

**Result if all pass:** ✅ One complete cycle works. Proceed.  
**Result if any fail:** ❌ Stop UI work. Debug that specific stage.

---

## PHASE 1: CORE PIPELINE (Week 1 - 14 hours)
**Blocker:** Phase 0 must pass first.

### 1.1 - Splunk Query Execution (2 hours)
- Status: ❌ 0% verified
- Effort: 2 hours (code exists, needs test)
- What's needed:
  - [x] SplunkClient.getIndexMetrics() implemented
  - [ ] **Verified to return real data from 144.202.48.85**
  - [x] SplunkClient.getBatchSourcetypeMetrics() implemented
  - [ ] **Verified with sample indexes**
  - [ ] Error handling tested (timeout, auth failure, permission denied)
- Success criteria:
  - Splunk returns ≥5 real indexes with event counts
  - Sourcetype breakdown works for high-volume indexes
  - No timeouts under 30s per query

### 1.2 - LLM Execution Under Load (4 hours)
- Status: ❌ 0% verified
- Effort: 4 hours
- What's needed:
  - [x] runLLMDecisionAgent() implemented in llm-decision-agent.ts
  - [ ] **Executed with real data from Splunk (Step 1.1 output)**
  - [ ] Ollama gemma2:9b responds with decisions
  - [ ] JSON parsing succeeds (no malformed responses)
  - [ ] All required fields populated (tier, action, confidence, scores, evidence)
  - [ ] Batch size = 5 indexes per call (VRAM constraint)
  - [ ] Timeout handling: 30s total, 2 retries
  - [ ] No fallback values, no synthetic data, no defaults
- Success criteria:
  - LLM processes ≥10 real indexes
  - 100% of decisions have non-null tier/action/confidence
  - No fallback/default values used
  - Response time < 30s per batch

### 1.3 - Database Persistence (3 hours)
- Status: ❌ 0% verified
- Effort: 3 hours
- What's needed:
  - [x] aggregation-service.ts calls SplunkClient
  - [x] aggregation-service.ts calls runLLMDecisionAgent
  - [ ] **Both actually execute with real data**
  - [ ] Results INSERT into telemetry_snapshots table
  - [ ] Results INSERT into agent_decisions table (one row per index/sourcetype decision)
  - [ ] Results INSERT into executive_kpis table (one row per day)
  - [ ] All NOT NULL fields actually populated
  - [ ] No NULL fallbacks, no default values used
  - [ ] Transaction rollback works on error
- Success criteria:
  - `SELECT COUNT(*) FROM agent_decisions > 100`
  - `SELECT COUNT(*) FROM executive_kpis = 1` (per day)
  - All rows have non-NULL: tier, action, confidence, reasoning, evidence
  - No synthetic data or defaults

### 1.4 - API Route Verification (2 hours)
- Status: ⚠️ 35% (routes exist, may have fallbacks)
- Effort: 2 hours
- What's needed:
  - [ ] **/api/executive-summary uses ONLY DB queries (no memory cache, no defaults)**
  - [ ] Verify: SELECT * FROM executive_kpis WHERE snapshot_date = TODAY
  - [ ] If no rows: return 503, mode='DEMO_MODE'
  - [ ] If rows exist: return 200, mode='FULL_STACK'
  - [ ] No synthetic KPIs calculated in code
  - [ ] No fallback arrays or hardcoded values
  - [ ] /api/agent-decisions uses ONLY DB queries
  - [ ] Pagination works (limit/offset)
  - [ ] Filtering by snapshot_id works
- Success criteria:
  - /api/executive-summary returns real data from DB
  - /api/agent-decisions returns paginated real decisions
  - No mode='DEMO_MODE' responses when data exists
  - Response time < 500ms

### 1.5 - Remove Fake KPI Logic (2 hours)
- Status: ⚠️ 50% (deterministic leakage identified)
- Effort: 2 hours
- What's needed:
  - [ ] **Search all files for hardcoded:**
    - Weighted average formulas
    - Savings multipliers (e.g., `dailyGb * 365 * costPerGb`)
    - Default/fallback scores if LLM fails
    - Synthetic ROI calculations
    - Hardcoded tier thresholds
  - [ ] Remove all above
  - [ ] LLM is sole decision authority
  - [ ] Code only validates/persists/orchestrates
- Files to audit:
  - apps/api/services/aggregation-service.ts
  - apps/api/agents/llm-decision-agent.ts
  - apps/api/services/config-service.ts
  - core/config/weights.ts (delete if empty)
  - core/config/cost.ts (migrate only DB-needed logic)
- Success criteria:
  - Zero hardcoded scoring rules
  - LLM output used as-is (no post-processing)
  - No "if LLM fails, use default" logic
  - All scores come from LLM or stored in DB

### 1.6 - Error Handling & Timeouts (3 hours)
- Status: ⚠️ 30% (structure exists, untested under failure)
- Effort: 3 hours
- What's needed:
  - [x] Three-level timeout architecture (TOTAL_PIPELINE, SPLUNK_QUERY, LLM_BATCH)
  - [ ] **Tested with real Splunk timeouts**
  - [ ] Retry logic: 2 retries on transient errors only
  - [ ] Fallback to Anthropic API if Ollama times out
  - [ ] Database transaction rollback on any failure
  - [ ] Clear error messages (not silent failures)
  - [ ] Honest mode indicator (DEMO_MODE vs FULL_STACK)
  - [ ] No graceful degradation with fake data
- Success criteria:
  - Splunk timeout → retry 2x, then fail cleanly
  - LLM timeout → retry 2x, then fallback to Anthropic API
  - DB error → transaction rollback, no partial inserts
  - UI shows exact error reason, not fake data

**Phase 1 Result:**
- If all tests pass: ✅ Core pipeline works end-to-end
- If any fail: ❌ Must debug before moving to Phase 2

---

## PHASE 2: SECONDARY TABLES (Week 2 - 20 hours)
**Blocker:** Phase 1 must be passing.

### 2.1 - Search Audit API (4 hours)
- Status: ❌ 0%
- What's needed:
  - [ ] Fetch saved searches from Splunk REST `/servicesNS/-/-/saved/searches`
  - [ ] Classify: orphan (scheduled, no runs), unused (not scheduled, no runs), active
  - [ ] Store in search_audit table
  - [ ] Implement `/api/search-audit` route (SELECT from table)
  - [ ] Real Splunk queries only, no synthetic data
- Success criteria: `/api/search-audit` returns real saved searches with classification

### 2.2 - Security Coverage (MITRE Mapping) (4 hours)
- Status: ❌ 0%
- What's needed:
  - [ ] Map sourcetype → MITRE techniques (manual mapping or external data)
  - [ ] Store in security_coverage table
  - [ ] Implement `/api/security-coverage` route
  - [ ] Real data only, no guesses
- Success criteria: `/api/security-coverage` returns MITRE mappings

### 2.3 - Field Usage (tstats) (4 hours)
- Status: ❌ 0%
- What's needed:
  - [ ] Implement Splunk tstats query: `| tstats count WHERE index=X BY sourcetype, field`
  - [ ] Compare indexed fields vs used fields per sourcetype
  - [ ] Store in field_usage table
  - [ ] Implement `/api/field-usage` route
- Success criteria: `/api/field-usage` returns field usage breakdown

### 2.4 - Quality Hotspots (Parse Errors) (4 hours)
- Status: ❌ 0%
- What's needed:
  - [ ] Query Splunk for parse errors per sourcetype: `index=_internal group=queue | stats count BY sourcetype`
  - [ ] Calculate parse error % per sourcetype
  - [ ] Store in quality_hotspots table
  - [ ] Implement `/api/quality-hotspots` route
- Success criteria: `/api/quality-hotspots` returns parse error analysis

### 2.5 - Integration Testing (4 hours)
- Status: ❌ 0%
- What's needed:
  - [ ] End-to-end test: Splunk → all 4 secondary tables populated
  - [ ] Verify all 4 API routes return non-empty data
  - [ ] Verify no synthetic/fallback data
- Success criteria: All secondary tables have data after one refresh

**Phase 2 Result:** ✅ All detail page tables populated with real data

---

## PHASE 3: STABILITY & OBSERVABILITY (Week 3 - 13 hours)
**Blocker:** Phase 1 & 2 must be passing.

### 3.1 - Real Health Check (2 hours)
- Status: ❌ 0% (route exists as stub)
- What's needed:
  - [ ] `/api/health` checks actual connectivity:
    - PostgreSQL: can SELECT 1?
    - Ollama: can reach /api/tags?
    - Splunk: can reach /services/server/info?
  - [ ] Returns actual status, not stubbed
  - [ ] Response time < 5s (timeout each check at 2s)
- Success criteria: `/api/health` returns real dependency status

### 3.2 - Comprehensive Logging (3 hours)
- Status: ⚠️ 30% (basic structure exists)
- What's needed:
  - [ ] Log Splunk query timing (start, end, duration)
  - [ ] Log LLM inference timing (prompt size, response time, tokens)
  - [ ] Log DB query timing (SELECT latency, INSERT latency)
  - [ ] Log decision counts per batch
  - [ ] Structured logs (JSON format) with timestamps
  - [ ] Log to both console and (optionally) PostgreSQL
- Success criteria: Debug logs show exact timing at each stage

### 3.3 - Error Recovery Flows (3 hours)
- Status: ⚠️ 30% (basic structure exists)
- What's needed:
  - [ ] Splunk timeout: retry logic, then fail with clear error
  - [ ] LLM timeout: retry logic, fallback to Anthropic, then fail
  - [ ] DB transaction: rollback on any error, no partial inserts
  - [ ] Circuit breaker: if Splunk down, show DEMO_MODE (don't retry forever)
  - [ ] Graceful degradation: show what data IS available, not fake data
- Success criteria: System recovers from failures without corruption

### 3.4 - Performance Optimization (3 hours)
- Status: ❌ 0%
- What's needed:
  - [ ] Database indexes: verify all query paths indexed (snapshot_date, index_name, snapshot_id)
  - [ ] Connection pooling: use pg pool, not new connection per query
  - [ ] Caching: 5-min TTL for config-service (already done, verify working)
  - [ ] Batch size optimization: find sweet spot for Ollama (currently 5)
- Success criteria:
  - Dashboard loads < 5s with 1000+ decisions
  - No N+1 queries in API routes

### 3.5 - Circuit Breaker Pattern (2 hours)
- Status: ❌ 0%
- What's needed:
  - [ ] If Splunk unreachable: show DEMO_MODE, don't retry every request
  - [ ] If Ollama down: show DEMO_MODE, use Anthropic fallback
  - [ ] If PostgreSQL down: show error (can't serve stale data)
  - [ ] State tracked in in-memory cache (reset every 5 min)
- Success criteria: System doesn't spam failing endpoints

**Phase 3 Result:** ✅ System is resilient and observable

---

## PHASE 4: TESTING (Week 4 - 24 hours)
**Blocker:** Phases 1-3 must pass.

### 4.1 - Unit Tests (8 hours)
- Status: ❌ 0%
- What's needed:
  - [ ] SplunkClient: test auth, query parsing, error handling
  - [ ] LLM Decision Agent: test prompt building, JSON parsing, schema validation
  - [ ] Aggregation Service: test Splunk→LLM→DB flow with mocks
  - [ ] API routes: test query building, pagination, error responses
  - [ ] Config Service: test load/update/TTL logic
- Success criteria: All tests pass, >80% code coverage

### 4.2 - Integration Tests (8 hours)
- Status: ❌ 0%
- What's needed:
  - [ ] Test /api/cache with real Splunk instance
  - [ ] Verify all 4 secondary tables populate
  - [ ] Verify all 7 API routes return correct data
  - [ ] Verify dashboard renders without errors
  - [ ] Test error recovery (kill Splunk/Ollama, verify graceful failover)
- Success criteria: Full end-to-end pipeline tested

### 4.3 - Load Testing (4 hours)
- Status: ❌ 0%
- What's needed:
  - [ ] Test with 100+ indexes
  - [ ] Test with 1000+ decisions
  - [ ] Measure dashboard load time (target: < 5s)
  - [ ] Measure API response time (target: < 500ms)
  - [ ] Verify no memory leaks or connection leaks
- Success criteria: System handles expected load without degradation

### 4.4 - Security Audit (4 hours)
- Status: ❌ 0%
- What's needed:
  - [ ] Splunk token not logged to stdout
  - [ ] Splunk token not stored plaintext (use env vars)
  - [ ] Database credentials not hardcoded
  - [ ] API does not return sensitive data (no token echoes)
  - [ ] SQL injection: all queries parameterized
  - [ ] XSS: all user input sanitized in UI
- Success criteria: No security vulnerabilities found

**Phase 4 Result:** ✅ System is tested and secure

---

## PENDING UI WORK (FREEZE UNTIL PHASE 1 PASSES)

**DO NOT START** until end-to-end data flow verified:

| Feature | Status | Hours | Block |
|---------|--------|-------|-------|
| Sankey visualization | Ready | 2 | Phase 1 pass |
| ReasoningDrawer wiring | Ready | 4 | Phase 1 pass |
| Sparkline trend lines | Ready | 2 | Phase 1 pass |
| Detail page tables | Ready | 3 | Phase 2 pass |
| SectionExplainer banners | Ready | 2 | Phase 1 pass |
| ConfigPanel integration | Ready | 1 | Phase 1 pass |

**Total UI frozen:** 14 hours (do not start)

---

## HONEST EFFORT ESTIMATE

| Phase | Hours | Blocker | Dependencies |
|-------|-------|---------|--------------|
| **Phase 0: Verify** | 1-2 | CRITICAL | None (can start now) |
| **Phase 1: Core** | 14 | CRITICAL | Phase 0 passing |
| **Phase 2: Secondary** | 20 | HIGH | Phase 1 passing |
| **Phase 3: Stability** | 13 | HIGH | Phase 1, 2 passing |
| **Phase 4: Testing** | 24 | MEDIUM | Phase 1, 2, 3 passing |
| **UI Work** | 14 | LOW | Phase 1 passing |
| **TOTAL** | **86 hours** | | Sequential, not parallel |

**Timeline (assuming full-time, 8h/day):**
- Phase 0: 1 day (TODAY — verify current state)
- Phase 1: 2 days (verify core pipeline works)
- Phase 2: 3 days (populate all secondary data)
- Phase 3: 2 days (add stability/observability)
- Phase 4: 3 days (comprehensive testing)
- UI: 2 days (add visualization polish)
- **Total: 13 days (excluding weekends)**

---

## RISK ASSESSMENT

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|-----------|
| Splunk timeout | Pipeline stalls | HIGH | Phase 0 testing, retry logic |
| LLM timeout/OOM | Batch fails | MEDIUM | Reduce batch size, fallback to API |
| DB insert fails | Data lost | MEDIUM | Transaction rollback, error logging |
| API uses fallback values | Fake data shown | HIGH | Code audit (Phase 1.5), unit tests |
| UI shows stale data | User confusion | MEDIUM | Clear mode indicator, refresh button |
| No alerting on failures | Silent degradation | MEDIUM | Logging/health checks (Phase 3) |

---

## SUCCESS CRITERIA FOR PRODUCTION

✅ Phase 0: Verify one complete Splunk→LLM→DB→API→UI cycle works  
✅ Phase 1: Core pipeline passes all tests (no timeouts, no fallbacks, no synthetic data)  
✅ Phase 2: All secondary tables populate with real data  
✅ Phase 3: System recovers from failures gracefully  
✅ Phase 4: Full test suite passes (unit, integration, load, security)  
✅ All data originates from real Splunk (ZERO synthetic/hardcoded values)  
✅ Mode indicator shows truth (DEMO_MODE vs FULL_STACK)  
✅ Performance acceptable (< 5s dashboard load, < 500ms API response)  
✅ Documentation complete (architecture, deployment, troubleshooting)  

---

## REAL STARTING POINT

**Right now (TODAY):**
- Do Phase 0 (1-2 hours): Test actual execution with real Splunk
- Do NOT start Phase 1 until Phase 0 passes
- Do NOT add UI polish until Phase 1 passes

**Currently blocked on:**
- ✅ Splunk instance: AVAILABLE (144.202.48.85)
- ✅ Splunk credentials: PROVIDED (ram/Rama@1988)
- ⏳ Actual end-to-end test execution

**Next action:**
```bash
# 1. Start services
./START.sh

# 2. Run Phase 0 test
curl -X POST http://localhost:3002/api/cache \
  -H 'Content-Type: application/json' \
  -d '{
    "mcpUrl": "https://144.202.48.85:8089",
    "token": "REAL_TOKEN_FROM_SPLUNK",
    "disableSslVerify": true
  }'

# 3. Check DB
SELECT COUNT(*) FROM agent_decisions;
SELECT COUNT(*) FROM executive_kpis;

# 4. Check logs
docker logs docker-web-1 | grep -i "ollama\|llm\|gemma"

# 5. Test API
curl http://localhost:3002/api/executive-summary
```

**If all pass:** ✅ Core pipeline works. Proceed to Phase 1 detailed implementation.  
**If any fail:** ❌ Stop. Debug that specific layer before continuing.

---

## REAL CURRENT STATE

```
Layers passing:
✅ Build (code compiles)
✅ Docker (services run)
✅ Splunk fetch (API responds)
⚠️  LLM (ready but untested)
⚠️  DB schema (ready but empty)
⚠️  API routes (exist but may have fallbacks)

Layers broken/untested:
❌ End-to-end execution (never run)
❌ Real data persistence (never inserted)
❌ Real data queries (never returned)
❌ Full pipeline verification (Phase 0 not done)

Honest assessment:
- Code quality: 70%
- Architecture understanding: 80%
- Actual working implementation: 15%
- Production readiness: 8-10%
```

---

## WHAT TO IMPLEMENT FIRST

**STOP UI WORK.** Do this sequentially:

1. **TODAY (Phase 0):** 1-2 hours
   - Run /api/cache with real Splunk
   - Verify DB inserts
   - Verify LLM executes
   - If all pass: Phase 1 ready

2. **THEN (Phase 1):** 14 hours
   - Debug/fix any Phase 0 failures
   - Verify each stage independently
   - Test error handling
   - Remove any fake KPI logic
   - Verify APIs use only real DB data

3. **THEN (Phase 2-4):** 57 hours
   - Secondary tables
   - Stability/observability
   - Full testing suite

**Do not skip steps. Do not parallelize.**

