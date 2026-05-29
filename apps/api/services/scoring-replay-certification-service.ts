/**
 * Scoring Replay Certification Service
 *
 * Implements the replay certification gate:
 * No scoring version may become active without a certification record.
 *
 * Certification flow:
 * 1. Create certification run (against last 30 days of snapshots)
 * 2. Re-score all Silver rows with the NEW scoring version
 * 3. Compare Gold outputs (current vs new)
 * 4. Compute drift_percentage (% of snapshots where tier changed)
 * 5. Classify: 'safe' | 'minor_drift' | 'major_drift' | 'breaking'
 * 6. If classification != 'breaking': eligible for human approval
 * 7. Human approves → certification record created → profile can be activated
 *
 * Drift classification thresholds:
 * - safe:         0–1%    tier changes
 * - minor_drift:  1–5%    tier changes
 * - major_drift:  5–15%   tier changes
 * - breaking:     >15%    tier changes (blocks activation entirely)
 */

import * as crypto from 'crypto';
import { query } from '../../../core/database/connection';

export interface ReplayCertification {
  id: string;
  scoring_version: string;
  profile_id?: string;
  replay_dataset: string;
  total_snapshots: number;
  drifted_snapshots: number;
  drift_percentage: number;
  classification: 'safe' | 'minor_drift' | 'major_drift' | 'breaking';
  approved_by?: string;
  approved_at?: string;
  rejected_by?: string;
  rejected_at?: string;
  notes?: string;
  created_at: string;
}

export interface CertificationDriftResult {
  total_snapshots: number;
  drifted_snapshots: number;
  drift_percentage: number;
  classification: 'safe' | 'minor_drift' | 'major_drift' | 'breaking';
  examples: Array<{
    index_name: string;
    old_tier: string;
    new_tier: string;
    old_composite: number;
    new_composite: number;
  }>;
}

// ─────────────────────────────────────────────
// Classification Thresholds
// ─────────────────────────────────────────────

function classifyDrift(pct: number): 'safe' | 'minor_drift' | 'major_drift' | 'breaking' {
  if (pct <= 1) return 'safe';
  if (pct <= 5) return 'minor_drift';
  if (pct <= 15) return 'major_drift';
  return 'breaking';
}

// ─────────────────────────────────────────────
// Gate Check
// ─────────────────────────────────────────────

/**
 * Check if a scoring version has an approved certification.
 * Call this before activating any scoring profile.
 *
 * @throws Error if no approved certification exists
 */
export async function assertCertified(
  scoringVersion: string,
  profileId?: string
): Promise<ReplayCertification> {
  const result = await query<ReplayCertification>(
    `SELECT id, scoring_version, profile_id, replay_dataset,
            total_snapshots, drifted_snapshots, drift_percentage,
            classification, approved_by, approved_at::TEXT,
            rejected_by, rejected_at::TEXT, notes, created_at::TEXT
     FROM scoring_replay_certifications
     WHERE scoring_version = $1
       AND approved_by IS NOT NULL
       AND approved_at IS NOT NULL
       ${profileId ? 'AND (profile_id = $2 OR profile_id IS NULL)' : ''}
     ORDER BY approved_at DESC
     LIMIT 1`,
    profileId ? [scoringVersion, profileId] : [scoringVersion]
  );

  if (result.rows.length === 0) {
    throw new Error(
      `[SCORING_CERTIFICATION_REQUIRED] Scoring version "${scoringVersion}" has no approved ` +
      `replay certification. Run a certification analysis and obtain human approval before activating.`
    );
  }

  return result.rows[0];
}

/**
 * Check if a scoring version is certified (non-throwing version).
 */
