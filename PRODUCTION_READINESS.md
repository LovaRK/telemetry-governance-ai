# Production Readiness Checklist
**Status: EARLY DEVELOPMENT (NOT READY)**  
**Last Updated: 2026-05-17**

---

## Critical Path (MUST HAVE for Production)

### ❌ Data Pipeline — Splunk to Dashboard
| Task | Status | Effort | Blocker |
|------|--------|--------|---------|
| Real Splunk connection via MCP | ❌ Stubbed | 4h | CRITICAL |
| Fetch real index metrics | ❌ Returns mock | 2h | CRITICAL |
| Real LLM decision making (Ollama/Anthropic) | ❌ Stubbed | 3h | CRITICAL |
| Store real decisions in PostgreSQL | ❌ Empty tables | 2h | CRITICAL |
| Real executive-summary API | ❌ Returns 503 | 2h | CRITICAL |
| Real agent-decisions API | ❌ Returns 503 | 1h | CRITICAL |
| **Subtotal** | **BLOCKED** | **14h** | **All stubbed** |

### ❌ Real Data in Detail Page
| Task | Status | Effort |
|------|--------|--------|
| Security coverage (real Splunk queries) | ❌ Empty | 3h |
| Field usage (real tstats queries) | ❌ Empty | 3h |
| Quality hotspots (parse error analysis) | ❌ Empty | 3h |
| Search audit (saved search analysis) | ❌ Empty | 2h |
| **Subtotal** | **BLOCKED** | **11h** |

### ❌ System Stability
| Task | Status | Effort |
|------|--------|--------|
| Health check (real DB + Ollama status) | ❌ Stubbed | 1h |
| Error handling & retry logic | ⚠️ Partial | 2h |
| Timeout handling for LLM inference | ⚠️ Partial | 2h |
| Database connection pooling | ❌ Not implemented | 2h |
| Logging & observability | ⚠️ Basic | 2h |
| **Subtotal** | **INCOMPLETE** | **9h** |

---

## Phase 1: Core Pipeline (Weeks 1-2)

### Week 1: Connect Real Data
- [ ] **Monday**: Verify Splunk MCP connection works (2h)
  - Test query: fetch all indexes with GB/day
  - Verify response format matches expectations
  - Document connection string

- [ ] **Monday-Tuesday**: Build `/api/executive-summary` with real data (6h)
  - Fetch index metrics from Splunk
  - Calculate KPIs from raw metrics
  - Build data structures matching frontend expectations
  - Test with sample Splunk data

- [ ] **Wednesday**: Build `/api/agent-decisions` with real LLM (6h)
  - Send Splunk data to Ollama/Claude
  - Parse LLM decisions
  - Store in PostgreSQL
  - Return decisions via API

- [ ] **Thursday-Friday**: Stabilize pipeline (4h)
  - Error handling for Splunk timeouts
  - LLM inference retries
  - Database transaction handling

**Week 1 Effort: 18 hours**

### Week 2: Secondary Tables
- [ ] **Monday**: Build `/api/search-audit` with real Splunk queries (4h)
- [ ] **Tuesday**: Build `/api/security-coverage` (4h)
- [ ] **Wednesday**: Build `/api/field-usage` (4h)
- [ ] **Thursday**: Build `/api/quality-hotspots` (4h)
- [ ] **Friday**: Integration testing (4h)

**Week 2 Effort: 20 hours**

---

## Phase 2: Stability & Observability (Week 3)

| Task | Effort | Notes |
|------|--------|-------|
| Real health check API | 2h | DB + Ollama status |
| Logging pipeline | 3h | Splunk/Ollama/DB query logs |
| Error recovery flows | 3h | Retry logic, circuit breakers |
| Performance profiling | 3h | Identify slow queries |
| Database indexes | 2h | Query optimization |
| **Subtotal** | **13h** | |

---

## Phase 3: Testing (Week 4)

| Task | Effort |
|------|--------|
| Unit tests for APIs | 8h |
| Integration tests (E2E) | 8h |
| Load testing (100+ indexes) | 4h |
| Security audit | 4h |
| **Subtotal** | **24h** |

---

## Summary by Category

| Category | Status | Effort | Timeline |
|----------|--------|--------|----------|
| **Critical Path** | 🔴 0% | 34h | Week 1-2 |
| **Secondary Features** | 🔴 0% | 11h | Week 2 |
| **Stability** | 🟡 30% | 13h | Week 3 |
| **Testing** | 🔴 0% | 24h | Week 4 |
| **Documentation** | 🟡 50% | 4h | Ongoing |
| **TOTAL** | 🔴 8% | **86 hours** | **4 weeks** |

---

## What's Currently Working

✅ **UI Components**
- Dashboard renders correctly
- Detail page structure exists
- ReasoningDrawer, SectionExplainer, Sparklines implemented
- Sankey visualization wired

✅ **Infrastructure**
- Docker compose setup
- PostgreSQL schema
- Ollama integration (ready)
- Bootstrap script

⚠️ **APIs**
- Routes exist but 90% are stubbed with 503s
- `/api/config` returns in-memory defaults (NOT production)
- `/api/cache-status` returns fake status

---

## What's NOT Working

❌ **Real Data**
- No Splunk queries actually running
- No real index metrics flowing
- No real LLM decisions being made
- No real data in any table

❌ **Production APIs**
- `/api/executive-summary` → returns 503 (needs real Splunk + LLM)
- `/api/agent-decisions` → returns 503 (needs real decisions)
- `/api/security-coverage` → returns 503 (needs real Splunk)
- `/api/field-usage` → returns 503 (needs real Splunk)
- `/api/search-audit` → returns 503 (needs real Splunk)
- `/api/quality-hotspots` → returns 503 (needs real Splunk)
- `/api/health` → returns 503 (needs real DB check)

❌ **Data Pipeline**
- Splunk MCP not connected
- No data flowing end-to-end
- No decisions being made
- Database tables empty

---

## How to Use This List

**For the user:**
- Week 1: Connect Splunk, build core APIs (34h)
- Week 2: Secondary tables (20h)
- Week 3: Stability (13h)
- Week 4: Testing (24h)
- **Total: 4 weeks (86 hours) to production readiness**

**For the next agent:**
- This is the real scope
- Do NOT call anything "complete" until real Splunk data is flowing
- Priority: Connect Splunk → Real APIs → Real LLM → Real DB → Real UI
- No mock data at any stage

---

## Key Constraints

1. **ALL data from Splunk MCP** — zero mocks, zero hardcoded values
2. **Real LLM decisions only** — not pre-computed, not hardcoded
3. **Real PostgreSQL storage** — not in-memory, not CSV files
4. **Real error handling** — not graceful degradation with fake data
5. **Honest status** — show DEMO_MODE or FULL_STACK explicitly

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Splunk connectivity | 🔴 Critical | Test MCP connection first |
| LLM token limits | 🔴 Critical | Batch size = 5 indexes max |
| Database performance | 🟡 High | Add indexes, connection pool |
| Ollama OOM | 🟡 High | Use gemma2:2b (16GB safe) |

---

## Definition of "Production Ready"

✅ Real data flows: Splunk → Normalized → LLM → Decisions → DB  
✅ All APIs return real data (no 503s or empty arrays)  
✅ Health check verifies all dependencies  
✅ Error handling graceful but honest  
✅ Tests pass (unit + integration + load)  
✅ Performance acceptable (< 5s for dashboard load)  
✅ Documentation complete  
✅ Deployment scripted and tested  

**Current Status: 8% complete**
