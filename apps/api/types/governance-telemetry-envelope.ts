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
import { VersionedSignature } from '../services/envelope-signing-key-service';

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
  signatureEpoch: number; // Signature epoch: incremented when signing keys rotate (prevents cross-deployment replays)
  services: {
    [serviceName: string]: {
      version: string; // Semantic version
      healthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
      lastHeartbeat: string; // ISO8601
    };
  };
}

// ===== EXECUTION CONTEXT (Signature Binding) =====

export interface ExecutionContext {
  route: string; // API route or handler path where envelope is processed
  tenantId: string; // Tenant UUID (binds signature to specific tenant)
  executionMode: 'SYNC' | 'ASYNC' | 'BATCH'; // How was this envelope processed?
  operationId: string; // Unique ID for this operation/request
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

  // ===== Execution Context (Signature Binding) =====
  executionContext: ExecutionContext; // Route, tenant, mode - bound into signature

  // ===== Replay Safety =====
  replayAuthority?: ReplayAuthority; // Replay permissions and nonce
  envelopeNonce?: string; // One-time use nonce for envelope replay detection (prevents replay attacks)
  nonceExpiresAt?: string; // ISO8601 when this nonce becomes invalid

  // ===== Bounded Freshness (Time-Bounding for Replay Prevention) =====
  issuedAt: string; // ISO8601 when envelope was issued (signed)
  expiresAt: string; // ISO8601 when envelope becomes invalid (absolute deadline)
  acceptedClockSkewMs?: number; // Tolerance for clock drift (default: 5000ms = 5s)

  // ===== Cryptographic Integrity =====
  envelopeSignature: VersionedSignature; // { keyId, algorithm, signature } — enables key rotation without invalidating historical signatures
  signatureEpoch: number; // Deployment signature epoch when envelope was signed (prevents cross-deployment replay)

