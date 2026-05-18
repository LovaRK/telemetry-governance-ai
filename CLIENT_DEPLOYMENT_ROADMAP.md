# Master Deployment Roadmap: Client Ready Application
**Target Delivery**: 26 Business Days  
**Status**: Ready for execution  
**Date**: May 18, 2026

---

## Executive Summary

The Teja Governance Dashboard is currently **70% complete**. Phase 6.1 (causality instrumentation) and Phase 6.1.5A.2 (critical blockers for Phase 2B) are committed to main. **Seven focused sprints** remaining to achieve **production-ready client deployment**.

Client will:
1. **Login** with configured credentials
2. **Provide their Splunk URL, token, and credentials** in Settings
3. **Dashboard automatically connects** and fetches data from their Splunk environment
4. **Reasoning agents run** on fetched data and make decisions
5. **Notifications fire** when reasoning completes
6. **Deploy to their environment** using provided Docker stack + scripts

---

## Timeline & Effort Breakdown

| Sprint | Days | Focus | Effort | Status |
|--------|------|-------|--------|--------|
| 1 | 1-3 | Auth & Splunk Config | 40 hours | PENDING |
| 2 | 4-7 | Dashboard Data & Graphs | 48 hours | PENDING |
| 3 | 8-12 | Agent Reasoning | 56 hours | PENDING |
| 4 | 13-15 | Notifications | 32 hours | PENDING |
| 5 | 16-19 | Docker & Deployment | 48 hours | PENDING |
| 6 | 20-22 | E2E Testing | 40 hours | PENDING |
| 7 | 23-25 | Production Hardening | 48 hours | PENDING |
| Final | 26 | Client Demo & Handoff | 8 hours | PENDING |
| **TOTAL** | **26 days** | **Full Stack Ready** | **320 hours (40 person-days)** | |

---

## Sprint Details

### SPRINT 1: Authentication & Splunk Configuration (Days 1-3)
**Effort**: 40 hours | **Outcome**: Client can input own Splunk credentials

**Tasks**:
- [ ] Build multi-tenant Splunk configuration service (stores URL, token, SSL settings per tenant)
- [ ] Create user authentication flow (OAuth2 or JWT; for MVP, email/password + session tokens)
- [ ] Implement Splunk connection validator with test button
- [ ] Update Settings page: Splunk URL input, HEC token input, auth type dropdown, "Test Connection" button
- [ ] Implement credential encryption (AES-256 in database or AWS Secrets Manager)
- [ ] Add `tenant_id` field to all tables for multi-tenancy
- [ ] Update database schema with `tenants` table (org_name, splunk_url, splunk_token, created_at, updated_at)
- [ ] Create `/api/config` endpoint (GET current Splunk config, POST update credentials)
- [ ] Add error handling: Splunk unreachable, auth failure, invalid token

**Deliverables**:
- ✅ Login page (email/password or OAuth)
- ✅ Settings page with Splunk configuration
- ✅ Connection test button with error messages
- ✅ Credentials persisted and encrypted
- ✅ Multi-tenant isolation verified

**Time Estimate**: 40 hours  
**Owner**: Backend (20h) + Frontend (15h) + DevOps (5h)

---

### SPRINT 2: Dashboard Data Flow & Graphs (Days 4-7)
**Effort**: 48 hours | **Outcome**: All graphs populated with real data, drill-down working

**Tasks**:
- [ ] Verify all dashboard KPI cards render correctly (ROI Score, GainScope, License Spend, Storage Savings)
- [ ] Test Executive Overview gauges with live Splunk data
- [ ] Verify Tier Distribution staircase shows all tiers (Tier 1-4)
- [ ] Verify Savings Staircase shows breakdown (consolidation, retention, search, efficiency)
- [ ] Test Agent Intelligence Panel (decision history, confidence distribution, model health)
- [ ] Populate secondary tables from Splunk:
  - [ ] field_usage (indexed vs used fields per sourcetype)
  - [ ] quality_hotspots (parse error % per sourcetype)
  - [ ] security_coverage (MITRE technique gaps)
  - [ ] search_audit (orphaned saved searches)
