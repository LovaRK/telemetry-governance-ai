# Master Development Plan: Phase 2A→2B Complete Feature Implementation

**Status**: Comprehensive Feature Roadmap for Immediate Implementation  
**Timeline**: Phase 2A (Complete) + Phase 2B (Foundation)  
**Approach**: Full feature development, no architectural constraints

---

## Executive Summary

**Current State**: Phase 2A architecture complete, empiricism methodology ready  
**Next State**: Phase 2A fully featured + Phase 2B foundation wired  
**Outcome**: Production-grade governance with approval workflows, TTL/revocation, and capability scopes

**This Plan Covers**:
- ✅ Phase 2A completion (all missing features)
- ✅ Phase 2B foundation (core dependencies)
- ✅ Integration points
- ✅ Database migrations
- ✅ Testing infrastructure
- ✅ API endpoints
- ✅ UI components
- ✅ Operator tooling

---

## Phase 2A: Completion Roadmap

### Currently Implemented ✅

| Component | Status | Lines | Purpose |
|-----------|--------|-------|---------|
| governance-mode.ts | Complete | 172 | 5-mode feature flag |
| governance-metrics.ts | Complete | 365 | Metric collection |
| governance-integrity.ts | Complete | 227 | Health assessment |
| governance-snapshot.ts | Complete | 247 | Snapshot capture |
| governance-replay.ts | Complete | 315 | Replay validation |
| governance-observer.ts | Complete | 330 | Observation loop |
| STAGE_CONTRACTS.md | Complete | 400 | Operational law |
| VALIDATION_SEQUENCE.md | Complete | 500 | Testing plan |

**Subtotal**: 2,556 lines (architecture + documentation)

### Missing Phase 2A Features 🔴

#### 0. Audit Persistence (Critical Path - IN PROGRESS ⚙️)
**Status**: Migration created, governance-audit-store.ts in development

**What's Needed**:
- [x] `prisma/migrations/20260528_governance_audit_events/migration.sql` — Database migration
- [ ] `governance-audit-store.ts` — Audit event persistence and querying
- [ ] `governance-audit-api.ts` — REST endpoints for audit retrieval
- [ ] Integration in runtime-governance-engine.ts for decision logging
- [ ] Integration in governance-observer.ts for metrics reporting
- [ ] Audit health tracking in governance-integrity.ts (7th check)

**Implementation Progress**:
- Day 1 (2026-05-28): Migration created with 14 indexes for forensic queries
- Day 2 (2026-05-28): governance-audit-store.ts and integration in progress

**Estimated Effort**: 300 lines code + integration points

---

#### 1. Approval Workflow (High Priority)
**Status**: Design exists, NOT IMPLEMENTED

**What's Needed**:
- [ ] `governance-approval.ts` — Request/approval state machine
- [ ] `governance-approval-store.ts` — Approval persistence (in-memory Phase 2A)
- [ ] `governance-approval-api.ts` — REST endpoints for approval management
- [ ] Schema migrations for approval_requests table
- [ ] UI approval dashboard component
- [ ] Approval notification system
- [ ] Audit logging for approvals

**Design**:
```typescript
// governance-approval.ts
export enum ApprovalState {
  PENDING = 'pending',      // Waiting for approval
  APPROVED = 'approved',    // Approved, can execute
  DENIED = 'denied',        // Denied by operator
  REVOKED = 'revoked'       // Previously approved, now revoked
}

export interface GovernanceApprovalRequest {
  request_id: string;
  decision_id: string;
  actor_id: string;
  action: string;
  resource: string;
  risk_level: RiskLevel;
  state: ApprovalState;
  required_approvals: number;
  received_approvals: ApprovalDecision[];
  created_at: string;
  expires_at?: string;
  approved_at?: string;
  execution_deadline?: string;
}

export function createApprovalRequest(...): GovernanceApprovalRequest
export function approveRequest(request_id, approver_id, reason): void
export function denyRequest(request_id, denier_id, reason): void
export function revokeApproval(request_id): void
export function getApprovalStatus(request_id): ApprovalState
```