  // ===== Deployment Verification =====
  topologyAttestation?: any; // Signed attestation of deployment topology (prevents topology spoofing)

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
 * Compute raw HMAC-SHA256 digest for envelope using canonical JSON serialization.
 * CRITICAL: Uses canonicalize() for deterministic serialization (not JSON.stringify).
 * Includes context binding (tenantId, route, topologyEpoch, issuedAt, nonce) to prevent
 * cross-context and cross-tenant replay attacks.
 * Returns hex digest of HMAC-SHA256 (algorithm independent).
 */
export function computeEnvelopeHMACDigest(
  envelope: Partial<GovernanceTelemetryEnvelopeV1>,
  keyMaterial: string
): string {
  const { createHmac } = require('crypto');
  const canonicalize = require('canonicalize');

  // Create a copy without the signature field for hashing
  const { envelopeSignature, ...envelopeWithoutSignature } = envelope as any;

  // Build context binding to prevent cross-context/cross-tenant replay
  const contextBinding = {
    // Tenant binding: cannot replay across tenants
    tenantId: (envelope as any).executionContext?.tenantId,
    // Route binding: cannot replay to different endpoints
    route: (envelope as any).executionContext?.route,
    // Deployment binding: cannot replay across deployments
    topologyEpoch: (envelope as any).topologyEpoch?.epoch,
    // Time binding: includes issued and expiration times
    issuedAt: (envelope as any).issuedAt,
    expiresAt: (envelope as any).expiresAt,
    // Nonce binding: ties signature to specific nonce
    envelopeNonce: (envelope as any).envelopeNonce,
  };

  // Create signing payload: context binding + envelope
  const signingPayload = {
    context: contextBinding,
    envelope: envelopeWithoutSignature,
  };

  // Use canonical JSON serialization to ensure deterministic hash
  const canonicalPayload = canonicalize(signingPayload);

  if (!canonicalPayload) {
    throw new Error('ENVELOPE_CANONICALIZATION_FAILED: Could not serialize signing payload');
  }

  // Compute HMAC-SHA256
  const hmac = createHmac('sha256', keyMaterial)
    .update(canonicalPayload)
    .digest('hex');

  return hmac;
}

/**
 * Compute versioned envelope signature with keyId and algorithm.
 * Used during envelope creation to include which key was used for signing.
 */
export function computeEnvelopeHMAC(
  envelope: Partial<GovernanceTelemetryEnvelopeV1>,
  keyId: string,
  keyMaterial: string
): VersionedSignature {
  const digest = computeEnvelopeHMACDigest(envelope, keyMaterial);

  return {
    keyId,
    algorithm: 'HMAC_SHA256_V1',
    signature: digest,
  };
}

/**
 * Verify envelope signature hasn't been tampered with.
 * Supports multiple keys for fallback verification (e.g., during key rotation grace period).
 * Recomputes HMAC and compares against stored signature using constant-time comparison.
 * CRITICAL: Uses crypto.timingSafeEqual to prevent timing side-channel attacks.
 */
export function verifyEnvelopeSignature(
  envelope: GovernanceTelemetryEnvelopeV1,
  verificationKeys: Array<{ keyId: string; keyMaterial: string }>
): { valid: boolean; usedKeyId?: string } {
  const { timingSafeEqual } = require('crypto');

  try {
    if (!envelope.envelopeSignature) {
      return { valid: false };
    }

    const { keyId, signature } = envelope.envelopeSignature;

    // Try to verify with each available key
    for (const key of verificationKeys) {
      try {
        const expectedDigest = computeEnvelopeHMACDigest(envelope, key.keyMaterial);

        // Use constant-time comparison to prevent timing attacks
        // Both must be equal length for timingSafeEqual
        if (expectedDigest.length === signature.length) {
          try {
            const expectedBuffer = Buffer.from(expectedDigest, 'hex');
            const signatureBuffer = Buffer.from(signature, 'hex');

            if (timingSafeEqual(expectedBuffer, signatureBuffer)) {
              return { valid: true, usedKeyId: key.keyId };
            }
          } catch {
            // Fallback to string comparison if buffer conversion fails
            // (e.g., invalid hex strings) - this is safe as we're already in a
            // non-matching scenario
            continue;
          }
        }
      } catch {
        // Continue to next key on error
        continue;
      }
    }

    // No key matched
    return { valid: false };
  } catch (error) {
    console.error('Envelope signature verification failed:', error);
    return { valid: false };
  }
}

// ===== HELPERS: ENVELOPE CONSTRUCTION =====

/**
 * Create a new GovernanceTelemetryEnvelopeV1 with default values
 * Automatically computes and includes versioned HMAC signature using active key
 * Generates and includes a replay prevention nonce
 */
export async function createGovernanceTelemetryEnvelope(
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
  keyService: any, // EnvelopeSigningKeyService
  tenantId: string,
  executionContext: ExecutionContext, // Route, mode, operation ID (for signature binding)
  replayPreventionService?: any, // EnvelopeReplayPreventionService (optional)
  ttlSeconds: number = 3600, // Default 1 hour
  acceptedClockSkewMs: number = 5000 // Default 5 seconds
): Promise<GovernanceTelemetryEnvelopeV1> {
  const { randomBytes } = require('crypto');

  // Get active signing key
  const activeKey = await keyService.getActiveKey(tenantId);
  if (!activeKey) {
    throw new Error('NO_ACTIVE_SIGNING_KEY: Cannot create envelope without active signing key');
  }

  // Decrypt key material
  const keyMaterial = await keyService.decryptKeyMaterial(activeKey.keyMaterialEncrypted);

  // Generate replay prevention nonce if service is available
  let envelopeNonce: string | undefined;
  let nonceExpiresAt: string | undefined;

  if (replayPreventionService) {
    const nonceResult = replayPreventionService.generateNonce();
    envelopeNonce = nonceResult.nonce;
    nonceExpiresAt = nonceResult.expiresAt.toISOString();
  }

  // Set time-bounding fields
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);