- [ ] Add ReasoningDrawer integration to all KPI cards (click gauge → shows reasoning, evidence, confidence)
- [ ] Test detail page drill-down (4 tables: Security Gaps, Quality Hotspots, Operational Coverage, Under-Utilized)
- [ ] Add info buttons to each row → click shows decision reasoning
- [ ] Implement 7-day trend sparklines on KPI cards (optional but recommended for demo)
- [ ] Wire heat maps (activity patterns) and Sankey diagrams (data flow) to real data
- [ ] Test all interactive elements respond with correct data

**Deliverables**:
- ✅ Executive Overview dashboard with all KPIs populated
- ✅ Detail page with 4 drill-down tables
- ✅ ReasoningDrawer on all interactive elements
- ✅ Trend sparklines (if included)
- ✅ Heat maps and Sankey connected to data

**Time Estimate**: 48 hours  
**Owner**: Frontend (35h) + Backend (13h)

---

### SPRINT 3: Agent Reasoning & Decision Processing (Days 8-12)
**Effort**: 56 hours | **Outcome**: Agents run correctly, decisions show in governance tab

**Tasks**:
- [ ] Verify LLM decision agent processes all Splunk snapshots correctly
  - [ ] Model lock enforced (ALLOWED_MODEL='gemma2:9b' or Claude)
  - [ ] Timeout handling (TOTAL_PIPELINE, SPLUNK_QUERY, LLM_BATCH)
  - [ ] Retry logic on transient failures
  - [ ] Backpressure applied (maxIndexesPerRun)
- [ ] Test reasoning drawer shows complete output:
  - [ ] LLM reasoning + evidence
  - [ ] Confidence score + tier
  - [ ] Calculation formula
  - [ ] Raw data (expandable)
- [ ] Verify AgentIntelligencePanel displays:
  - [ ] Decision history (last 20 decisions)
  - [ ] Confidence distribution (high/medium/low counts)
  - [ ] Model health (trust score %, disagreement rate)
- [ ] Implement decision review queue:
  - [ ] Pending decisions table
  - [ ] Approve/Reject buttons with reason tracking
  - [ ] Audit trail (who approved, when, why)
- [ ] Add ModelHealthMonitor component to governance tab:
  - [ ] Model Trust Score (%) with color coding
  - [ ] Disagreement rate over 30 days
  - [ ] Stale/expired approvals requiring re-review
  - [ ] System health status indicator
- [ ] Wire DecisionTimeline:
  - [ ] Show full mutation lifecycle (INTENT_RECEIVED → MUTATION_DISPATCHED → STATE_PERSISTED → QUERY_INVALIDATED → LIFECYCLE_COMPLETE)
  - [ ] Click timeline events → see detailed event data
- [ ] Test confidence decay logic:
  - [ ] Unreviewed decisions: C(t) = C₀ × e^(-0.0231t) (30-day half-life)
  - [ ] Approved decisions: decay locked at 1.0 until 90 days (then degrades to 0.7)
  - [ ] Verify capping at 50% for unreviewed, 70% for stale approved
- [ ] Implement trust-decay-service integration
  - [ ] Calculate effective confidence with all multipliers
  - [ ] Apply freshness decay
  - [ ] Apply drift penalties
  - [ ] Apply oscillation multipliers

**Deliverables**:
- ✅ Governance tab with all components
- ✅ Decision review queue (pending decisions visible)
- ✅ ModelHealthMonitor displaying all metrics
- ✅ DecisionTimeline wired to real data
- ✅ Confidence decay calculations verified

**Time Estimate**: 56 hours  
**Owner**: Backend (30h) + Frontend (26h)

---

### SPRINT 4: Notifications & Real-Time Updates (Days 13-15)
**Effort**: 32 hours | **Outcome**: Notifications fire, users see real-time updates

**Tasks**:
- [ ] Build notification service:
  - [ ] Email notifications (reasoning completed, decision requires review)
  - [ ] In-app notifications (banner, toast messages)
  - [ ] Webhook notifications (client can integrate to Slack, PagerDuty, etc.)
- [ ] Implement Server-Sent Events (SSE) for real-time dashboard updates
  - [ ] Open SSE connection on dashboard load
  - [ ] Subscribe to: decision updates, drift events, queue changes
  - [ ] Auto-update cards when events arrive (no manual refresh needed)
- [ ] Add job status polling for in-progress reasoning:
  - [ ] Show progress bar with ETA
  - [ ] Display current stage (fetching data, processing, running LLM, storing results)