**Estimated Effort**: 600 lines code + 200 lines tests + migrations

#### 2. TTL & Revocation (Medium Priority)
**Status**: Design exists, NOT IMPLEMENTED

**What's Needed**:
- [ ] `governance-ttl.ts` — Time-bounded permission lifecycle
- [ ] `governance-revocation.ts` — Revocation management
- [ ] TTL expiration check in decision evaluation
- [ ] Revocation list store
- [ ] Revocation API endpoints
- [ ] Scheduled expiration task

**Design**:
```typescript
// governance-ttl.ts
export interface PermissionTTL {
  permission_id: string;
  created_at: string;
  expires_at: string;
  ttl_seconds: number;
  auto_renew: boolean;
}

export function setPermissionTTL(permission_id, ttl_seconds): PermissionTTL
export function renewPermission(permission_id, ttl_seconds): PermissionTTL
export function isPermissionExpired(permission_id): boolean
export function checkTTLExpiration(): ExpiredPermissions[]

// governance-revocation.ts
export interface RevocationRecord {
  revocation_id: string;
  permission_id: string;
  actor_id: string;
  revoked_at: string;
  reason: string;
  effective_immediately: boolean;
}

export function revokePermission(permission_id, reason): RevocationRecord
export function isPermissionRevoked(permission_id): boolean
export function listRevocations(actor_id): RevocationRecord[]
```

**Estimated Effort**: 500 lines code + 200 lines tests

#### 3. Capability Scopes (Medium Priority)
**Status**: Design exists, NOT IMPLEMENTED

**What's Needed**:
- [ ] `governance-scopes.ts` — Actor capability boundaries
- [ ] `governance-scope-resolver.ts` — Scope intersection/union logic
- [ ] Scope validation in decision evaluation
- [ ] Scope API endpoints
- [ ] Scope UI editor

**Design**:
```typescript
// governance-scopes.ts
export interface CapabilityScope {
  scope_id: string;
  actor_id: string;
  capabilities: string[];      // ['read', 'write', 'delete']
  resource_pattern: string;     // 'splunk:config:*'
  environment: 'sandbox' | 'production';
  created_at: string;
  expires_at?: string;
}

export function defineScope(actor_id, capabilities, resource_pattern): CapabilityScope
export function checkScopePermission(actor_id, capability, resource): boolean
export function getScopeIntersection(scope1, scope2): CapabilityScope
export function validateCapability(actor_id, action, resource): boolean
```

**Estimated Effort**: 400 lines code + 200 lines tests

#### 4. Authorization System Integration (High Priority)
**Status**: Design exists, NOT IMPLEMENTED

**What's Needed**:
- [ ] `authorization-engine.ts` — Full ABAC integration with governance
- [ ] `authorization-governance-bridge.ts` — Decision enrichment with authorization context
- [ ] API authorization middleware
- [ ] UI authorization checks
- [ ] Role/attribute evaluation

**Design**:
```typescript
// authorization-engine.ts
export interface AuthorizationContext {
  actor_id: string;
  actor_attributes: Record<string, any>;
  resource_attributes: Record<string, any>;
  environment_attributes: Record<string, any>;
  action: string;
  timestamp: string;
}

export function evaluateAuthorization(context: AuthorizationContext): AuthorizationResult
export function enrichGovernanceDecision(decision, authContext): EnrichedDecision

// In RGE:
const authContext = extractAuthorizationContext(request);
const authResult = evaluateAuthorization(authContext);
const governanceDecision = evaluate(request);
const enriched = enrichGovernanceDecision(governanceDecision, authResult);
```

**Estimated Effort**: 700 lines code + 300 lines tests + 3 migrations

#### 5. Audit Trail Persistence (Medium Priority)
**Status**: Schema design exists, NOT IMPLEMENTED

**What's Needed**:
- [ ] `governance_audit_events` table migration
- [ ] `governance-audit-store.ts` — Persistent audit logging
- [ ] Audit write error tracking (integrity check)
- [ ] Audit query API
- [ ] Audit analytics

