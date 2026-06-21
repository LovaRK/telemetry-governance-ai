/**
 * Governance Snapshot
 * Freezes the entire semantic context of a decision.
 *
 * CRITICAL: Every evaluation must capture:
 * - Decision identifiers
 * - All version contracts (frozen at decision time)
 * - Operational state (enforcement mode, integrity)
 * - Forensic context (actor, environment, timestamp)
 *
 * This enables:
 * - Replay verification (using same versions)
 * - Forensic reconstruction (complete context)
 * - Audit compliance (what was the governance state?)
 * - Migration safety (understanding policy changes)
 *
 * Without GovernanceSnapshot, future replay becomes ambiguous.
 */

import { GovernanceMode } from './governance-mode';
import { GovernanceIntegrityState } from './governance-integrity';

/**
 * Governance semantic versions (frozen per phase).
 * These NEVER change within a phase.
 * Changing them requires phase progression and operator sign-off.
 */
export interface GovernanceVersions {
  /**
   * NORMALIZATION_VERSION: URL canonicalization rules.
   * Frozen in NORMALIZATION_CONTRACT.md
   * Examples: "1.0" (Phase 2A), "1.1" (Phase 2A.1 if needed)
   *
   * CRITICAL: Same normalization_version → same input_fingerprint
   * If this changes, historical requests become unfindable.
   */
  normalization_version: string;

  /**
   * POLICY_SCHEMA_VERSION: How policies are structured.
   * Examples: "1.0" (Phase 2A environment isolation only)
   *
   * CRITICAL: Policy schema changes require migration plan.
   * Historical decisions evaluated under old schema.
   */
  policy_schema_version: string;

  /**
   * GOVERNANCE_SCHEMA_VERSION: GovernanceDecision structure.
   * Examples: "1.0" (Phase 2A with 30 fields)
   *
   * CRITICAL: Decision schema changes require audit migration.
   * May add fields, must not remove fields (backward compatible only).
   */
  governance_schema_version: string;

  /**
   * GOVERNANCE_ENGINE_VERSION: RGE implementation version.
   * Examples: "1.0" (Phase 2A, environment isolation)
   *
   * CRITICAL: Engine changes may affect decision determinism.
   * Must be frozen per phase.
   */
  governance_engine_version: string;
}

/**
 * Complete governance context frozen at decision time.
 * Persisted with every evaluation for replay and forensics.
 */
export interface GovernanceSnapshot {
  // Decision Identifiers
  decision_id: string; // Deterministic hash of normalized input + decision
  input_fingerprint: string; // Forensic grouping key
  policy_snapshot_hash: string; // Policy version used for decision

  // Frozen Semantic Versions
  versions: GovernanceVersions;

  // Operational State (What was governance doing?)
  enforcement_mode: GovernanceMode; // SHADOW, LOG_ONLY, NON_CRITICAL, FULL_ENFORCING
  integrity_state: GovernanceIntegrityState; // HEALTHY, DEGRADED, FAILED

  // Forensic Context
  actor_id: string;
  actor_type: 'human' | 'agent' | 'service';
  environment: 'sandbox' | 'production';
  action: string;
  resource: string;

  // Traceability
  trace_id: string;
  correlation_id: string;
  causation_id: string;

  // Temporal
  created_at: string; // When decision was made
  replay_verified_at?: string; // When replay check passed (if verified)

  // Integrity
  replay_match?: boolean; // Did replay produce same decision_id?
  normalization_stable?: boolean; // Was normalization deterministic?
  schema_compatibility?: boolean; // Are schema versions compatible?
}

/**
 * Governance snapshot metadata for faster indexing.
 * Enables efficient queries: "Show me all decisions from 2026-05-28 to 2026-06-01"
 */
export interface GovernanceSnapshotMetadata {
  decision_id: string;
  input_fingerprint: string;
  created_at: string;
  actor_id: string;
  environment: 'sandbox' | 'production';
  enforcement_mode: GovernanceMode;
  integrity_state: GovernanceIntegrityState;
  replay_verified: boolean;
  action: string;
}