- [ ] Create notification preferences panel:
  - [ ] Users select notification channels (email, in-app, webhook)
  - [ ] Set frequency (real-time, daily digest, weekly summary)
  - [ ] Manage notification subscriptions per decision type
- [ ] Test end-to-end flow:
  - [ ] Start reasoning batch
  - [ ] Watch progress in dashboard
  - [ ] Receive notification when complete
  - [ ] Dashboard updates automatically
  - [ ] Decision appears in review queue

**Deliverables**:
- ✅ Email notifications working
- ✅ In-app notifications + SSE streaming
- ✅ Real-time dashboard updates (no refresh needed)
- ✅ Notification preferences panel
- ✅ End-to-end notification flow verified

**Time Estimate**: 32 hours  
**Owner**: Backend (18h) + Frontend (14h)

---

### SPRINT 5: Client Deployment & Docker Containerization (Days 16-19)
**Effort**: 48 hours | **Outcome**: Single command deploys full stack for any client

**Tasks**:
- [ ] Create multi-tenant docker-compose.yml:
  - [ ] PostgreSQL (14+ image)
  - [ ] Redis (7+ image)
  - [ ] Ollama service (LLM runtime)
  - [ ] Web service (Next.js frontend + Express API)
  - [ ] Worker service (decision processing)
  - [ ] Environment variable config (SPLUNK_URL, SPLUNK_TOKEN, LLM_MODEL, etc.)
- [ ] Build deployment script (./scripts/client-deploy.sh):
  - [ ] Prompt client for: org name, Splunk URL, Splunk token
  - [ ] Generate docker-compose.yml with client credentials
  - [ ] Create .env file with client config
  - [ ] Spin up full stack (docker-compose up -d)
  - [ ] Health checks (wait for all services healthy)
  - [ ] Print access URL and credentials
- [ ] Create comprehensive deployment guide:
  - [ ] Prerequisites (Docker 20+, docker-compose 1.29+, 8GB RAM, 50GB disk)
  - [ ] Installation steps (clone repo, run script, wait for startup)
  - [ ] Configuration (where to input Splunk URL, token, LLM model)
  - [ ] Troubleshooting (common issues, logs to check)
  - [ ] Scaling guidance (performance tuning, resource allocation)
- [ ] Test full Docker stack:
  - [ ] Spin up on local machine
  - [ ] Verify all containers healthy (postgres, redis, web, worker, ollama)
  - [ ] Test connectivity: web → postgres, web → redis, worker → postgres, worker → ollama
  - [ ] Verify Splunk connection works
  - [ ] Run a full reasoning cycle
- [ ] Create health check endpoints:
  - [ ] GET /api/health (overall system health)
  - [ ] GET /api/health/database (postgres connectivity)
  - [ ] GET /api/health/splunk (Splunk connectivity)
  - [ ] GET /api/health/llm (LLM model availability)
  - [ ] GET /api/health/redis (Redis connectivity)
- [ ] Build system health dashboard:
  - [ ] Shows all service statuses on app load
  - [ ] Red/yellow/green indicators
  - [ ] Diagnostic messages for failures
  - [ ] Links to troubleshooting guide

**Deliverables**:
- ✅ Multi-tenant docker-compose.yml
- ✅ Client deployment script (one-liner)
- ✅ Comprehensive deployment guide
- ✅ Health check endpoints
- ✅ System health dashboard
- ✅ Full Docker stack tested and working

**Time Estimate**: 48 hours  
**Owner**: DevOps (28h) + Backend (15h) + Frontend (5h)

---

### SPRINT 6: End-to-End Testing & Demo Preparation (Days 20-22)
**Effort**: 40 hours | **Outcome**: Complete application verified, ready for client demo

**Tasks**:
- [ ] Test complete user flow end-to-end:
  1. Login with test credentials
  2. Configure Splunk (URL, token, test connection)
  3. Dashboard loads (waits for initial data fetch)
  4. Graphs populate with real data
  5. Click KPI → reasoning drawer shows
  6. Start reasoning batch (click "Analyze" button)
  7. Watch progress in dashboard
  8. Receive notification when complete
  9. Decision appears in governance review queue
  10. Approve decision (update calibration, confidence)
  11. Dashboard updates in real-time
