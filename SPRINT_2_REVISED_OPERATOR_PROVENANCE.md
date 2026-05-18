# SPRINT 2 (REVISED): Operator Provenance & Telemetry Contracts

**Original Plan**: Dashboard data flow and graphs  
**Revised Plan**: Freeze telemetry semantics before UI  
**Reason**: Dashboards calcify unstable epistemology → Phase 2A.1 pain  

**Duration**: Days 4-7 (48 hours)  
**Status**: Planning  

---

## Why This Pivot Is Critical

Current State:
- ✓ Causal integrity systems (Phase 6.1)
- ✓ Replay infrastructure (Phase 6.1.5A)
- ✓ Auth/session systems (Sprint 1)
- ✗ **Identity-to-trace binding (MISSING)**
- ✗ **Telemetry contract versioning (MISSING)**

If we render dashboards now:
- UI calcifies unstable semantics
- APIs become presentation-coupled
- Trust domains become hard to refactor
- SSE fanout introduces cascading assumptions

If we freeze contracts first:
- Dashboard APIs are resilient
- Replay authorization is well-defined
- Automation directives have clear authority binding
- Phase 2A.1 (systemic correlation) has stable input

---

## What Must Be Built

### 1. OperatorTraceBinding Interface

**Purpose**: Immutable proof that operator X approved action Y under trace Z with authority context W.

```typescript
// apps/api/types/operator-trace-binding.ts (180 lines)

export interface OperatorSessionSnapshot {
  sessionId: string;
  operatorHash: string;           // SHA256(user_id + creation_timestamp)
  userId: string;                 // User UUID
  tenantId: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  loginAt: string;                // ISO8601
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthorizationContext {
  contextId: string;              // UUID
  operatorSessionId: string;
  authorizationScope: 'LOCAL' | 'CROSS_TENANT' | 'REPLAY' | 'ESCALATION';
  grantedScopes: string[];        // e.g., ['traces:read', 'decisions:approve', 'replay:execute']
  expiresAt: string;              // ISO8601
}

export interface OperatorTraceBinding {
  bindingId: string;              // UUID
  traceId: string;
  originatingSpanId: string;      // Where in the trace did this binding originate?
  
  operatorSessionSnapshot: OperatorSessionSnapshot;
  authorizationContext: AuthorizationContext;
  
  // What action was taken?
  actionType: 'TRACE_READ' | 'DECISION_APPROVE' | 'REPLAY_AUTHORIZE' | 'REMEDIATION_APPROVE' | 'ESCALATION_OVERRIDE';
  actionPayload: Record<string, unknown>;
  
  // Immutability guarantee
  signedAt: string;               // ISO8601 when binding was created
  signedBy: string;               // Which service signed? ('governance-causality-engine', 'replay-authority', etc.)
  signatureHash?: string;         // HMAC-SHA256 of (operatorSessionId + actionType + actionPayload + signedAt)
  
  // Forensic trail
  rootCauseIfAnomalous?: {
    reason: string;
    detectedAt: string;
    byService: string;
  };
}

export interface OperatorTraceBindingChain {
  traceId: string;
  bindings: OperatorTraceBinding[];          // Timeline of all operator actions on this trace
  operatorConflicts?: {                       // e.g., approval + override on same decision
    bindingId1: string;
    bindingId2: string;
    conflictType: string;
  }[];
}

// Helper functions
export function createOperatorTraceBinding(
  traceId: string,
  originatingSpanId: string,
  sessionSnapshot: OperatorSessionSnapshot,
  authContext: AuthorizationContext,
  actionType: string,
  actionPayload: Record<string, unknown>
): OperatorTraceBinding;

export function verifyOperatorTraceBinding(binding: OperatorTraceBinding): boolean;

export function reconstructOperatorIntent(chain: OperatorTraceBindingChain): {
  primaryDecision: OperatorTraceBinding;
  approvals: OperatorTraceBinding[];
  overrides: OperatorTraceBinding[];
  escalations: OperatorTraceBinding[];
};
```

---

### 2. Short-Lived JWT + Refresh Token Flow

**Purpose**: Prevent leaked credentials from granting 7-day access.

```typescript
// apps/api/services/token-service.ts (250 lines)

export interface TokenPair {
  accessToken: string;            // 15–30m expiry, signed with PRIVATE_KEY
  refreshToken: string;           // 7d expiry, signed with different PRIVATE_KEY
  accessExpiresAt: string;        // ISO8601
  refreshExpiresAt: string;
}

export interface RefreshTokenPayload {
  refreshTokenId: string;         // UUID, stored in DB for revocation
  userId: string;
  tenantId: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;                  // Random, changes on each refresh
}

export class TokenService {
  /**
   * Mint a new token pair after successful login
   */
  async issueTokenPair(
    userId: string,
    tenantId: string,
    pool: Pool
  ): Promise<TokenPair>;

  /**
   * Refresh access token using refresh token
   * Requires refresh token to be valid + not revoked + nonce unchanged
   */
  async refreshAccessToken(
    refreshToken: string,
    pool: Pool
  ): Promise<{ accessToken: string; accessExpiresAt: string }>;

  /**
   * Verify access token (no DB lookup, fast)
   */
  verifyAccessToken(accessToken: string): {
    userId: string;
    tenantId: string;
  };

  /**
   * Revoke refresh token (logout, or force re-auth)
   */
  async revokeRefreshToken(refreshToken: string, pool: Pool): Promise<void>;

  /**
   * Rotate refresh token on each use (sliding window)
   * New nonce prevents token reuse attacks
   */
  private async rotateRefreshToken(
    oldRefreshToken: string,
    pool: Pool
  ): Promise<string>;
}
```