/**
 * Capture governance snapshot from decision context.
 * Call immediately after decision is made.
 */
export function captureGovernanceSnapshot(
  decision_id: string,
  input_fingerprint: string,
  policy_snapshot_hash: string,
  actor_id: string,
  actor_type: 'human' | 'agent' | 'service',
  environment: 'sandbox' | 'production',
  action: string,
  resource: string,
  trace_id: string,
  correlation_id: string,
  causation_id: string,
  enforcement_mode: GovernanceMode,
  integrity_state: GovernanceIntegrityState
): GovernanceSnapshot {
  return {
    decision_id,
    input_fingerprint,
    policy_snapshot_hash,
    versions: {
      normalization_version: '1.0', // Phase 2A frozen
      policy_schema_version: '1.0', // Phase 2A frozen
      governance_schema_version: '1.0', // Phase 2A frozen
      governance_engine_version: '1.0' // Phase 2A frozen
    },
    enforcement_mode,
    integrity_state,
    actor_id,
    actor_type,
    environment,
    action,
    resource,
    trace_id,
    correlation_id,
    causation_id,
    created_at: new Date().toISOString()
  };
}

/**
 * Extract metadata from snapshot for indexing.
 * Used for efficient historical queries.
 */
export function extractSnapshotMetadata(snapshot: GovernanceSnapshot): GovernanceSnapshotMetadata {
  return {
    decision_id: snapshot.decision_id,
    input_fingerprint: snapshot.input_fingerprint,
    created_at: snapshot.created_at,
    actor_id: snapshot.actor_id,
    environment: snapshot.environment,
    enforcement_mode: snapshot.enforcement_mode,
    integrity_state: snapshot.integrity_state,
    replay_verified: snapshot.replay_verified_at ? true : false,
    action: snapshot.action
  };
}

/**
 * Verify snapshot consistency.
 * Called before using snapshot for replay validation.
 */
export function verifySnapshotConsistency(snapshot: GovernanceSnapshot): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Required fields
  if (!snapshot.decision_id) errors.push('decision_id is required');
  if (!snapshot.input_fingerprint) errors.push('input_fingerprint is required');
  if (!snapshot.policy_snapshot_hash) errors.push('policy_snapshot_hash is required');
  if (!snapshot.actor_id) errors.push('actor_id is required');
  if (!snapshot.trace_id) errors.push('trace_id is required');

  // Version consistency
  if (!snapshot.versions.normalization_version) errors.push('normalization_version is required');
  if (!snapshot.versions.policy_schema_version) errors.push('policy_schema_version is required');
  if (!snapshot.versions.governance_schema_version) errors.push('governance_schema_version is required');
  if (!snapshot.versions.governance_engine_version) errors.push('governance_engine_version is required');

  // Temporal consistency
  const created = new Date(snapshot.created_at);
  if (isNaN(created.getTime())) {
    errors.push('created_at is not a valid ISO timestamp');
  }

  if (snapshot.replay_verified_at) {
    const replayed = new Date(snapshot.replay_verified_at);
    if (isNaN(replayed.getTime())) {
      errors.push('replay_verified_at is not a valid ISO timestamp');
    } else if (replayed < created) {
      errors.push('replay_verified_at cannot be before created_at');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Log governance snapshot for audit trail.
 * Snapshots are immutable audit records.
 */
export function logGovernanceSnapshot(snapshot: GovernanceSnapshot): void {
  console.log('[GOVERNANCE_SNAPSHOT]', {
    decision_id: snapshot.decision_id,
    input_fingerprint: snapshot.input_fingerprint,
    normalization_version: snapshot.versions.normalization_version,
    policy_schema_version: snapshot.versions.policy_schema_version,
    governance_schema_version: snapshot.versions.governance_schema_version,
    governance_engine_version: snapshot.versions.governance_engine_version,
    enforcement_mode: snapshot.enforcement_mode,
    integrity_state: snapshot.integrity_state,
    actor_id: snapshot.actor_id,
    environment: snapshot.environment,
    created_at: snapshot.created_at,
    replay_verified: snapshot.replay_verified_at ? true : false
  });
}
