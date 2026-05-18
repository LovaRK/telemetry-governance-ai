import { PoolClient } from 'pg';

export type ReviewStatus = 'UNREVIEWED' | 'APPROVED' | 'REJECTED';

export interface CalibrationVector {
  status: ReviewStatus;
  vector: number;
  reason: string;
}

export interface CalibratedConfidenceResult {
  rawStability: number;
  calibrationVector: number;
  reviewStatus: ReviewStatus;
  calibratedConfidence: number;
  isCapped: boolean;
  isBlacklisted: boolean;
  tier: 'TIER_A' | 'TIER_B';
  explanation: string;
}

const CALIBRATION_VECTORS: Record<ReviewStatus, number> = {
  'UNREVIEWED': 0.5,    // Hard ceiling at 50%
  'APPROVED': 1.0,      // Full scaling unlock
  'REJECTED': 0.0,      // Permanent blacklist
};

const CALIBRATION_EXPLANATIONS: Record<ReviewStatus, string> = {
  'UNREVIEWED': 'Unreviewed decision: confidence capped at 50% maximum',
  'APPROVED': 'Human-approved: confidence scaling unlocked to full value',
  'REJECTED': 'Rejected by human: fingerprint blacklisted for re-analysis',
};

export async function computeCalibratedConfidence(
  client: PoolClient,
  factId: string,
  rawStability: number,
  fingerprintVersion: string
): Promise<CalibratedConfidenceResult> {
  // Fetch human review status for this fact
  const reviewResult = await client.query(
    `SELECT review_status, calibration_vector
     FROM human_review_ledger
     WHERE fact_id = $1
     ORDER BY reviewed_at DESC
     LIMIT 1`,
    [factId]
  );

  const reviewRecord = reviewResult.rows[0];
  const reviewStatus: ReviewStatus = reviewRecord?.review_status || 'UNREVIEWED';
  const calibrationVector = reviewRecord?.calibration_vector || CALIBRATION_VECTORS[reviewStatus];

  // Check if fingerprint is blacklisted
  const blacklistResult = await client.query(
    `SELECT COUNT(*) as count
     FROM human_review_ledger hrl
     JOIN cognitive_enrichments ce ON ce.enrichment_id = hrl.enrichment_id
     WHERE ce.fingerprint_version = $1
     AND hrl.review_status = 'REJECTED'`,
    [fingerprintVersion]
  );

  const isBlacklisted = parseInt(blacklistResult.rows[0].count) > 0;

  // Compute calibrated confidence
  let calibratedConfidence = rawStability * calibrationVector;

  // If blacklisted, force Tier B re-analysis (confidence set to 0, triggers re-inference)
  if (isBlacklisted) {
    calibratedConfidence = 0.0;
  }

  const isCapped = reviewStatus === 'UNREVIEWED' && rawStability > 0.5;
  const tier = isBlacklisted || reviewStatus === 'REJECTED' ? 'TIER_B' : 'TIER_A';

  return {
    rawStability,
    calibrationVector,
    reviewStatus,
    calibratedConfidence: Math.min(calibratedConfidence, 1.0), // Ensure max 100%
    isCapped,
    isBlacklisted,
    tier,
    explanation: isBlacklisted
      ? 'REJECTED: Fingerprint blacklisted, forces Tier B (full re-analysis required)'
      : CALIBRATION_EXPLANATIONS[reviewStatus],
  };
}

export function getCalibrationVector(reviewStatus: ReviewStatus): number {
  return CALIBRATION_VECTORS[reviewStatus];
}

export async function isBlacklistedFingerprint(
  client: PoolClient,
  fingerprintVersion: string
): Promise<boolean> {
  const result = await client.query(
    `SELECT COUNT(*) as count
     FROM human_review_ledger hrl
     JOIN cognitive_enrichments ce ON ce.enrichment_id = hrl.enrichment_id
     WHERE ce.fingerprint_version = $1
     AND hrl.review_status = 'REJECTED'`,
    [fingerprintVersion]
  );

  return parseInt(result.rows[0].count) > 0;
}

export async function shouldReanalyze(
  client: PoolClient,
  factId: string,
  rawStability: number,
  fingerprintVersion: string
): Promise<boolean> {
  const result = await computeCalibratedConfidence(client, factId, rawStability, fingerprintVersion);

  // Reanalyze if:
  // 1. Fingerprint is blacklisted (explicit human rejection)
  // 2. Raw stability is very high but unreviewed (unstable hallucination risk)
  // 3. Calibrated confidence is 0 (rejected)

  return result.isBlacklisted ||
         result.calibratedConfidence === 0 ||
         (result.reviewStatus === 'UNREVIEWED' && rawStability > 0.95);
}

export async function updateReviewCalibration(
  client: PoolClient,
  factId: string,
  reviewStatus: ReviewStatus,
  reviewedBy: string,
  reviewNotes?: string
): Promise<void> {
  const calibrationVector = CALIBRATION_VECTORS[reviewStatus];

  await client.query(
    `INSERT INTO human_review_ledger (
      fact_id, review_status, calibration_vector,
      reviewed_by, reviewed_at, review_notes
    ) VALUES ($1, $2, $3, $4, NOW(), $5)
    ON CONFLICT (fact_id) DO UPDATE SET
      review_status = EXCLUDED.review_status,
      calibration_vector = EXCLUDED.calibration_vector,
      reviewed_by = EXCLUDED.reviewed_by,
      reviewed_at = NOW(),
      review_notes = EXCLUDED.review_notes`,
    [factId, reviewStatus, calibrationVector, reviewedBy, reviewNotes || null]
  );
}

export function explainCalibration(result: CalibratedConfidenceResult): string {
  const lines = [
    `Raw Stability Score: ${(result.rawStability * 100).toFixed(1)}%`,
    `Human Review Status: ${result.reviewStatus}`,
    `Calibration Vector (H): ${result.calibrationVector.toFixed(2)}`,
    `Calibrated Confidence: ${(result.calibratedConfidence * 100).toFixed(1)}%`,
    `Processing Tier: ${result.tier}`,
    ``,
    result.explanation,
  ];

  if (result.isCapped) {
    lines.push(`⚠️  Confidence capped at 50% despite ${(result.rawStability * 100).toFixed(1)}% stability`);
  }

  if (result.isBlacklisted) {
    lines.push(`🚫 Fingerprint blacklisted: forces complete re-analysis (Tier B)`);
  }

  return lines.join('\n');
}