**Migration**: Add `refresh_tokens` table with `id, user_id, tenant_id, nonce, expires_at, is_revoked, created_at`.

---

### 3. GovernanceTelemetryEnvelopeV1

**Purpose**: Frozen contract defining what "a telemetry event" is across all trust domains.

```typescript
// apps/api/types/governance-telemetry-envelope.ts (400 lines)

export interface TrustDomainSnapshot {
  domain: 'STRUCTURAL' | 'PROPAGATION' | 'AUTOMATION' | 'IDENTITY' | 'OBSERVABILITY';
  score: number;              // [0, 1]
  composition?: {
    [component: string]: number; // e.g., { extractionRate: 0.95, alsIntegrity: 0.88 }
  };
  lastEvaluatedAt: string;
  evaluationMethod: string;   // 'PHASE_6_1_5A_1_1' | 'PROPAGATION_CONFIDENCE' | etc.
}

export interface AutomationDirective {
  directiveId: string;
  scope: 'FULL_AUTOMATION' | 'SUGGEST_ONLY' | 'ESCALATION_ONLY';
  confidenceThreshold: number;
  requiresApproval: boolean;
  approverRole: 'admin' | 'editor' | 'viewer';
  appliedAt: string;
}

export interface CoherenceTier {
  tier: 'COLD' | 'WARM' | 'HOT';
  reason: string;
  cachedAt: string;
  expectedFreshnessMs: number;
}

export interface SystemicClusterLink {
  clusterId: string;          // Aggregation ID for cross-trace anomalies (Phase 2A.1)
  clusterSize: number;
  relatedTraceIds: string[];
  clusterAnomalyType?: string;
}

export interface ReplayAuthority {
  replayBound: boolean;
  replayNonce?: string;       // One-time use token for replay execution
  replayExpiresAt?: string;
  replayInitiatorSessionId?: string;
}

export interface TopologyEpoch {
  epoch: number;              // Incremented on deployment, topology change
  deploymentId: string;
  deployedAt: string;
  services: {
    [serviceName: string]: {
      version: string;
      healthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
      lastHeartbeat: string;
    };
  };
}

export interface GovernanceTelemetryEnvelopeV1 {
  // ===== Identity =====
  envelopeId: string;
  schemaVersion: '1.0';
  traceId: string;
  spanId: string;
  
  // ===== Trust Domains =====
  trustDomains: {
    structural: TrustDomainSnapshot;
    propagation: TrustDomainSnapshot;
    automation: TrustDomainSnapshot;
    identity: TrustDomainSnapshot;
    observability: TrustDomainSnapshot;
  };
  
  // ===== Automation Authority =====
  automationDirective?: AutomationDirective;
  operatorTraceBinding?: OperatorTraceBinding;  // If human approval involved
  
  // ===== Observability State =====
  coherenceTier: CoherenceTier;
  topologyEpoch: TopologyEpoch;
  systemicClusterLink?: SystemicClusterLink;    // For Phase 2A.1
  
  // ===== Replay Safety =====
  replayAuthority?: ReplayAuthority;
  
  // ===== Metadata =====
  emittedAt: string;
  emittedBy: string;          // Which service/function created this?
  ttlSeconds?: number;        // When should this envelope expire from cache?
}

// ===== DTO for Dashboard Consumption =====
export interface GovernanceTelemetryEnvelopeDTO {
  traceId: string;
  spanId: string;
  trustScores: {
    structural: number;
    propagation: number;
    automation: number;
    identity: number;
    observability: number;
  };
  overallAutomationGate: 'FULL_AUTOMATION' | 'SUGGEST_ONLY' | 'ESCALATION_ONLY';
  operatorApproval?: {
    approverEmail: string;
    approvedAt: string;
    actionType: string;
  };
  coherenceTier: 'COLD' | 'WARM' | 'HOT';
  systemicAnomaly?: boolean;
}

// Helper
export function envelopeToDTO(env: GovernanceTelemetryEnvelopeV1): GovernanceTelemetryEnvelopeDTO;
```

---

### 4. Immutable Audit Linkage

**Purpose**: Every operator action is immutably linked to the traces it affected.

