/**
 * GovernanceTelemetryEnvelopeV1
 *
 * Frozen contract defining what "a telemetry event" is across all trust domains.
 * This envelope is immutable once emitted and versioned to prevent dashboard
 * coupling to unstable semantics.
 *
 * Version 1.0: Baseline covering five trust domains with operator provenance binding.
 */

import { OperatorTraceBinding } from './operator-trace-binding';

// ===== TRUST DOMAIN SNAPSHOTS =====

export interface TrustDomainSnapshot {
  domain: 'STRUCTURAL' | 'PROPAGATION' | 'AUTOMATION' | 'IDENTITY' | 'OBSERVABILITY';
  score: number; // [0, 1] confidence in this domain
  composition?: {
    [component: string]: number; // e.g., { extractionRate: 0.95, alsIntegrity: 0.88 }
  };
  lastEvaluatedAt: string; // ISO8601
  evaluationMethod: string; // 'PHASE_6_1_5A_1_1' | 'PROPAGATION_CONFIDENCE' | etc.
}

// ===== AUTOMATION AUTHORITY =====

export interface AutomationDirective {
  directiveId: string; // UUID
  scope: 'FULL_AUTOMATION' | 'SUGGEST_ONLY' | 'ESCALATION_ONLY';
  confidenceThreshold: number; // [0, 1]
  requiresApproval: boolean;
  approverRole?: 'admin' | 'editor' | 'viewer';
  appliedAt: string; // ISO8601
}

// ===== OBSERVABILITY STATE =====

export interface CoherenceTier {
  tier: 'COLD' | 'WARM' | 'HOT';
  reason: string; // Why this tier? e.g., "Freshness > 5m" → COLD
  cachedAt: string; // ISO8601 when this tier was computed
  expectedFreshnessMs: number; // When will this become stale?
}

// ===== SYSTEMIC ANOMALY DETECTION (Phase 2A.1) =====

export interface SystemicClusterLink {
  clusterId: string; // Aggregation ID for cross-trace anomalies
  clusterSize: number; // How many traces share this anomaly signature?
  relatedTraceIds: string[]; // Other trace IDs in this cluster (up to 100)
  clusterAnomalyType?: string; // 'CORRELATED_LATENCY' | 'CASCADING_ERRORS' | etc.
}

// ===== REPLAY AUTHORIZATION =====

export interface ReplayAuthority {
  replayBound: boolean; // Is replay allowed for this trace?
  replayNonce?: string; // One-time use token for replay execution
  replayExpiresAt?: string; // ISO8601 when replay authorization expires
  replayInitiatorSessionId?: string; // Which operator authorized this replay?
}

// ===== TOPOLOGY EPOCH (Deployment Tracking) =====

export interface TopologyEpoch {
  epoch: number; // Incremented on deployment, topology change
  deploymentId: string; // Correlate to deployment event
  deployedAt: string; // ISO8601
  services: {
    [serviceName: string]: {
      version: string; // Semantic version
      healthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
      lastHeartbeat: string; // ISO8601
    };
  };
}

// ===== MAIN ENVELOPE =====

export interface GovernanceTelemetryEnvelopeV1 {
  // ===== Identity =====
  envelopeId: string; // UUID, globally unique
  schemaVersion: '1.0'; // Frozen contract version
  traceId: string; // Distributed trace ID
  spanId: string; // Span within trace

  // ===== Trust Domains =====
  trustDomains: {
    structural: TrustDomainSnapshot;
    propagation: TrustDomainSnapshot;
    automation: TrustDomainSnapshot;
    identity: TrustDomainSnapshot;
    observability: TrustDomainSnapshot;
  };

  // ===== Automation Authority =====
  automationDirective?: AutomationDirective; // What automation gate applies here?
  operatorTraceBinding?: OperatorTraceBinding; // If human approval involved

  // ===== Observability State =====
  coherenceTier: CoherenceTier; // Data freshness tier (COLD/WARM/HOT)
  topologyEpoch: TopologyEpoch; // Which deployment version is this?
  systemicClusterLink?: SystemicClusterLink; // Phase 2A.1 cross-trace correlation

  // ===== Replay Safety =====
  replayAuthority?: ReplayAuthority; // Replay permissions and nonce

  // ===== Cryptographic Integrity =====
  envelopeSignature: string; // HMAC-SHA256(canonicalize(envelope), serviceSecret) — prevents mutation attacks