**Design**:
```sql
-- Migration: governance_audit_events
CREATE TABLE governance_audit_events (
  id BIGSERIAL PRIMARY KEY,
  decision_id VARCHAR(64) NOT NULL,
  decision_hash VARCHAR(64),
  governance_snapshot_hash VARCHAR(64),
  actor_id VARCHAR(255),
  action VARCHAR(255),
  resource VARCHAR(512),
  decision ENUM('ALLOW', 'DENY', 'REQUIRE_APPROVAL'),
  risk_level ENUM('LOW', 'MODERATE', 'HIGH', 'CRITICAL'),
  approval_request_id VARCHAR(64),
  timestamp TIMESTAMP NOT NULL,
  evaluation_ms INTEGER,
  environment VARCHAR(50),
  enforcement_mode VARCHAR(50),
  INDEX idx_decision_id (decision_id),
  INDEX idx_actor_id (actor_id),
  INDEX idx_timestamp (timestamp)
);
```

**Estimated Effort**: 300 lines code + 100 lines tests + 1 migration

#### 6. Dashboard Metrics API (Medium Priority)
**Status**: UI design exists, NOT IMPLEMENTED

**What's Needed**:
- [ ] `governance-metrics-api.ts` — Metrics query endpoints
- [ ] `/api/governance/metrics` endpoints (JSON + time-series)
- [ ] `/api/governance/health` endpoint (integrity state)
- [ ] `/api/governance/observation-state` endpoint
- [ ] `/api/governance/replay-stats` endpoint
- [ ] Metrics export (CSV, Prometheus)

**Design**:
```typescript
// Endpoints
GET /api/governance/metrics?window=5m|1h|24h
GET /api/governance/metrics/by-action
GET /api/governance/metrics/consensus-rate
GET /api/governance/health
GET /api/governance/observation-state
GET /api/governance/replay-stats
GET /api/governance/metrics/export?format=csv|prometheus|json
```

**Estimated Effort**: 500 lines code + 200 lines tests

#### 7. Operator Command-Line Tools (Low Priority but useful)
**Status**: Not implemented

**What's Needed**:
- [ ] `governance-cli.ts` — CLI commands for operators
- [ ] `governance-drill.ts` — Operational drill execution
- [ ] Commands:
  - `governance-cli mode [SHADOW|LOG_ONLY|NON_CRITICAL|FULL]` — Change mode
  - `governance-cli metrics` — Show current metrics
  - `governance-cli health` — Show integrity check
  - `governance-cli replay-sample` — Run replay on 10 recent snapshots
  - `governance-cli drill-rollback` — Practice emergency rollback

**Estimated Effort**: 400 lines code

#### 8. UI Governance Dashboard Components (Medium Priority)
**Status**: Design spec exists, NOT IMPLEMENTED

**What's Needed**:
- [ ] `/governance/dashboard` page
  - Real-time metrics display
  - Health status widget
  - Observation state panel
  - Recent decisions list
  - Alert panel

- [ ] `/governance/approvals` page
  - Pending approval requests
  - Approval history
  - Approval request details

- [ ] `/governance/metrics` page
  - Time-series metrics
  - Consensus rate chart
  - Latency percentiles
  - Drift over time

- [ ] `/governance/compliance` page
  - Audit log viewer
  - Compliance report generator
  - Snapshot inspector

**Estimated Effort**: 1,200 lines React + 300 lines styling

#### 9. Testing Infrastructure (High Priority)
**Status**: Test skeletons exist, NOT IMPLEMENTED

**What's Needed**:
- [ ] `__tests__/governance-integration.test.ts` — Full integration tests
- [ ] `__tests__/governance-replay.test.ts` — Replay validation tests
- [ ] `__tests__/governance-approval.test.ts` — Approval workflow tests
- [ ] `__tests__/governance-scenarios.test.ts` — Real-world scenarios
  - Mismatch scenarios
  - Failure recovery
  - Replay divergence
  - Approval timeout
  - TTL expiration