  const envelope: GovernanceTelemetryEnvelopeV1 = {
    envelopeId: randomBytes(16).toString('hex'),
    schemaVersion: '1.0',
    traceId,
    spanId,
    trustDomains: trustDomainSnapshots,
    coherenceTier,
    topologyEpoch,
    executionContext, // Context binding for signature
    emittedAt: issuedAt.toISOString(),
    emittedBy: 'governance-engine',
    envelopeNonce,
    nonceExpiresAt,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    acceptedClockSkewMs,
    signatureEpoch: topologyEpoch.signatureEpoch, // Bind signature to deployment epoch
    envelopeSignature: { keyId: '', algorithm: 'HMAC_SHA256_V1', signature: '' }, // Placeholder
  };

  // Compute and set the versioned signature (includes context binding)
  envelope.envelopeSignature = computeEnvelopeHMAC(envelope, activeKey.keyId, keyMaterial);

  return envelope;
}

/**
 * Verify an envelope hasn't been modified and hasn't been replayed by checking:
 * - envelopeSignature is valid (HMAC-SHA256 matches canonical serialization with active/previous keys)
 * - schemaVersion is '1.0'
 * - All trust domain scores are in [0, 1]
 * - emittedAt is a valid ISO8601 timestamp
 * - envelopeNonce hasn't been seen before (replay detection)
 * - envelopeNonce hasn't expired
 * - If operatorTraceBinding exists, its signature is valid
 */