  // ===== Metadata =====
  emittedAt: string; // ISO8601 when envelope was created
  emittedBy: string; // Which service/function created this? (e.g., 'governance-causality-engine', 'replay-authority')
  ttlSeconds?: number; // When should this envelope expire from cache?
}

// ===== DTO FOR DASHBOARD CONSUMPTION =====

/**
 * Simplified envelope for dashboard rendering.
 * Includes only fields needed for UI visualization.
 */
export interface GovernanceTelemetryEnvelopeDTO {
  traceId: string;
  spanId: string;

  // Trust scores (5-point summary)
  trustScores: {
    structural: number; // [0, 1]
    propagation: number;
    automation: number;
    identity: number;
    observability: number;
  };

  // Automation gate
  overallAutomationGate: 'FULL_AUTOMATION' | 'SUGGEST_ONLY' | 'ESCALATION_ONLY';

  // Operator approval (if applicable)
  operatorApproval?: {
    approverEmail: string;
    approvedAt: string; // ISO8601
    actionType: string;
  };

  // Observability
  coherenceTier: 'COLD' | 'WARM' | 'HOT';

  // Phase 2A.1
  systemicAnomaly?: boolean;

  // Metadata
  emittedAt: string;
}

// ===== HELPER: ENVELOPE TO DTO CONVERSION =====

/**
 * Convert full envelope to dashboard-friendly DTO
 */
export function envelopeToDTO(env: GovernanceTelemetryEnvelopeV1): GovernanceTelemetryEnvelopeDTO {
  return {
    traceId: env.traceId,
    spanId: env.spanId,

    trustScores: {
      structural: env.trustDomains.structural.score,
      propagation: env.trustDomains.propagation.score,
      automation: env.trustDomains.automation.score,
      identity: env.trustDomains.identity.score,
      observability: env.trustDomains.observability.score,
    },

    overallAutomationGate: env.automationDirective?.scope || 'ESCALATION_ONLY',

    operatorApproval: env.operatorTraceBinding
      ? {
          approverEmail: env.operatorTraceBinding.operatorSessionSnapshot.email,
          approvedAt: env.operatorTraceBinding.signedAt,
          actionType: env.operatorTraceBinding.actionType,
        }
      : undefined,

    coherenceTier: env.coherenceTier.tier,

    systemicAnomaly: env.systemicClusterLink ? env.systemicClusterLink.clusterSize > 1 : false,

    emittedAt: env.emittedAt,
  };
}

// ===== HELPERS: ENVELOPE SIGNATURE =====

/**
 * Compute HMAC-SHA256 signature for envelope using canonical JSON serialization.
 * CRITICAL: Uses canonicalize() for deterministic serialization (not JSON.stringify).
 * This prevents object key reordering attacks from invalidating signatures.
 */
export function computeEnvelopeHMAC(
  envelope: Partial<GovernanceTelemetryEnvelopeV1>,
  serviceSecret: string
): string {
  const { createHmac } = require('crypto');
  const canonicalize = require('canonicalize');

  // Create a copy without the signature field for hashing
  const { envelopeSignature, ...envelopeWithoutSignature } = envelope as any;

  // Use canonical JSON serialization to ensure deterministic hash
  const canonicalEnvelope = canonicalize(envelopeWithoutSignature);

  if (!canonicalEnvelope) {
    throw new Error('ENVELOPE_CANONICALIZATION_FAILED: Could not serialize envelope');
  }

  // Compute HMAC-SHA256
  const hmac = createHmac('sha256', serviceSecret)
    .update(canonicalEnvelope)
    .digest('hex');

  return hmac;
}

/**
 * Verify envelope signature hasn't been tampered with.
 * Recomputes HMAC and compares against stored signature.
 */
export function verifyEnvelopeSignature(
  envelope: GovernanceTelemetryEnvelopeV1,
  serviceSecret: string
): boolean {
  try {
    const expectedSignature = computeEnvelopeHMAC(envelope, serviceSecret);
    return envelope.envelopeSignature === expectedSignature;
  } catch (error) {
    console.error('Envelope signature verification failed:', error);
    return false;
  }
}

// ===== HELPERS: ENVELOPE CONSTRUCTION =====

/**
 * Create a new GovernanceTelemetryEnvelopeV1 with default values
 * Automatically computes and includes HMAC signature
 */