**Estimated Effort**: 1,500 lines tests

---

## Phase 2B: Foundation Roadmap

### Not Yet Implemented (Phase 2B Dependencies)

#### 1. Approval System Complete
**Needed For**: Decision blocking, risk mitigation  
**Estimated Effort**: 600 lines + tests + migrations

#### 2. TTL & Revocation System Complete
**Needed For**: Time-bounded permissions  
**Estimated Effort**: 500 lines + tests

#### 3. Capability Scopes Complete
**Needed For**: Actor boundary enforcement  
**Estimated Effort**: 400 lines + tests

#### 4. Authorization System Full Integration
**Needed For**: ABAC-based decision enrichment  
**Estimated Effort**: 700 lines + tests + migrations

#### 5. Distributed Governance Foundation
**For Phase 2C**:
- [ ] Governance event streaming (Kafka/RabbitMQ)
- [ ] Cross-service governance consensus
- [ ] Distributed approval workflows
- [ ] Multi-region governance replication

**Estimated Effort**: 2,000+ lines (Phase 2C, not 2B)

---

## Complete Implementation Roadmap

### Tier 1: Phase 2A Completion (CRITICAL PATH)

| Component | Effort | Dependencies | Deadline |
|-----------|--------|--------------|----------|
| Approval Workflow | 600L | None | Day 3 |
| TTL & Revocation | 500L | Approval | Day 4 |
| Capability Scopes | 400L | None | Day 5 |
| Authorization Bridge | 700L | Approval + Scopes | Day 6 |
| Audit Persistence | 300L | None | Day 2 |
| Metrics API | 500L | Observer | Day 3 |
| Testing Framework | 1,500L | All above | Day 7 |
| **Subtotal** | **4,500L** | | **7 Days** |

### Tier 2: Phase 2A UI & Operations

| Component | Effort | Dependencies | Deadline |
|-----------|--------|--------------|----------|
| CLI Tools | 400L | Metrics API | Day 4 |
| Dashboard Components | 1,200L | Metrics API | Day 6 |
| Approval UI | 600L | Approval Workflow | Day 5 |
| Metrics UI | 500L | Metrics API | Day 5 |
| **Subtotal** | **2,700L** | | **6 Days** |

### Tier 3: Phase 2B Foundation

| Component | Effort | Dependencies | Deadline |
|-----------|--------|--------------|----------|
| Approval System (complete) | 800L | Phase 2A approval | Day 10 |
| TTL System (complete) | 600L | Phase 2A TTL | Day 10 |
| Scopes System (complete) | 500L | Phase 2A scopes | Day 10 |
| Authorization Integration | 900L | All Phase 2A | Day 12 |
| Event Streaming Foundation | 800L | Audit store | Day 12 |
| **Subtotal** | **3,600L** | | **12 Days** |

---

## Complete Feature List: What Gets Built

### Governance Core (Already Done)
✅ Deterministic evaluation  
✅ Snapshot capture  
✅ Replay validation  
✅ Integrity assessment  
✅ Observation loop  
✅ Staged enforcement  
✅ Stage contracts  
✅ Validation sequence  

### Governance Features (TO BUILD)

#### Approval Workflows
- [ ] Request state machine (PENDING → APPROVED/DENIED/REVOKED)
- [ ] Approval deadlines (auto-deny if not approved)
- [ ] Multi-approver support (AND/OR logic)
- [ ] Approval audit trail
- [ ] Approval API endpoints
- [ ] Approval dashboard
- [ ] Notification system

#### TTL & Revocation
- [ ] Permission TTL enforcement
- [ ] Auto-renewal mechanism
- [ ] Revocation immediate effect
- [ ] Grace period for active sessions
- [ ] TTL enforcement in decision evaluation
- [ ] Scheduled expiration cleanup
- [ ] Revocation audit trail