- [ ] Load test with realistic client data:
  - [ ] Load 500 indexes from client Splunk
  - [ ] Measure response times (Splunk query, LLM processing, database writes)
  - [ ] Verify no timeouts or errors
  - [ ] Check resource usage (CPU, memory, disk I/O)
  - [ ] Estimate throughput (indexes processed per minute)
- [ ] Verify reasoning performance:
  - [ ] LLM model lock enforced
  - [ ] Timeout handling works (TOTAL_PIPELINE, SPLUNK_QUERY, LLM_BATCH)
  - [ ] Retry logic functions correctly
  - [ ] Backpressure prevents resource exhaustion
  - [ ] Worker recovers from crashes without losing data
- [ ] Test drill-down on all KPIs and tables:
  - [ ] Click every gauge in Executive Overview
  - [ ] Click every row in all detail tables
  - [ ] Reasoning drawer opens with complete data
  - [ ] Evidence, confidence, calculation formula all show
- [ ] Verify all graphs render correctly:
  - [ ] Executive Overview (ROI, GainScope, License Spend, Storage, Security, Operational)
  - [ ] Tier Distribution (4 tiers with counts)
  - [ ] Savings Staircase (consolidation, retention, search, efficiency)
  - [ ] Agent Intelligence (decision history, confidence distribution, model health)
  - [ ] Heat map (activity patterns by day/hour)
  - [ ] Sankey (data flow visualization)
- [ ] Test governance tab completely:
  - [ ] Pending decisions queue (shows all pending)
  - [ ] Approve/Reject buttons work
  - [ ] Model health monitor displays correctly
  - [ ] Drift monitor shows all drifting indexes
  - [ ] Reanalysis queue displays job status
- [ ] Verify notifications:
  - [ ] Email notifications arrive
  - [ ] In-app notifications toast
  - [ ] Dashboard updates via SSE (no manual refresh)
  - [ ] Notification preferences honored
- [ ] Create demo walkthrough document:
  - [ ] Step-by-step client onboarding guide
  - [ ] Screenshots of each flow
  - [ ] Explanation of each feature
  - [ ] Keyboard shortcuts and tips
  - [ ] Common use cases

**Deliverables**:
- ✅ All features tested end-to-end
- ✅ Load tested with realistic data
- ✅ Performance metrics documented
- ✅ Demo walkthrough guide with screenshots
- ✅ Client ready for live demo

**Time Estimate**: 40 hours  
**Owner**: QA/Testing (25h) + Frontend (10h) + Documentation (5h)

---

### SPRINT 7: Production Hardening & Client Handoff (Days 23-25)
**Effort**: 48 hours | **Outcome**: Production-grade application with client support materials

**Tasks**:
- [ ] Implement comprehensive error handling:
  - [ ] API errors (500, 503, 504) → graceful error messages
  - [ ] Splunk timeouts → retry with exponential backoff
  - [ ] LLM failures → fallback reasoning or escalation
  - [ ] Database connection losses → queue recovery
  - [ ] Missing credentials → helpful error + link to settings
- [ ] Add rate limiting:
  - [ ] API rate limits (100 req/min per user, 1000 req/min per org)
  - [ ] Splunk query limits (concurrent queries, batch sizes)
  - [ ] LLM inference limits (maxIndexesPerRun, concurrent batches)
  - [ ] WebSocket/SSE limits (max concurrent connections)
- [ ] Optimize database and queries:
  - [ ] Connection pooling (min 5, max 20 connections)
  - [ ] Query optimization (indexes on frequently queried columns)
  - [ ] Caching layer for static data (Splunk index list, field mappings)
  - [ ] Pagination on large result sets
- [ ] Implement comprehensive logging:
  - [ ] Application logs (info, warning, error levels)
  - [ ] Error tracking (Sentry or similar for crash reporting)
  - [ ] Performance metrics (query latencies, API response times)
  - [ ] Structured logging (JSON format for easy parsing)
  - [ ] Log rotation (prevent disk exhaustion)
- [ ] Create client troubleshooting guide:
  - [ ] Common issues (Splunk unreachable, LLM timeout, database full)
  - [ ] Diagnostic commands (health check endpoints, log viewing)
  - [ ] Performance tuning (resource allocation, batch size tuning)
  - [ ] Support contact (how to reach vendor, response time SLA)
