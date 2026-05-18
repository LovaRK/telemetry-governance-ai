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

export class EnvelopeReplayPreventionService {
  private pool: Pool;
  private nonceDefaultTTLSeconds = 3600; // 1 hour default nonce lifetime
  private maxCacheSizeBytes = 100 * 1024 * 1024; // 100 MB default max cache size
  private cachePressureThresholdPercent = 85; // Trigger cleanup at 85% full

  constructor(pool: Pool, nonceDefaultTTLSeconds?: number, maxCacheSizeBytes?: number) {
    this.pool = pool;
    if (nonceDefaultTTLSeconds) {
      this.nonceDefaultTTLSeconds = nonceDefaultTTLSeconds;
    }
    if (maxCacheSizeBytes) {
      this.maxCacheSizeBytes = maxCacheSizeBytes;
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
   * If allowed, registers the nonce to prevent future replays
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
      // First, check if nonce has already been seen
      const checkResult = await this.pool.query(
        `SELECT * FROM has_envelope_been_seen($1, $2)`,
        [tenantId, nonce]
      );

      if (checkResult.rows[0].seen) {
        // Nonce already registered - this is a replay attempt
        console.warn('[ENVELOPE_REPLAY_DETECTED]', {
          envelopeId,
          nonce,
          tenantId,
          seenAt: checkResult.rows[0].seen_at,
        });

        return {
          allowed: false,
          reason: 'ENVELOPE_REPLAY_DETECTED: Nonce has already been processed',
          previouslySeen: true,
          seenAt: new Date(checkResult.rows[0].seen_at),
        };
      }

      // Nonce not seen before - attempt to register it
      // This will fail with unique constraint if another process already registered it
      // (prevents race condition race between check and register)
      const registerResult = await this.pool.query(
        `
        SELECT registered, reason FROM register_envelope_nonce(
          $1, $2, $3, $4, $5, $6, $7
        )
        `,
        [tenantId, envelopeId, nonce, signatureKeyId || null, expiresAt, sourceService || null, consumerId || null]
      );

      const row = registerResult.rows[0];

      if (!row.registered) {
        // Race condition: another consumer registered the same nonce
        return {
          allowed: false,
          reason: row.reason,
          previouslySeen: true,
        };
      }

      console.log('[ENVELOPE_NONCE_REGISTERED]', {
        envelopeId,
        nonce: nonce.substring(0, 8) + '...', // Log only prefix for security
        tenantId,
        expiresAt,
      });

      return {
        allowed: true,
        reason: 'Nonce registered successfully',
      };
    } catch (error) {
      console.error('[ENVELOPE_REPLAY_CHECK_ERROR]', error);
      return {
        allowed: false,
        reason: `Error checking envelope replay: ${error}`,
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