export function createGovernanceTelemetryEnvelope(
  traceId: string,
  spanId: string,
  trustDomainSnapshots: {
    structural: TrustDomainSnapshot;
    propagation: TrustDomainSnapshot;
    automation: TrustDomainSnapshot;
    identity: TrustDomainSnapshot;
    observability: TrustDomainSnapshot;
  },
  topologyEpoch: TopologyEpoch,
  coherenceTier: CoherenceTier,
  serviceSecret: string = process.env.ENVELOPE_SIGNING_SECRET || 'default-envelope-secret'
): GovernanceTelemetryEnvelopeV1 {
  const { randomBytes } = require('crypto');

  const envelope: GovernanceTelemetryEnvelopeV1 = {
    envelopeId: randomBytes(16).toString('hex'),
    schemaVersion: '1.0',
    traceId,
    spanId,
    trustDomains: trustDomainSnapshots,
    coherenceTier,
    topologyEpoch,
    emittedAt: new Date().toISOString(),
    emittedBy: 'governance-engine',
    envelopeSignature: '', // Placeholder, will be computed below
  };

  // Compute and set the signature
  envelope.envelopeSignature = computeEnvelopeHMAC(envelope, serviceSecret);

  return envelope;
}

/**
 * Verify an envelope hasn't been modified by checking:
 * - envelopeSignature is valid (HMAC-SHA256 matches canonical serialization)
 * - schemaVersion is '1.0'
 * - All trust domain scores are in [0, 1]
 * - emittedAt is a valid ISO8601 timestamp
 * - If operatorTraceBinding exists, its signature is valid
 */
export function verifyGovernanceTelemetryEnvelope(
  env: GovernanceTelemetryEnvelopeV1,
  serviceSecret: string = process.env.ENVELOPE_SIGNING_SECRET || 'default-envelope-secret'
): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check envelope signature FIRST (integrity)
  if (!env.envelopeSignature) {
    errors.push('Missing envelopeSignature: envelope integrity cannot be verified');
  } else if (!verifyEnvelopeSignature(env, serviceSecret)) {
    errors.push('Envelope signature verification failed: envelope may have been tampered with');
  }

  // Check schema version
  if (env.schemaVersion !== '1.0') {
    errors.push(`Invalid schemaVersion: ${env.schemaVersion}`);
  }

  // Check trust domain scores
  const scores = [
    env.trustDomains.structural.score,
    env.trustDomains.propagation.score,
    env.trustDomains.automation.score,
    env.trustDomains.identity.score,
    env.trustDomains.observability.score,
  ];

  for (const score of scores) {
    if (typeof score !== 'number' || score < 0 || score > 1) {
      errors.push(`Trust domain score out of range [0, 1]: ${score}`);
    }
  }

  // Check emittedAt is valid ISO8601
  try {
    new Date(env.emittedAt).toISOString();
  } catch {
    errors.push(`Invalid emittedAt timestamp: ${env.emittedAt}`);
  }

  // Verify operator trace binding if present
  if (env.operatorTraceBinding) {
    const { verifyOperatorTraceBinding } = require('./operator-trace-binding');
    if (!verifyOperatorTraceBinding(env.operatorTraceBinding)) {
      errors.push('Operator trace binding signature verification failed');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Compute overall trust score as weighted average of five trust domains
 * Weights can be customized per tenant
 */
export function computeOverallTrustScore(
  env: GovernanceTelemetryEnvelopeV1,
  weights?: {
    structural?: number;
    propagation?: number;
    automation?: number;
    identity?: number;
    observability?: number;
  }
): number {
  const defaultWeights = {
    structural: 0.25,
    propagation: 0.25,
    automation: 0.2,
    identity: 0.2,
    observability: 0.1,
  };

  const finalWeights = { ...defaultWeights, ...weights };

  // Normalize weights to sum to 1
  const totalWeight =
    finalWeights.structural +
    finalWeights.propagation +
    finalWeights.automation +
    finalWeights.identity +
    finalWeights.observability;

  const normalizedWeights = {
    structural: finalWeights.structural / totalWeight,
    propagation: finalWeights.propagation / totalWeight,
    automation: finalWeights.automation / totalWeight,
    identity: finalWeights.identity / totalWeight,
    observability: finalWeights.observability / totalWeight,
  };

  const overallScore =
    env.trustDomains.structural.score * normalizedWeights.structural +
    env.trustDomains.propagation.score * normalizedWeights.propagation +
    env.trustDomains.automation.score * normalizedWeights.automation +
    env.trustDomains.identity.score * normalizedWeights.identity +
    env.trustDomains.observability.score * normalizedWeights.observability;

  return Math.round(overallScore * 100) / 100; // Round to 2 decimals
}
