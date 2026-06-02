# Documentation Index: Complete Reference Guide

**Purpose**: Single place to find all project documentation  
**Last Updated**: 2026-05-28  
**Maintainer**: Claude (Agent) + User (Ramakrishna)

---

## 🎯 START HERE

### New to the project?
1. Read: [PROJECT_STATUS_SOURCE_OF_TRUTH.md](#project-status-source-of-truth) (5 min)
2. Read: [GOVERNANCE_EMPIRICISM_PHILOSOPHY.md](#governance-empiricism-philosophy) (10 min)
3. Reference: [MASTER_DEVELOPMENT_PLAN_PHASE_2A_2B.md](#master-development-plan) (as needed)

### Deploying today?
1. Follow: [PHASE_2A_PRE_FLIGHT_CHECKLIST.md](#phase-2a-pre-flight-checklist) (1 hour)
2. Reference: [PHASE_2A_OPERATOR_QUICK_REFERENCE.md](#phase-2a-operator-quick-reference)
3. Monitor: [PHASE_2A_SHADOW_VALIDATION_CHECKLIST.md](#phase-2a-shadow-validation-checklist)

### Building features?
1. Reference: [MASTER_DEVELOPMENT_PLAN_PHASE_2A_2B.md](#master-development-plan) (planning)
2. Track: [IMPLEMENTATION_PROGRESS_2026_05_28.md](#implementation-progress) (daily)
3. Understand: [STAGE_CONTRACTS.md](#stage-contracts) (operational rules)

### Understanding governance?
1. Read: [GOVERNANCE_EMPIRICISM_PHILOSOPHY.md](#governance-empiricism-philosophy) (strategy)
2. Reference: [NORMALIZATION_CONTRACT.md](#normalization-contract) (semantics)
3. Study: [STAGE_CONTRACTS.md](#stage-contracts) (operations)

---

## 📋 Document Directory

### Strategic & Architectural Documents

#### PROJECT_STATUS_SOURCE_OF_TRUTH.md
**Purpose**: Single source of truth for project state  
**Read When**: Daily status check, before making decisions  
**Contains**: Executive summary, document index, current work, 12-day plan, deployment timeline  
**Audience**: Everyone (1 page executive, then detailed sections)  
**Updated**: 2026-05-28

#### GOVERNANCE_EMPIRICISM_PHILOSOPHY.md
**Purpose**: Strategic framework for post-architecture development  
**Read When**: Unsure why we're not building more features, want to understand Phase A-D  
**Contains**: Why empiricism matters, Phase A-D methodology, 4 operational drills, success criteria  
**Audience**: Decision makers, architects, operators  
**Key Insight**: "Reality is the next architect" — we learn from operations, not speculation  
**Updated**: 2026-05-28

#### STAGE_CONTRACTS.md
**Purpose**: Operational governance law (governance rules, not code)  
**Read When**: Need to understand how enforcement modes work, what operators must do  
**Contains**: 5 enforcement modes, requirements for each, transition gates, emergency procedures  
**Audience**: Operators, decision makers, enforcement system  
**Key Rules**: SHADOW → ENFORCING_LOG_ONLY → ENFORCING_NON_CRITICAL → FULL_ENFORCING  
**Updated**: 2026-05-27

#### NORMALIZATION_CONTRACT.md
**Purpose**: Frozen input normalization semantics (determinism guarantee)  
**Read When**: Debugging non-determinism, implementing replay, or understanding decision_id generation  
**Contains**: Normalization rules, version contract, breaking change detection, hashing strategy  
**Audience**: Developers, forensic engineers  
**Key**: If normalization changes, decision_id changes (breaks replay validation)  
**Status**: FROZEN (do not change)

---

### Implementation & Feature Development

#### MASTER_DEVELOPMENT_PLAN_PHASE_2A_2B.md
**Purpose**: 12-day feature implementation roadmap  
**Read When**: Planning next feature, want to see full scope, need design details  
**Contains**: Tier 1 (Days 1-7), Tier 2 (Days 8-12), Tier 3 (Phase 2B), migrations, designs, APIs  
**Audience**: Developers, architects, project managers  
**Effort**: 4,500 lines (Tier 1) + 2,700 lines (Tier 2) + 3,600 lines (Tier 3)  
**Updated**: 2026-05-28 (added Audit Persistence status)

#### IMPLEMENTATION_PROGRESS_2026_05_28.md
**Purpose**: Session-by-session progress tracking (SOURCE OF TRUTH for work done)  
**Read When**: Daily status check, want to see what was completed, what's next  
**Contains**: Current session progress, implementation status, database migrations, deployment pipeline  
**Audience**: Everyone (different sections for different roles)  
**Frequency**: Updated daily upon task completion  
**Updated**: 2026-05-28 (created Session 7)

---

### Deployment & Validation

#### DEPLOYMENT_READINESS_REPORT.md
**Purpose**: Pre-deployment validation and risk assessment  
**Read When**: Before deploying to sandbox, assessing deployment readiness  
**Contains**: Implementation status (100%), integration checklist, risk assessment, pre-deployment verification, success metrics  
**Audience**: Decision makers, operations team, technical leads  
**Status**: ✅ READY FOR DEPLOYMENT (with feature development complete)  
**Updated**: 2026-05-28 (updated with feature status)

#### PHASE_2A_PRE_FLIGHT_CHECKLIST.md
**Purpose**: Hour-by-hour pre-deployment verification  
**Read When**: Right before deploying (30 min before go-time)  
**Contains**: 7 sections (Code, Environment, Deployment, Logs, Metrics, Safety, Documentation), each with specific tests  
**Audience**: Technical lead executing deployment  
**Time**: 1 hour for all checks  
**Updated**: 2026-05-28 (added status note)

#### PHASE_2A_SHADOW_VALIDATION_CHECKLIST.md
**Purpose**: Success criteria for Phase A validation  
**Read When**: After Phase A deployment, monitoring progress toward Phase B  
**Contains**: Integration requirements, metrics to track, success thresholds, gate criteria  
**Audience**: Operators monitoring Phase A  
**Duration**: 48-72 hours observation  
**Reference**: [STAGE_CONTRACTS.md](#stage-contracts) for Phase B requirements

#### PHASE_2A_STARTUP_INTEGRATION.md
**Purpose**: How to integrate governance startup code into app  
**Read When**: Need to wire up initialization, have questions about startup flow  
**Contains**: Step-by-step integration guide, config options, environment setup, verification  
**Audience**: Developers doing integration work  
**Status**: ✅ READY TO FOLLOW

---

### Operational Guides

#### PHASE_2A_OPERATOR_QUICK_REFERENCE.md
**Purpose**: Operator handbook (print and post at the desk)  
**Read When**: On-call during Phase A/B/C/D, want quick grep commands, need alert procedures  
**Contains**: Log reference guide, grep commands for all alerts, red flags, remediation steps  
**Audience**: Operations team, on-call engineers  
**Format**: Quick lookup (not narrative)  
**Frequency**: Bookmark/print for daily use

#### PHASE_2A_INTEGRATION_COMPLETE.md
**Purpose**: Summary of all integration points and how they work together  
**Read When**: Want to understand how all the pieces fit together, debugging integration issues  
**Contains**: 7 integration points, data flow diagram, component interactions  
**Audience**: Developers, architects  
**Reference**: Code files for detailed implementation

---

### Code Architecture (Reference Only)

#### governance-mode.ts
**Purpose**: 5-mode feature flag (SHADOW/LOG_ONLY/NON_CRITICAL/ENFORCING/FULL)  
**Status**: ✅ FROZEN (do not change)  
**Location**: `/Users/ramakrishna/Desktop/Teja/Dashboards/core/governance/governance-mode.ts`  
**Size**: 172 lines  
**Modes**:
- SHADOW: Observe, don't block (Phase A)
- ENFORCING_LOG_ONLY: Log DENY decisions (Phase C)
- ENFORCING_NON_CRITICAL: Block LOW/MODERATE (Phase D1)
- FULL_ENFORCING: Block all risk levels (Phase D2)

#### governance-metrics.ts
**Purpose**: Metric collection and reporting  
**Status**: ✅ FROZEN  
**Location**: `/Users/ramakrishna/Desktop/Teja/Dashboards/core/governance/governance-metrics.ts`  
**Size**: 365 lines  
**Metrics**: decision counters, failure rates, latency percentiles, consensus rate

#### governance-integrity.ts
**Purpose**: Health assessment (7 checks → HEALTHY/DEGRADED/FAILED)  
**Status**: ✅ FROZEN (audit_health check being wired in S7)  
**Location**: `/Users/ramakrishna/Desktop/Teja/Dashboards/core/governance/governance-integrity.ts`  
**Size**: 227+ lines  
**Checks**: failures, consensus, latency, metrics, replay, normalization, audit

#### governance-snapshot.ts
**Purpose**: Semantic context freezing (50+ fields per decision)  
**Status**: ✅ FROZEN  
**Location**: `/Users/ramakrishna/Desktop/Teja/Dashboards/core/governance/governance-snapshot.ts`  
**Size**: 247 lines  
**Fields**: decision_id, actor, action, resource, policy_snapshot_hash, versions...

#### governance-replay.ts
**Purpose**: Replay validation + drift classification  
**Status**: ✅ FROZEN (enhanced S7 with drift types)  
**Location**: `/Users/ramakrishna/Desktop/Teja/Dashboards/core/governance/governance-replay.ts`  
**Size**: 315 lines  
**Features**: ReplaySampler, drift classification (8 types), forensic analysis

#### governance-observer.ts
**Purpose**: Observation loop (5-min tick, integrity + drift reporting)  
**Status**: ✅ FROZEN  
**Location**: `/Users/ramakrishna/Desktop/Teja/Dashboards/core/governance/governance-observer.ts`  
**Size**: 330+ lines  
**Frequency**: 5-minute ticks, logs [GOVERNANCE_OBSERVATION_STATE], [GOVERNANCE_INTEGRITY_CHECK], [GOVERNANCE_DRIFT_REPORT]

#### runtime-governance-engine.ts
**Purpose**: Core decision engine (deterministic, fail-closed)  
**Status**: ✅ FROZEN (audit logging being wired in S7)  
**Location**: `/Users/ramakrishna/Desktop/Teja/Dashboards/core/governance/engine/runtime-governance-engine.ts`  
**Size**: Core component with snapshot capture, metrics recording, validation

#### decision-model.ts
**Purpose**: Decision structures and enums  
**Status**: ✅ FROZEN  
**Location**: `/Users/ramakrishna/Desktop/Teja/Dashboards/core/governance/decision-model.ts`  
**Types**: GovernanceDecision, Decision enum, RiskLevel, PolicyEvaluationResult

---

### Database Migrations

#### 20260528_governance_audit_events
**Purpose**: Audit trail foundation (immutable decision log)  
**Status**: ✅ CREATED, PENDING MIGRATION APPLY  
**Location**: `/Users/ramakrishna/Desktop/Teja/Dashboards/prisma/migrations/20260528_governance_audit_events/migration.sql`  
**Table**: governance_audit_events (14 forensic indexes)  
**Fields**: decisionId, decision, riskLevel, actor, actorId, action, resource, environment, traceId, correlationId, integrityState, etc.

#### 20260529_governance_approval_requests
**Purpose**: Approval workflow state machine  
**Status**: ⏳ QUEUED FOR CREATION (Day 2-3)  
**Table**: governance_approval_requests  
**Fields**: request_id, decision_id, state, required_approvals, received_approvals, created_at, expires_at, approved_at

#### 20260530_governance_permissions_ttl
**Purpose**: TTL/revocation system  
**Status**: ⏳ QUEUED FOR CREATION (Day 4-5)  
**Tables**: governance_permissions_ttl, governance_revocations  
**Features**: Auto-renewal, grace periods, revocation tracking

#### 20260531_governance_scopes
**Purpose**: Capability scopes (actor boundary enforcement)  
**Status**: ⏳ QUEUED FOR CREATION (Day 5-6)  
**Table**: governance_scopes  
**Features**: AND/OR approval logic, time-bounded scopes, approval requirements

---

## 📊 Status Summary

### Architecture ✅ COMPLETE (Do Not Change)
- [x] governance-mode.ts
- [x] governance-metrics.ts
- [x] governance-integrity.ts
- [x] governance-snapshot.ts
- [x] governance-replay.ts (enhanced S7)
- [x] governance-observer.ts
- [x] runtime-governance-engine.ts
- [x] decision-model.ts

**Total**: 2,556 lines (production-ready, frozen)

### Features 🔄 IN PROGRESS (Tier 1)
- [x] Migration: 20260528_governance_audit_events
- [ ] governance-audit-store.ts (IN PROGRESS, Day 1-2)
- [ ] governance-audit-api.ts (PENDING, Day 1-2)
- [ ] Approval Workflow (QUEUED, Day 2-3)
- [ ] Metrics API (QUEUED, Day 3-4)
- [ ] TTL & Revocation (QUEUED, Day 4-5)
- [ ] Capability Scopes (QUEUED, Day 5-6)
- [ ] Authorization Bridge (QUEUED, Day 6-7)
- [ ] Testing Framework (QUEUED, Day 7)

### Deployment 🟡 ALMOST READY
- ✅ Pre-flight checklist prepared
- ✅ Operator handbook ready
- 🔄 Feature implementation in progress (must complete Tier 1 first)
- ⏳ Phase A deployment (after Tier 1 complete)

---

## 🔗 Quick Links

**Strategic Questions?** → [GOVERNANCE_EMPIRICISM_PHILOSOPHY.md](#governance-empiricism-philosophy)  
**What's happening now?** → [PROJECT_STATUS_SOURCE_OF_TRUTH.md](#project-status-source-of-truth)  
**What gets built next?** → [MASTER_DEVELOPMENT_PLAN_PHASE_2A_2B.md](#master-development-plan)  
**Daily progress?** → [IMPLEMENTATION_PROGRESS_2026_05_28.md](#implementation-progress)  
**Deploying?** → [PHASE_2A_PRE_FLIGHT_CHECKLIST.md](#phase-2a-pre-flight-checklist)  
**Operating?** → [PHASE_2A_OPERATOR_QUICK_REFERENCE.md](#phase-2a-operator-quick-reference)  
**How does it work?** → [STAGE_CONTRACTS.md](#stage-contracts)  

---

**Last Updated**: 2026-05-28  
**Source of Truth**: This document + PROJECT_STATUS_SOURCE_OF_TRUTH.md + IMPLEMENTATION_PROGRESS_2026_05_28.md  
**Maintained By**: Claude (Agent)