- [ ] Build admin panel for client:
  - [ ] User management (add/remove users, set roles)
  - [ ] Splunk credential management (update URL/token)
  - [ ] Notification settings (configure channels and frequency)
  - [ ] Log viewer (search logs, filter by level/date)
  - [ ] System metrics dashboard (uptime, resource usage, error rate)
  - [ ] Backup/restore functionality
- [ ] Create release notes and version file:
  - [ ] Version number (e.g., 1.0.0)
  - [ ] Feature list (what's included in this version)
  - [ ] Known issues (limitations, workarounds)
  - [ ] Breaking changes (if upgrading from previous version)
  - [ ] Upgrade instructions
- [ ] Test production deployment:
  - [ ] Spin up in production-like environment (separate database, SSL certs)
  - [ ] Run load test (100+ concurrent users)
  - [ ] Verify no data loss on container restart
  - [ ] Test backup/restore
  - [ ] Verify logging and monitoring work

**Deliverables**:
- ✅ Production-grade error handling
- ✅ Rate limiting in place
- ✅ Database optimized
- ✅ Comprehensive logging
- ✅ Troubleshooting guide
- ✅ Admin panel for client
- ✅ Release notes
- ✅ Production deployment verified

**Time Estimate**: 48 hours  
**Owner**: Backend (25h) + DevOps (15h) + Documentation (8h)

---

### FINAL: Client Demo & Delivery (Day 26)
**Effort**: 8 hours | **Outcome**: Client has working application and knowledge to deploy

**Tasks**:
- [ ] Conduct full demo walkthrough with client (1-2 hours):
  - [ ] Show login flow and Splunk configuration
  - [ ] Walk through dashboard (all KPIs, graphs, drill-down)
  - [ ] Show reasoning drawer (why decisions were made)
  - [ ] Demonstrate governance tab (review queue, model health, drift)
  - [ ] Show notifications (email, in-app, SSE updates)
  - [ ] Answer questions and gather feedback
- [ ] Provide deployment package (1 hour):
  - [ ] docker-compose.yml (multi-tenant setup)
  - [ ] Deployment script (client-deploy.sh)
  - [ ] Documentation (README, deployment guide, troubleshooting)
  - [ ] Environment variable template (.env.example)
  - [ ] Credentials management guide (how to secure secrets)
  - [ ] Upgrade instructions (for future versions)
- [ ] Complete knowledge transfer (3 hours):
  - [ ] Train client team on deployment process
  - [ ] Walk through troubleshooting guide
  - [ ] Show how to access logs and debug
  - [ ] Demonstrate admin panel features
  - [ ] Establish support process (how to report issues)
- [ ] Launch on client environment (2-3 hours):
  - [ ] Client provides Splunk URL and token
  - [ ] Run deployment script on their infrastructure
  - [ ] Verify all services healthy
  - [ ] Run test Splunk query
  - [ ] Verify reasoning completes
  - [ ] Check dashboard shows correct data
  - [ ] Confirm notifications working

**Deliverables**:
- ✅ Client demo completed (live application)
- ✅ Deployment package delivered
- ✅ Client team trained
- ✅ Application running on client environment
- ✅ Support process established

**Time Estimate**: 8 hours  
**Owner**: Product (2h) + DevOps (3h) + Support (3h)

---

## Current Application State

### ✅ COMPLETE (70%)
- [x] Phase 6.1: Causality & Cache Coherence Instrumentation
- [x] Phase 6.1.5A.2: Critical Blockers for Phase 2B SSE
- [x] Phase 6: Governance Observability Infrastructure
- [x] Phase 5.1: Bidirectional Confidence Calibration
- [x] Phase 5: Trust Inspection & Transparency Layer
- [x] Phase 4: ModelOps & Governance Hardening
- [x] Phase 3: Data Flow Verification & Production Testing
- [x] Phase 2: UI Drill-Down & Explanation
- [x] Phase 1: Core Pipeline & Cold Start UX
- [x] Dashboard components (Executive Overview, Tier Distribution, Agent Intelligence)
- [x] LLM decision agent with model lock and timeout handling
- [x] Reasoning drawer with evidence and confidence
- [x] Governance tab (review queue, model health, drift monitor)
- [x] Database schema (migrations 1-24)
- [x] API routes (17 endpoints)
- [x] Docker setup (web, worker, postgres, redis)

### 🔄 IN PROGRESS (10%)
- Multi-tenant Splunk configuration (client provides URL/token)
- User authentication / login flow
- Notification system (email, in-app, webhook)

### ⏳ PENDING (20%)
- Client deployment scripts and documentation
- E2E testing and demo preparation
- Production hardening (error handling, logging, monitoring)
- Admin panel for client
- Health check endpoints

---

## Key Features by Sprint

### Sprint 1: Client Configurable
✅ Login with credentials  
✅ Settings page to input Splunk URL, HEC token  
✅ Test connection button  
✅ Secure credential storage  

### Sprint 2: Data-Driven Dashboard
✅ All KPI cards populated with real data  
✅ All graphs rendering (Executive Overview, Tier Distribution, Savings Staircase, Agent Intelligence)  
✅ Drill-down on every KPI → Reasoning Drawer  
✅ Detail page with 4 tables + info buttons  
✅ Heat maps and Sankey diagrams  

### Sprint 3: Autonomous Reasoning
✅ LLM agents run on Splunk data  
✅ Decisions stored with full reasoning + evidence  
✅ Decision review queue (approve/reject)  
✅ Model health monitoring  
✅ Confidence decay and approval expiry  

### Sprint 4: Real-Time Notifications
✅ Email notifications (reasoning complete, decision requires review)  
✅ In-app notifications (toast + banner)  
✅ WebSocket/SSE for real-time dashboard updates  
✅ Notification preferences (channel, frequency)  

### Sprint 5: Client-Ready Deployment
✅ Multi-tenant docker-compose.yml  
✅ One-command deployment script  
✅ Health check endpoints  
✅ System health dashboard  

### Sprint 6: Fully Tested
✅ End-to-end flow verified  
✅ Load tested with realistic data  
✅ All features working correctly  
✅ Demo walkthrough prepared  

### Sprint 7: Production Grade
✅ Comprehensive error handling  
✅ Rate limiting  
✅ Database optimization  
✅ Logging and monitoring  
✅ Admin panel for client  

### Final: Client Delivery
✅ Live demo with client  
✅ Deployment package + documentation  
✅ Client team trained  
✅ Running on client infrastructure  

---

## Resource Allocation

**Total Effort**: 320 person-hours (40 person-days)

**Team Composition** (recommended):
- 1 Backend Engineer (140 hours) — APIs, database, decision engine
- 1 Frontend Engineer (100 hours) — Dashboard, UI components, notifications
- 1 DevOps Engineer (45 hours) — Docker, deployment, monitoring
- 1 QA/Tester (25 hours) — End-to-end testing, load testing
- 1 Technical Writer (10 hours) — Documentation, troubleshooting guide

**Timeline**: 26 business days (5.2 weeks)

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Splunk API complexity | High | Use existing Splunk Python SDK, test with real Splunk instance early (Sprint 1) |
| LLM model unavailable | High | Fallback to Claude API if Ollama down; model lock + timeout prevents hung processes |
| Large dataset performance | Medium | Load test in Sprint 6 with 500+ indexes; optimize queries and add pagination |
| Multi-tenant isolation | High | All queries filtered by tenant_id; test isolation in Sprint 7 |
| Client environment differences | Medium | Provide docker stack (removes dependency issues); health checks diagnose issues |
| Notification delivery | Low | Use multiple channels (email + in-app); retries with exponential backoff |

---

## Success Criteria

- ✅ All 26 sprints completed on schedule
- ✅ Every feature tested end-to-end
- ✅ Zero data loss on service restart
- ✅ <5% error rate on API calls
- ✅ <2 second response time on dashboard loads
- ✅ Client can deploy in <30 minutes
- ✅ Notifications arrive within 2 minutes of reasoning completion
- ✅ Client team trained and confident on operations

---

## Next Steps

1. **Start Sprint 1 immediately** (Days 1-3)
2. **Execute sprints sequentially** (no parallelization to avoid rework)
3. **Daily standup** (15 min, track blockers)
4. **Weekly review** (Friday, assess progress, plan next week)
5. **Day 26 demo with client** (go/no-go decision)

**Questions?** Refer to this roadmap for feature list, time estimates, and deliverables.
