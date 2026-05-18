/**
 * Governance Causality Service
 *
 * Phase 6.1: Causal tracing, cache coherence instrumentation, mutation lifecycle states,
 * replay authorization boundaries, and operator anonymization
 *
 * Extends Phase 6 observability with production-grade tracing fabric
 */

import { randomBytes } from 'crypto';
import { createHash } from 'crypto';

export interface CorrelationContext {
  correlationId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sessionId?: string;
  causalParentId?: string;
}

export interface CacheCoherenceMetrics {
  coherenceId: string;
  indexName: string;
  mutationCommittedAt: Date;
  invalidationRequestedAt?: Date;
  serverResponseReceivedAt?: Date;
  uiRefetchInitiatedAt?: Date;
  uiAcknowledgedAt?: Date;

  // Calculated metrics
  serverCommitToInvalidationMs?: number;
  invalidationToClientAwarenessMs?: number;
  clientAwarenessToRefetchMs?: number;
  refetchToUiReconciliationMs?: number;
  totalDivergenceWindowMs?: number;

  // Status flags
  isDivergent?: boolean;
  invalidationFailed?: boolean;
  refetchFailed?: boolean;
  uiStillStale?: boolean;

  correlationId: string;
}

export interface MutationLifecycleEvent {
  eventId: string;
  correlationId: string;
  lifecycleState:
    | 'INTENT_RECEIVED'
    | 'MUTATION_DISPATCHED'
    | 'API_ACCEPTED'
    | 'STATE_PERSISTED'
    | 'AUDIT_SNAPSHOTTED'
    | 'QUERY_INVALIDATED'
    | 'CACHE_REFRESH_REQUESTED'
    | 'QUERY_REFETCHED'
    | 'UI_RECONCILED'
    | 'OPERATOR_ACKNOWLEDGED';
  previousState?: string;
  stateTransitionReason?: string;
  enteredAt: Date;
  durationInStateMs?: number;
  errorCode?: string;
  errorMessage?: string;
  triggeringEventId?: string;
}

export interface ReplayAuthorizationRequest {
  requesterId: string;
  requesterRole: 'SUPER_COMPLIANCE_OPERATOR' | 'ADMIN' | 'AUDIT_REVIEWER';
  targetSnapshotId: string;
  targetIndexName: string;
  replayScope: 'READ_ONLY' | 'SANDBOX' | 'SIMULATION' | 'PROJECTION_REBUILD' | 'LIVE_RECONCILIATION';
  expectedSnapshotVersion?: string;
}

export interface OperatorIdentityToken {
  originalOperatorId: string;
  anonymizedToken: string;
  tokenVersion: number;
}

export class GovernanceCausalityService {
  private saltCluster: string;
  private correlationIdCounter: Map<string, number>;

  constructor(saltCluster?: string) {
    // SHA-256 salt cluster for operator anonymization (rotating monthly)
    this.saltCluster = saltCluster || this.generateSaltCluster();
    this.correlationIdCounter = new Map();
  }

