/**
 * EnvelopeReplayPreventionService
 *
 * Prevents replay attacks on signed governance telemetry envelopes.
 * Tracks nonce usage and enforces expiration to ensure each envelope is processed only once.
 *
 * Replay attack scenario:
 * 1. Attacker captures valid, signed envelope E1
 * 2. Attacker replays E1 to governance-engine multiple times
 * 3. E1's automation directive is applied repeatedly (unintended consequences)
 *
 * Prevention:
 * - Each envelope has a unique nonce (one-time use token)
 * - Nonce cache tracks all seen nonces with expiration timestamps
 * - Replay attempt causes unique constraint violation
 * - Expired nonces are cleaned up periodically
 */

import { Pool } from 'pg';
import { randomBytes } from 'crypto';
import { GovernanceTelemetryEnvelopeV1 } from '../types/governance-telemetry-envelope';

export interface EnvelopeNonceGeneratorResult {
  nonce: string;
  expiresAt: Date;
}

export interface EnvelopeReplayCheckResult {
  allowed: boolean;
  reason?: string;
  previouslySeen?: boolean;
  seenAt?: Date;
}

export interface ReplayAttempt {
  envelopeNonce: string;
  attemptCount: number;
  firstSeen: Date;
  lastSeen: Date;
  consumers: string[];
}

/**
 * Tiered cache strategy for replay prevention:
 * - Tier 1 (0–5 min): HOT PATH — exact match required, 100% accuracy
 * - Tier 2 (5–60 min): WARM PATH — probabilistic sampling, optimized for memory
 * - Tier 3 (60+ min): COLD PATH — expired, periodically purged
 */
export interface CacheTierConfig {
  hotPathMinutes: number; // Tier 1 boundary (default 5)
  warmPathMinutes: number; // Tier 2 boundary (default 60)
  warmPathSamplingRate: number; // Probability of false negative in Tier 2 (default 0.05 = 5%)
}

const DEFAULT_CACHE_TIERS: CacheTierConfig = {
  hotPathMinutes: 5,
  warmPathMinutes: 60,
  warmPathSamplingRate: 0.05, // 5% false negative rate acceptable in warm path
};

export class EnvelopeReplayPreventionService {
  private pool: Pool;
  private nonceDefaultTTLSeconds = 3600; // 1 hour default nonce lifetime
  private maxCacheSizeBytes = 100 * 1024 * 1024; // 100 MB default max cache size
  private cachePressureThresholdPercent = 85; // Trigger cleanup at 85% full
  private cacheTiers: CacheTierConfig = DEFAULT_CACHE_TIERS;

  constructor(
    pool: Pool,
    nonceDefaultTTLSeconds?: number,
    maxCacheSizeBytes?: number,
    cacheTiers?: Partial<CacheTierConfig>
  ) {
    this.pool = pool;
    if (nonceDefaultTTLSeconds) {
      this.nonceDefaultTTLSeconds = nonceDefaultTTLSeconds;
    }
    if (maxCacheSizeBytes) {
      this.maxCacheSizeBytes = maxCacheSizeBytes;
    }
    if (cacheTiers) {
      this.cacheTiers = { ...DEFAULT_CACHE_TIERS, ...cacheTiers };
    }
  }

  /**
   * Generate a new nonce for an envelope
   * Nonce is cryptographically random and expires after configured TTL
   */
  generateNonce(): EnvelopeNonceGeneratorResult {
    const nonce = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.nonceDefaultTTLSeconds * 1000);