export async function isCertified(
  scoringVersion: string,
  profileId?: string
): Promise<boolean> {
  try {
    await assertCertified(scoringVersion, profileId);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// Create Certification Record
// ─────────────────────────────────────────────

/**
 * Create a certification analysis record (before human approval).
 * The certification is not yet approved — requires `approveCertification()`.
 */
export async function createCertificationAnalysis(
  scoringVersion: string,
  profileId: string | undefined,
  driftResult: CertificationDriftResult,
  replayDataset: string
): Promise<ReplayCertification> {
  const id = `cert-${crypto.randomBytes(8).toString('hex')}`;

  const result = await query<ReplayCertification>(
    `INSERT INTO scoring_replay_certifications
       (id, scoring_version, profile_id, replay_dataset,
        total_snapshots, drifted_snapshots, drift_percentage, classification)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, scoring_version, profile_id, replay_dataset,
               total_snapshots, drifted_snapshots, drift_percentage,
               classification, approved_by, approved_at::TEXT,
               rejected_by, rejected_at::TEXT, notes, created_at::TEXT`,
    [
      id,
      scoringVersion,
      profileId ?? null,
      replayDataset,
      driftResult.total_snapshots,
      driftResult.drifted_snapshots,
      driftResult.drift_percentage,
      driftResult.classification
    ]
  );

  console.log('[SCORING_CERTIFICATION_CREATED]', {
    id,
    scoring_version: scoringVersion,
    classification: driftResult.classification,
    drift_pct: driftResult.drift_percentage,
    total_snapshots: driftResult.total_snapshots,
    timestamp: new Date().toISOString()
  });

  return result.rows[0];
}

/**
 * Approve a certification analysis.
 * After approval, the scoring version may be activated.
 *
 * Note: 'breaking' classifications CANNOT be approved.
 */
export async function approveCertification(
  certificationId: string,
  approvedBy: string,
  notes?: string
): Promise<ReplayCertification> {
  // First fetch to check classification
  const existing = await query<{ classification: string }>(
    `SELECT classification FROM scoring_replay_certifications WHERE id = $1`,
    [certificationId]
  );

  if (existing.rows.length === 0) {
    throw new Error(`Certification not found: ${certificationId}`);
  }

  if (existing.rows[0].classification === 'breaking') {
    throw new Error(
      `Cannot approve a 'breaking' certification (drift > 15%). ` +
      `Review the breaking changes and create a new scoring version with lower drift.`
    );
  }

  const result = await query<ReplayCertification>(
    `UPDATE scoring_replay_certifications
     SET approved_by = $1, approved_at = NOW(), notes = COALESCE($2, notes)
     WHERE id = $3
     RETURNING id, scoring_version, profile_id, replay_dataset,
               total_snapshots, drifted_snapshots, drift_percentage,
               classification, approved_by, approved_at::TEXT,
               rejected_by, rejected_at::TEXT, notes, created_at::TEXT`,
    [approvedBy, notes ?? null, certificationId]
  );

  console.log('[SCORING_CERTIFICATION_APPROVED]', {
    id: certificationId,
    approved_by: approvedBy,
    timestamp: new Date().toISOString()
  });

  return result.rows[0];
}

/**
 * Reject a certification analysis.
 */
export async function rejectCertification(
  certificationId: string,
  rejectedBy: string,
  reason: string
): Promise<ReplayCertification> {
  const result = await query<ReplayCertification>(
    `UPDATE scoring_replay_certifications
     SET rejected_by = $1, rejected_at = NOW(), notes = $2
     WHERE id = $3
     RETURNING id, scoring_version, profile_id, replay_dataset,
               total_snapshots, drifted_snapshots, drift_percentage,
               classification, approved_by, approved_at::TEXT,
               rejected_by, rejected_at::TEXT, notes, created_at::TEXT`,
    [rejectedBy, reason, certificationId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Certification not found: ${certificationId}`);
  }

  console.log('[SCORING_CERTIFICATION_REJECTED]', {
    id: certificationId,
    rejected_by: rejectedBy,
    reason,
    timestamp: new Date().toISOString()
  });

  return result.rows[0];
}

// ─────────────────────────────────────────────
// Query
// ─────────────────────────────────────────────

/**
 * List certifications, optionally filtered by scoring version.
 */
export async function listCertifications(
  scoringVersion?: string,
  limit = 20
): Promise<ReplayCertification[]> {
  const result = await query<ReplayCertification>(
    `SELECT id, scoring_version, profile_id, replay_dataset,
            total_snapshots, drifted_snapshots, drift_percentage,
            classification, approved_by, approved_at::TEXT,
            rejected_by, rejected_at::TEXT, notes, created_at::TEXT
     FROM scoring_replay_certifications
     ${scoringVersion ? 'WHERE scoring_version = $1' : ''}
     ORDER BY created_at DESC
     LIMIT ${scoringVersion ? '$2' : '$1'}`,
    scoringVersion ? [scoringVersion, limit] : [limit]
  );
  return result.rows;
}
