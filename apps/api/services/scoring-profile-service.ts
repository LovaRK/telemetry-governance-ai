/**
 * Scoring Profile Service
 *
 * Manages scoring profiles as DB-persisted entities (not hardcoded config).
 * A scoring profile defines the weights (utilization, detection, quality) used
 * to compute composite scores.
 *
 * CRITICAL INVARIANTS:
 * - Only one profile may be active at any time
 * - Changing the active profile does NOT retroactively change existing snapshots
 *   (each snapshot records its own scoring_profile + weight_* fields)
 * - A scoring version change requires replay certification before activation
 *   (enforced by scoring-replay-certification-service.ts)
 *
 * Profile hierarchy:
 * 1. Hardcoded defaults (lowest priority — used if DB unavailable)
 * 2. Active profile from DB scoring_profiles table (highest priority)
 */

import { query } from '../../../core/database/connection';
import { SCORING_VERSION } from '../../../packages/core/engine/scoring/composite';
import type { ScoringWeights } from '../../../packages/core/engine/types';

export interface ScoringProfile {
  id: string;
  name: string;
  description?: string;
  weight_utilization: number;
  weight_detection: number;
  weight_quality: number;
  is_active: boolean;
  version: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ScoringProfileInput {
  name: string;
  description?: string;
  weight_utilization: number;
  weight_detection: number;
  weight_quality: number;
  created_by: string;
}

// ─────────────────────────────────────────────
// Cache (30s TTL — profiles change rarely)
// ─────────────────────────────────────────────

let _activeProfileCache: { profile: ScoringProfile; loadedAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

function isCacheValid(): boolean {
  return _activeProfileCache !== null && Date.now() - _activeProfileCache.loadedAt < CACHE_TTL_MS;
}

export function invalidateScoringProfileCache(): void {
  _activeProfileCache = null;
}

// ─────────────────────────────────────────────
// Hardcoded fallback (used when DB unavailable)
// ─────────────────────────────────────────────

const FALLBACK_PROFILE: ScoringProfile = {
  id: 'profile-balanced',
  name: 'balanced',
  description: 'Balanced security and operations weighting (hardcoded fallback)',
  weight_utilization: 0.35,
  weight_detection: 0.40,
  weight_quality: 0.25,
  is_active: true,
  version: SCORING_VERSION,
  created_by: 'system',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

// ─────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────

/**
 * Get the currently active scoring profile.
 * Used by the scoring engine for every pipeline run.
 */
export async function getActiveProfile(): Promise<ScoringProfile> {
  if (isCacheValid()) {
    return _activeProfileCache!.profile;
  }

  try {
    const result = await query<ScoringProfile>(
      `SELECT id, name, description,
              weight_utilization, weight_detection, weight_quality,
              is_active, version, created_by,
              created_at::TEXT, updated_at::TEXT
       FROM scoring_profiles
       WHERE is_active = true
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      console.warn('[SCORING_PROFILE_NO_ACTIVE]', {
        message: 'No active scoring profile in DB. Using hardcoded fallback.',
        timestamp: new Date().toISOString()
      });
      return FALLBACK_PROFILE;
    }

    const profile = result.rows[0];
    _activeProfileCache = { profile, loadedAt: Date.now() };
    return profile;
  } catch (error) {
    console.error('[SCORING_PROFILE_LOAD_FAILED]', {
      error: error instanceof Error ? error.message : String(error),
      fallback: 'hardcoded balanced profile',
      timestamp: new Date().toISOString()
    });
    return FALLBACK_PROFILE;
  }
}

/**
 * Get weights from the active profile.
 * Convenience method for the scoring engine.
 */
export async function getActiveScoringWeights(): Promise<ScoringWeights & { profile_name: string; profile_id: string }> {
  const profile = await getActiveProfile();
  return {
    utilization: profile.weight_utilization,
    detection: profile.weight_detection,
    quality: profile.weight_quality,
    profile_name: profile.name,
    profile_id: profile.id
  };
}

/**
 * Get all scoring profiles.
 */
export async function getAllProfiles(): Promise<ScoringProfile[]> {
  const result = await query<ScoringProfile>(
    `SELECT id, name, description,
            weight_utilization, weight_detection, weight_quality,
            is_active, version, created_by,
            created_at::TEXT, updated_at::TEXT
     FROM scoring_profiles
     ORDER BY is_active DESC, name ASC`
  );
  return result.rows;
}

/**
 * Get a profile by ID.
 */
export async function getProfileById(id: string): Promise<ScoringProfile | null> {
  const result = await query<ScoringProfile>(
    `SELECT id, name, description,
            weight_utilization, weight_detection, weight_quality,
            is_active, version, created_by,
            created_at::TEXT, updated_at::TEXT
     FROM scoring_profiles WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

// ─────────────────────────────────────────────
// Write
// ─────────────────────────────────────────────

/**
 * Create a new scoring profile.
 * The profile starts as inactive — requires explicit activation.
 */
export async function createProfile(
  input: ScoringProfileInput
): Promise<ScoringProfile> {
  // Validate weights sum to 1.0
  const sum = input.weight_utilization + input.weight_detection + input.weight_quality;
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(`Scoring weights must sum to 1.0. Got: ${sum.toFixed(4)}`);
  }

  const id = `profile-${input.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

  const result = await query<ScoringProfile>(
    `INSERT INTO scoring_profiles
       (id, name, description, weight_utilization, weight_detection, weight_quality,
        is_active, version, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8)
     RETURNING id, name, description,
               weight_utilization, weight_detection, weight_quality,
               is_active, version, created_by,
               created_at::TEXT, updated_at::TEXT`,
    [
      id,
      input.name,
      input.description ?? null,
      input.weight_utilization,
      input.weight_detection,
      input.weight_quality,
      SCORING_VERSION,
      input.created_by
    ]
  );

  console.log('[SCORING_PROFILE_CREATED]', {
    id: result.rows[0].id,
    name: input.name,
    created_by: input.created_by,
    timestamp: new Date().toISOString()
  });

  return result.rows[0];
}

/**
 * Activate a scoring profile.
 * Deactivates all other profiles first (only one active at a time).
 *
 * IMPORTANT: This does NOT require replay certification at the service layer.
 * Callers (the API route) must verify certification before calling this.
 * Use scoring-replay-certification-service.ts to check.
 */
export async function activateProfile(
  id: string,
  activatedBy: string
): Promise<ScoringProfile> {
  // Deactivate all profiles
  await query(
    `UPDATE scoring_profiles SET is_active = false, updated_at = NOW()`
  );

  // Activate the target
  const result = await query<ScoringProfile>(
    `UPDATE scoring_profiles
     SET is_active = true, updated_at = NOW()
     WHERE id = $1
     RETURNING id, name, description,
               weight_utilization, weight_detection, weight_quality,
               is_active, version, created_by,
               created_at::TEXT, updated_at::TEXT`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new Error(`Scoring profile not found: ${id}`);
  }

  // Invalidate cache
  invalidateScoringProfileCache();

  console.log('[SCORING_PROFILE_ACTIVATED]', {
    id,
    name: result.rows[0].name,
    activated_by: activatedBy,
    timestamp: new Date().toISOString()
  });

  return result.rows[0];
}