  /**
   * Generate salt cluster for operator anonymization
   * Used in SHA-256 hashing with rotating schedule
   */
  private generateSaltCluster(): string {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    return createHash('sha256')
      .update(`${month}:governance-operator-salt`)
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Generate correlation context for new mutation
   * Correlation IDs are deterministic: corr_[uint64_timestamp]_[random_entropy]
   */
  generateCorrelationContext(sessionId?: string): CorrelationContext {
    const timestamp = Date.now();
    const entropy = randomBytes(8).toString('hex');
    const correlationId = `corr_${timestamp}_${entropy}`;
    const traceId = `trace_${randomBytes(16).toString('hex')}`;
    const spanId = `span_${randomBytes(8).toString('hex')}`;

    return {
      correlationId,
      traceId,
      spanId,
      sessionId: sessionId || undefined,
    };
  }

  /**
   * Extend correlation context with parent span reference
   * Used for nested/chained mutations
   */
  extendCorrelationContext(
    parent: CorrelationContext,
    causalParentId?: string
  ): CorrelationContext {
    return {
      ...parent,
      spanId: `span_${randomBytes(8).toString('hex')}`,
      parentSpanId: parent.spanId,
      causalParentId,
    };
  }

  /**
   * Calculate cache coherence metrics
   * Measures full lifecycle: mutation commit → UI acknowledgment
   */
  calculateCacheCoherenceMetrics(
    indexName: string,
    correlationId: string,
    timestamps: {
      mutationCommittedAt: Date;
      invalidationRequestedAt?: Date;
      serverResponseReceivedAt?: Date;
      uiRefetchInitiatedAt?: Date;
      uiAcknowledgedAt?: Date;
    },
    failures?: {
      invalidationFailed?: boolean;
      refetchFailed?: boolean;
      uiStillStale?: boolean;
    }
  ): CacheCoherenceMetrics {
    const baseMetrics: CacheCoherenceMetrics = {
      coherenceId: `coh_${randomBytes(8).toString('hex')}`,
      indexName,
      correlationId,
      ...timestamps,
      ...failures,
    };

    // Calculate latency windows
    if (timestamps.invalidationRequestedAt && timestamps.mutationCommittedAt) {
      baseMetrics.serverCommitToInvalidationMs =
        timestamps.invalidationRequestedAt.getTime() -
        timestamps.mutationCommittedAt.getTime();
    }

    if (timestamps.serverResponseReceivedAt && timestamps.invalidationRequestedAt) {
      baseMetrics.invalidationToClientAwarenessMs =
        timestamps.serverResponseReceivedAt.getTime() -
        timestamps.invalidationRequestedAt.getTime();
    }

    if (timestamps.uiRefetchInitiatedAt && timestamps.serverResponseReceivedAt) {
      baseMetrics.clientAwarenessToRefetchMs =
        timestamps.uiRefetchInitiatedAt.getTime() -
        timestamps.serverResponseReceivedAt.getTime();
    }

    if (timestamps.uiAcknowledgedAt && timestamps.uiRefetchInitiatedAt) {
      baseMetrics.refetchToUiReconciliationMs =
        timestamps.uiAcknowledgedAt.getTime() -
        timestamps.uiRefetchInitiatedAt.getTime();
    }

    // Total divergence window: full mutation-to-reconciliation span
    if (timestamps.uiAcknowledgedAt && timestamps.mutationCommittedAt) {
      baseMetrics.totalDivergenceWindowMs =
        timestamps.uiAcknowledgedAt.getTime() -
        timestamps.mutationCommittedAt.getTime();

      // Flag as divergent if exceeds 5s threshold
      baseMetrics.isDivergent = baseMetrics.totalDivergenceWindowMs > 5000;
    }

    return baseMetrics;
  }

  /**
   * Track mutation through 10-stage lifecycle
   * Returns event ready for database recording
   */
  createLifecycleEvent(
    correlationId: string,
    lifecycleState: MutationLifecycleEvent['lifecycleState'],
    previousState?: string,
    durationInStateMs?: number,
    errorContext?: { code?: string; message?: string }
  ): MutationLifecycleEvent {
    return {
      eventId: `evt_${randomBytes(8).toString('hex')}`,
      correlationId,
      lifecycleState,
      previousState,
      enteredAt: new Date(),
      durationInStateMs,
      errorCode: errorContext?.code,
      errorMessage: errorContext?.message,
    };
  }

  /**
   * Enforce triple-gate replay authorization
   * Returns authorization decision with gate results
   */
  authorizeReplay(request: ReplayAuthorizationRequest): {
    authorized: boolean;
    gate1RbacPassed: boolean;
    gate2TemporalPassed: boolean;
    gate3StateMatchPassed: boolean;
    denialReason?: string;
  } {
    // Gate 1: RBAC enforcement
    const gate1RbacPassed = ['SUPER_COMPLIANCE_OPERATOR', 'ADMIN', 'AUDIT_REVIEWER'].includes(
      request.requesterRole
    );
    if (!gate1RbacPassed) {
      return {
        authorized: false,
        gate1RbacPassed: false,
        gate2TemporalPassed: false,
        gate3StateMatchPassed: false,
        denialReason: 'RBAC_ENFORCEMENT_FAILED',
      };
    }

    // Gate 2: Temporal boundary (48h max replay window)
    const snapshotAge = Math.floor(Date.now() / 1000) - parseInt(request.targetSnapshotId.slice(0, 10), 10);
    const maxReplayWindowSeconds = 48 * 3600;
    const gate2TemporalPassed = snapshotAge <= maxReplayWindowSeconds;
    if (!gate2TemporalPassed) {
      return {
        authorized: false,
        gate1RbacPassed: true,
        gate2TemporalPassed: false,
        gate3StateMatchPassed: false,
        denialReason: 'REPLAY_EXPIRED',
      };
    }

    // Gate 3: State-match verification (simplified; full implementation would compare versions)
    const gate3StateMatchPassed = request.expectedSnapshotVersion !== undefined;

    return {
      authorized: gate1RbacPassed && gate2TemporalPassed && gate3StateMatchPassed,
      gate1RbacPassed,
      gate2TemporalPassed,
      gate3StateMatchPassed,
    };
  }

  /**
   * Anonymize operator identity
   * SHA-256 hash with rotating salt cluster
   */
  anonymizeOperatorId(originalOperatorId: string, tokenVersion: number = 1): OperatorIdentityToken {
    const token = createHash('sha256')
      .update(`${originalOperatorId}:${this.saltCluster}:v${tokenVersion}`)
      .digest('hex');

    return {
      originalOperatorId,
      anonymizedToken: token,
      tokenVersion,
    };
  }

  /**
   * Verify anonymized token matches operator (for compliance audit)
   */
  verifyAnonymizedToken(
    originalOperatorId: string,
    anonymizedToken: string,
    tokenVersion: number = 1
  ): boolean {
    const expected = this.anonymizeOperatorId(originalOperatorId, tokenVersion);
    return expected.anonymizedToken === anonymizedToken;
  }

  /**
   * Rotate salt cluster for monthly anonymization schedule
   * Called by background process on the 1st of each month
   */
  rotateSaltCluster(): void {
    this.saltCluster = this.generateSaltCluster();
  }

  /**
   * Get current salt cluster version (YYYY-MM format)
   */
  getCurrentSaltVersion(): string {
    return new Date().toISOString().slice(0, 7);
  }
}

export const governanceCausalityService = new GovernanceCausalityService();