    return {
      nonce,
      expiresAt,
    };
  }

  /**
   * Check if envelope can be processed (not a replay)
   * If allowed, atomically registers the nonce to prevent future replays
   * CRITICAL: Treats DB UNIQUE constraint violation as definitive replay detection
   * (no retry logic or fallback—DB conflict = replay regardless of timing)
   */
  async checkAndRegisterEnvelope(
    tenantId: string,
    envelopeId: string,
    nonce: string,
    expiresAt: Date,
    signatureKeyId?: string,
    sourceService?: string,
    consumerId?: string
  ): Promise<EnvelopeReplayCheckResult> {
    try {
      // Atomic operation: attempt registration directly
      // DB constraint will reject if nonce already exists
      // This is NOT retryable—constraint violation = replay
      const registerResult = await this.pool.query(
        `
        SELECT registered, reason, previous_seen_at FROM register_envelope_nonce(
          $1, $2, $3, $4, $5, $6, $7
        )
        `,
        [tenantId, envelopeId, nonce, signatureKeyId || null, expiresAt, sourceService || null, consumerId || null]
      );

      const row = registerResult.rows[0];

      if (!row.registered) {
        // Nonce already exists: this is a REPLAY ATTEMPT
        // Do NOT retry, do NOT treat as transient error
        console.warn('[ENVELOPE_REPLAY_DETECTED_ATOMIC]', {
          envelopeId,
          nonce: nonce.substring(0, 8) + '...',
          tenantId,
          previousSeenAt: row.previous_seen_at,
          reason: row.reason,
        });

        return {
          allowed: false,
          reason: `ENVELOPE_REPLAY_DETECTED: ${row.reason}`,
          previouslySeen: true,
          seenAt: row.previous_seen_at ? new Date(row.previous_seen_at) : undefined,
        };
      }

      // Nonce registered successfully on first attempt
      console.log('[ENVELOPE_NONCE_REGISTERED_ATOMIC]', {
        envelopeId,
        nonce: nonce.substring(0, 8) + '...',
        tenantId,
        expiresAt,
      });

      return {
        allowed: true,
        reason: 'Nonce registered successfully',
      };
    } catch (error: any) {
      // CRITICAL: Distinguish between replay (constraint violation) and actual errors
      const errorMessage = error?.message || String(error);

      // Unique constraint violation = replay (not retryable)
      if (errorMessage.includes('unique') || errorMessage.includes('duplicate')) {
        console.warn('[ENVELOPE_REPLAY_DETECTED_CONSTRAINT]', {
          envelopeId,
          nonce: nonce.substring(0, 8) + '...',
          tenantId,
          error: errorMessage,
        });

        return {
          allowed: false,
          reason: 'ENVELOPE_REPLAY_DETECTED: Database constraint violation on nonce uniqueness',
          previouslySeen: true,
        };
      }

      // Other errors (connection failure, etc.)—fail closed
      console.error('[ENVELOPE_REPLAY_CHECK_FATAL_ERROR]', {
        envelopeId,
        tenantId,
        error: errorMessage,
      });

      return {
        allowed: false,
        reason: `Fatal error checking envelope replay: ${errorMessage}`,
      };
    }
  }

  /**
   * Verify envelope expiration (separate from nonce check)
   * Envelopes should include their own expiration timestamp
   */
  verifyEnvelopeExpiration(envelope: GovernanceTelemetryEnvelopeV1): {
    valid: boolean;
    reason?: string;
  } {
    if (!envelope.emittedAt) {
      return {
        valid: false,
        reason: 'Missing emittedAt timestamp',
      };
    }

    const emittedTime = new Date(envelope.emittedAt).getTime();
    const nowTime = Date.now();
    const maxAgeMs = this.nonceDefaultTTLSeconds * 1000;

    // Envelope is valid if it was emitted within the nonce TTL window
    if (nowTime - emittedTime > maxAgeMs) {
      return {
        valid: false,
        reason: `Envelope expired: emitted ${Math.round((nowTime - emittedTime) / 1000)}s ago, max age is ${this.nonceDefaultTTLSeconds}s`,
      };
    }

    return {
      valid: true,
    };
  }

  /**
   * Get recent replay attempts (for incident response)
   */
  async getRecentReplayAttempts(
    tenantId: string,
    windowMinutes: number = 60
  ): Promise<ReplayAttempt[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM get_replay_attempts($1, $2)`,
        [tenantId, windowMinutes]
      );

      return result.rows.map((row: any) => ({
        envelopeNonce: row.envelope_nonce,
        attemptCount: row.attempt_count,
        firstSeen: new Date(row.first_seen),
        lastSeen: new Date(row.last_seen),
        consumers: row.consumers || [],
      }));
    } catch (error) {
      console.error('[GET_REPLAY_ATTEMPTS_ERROR]', error);
      return [];
    }
  }

  /**
   * Check for suspicious replay patterns
   * Returns true if there are multiple replay attempts in recent window
   */
  async detectReplayAttackPattern(
    tenantId: string,
    thresholdAttemptsInWindow: number = 5,
    windowMinutes: number = 10
  ): Promise<boolean> {
    try {
      const result = await this.pool.query(
        `
        SELECT COUNT(*) as attempt_count
        FROM envelope_nonce_cache
        WHERE tenant_id = $1
          AND seen_at > NOW() - INTERVAL '1 minute' * $2
          AND EXISTS (
            SELECT 1 FROM envelope_nonce_cache enf2
            WHERE enf2.tenant_id = envelope_nonce_cache.tenant_id
              AND enf2.envelope_nonce = envelope_nonce_cache.envelope_nonce
            GROUP BY enf2.envelope_nonce
            HAVING COUNT(*) > 1
          )
        `,
        [tenantId, windowMinutes]
      );

      const attemptCount = parseInt(result.rows[0].attempt_count || 0);

      if (attemptCount >= thresholdAttemptsInWindow) {
        console.warn('[REPLAY_ATTACK_PATTERN_DETECTED]', {
          tenantId,
          attemptCount,
          windowMinutes,
          threshold: thresholdAttemptsInWindow,
        });

        return true;
      }

      return false;
    } catch (error) {
      console.error('[REPLAY_PATTERN_DETECTION_ERROR]', error);
      return false;
    }
  }

  /**
   * Cleanup expired nonces (periodic maintenance task)
   * Should be called regularly (e.g., every hour)
   */
  async cleanupExpiredNonces(): Promise<{ deletedCount: number }> {
    try {
      const result = await this.pool.query(`SELECT cleanup_expired_nonce_cache() as deleted`);

      const deletedCount = result.rows[0].deleted || 0;

      if (deletedCount > 0) {
        console.log('[NONCE_CACHE_CLEANUP]', {
          deletedCount,
          timestamp: new Date().toISOString(),
        });
      }

      return { deletedCount };
    } catch (error) {
      console.error('[CLEANUP_EXPIRED_NONCES_ERROR]', error);
      return { deletedCount: 0 };
    }
  }

  /**
   * Get nonce cache statistics for monitoring
   */
  async getNonceCacheStats(tenantId: string): Promise<{
    activenonces: number;
    expiredNonces: number;
    replayAttempts: number;
  }> {
    try {
      const result = await this.pool.query(
        `
        SELECT
          (SELECT COUNT(*) FROM envelope_nonce_cache WHERE tenant_id = $1 AND expires_at > NOW()) as active,
          (SELECT COUNT(*) FROM envelope_nonce_cache WHERE tenant_id = $1 AND expires_at <= NOW()) as expired,
          (
            SELECT COUNT(*)
            FROM (
              SELECT envelope_nonce, COUNT(*) as cnt
              FROM envelope_nonce_cache
              WHERE tenant_id = $1
              GROUP BY envelope_nonce
              HAVING COUNT(*) > 1
            ) replays
          ) as attempts
        `,
        [tenantId]
      );

      const row = result.rows[0];
      return {
        activenonces: parseInt(row.active || 0),
        expiredNonces: parseInt(row.expired || 0),
        replayAttempts: parseInt(row.attempts || 0),
      };
    } catch (error) {
      console.error('[NONCE_CACHE_STATS_ERROR]', error);
      return {
        activenonces: 0,
        expiredNonces: 0,
        replayAttempts: 0,
      };
    }
  }

  /**
   * Monitor and manage cache memory pressure
   * Implements tiered cleanup strategy:
   * - Tier 1: Aggressive cleanup of expired nonces
   * - Tier 2: Probabilistic sampling of old active nonces
   * - Tier 3: Force cleanup if cache exceeds max size
   */
  async manageCachePressure(): Promise<{ pressureLevel: string; cleanedCount: number }> {
    try {
      // Get current cache size estimate
      const sizeResult = await this.pool.query(
        `
        SELECT
          COUNT(*) as nonce_count,
          (COUNT(*) * 200)::BIGINT as estimated_bytes
        FROM envelope_nonce_cache
        WHERE expires_at > NOW() - INTERVAL '1 day'
        `
      );

      const estimatedBytes = sizeResult.rows[0].estimated_bytes || 0;
      const pressurePercent = (estimatedBytes / this.maxCacheSizeBytes) * 100;

      if (pressurePercent > 100) {
        // CRITICAL: Cache exceeds max size - force aggressive cleanup
        console.warn('[CACHE_PRESSURE_CRITICAL]', {
          pressurePercent: Math.round(pressurePercent),
          estimatedBytes,
          maxBytes: this.maxCacheSizeBytes,
        });

        // Force cleanup: delete entries older than 30 minutes + 1 hour TTL
        const forcedCleanup = await this.pool.query(
          `DELETE FROM envelope_nonce_cache WHERE expires_at < NOW() - INTERVAL '30 minutes'`
        );

        return {
          pressureLevel: 'CRITICAL',
          cleanedCount: forcedCleanup.rowCount || 0,
        };
      } else if (pressurePercent > this.cachePressureThresholdPercent) {
        // HIGH: Cache is getting full - clean expired + probabilistic sampling of old entries
        console.warn('[CACHE_PRESSURE_HIGH]', {
          pressurePercent: Math.round(pressurePercent),
          estimatedBytes,
          threshold: this.cachePressureThresholdPercent,
        });

        // Cleanup 1: Remove all expired nonces
        const expiredCleanup = await this.pool.query(`SELECT cleanup_expired_nonce_cache() as deleted`);

        // Cleanup 2: Probabilistically sample 10% of nonces older than 50 minutes
        const sampledCleanup = await this.pool.query(
          `
          DELETE FROM envelope_nonce_cache
          WHERE created_at < NOW() - INTERVAL '50 minutes'
            AND RANDOM() < 0.1
          `
        );

        return {
          pressureLevel: 'HIGH',
          cleanedCount: (expiredCleanup.rows[0].deleted || 0) + (sampledCleanup.rowCount || 0),
        };
      }

      return {
        pressureLevel: 'NORMAL',
        cleanedCount: 0,
      };
    } catch (error) {
      console.error('[CACHE_PRESSURE_MANAGEMENT_ERROR]', error);
      return {
        pressureLevel: 'ERROR',
        cleanedCount: 0,
      };
    }
  }

  /**
   * Check nonce using tiered cache strategy
   * Tier 1 (HOT): 0–5 min → 100% exact match required
   * Tier 2 (WARM): 5–60 min → Probabilistic sampling, acceptable false negatives
   * Tier 3 (COLD): 60+ min → Expired, can be purged
   * Returns: {inHotPath: boolean, nonceSeen: boolean, strategy: 'EXACT'|'PROBABILISTIC'|'EXPIRED'}
   */
  async checkNonceWithTiering(
    tenantId: string,
    nonce: string,
    seenAt: Date
  ): Promise<{ inCache: boolean; strategy: string; confidence: number }> {
    const nowTime = Date.now();
    const seenAtTime = seenAt.getTime();
    const ageMs = nowTime - seenAtTime;
    const ageMinutes = ageMs / (1000 * 60);

    const hotPathMs = this.cacheTiers.hotPathMinutes * 60 * 1000;
    const warmPathMs = this.cacheTiers.warmPathMinutes * 60 * 1000;

    // Tier 1: HOT PATH (0–5 min)—exact match required
    if (ageMs < hotPathMs) {
      const checkResult = await this.pool.query(
        `
        SELECT EXISTS(
          SELECT 1 FROM envelope_nonce_cache
          WHERE tenant_id = $1 AND envelope_nonce = $2 AND expires_at > NOW()
        ) as found
        `,
        [tenantId, nonce]
      );

      return {
        inCache: checkResult.rows[0].found,
        strategy: 'EXACT_MATCH_HOT_PATH',
        confidence: 1.0, // 100% accuracy required
      };
    }

    // Tier 2: WARM PATH (5–60 min)—probabilistic sampling
    if (ageMs < warmPathMs) {
      const checkResult = await this.pool.query(
        `
        SELECT EXISTS(
          SELECT 1 FROM envelope_nonce_cache
          WHERE tenant_id = $1 AND envelope_nonce = $2 AND expires_at > NOW()
        ) as found
        `,
        [tenantId, nonce]
      );

      // Probabilistic acceptance: allow configured false negative rate
      const samplingProbability = Math.random();
      const acceptableFalseNegativeRate = this.cacheTiers.warmPathSamplingRate;

      // If nonce NOT found and we're willing to accept false negatives:
      if (!checkResult.rows[0].found && samplingProbability < acceptableFalseNegativeRate) {
        // Treat as "not found" with degraded confidence
        return {
          inCache: false,
          strategy: 'PROBABILISTIC_WARM_PATH',
          confidence: 1.0 - acceptableFalseNegativeRate,
        };
      }

      return {
        inCache: checkResult.rows[0].found,
        strategy: 'PROBABILISTIC_WARM_PATH',
        confidence: 1.0 - acceptableFalseNegativeRate,
      };
    }

    // Tier 3: COLD PATH (60+ min)—expired or expired
    return {
      inCache: false,
      strategy: 'COLD_PATH_EXPIRED',
      confidence: 1.0,
    };
  }

  /**
   * Periodic maintenance task to manage cache memory and detect issues
   * Should be called hourly or on configurable schedule
   */
  async periodicMaintenance(): Promise<{
    pressureStatus: string;
    cleanedNonces: number;
    cleanedExpired: number;
  }> {
    try {
      // Check and manage cache pressure
      const pressureResult = await this.manageCachePressure();

      // Additional cleanup of truly expired nonces
      const expiredResult = await this.cleanupExpiredNonces();

      return {
        pressureStatus: pressureResult.pressureLevel,
        cleanedNonces: pressureResult.cleanedCount,
        cleanedExpired: expiredResult.deletedCount,
      };
    } catch (error) {
      console.error('[PERIODIC_MAINTENANCE_ERROR]', error);
      return {
        pressureStatus: 'ERROR',
        cleanedNonces: 0,
        cleanedExpired: 0,
      };
    }
  }
}