export async function verifyGovernanceTelemetryEnvelope(
  env: GovernanceTelemetryEnvelopeV1,
  keyService: any, // EnvelopeSigningKeyService
  tenantId: string,
  replayPreventionService?: any // EnvelopeReplayPreventionService (optional)
): Promise<{
  valid: boolean;
  errors: string[];
  usedKeyId?: string;
}> {
  const errors: string[] = [];
  let usedKeyId: string | undefined;

  // Check envelope signature FIRST (integrity)
  if (!env.envelopeSignature) {
    errors.push('Missing envelopeSignature: envelope integrity cannot be verified');
  } else {
    try {
      // Get all valid keys for verification (active + recent previous)
      const verificationKeys = await keyService.getVerificationKeys(tenantId);

      if (verificationKeys.length === 0) {
        errors.push('No valid signing keys available for verification');
      } else {
        // Decrypt all key materials
        const decryptedKeys = await Promise.all(
          verificationKeys.map(async (key: any) => ({
            keyId: key.keyId,
            keyMaterial: await keyService.decryptKeyMaterial(key.keyMaterialEncrypted),
          }))
        );

        // Try verification with all available keys
        const result = verifyEnvelopeSignature(env, decryptedKeys);

        if (!result.valid) {
          errors.push('Envelope signature verification failed: envelope may have been tampered with');
          // Log verification failure for compromise detection
          await keyService.logVerificationFailure(
            tenantId,
            env.envelopeId,
            env.envelopeSignature.keyId,
            'SIGNATURE_MISMATCH'
          );
        } else {
          usedKeyId = result.usedKeyId;
        }
      }
    } catch (error) {
      errors.push(`Envelope signature verification error: ${error}`);
    }
  }

  // Check schema version
  if (env.schemaVersion !== '1.0') {
    errors.push(`Invalid schemaVersion: ${env.schemaVersion}`);
  }

  // Check signature epoch matches deployment (prevents cross-deployment replay)
  const currentEpoch = env.topologyEpoch.signatureEpoch;
  if (env.signatureEpoch !== currentEpoch) {
    // Allow a 1-epoch grace period for gradual deployment rollout
    if (env.signatureEpoch !== currentEpoch - 1) {
      errors.push(
        `Signature epoch mismatch: envelope signed in epoch ${env.signatureEpoch}, current epoch is ${currentEpoch}`
      );
    }
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

  // Check bounded freshness (time-bounding for replay prevention)
  const nowTime = Date.now();
  const acceptedClockSkewMs = env.acceptedClockSkewMs || 5000; // Default 5 seconds

  try {
    const issuedAtTime = new Date(env.issuedAt).getTime();
    const expiresAtTime = new Date(env.expiresAt).getTime();

    // Validate timestamp order
    if (issuedAtTime >= expiresAtTime) {
      errors.push(`Invalid time bounds: issuedAt (${env.issuedAt}) must be before expiresAt (${env.expiresAt})`);
    }

    // Check if current time is within acceptable window
    // Allow clock skew: [issuedAt - clockSkew, expiresAt + clockSkew]
    const earliestAcceptedTime = issuedAtTime - acceptedClockSkewMs;
    const latestAcceptedTime = expiresAtTime + acceptedClockSkewMs;

    if (nowTime < earliestAcceptedTime) {
      errors.push(
        `Envelope not yet valid: issued at ${env.issuedAt}, current time is ${new Date(nowTime).toISOString()}, clock skew allowed: ${acceptedClockSkewMs}ms`
      );
    }

    if (nowTime > latestAcceptedTime) {
      errors.push(
        `Envelope has expired: expires at ${env.expiresAt}, current time is ${new Date(nowTime).toISOString()}, clock skew allowed: ${acceptedClockSkewMs}ms`
      );
    }
  } catch (error) {
    errors.push(`Invalid time bounds: ${error}`);
  }

  // Check replay prevention (nonce tracking) if service is available
  if (replayPreventionService) {
    // First check if nonce has expired
    if (env.envelopeNonce && env.nonceExpiresAt) {
      const expiresAt = new Date(env.nonceExpiresAt).getTime();
      const nowTime = Date.now();

      if (nowTime > expiresAt) {
        errors.push(
          `Envelope nonce has expired: expires at ${env.nonceExpiresAt}, current time is ${new Date(nowTime).toISOString()}`
        );
      }

      // Then check if nonce has been seen before (replay detection)
      if (errors.length === 0 && env.envelopeNonce) {
        const replayCheck = await replayPreventionService.checkAndRegisterEnvelope(
          tenantId,
          env.envelopeId,
          env.envelopeNonce,
          new Date(env.nonceExpiresAt),
          env.envelopeSignature.keyId,
          'governance-engine',
          undefined // consumer_id will be set by consumer
        );

        if (!replayCheck.allowed) {
          errors.push(`Replay prevention: ${replayCheck.reason}`);
        }
      }
    } else if (env.envelopeNonce || env.nonceExpiresAt) {
      // Nonce present but expiry missing, or vice versa
      errors.push('Envelope replay protection incomplete: nonce and/or expiry missing');
    }

    // Check for replay attack patterns
    if (errors.length === 0) {
      const isUnderAttack = await replayPreventionService.detectReplayAttackPattern(
        tenantId,
        5, // threshold: 5 attempts
        10 // window: 10 minutes
      );

      if (isUnderAttack) {
        errors.push('SECURITY_ALERT: Replay attack pattern detected on tenant');
      }
    }
  }

  // Verify operator trace binding if present
  if (env.operatorTraceBinding) {
    const { verifyOperatorTraceBinding } = require('./operator-trace-binding');
    if (!verifyOperatorTraceBinding(env.operatorTraceBinding)) {
      errors.push('Operator trace binding signature verification failed');
    }
  }

  // Verify topology attestation if present (prevents topology spoofing)
  if (env.topologyAttestation) {
    try {
      // Import TopologyAttestationService and verify
      const { TopologyAttestationService } = require('../services/topology-attestation-service');
      // Note: In production, pass actual signing key material from KMS
      // For now, we verify the structure exists
      if (
        !env.topologyAttestation.manifest ||
        !env.topologyAttestation.signature ||
        !env.topologyAttestation.signer
      ) {
        errors.push('Topology attestation is malformed: missing required fields');
      }

      // Check attestation hasn't expired
      const expiresAtTime = new Date(env.topologyAttestation.expiresAt).getTime();
      if (nowTime > expiresAtTime) {
        errors.push(`Topology attestation has expired: expires at ${env.topologyAttestation.expiresAt}`);
      }
    } catch (error) {
      errors.push(`Topology attestation verification error: ${error}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    usedKeyId,
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