#### Capability Scopes
- [ ] Scope definition (capabilities + resources)
- [ ] Scope intersection (multiple scopes)
- [ ] Environment-specific scopes
- [ ] Time-bounded scopes
- [ ] Scope validation in decisions
- [ ] Scope editor UI

#### Authorization System
- [ ] ABAC attribute evaluation
- [ ] Role-based attribute mapping
- [ ] Resource attribute extraction
- [ ] Policy evaluation (attributes + governance)
- [ ] Authorization decision enrichment
- [ ] API middleware integration

#### Audit System
- [ ] Persistent audit table
- [ ] Audit entry creation
- [ ] Audit write error tracking (integrity check #7)
- [ ] Audit query API
- [ ] Audit export (CSV, JSON)
- [ ] Compliance report generation

#### Metrics & Observability
- [ ] REST metrics API
- [ ] Time-series data export
- [ ] Prometheus format export
- [ ] Health endpoint
- [ ] Real-time metrics dashboard
- [ ] Metrics visualization
- [ ] Alerting infrastructure

#### Operations Tools
- [ ] CLI for mode changes
- [ ] CLI for metrics viewing
- [ ] CLI for health checks
- [ ] CLI for replay sampling
- [ ] Operational drills
- [ ] Dashboard real-time view
- [ ] Approval request management UI

#### Testing
- [ ] Integration test suite
- [ ] Approval flow tests
- [ ] TTL expiration tests
- [ ] Revocation tests
- [ ] Scope intersection tests
- [ ] Authorization tests
- [ ] Replay divergence scenarios
- [ ] Failure recovery scenarios
- [ ] Operator drill simulations

---

## Implementation Sequence

### Week 1: Core Features

**Day 1-2: Audit Persistence** (Foundation for compliance)
- [ ] Migration: governance_audit_events table
- [ ] governance-audit-store.ts
- [ ] Audit write error tracking
- [ ] 100 lines RGE integration

**Day 2-3: Approval Workflow** (Critical for risk mitigation)
- [ ] governance-approval.ts (state machine)
- [ ] governance-approval-store.ts (in-memory store)
- [ ] governance-approval-api.ts (endpoints)
- [ ] Approval state transitions
- [ ] Approval deadline enforcement
- [ ] 600 lines implementation

**Day 3-4: Metrics API** (Operator visibility)
- [ ] governance-metrics-api.ts
- [ ] REST endpoints for metrics
- [ ] Time-series data endpoints
- [ ] Export functionality
- [ ] 500 lines implementation

**Day 4-5: TTL & Revocation** (Time-bounded permissions)
- [ ] governance-ttl.ts
- [ ] governance-revocation.ts
- [ ] TTL check in RGE evaluate
- [ ] Expiration cleanup task
- [ ] 500 lines implementation

**Day 5-6: Capability Scopes** (Actor boundaries)
- [ ] governance-scopes.ts
- [ ] governance-scope-resolver.ts
- [ ] Scope validation in RGE
- [ ] Scope intersection logic
- [ ] 400 lines implementation

**Day 6-7: Authorization Bridge** (ABAC integration)
- [ ] authorization-governance-bridge.ts
- [ ] Context extraction
- [ ] Decision enrichment
- [ ] Attribute evaluation
- [ ] 700 lines implementation

**Day 7: Testing Framework** (Validation)
- [ ] Integration tests
- [ ] Scenario tests
- [ ] Failure recovery tests
- [ ] 1,500 lines tests

### Week 2: UI & Operations

**Day 8-9: CLI Tools**
- [ ] Operator CLI
- [ ] Drill execution
- [ ] Mode management
- [ ] 400 lines implementation

**Day 9-10: Dashboard Components**
- [ ] Main dashboard
- [ ] Metrics visualization
- [ ] Health status widget
- [ ] Recent decisions list
- [ ] 1,200 lines React

**Day 10-11: Approval UI**
- [ ] Approval request listing
- [ ] Approval details view
- [ ] Approval/deny controls
- [ ] Approval history
- [ ] 600 lines React

**Day 11-12: Complete Testing**
- [ ] End-to-end scenarios
- [ ] UI interaction tests
- [ ] API integration tests
- [ ] Load testing
- [ ] 1,000 lines tests

---

## Database Migrations Required

### Migration 1: Audit Events Table
```sql
CREATE TABLE governance_audit_events (
  id BIGSERIAL PRIMARY KEY,
  decision_id VARCHAR(64),
  decision_hash VARCHAR(64),
  governance_snapshot_hash VARCHAR(64),
  actor_id VARCHAR(255),
  action VARCHAR(255),
  resource VARCHAR(512),
  decision ENUM,
  risk_level ENUM,
  approval_request_id VARCHAR(64),
  timestamp TIMESTAMP,
  evaluation_ms INTEGER,
  environment VARCHAR(50),
  enforcement_mode VARCHAR(50),
  INDEX idx_timestamp (timestamp)
);
```

### Migration 2: Approval Requests Table
```sql
CREATE TABLE governance_approval_requests (
  request_id VARCHAR(64) PRIMARY KEY,
  decision_id VARCHAR(64),
  actor_id VARCHAR(255),
  action VARCHAR(255),
  resource VARCHAR(512),
  risk_level VARCHAR(50),
  state ENUM,
  required_approvals INTEGER,
  created_at TIMESTAMP,
  expires_at TIMESTAMP,
  approved_at TIMESTAMP,
  INDEX idx_state (state),
  INDEX idx_actor_id (actor_id)
);
```

### Migration 3: TTL & Revocation
```sql
CREATE TABLE governance_permissions_ttl (
  permission_id VARCHAR(64) PRIMARY KEY,
  created_at TIMESTAMP,
  expires_at TIMESTAMP,
  ttl_seconds INTEGER
);

CREATE TABLE governance_revocations (
  revocation_id VARCHAR(64) PRIMARY KEY,
  permission_id VARCHAR(64),
  revoked_at TIMESTAMP,
  reason VARCHAR(512)
);
```

### Migration 4: Capability Scopes
```sql
CREATE TABLE governance_scopes (
  scope_id VARCHAR(64) PRIMARY KEY,
  actor_id VARCHAR(255),
  capabilities JSON,
  resource_pattern VARCHAR(512),
  environment VARCHAR(50),
  created_at TIMESTAMP,
  expires_at TIMESTAMP
);
```

---

## Success Metrics

### Phase 2A Completion ✅
- [ ] All 8 Tier 1 components implemented
- [ ] All Tier 2 UI components deployed
- [ ] 4,500+ lines of new code
- [ ] 3,000+ lines of tests
- [ ] 2,700+ lines of UI
- [ ] 4 database migrations applied
- [ ] 100% test coverage for critical paths

### Phase 2B Foundation ✅
- [ ] All foundational components integrated
- [ ] Event streaming framework ready
- [ ] Authorization system complete
- [ ] Distributed governance capable
- [ ] 3,600+ lines of additional code

### Production Readiness ✅
- [ ] All tests passing
- [ ] All integrations verified
- [ ] All endpoints documented
- [ ] All UI workflows functional
- [ ] Operator handbook updated
- [ ] Runbooks created
- [ ] Performance benchmarked

---

## Deployment Checklist

- [ ] Code review complete
- [ ] All tests passing
- [ ] Database migrations tested
- [ ] UI workflows validated
- [ ] Operator handbook updated
- [ ] Performance benchmarks acceptable
- [ ] Security review complete
- [ ] Compliance verified

---

## Timeline Summary

| Phase | Duration | Deliverables | Status |
|-------|----------|--------------|--------|
| Phase 2A Complete | 7 days | 4,500L code, 3,000L tests, 2,700L UI | READY |
| Phase 2B Foundation | 5 days | 3,600L code, completions | READY |
| **Total** | **12 days** | **11,800+ lines** | **EXECUTE NOW** |

---

**Status**: Complete Master Plan Ready  
**Next Action**: Start Day 1 implementation (Audit Persistence)  
**No Approvals Required**: Full execution authority