```typescript
// apps/api/routes/immutable-audit-routes.ts (150 lines)

/**
 * POST /audit/operator-action
 * Record an immutable operator action binding
 */
router.post('/operator-action', verifyTokenMiddleware, async (req, res) => {
  const { traceId, spanId, actionType, actionPayload } = req.body;
  const user = (req as any).user;

  // 1. Snapshot operator session
  const sessionSnapshot = await captureOperatorSession(user, req);

  // 2. Create OperatorTraceBinding
  const binding = createOperatorTraceBinding(
    traceId,
    spanId,
    sessionSnapshot,
    { /* authContext */ },
    actionType,
    actionPayload
  );

  // 3. Write immutably to database
  await pool.query(
    `
    INSERT INTO operator_trace_bindings (
      binding_id, trace_id, spanning_id, operator_session_snapshot,
      action_type, action_payload, signed_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `,
    [
      binding.bindingId,
      binding.traceId,
      binding.originatingSpanId,
      JSON.stringify(binding.operatorSessionSnapshot),
      binding.actionType,
      JSON.stringify(binding.actionPayload),
    ]
  );

  // 4. Emit to audit stream
  await emitToSplunkAuditStream({
    eventType: 'OPERATOR_ACTION',
    binding,
  });

  res.json({ bindingId: binding.bindingId });
});

/**
 * GET /audit/trace/:traceId/operators
 * Get all operator actions on a trace
 */
router.get('/trace/:traceId/operators', verifyTokenMiddleware, async (req, res) => {
  const { traceId } = req.params;

  const result = await pool.query(
    `
    SELECT * FROM operator_trace_bindings
    WHERE trace_id = $1
    ORDER BY signed_at ASC
    `,
    [traceId]
  );

  const bindings = result.rows.map(row => ({
    ...row,
    operator_session_snapshot: JSON.parse(row.operator_session_snapshot),
    action_payload: JSON.parse(row.action_payload),
  }));

  res.json({
    traceId,
    operatorActions: bindings,
    reconstructedIntent: reconstructOperatorIntent({
      traceId,
      bindings,
    }),
  });
});
```

---

### 5. Database Migrations

**Migration 107**: Operator provenance + refresh tokens

```sql
-- Refresh tokens (for JWT rotation)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nonce VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  is_revoked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_nonce ON refresh_tokens(nonce);

-- Operator trace bindings (immutable)
CREATE TABLE IF NOT EXISTS operator_trace_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id VARCHAR(255) NOT NULL UNIQUE,
  trace_id VARCHAR(255) NOT NULL,
  originating_span_id VARCHAR(255),
  operator_session_snapshot JSONB NOT NULL,
  authorization_context JSONB,
  action_type VARCHAR(100) NOT NULL,
  action_payload JSONB NOT NULL,
  signature_hash VARCHAR(255),
  signed_at TIMESTAMPTZ NOT NULL,
  signed_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_operator_bindings_trace ON operator_trace_bindings(trace_id);
CREATE INDEX idx_operator_bindings_user ON operator_trace_bindings((operator_session_snapshot->>'userId'));
```

---

## Sprint 2 Deliverables Checklist

- [ ] OperatorTraceBinding interface + helpers (180 lines)
- [ ] TokenService: short-lived JWT + refresh tokens (250 lines)
- [ ] GovernanceTelemetryEnvelopeV1 + DTO (400 lines)
- [ ] Immutable audit linkage routes (150 lines)
- [ ] Migration 107: refresh_tokens + operator_trace_bindings tables
- [ ] Update AuthService to use TokenService
- [ ] Update all governance API routes to emit GovernanceTelemetryEnvelopeV1
- [ ] Documentation: Telemetry contract versioning guide
- [ ] Tests: OperatorTraceBinding integrity, token rotation, envelope serialization

**Total**: ~1,200 lines of production code + migration

---

## Success Metrics

✓ Telemetry contract frozen (no dashboard assumptions baked in)  
✓ Operator provenance immutable (audit trail is first-class)  
✓ Short-lived tokens deployed (replay auth is safe)  
✓ All governance APIs emit V1 envelopes (consistent schema)  
✓ Five trust domains have defined input/output contracts  

---

## Then Sprint 3 Can Begin

**Objective**: Dashboard data flow and graph rendering

**Now Safe Because**:
- Telemetry envelopes are versioned → UI can evolve independently
- OperatorTraceBindings are immutable → dashboards can reference operator intent
- Trust domains have frozen semantics → graphs don't calcify assumptions
- Replay authority is bound → automation gates are well-defined

---

## Critical Notes

**Do NOT**:
- Start rendering dashboards yet
- Emit telemetry in unstable formats
- Couple auth decisions to UI presentation

**Do**:
- Freeze telemetry contract now
- Make every governance API emit V1 envelopes
- Test OperatorTraceBinding immutability guarantees
- Rotate refresh tokens on every use

---

**Pivot Justification**: This is the difference between "coherent observability system" and "dashboard coupled to unstable semantics." The extra 3 days on Sprint 2 prevents 2 weeks of refactoring in Phase 2A.1.
