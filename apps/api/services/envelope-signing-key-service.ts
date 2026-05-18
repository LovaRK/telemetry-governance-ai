/**
 * EnvelopeSigningKeyService
 *
 * Manages HMAC signing key rotation for GovernanceTelemetryEnvelopeV1.
 * Enables key rotation without invalidating historical envelope signatures.
 *
 * Key rotation strategy:
 * - Active key: used for new envelope signatures
 * - Previous keys: kept for 30 days after retirement for verification fallback
 * - Grace period: historical envelopes remain verifiable during retirement window
 */

import { Pool } from 'pg';
import { createHmac } from 'crypto';

export interface SigningKey {
  keyId: string;
  tenantId: string;
  keyMaterialEncrypted: Buffer;
  keyAlgorithm: string;
  isActive: boolean;
  activatedAt: string;
  retiredAt: string | null;
  canSign: boolean;
  canVerify: boolean;
  rotationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VersionedSignature {
  keyId: string;
  algorithm: string; // 'HMAC_SHA256_V1'
  signature: string; // hex digest
}

export class EnvelopeSigningKeyService {
  private pool: Pool;
  private keyCache: Map<string, { key: SigningKey; expiresAt: number }> = new Map();
  private cacheMaxAgeMs = 60000; // 60 seconds
  private kmsDecryptFn?: (encrypted: Buffer) => Promise<string>;

  constructor(pool: Pool, kmsDecryptFn?: (encrypted: Buffer) => Promise<string>) {
    this.pool = pool;
    this.kmsDecryptFn = kmsDecryptFn;
  }

  /**
   * Get the active signing key for a tenant
   * Caches result for 60 seconds to avoid repeated DB queries
   */
  async getActiveKey(tenantId: string): Promise<SigningKey | null> {
    const cacheKey = `active:${tenantId}`;
    const cached = this.keyCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.key;
    }

    const result = await this.pool.query(
      `
      SELECT
        key_id, tenant_id, key_material_encrypted, key_algorithm,
        is_active, activated_at, retired_at,
        can_sign, can_verify, rotation_reason,
        created_at, updated_at
      FROM envelope_signing_keys
      WHERE tenant_id = $1
        AND is_active = true
        AND can_sign = true
        AND retired_at IS NULL
      LIMIT 1
      `,
      [tenantId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const key = this.rowToSigningKey(result.rows[0]);
    this.keyCache.set(cacheKey, {
      key,
      expiresAt: Date.now() + this.cacheMaxAgeMs,
    });

    return key;
  }

  /**
   * Get all valid keys for verification (active + recent previous keys within grace period)
   */
  async getVerificationKeys(tenantId: string): Promise<SigningKey[]> {
    const result = await this.pool.query(
      `
      SELECT
        key_id, tenant_id, key_material_encrypted, key_algorithm,
        is_active, activated_at, retired_at,
        can_sign, can_verify, rotation_reason,
        created_at, updated_at
      FROM envelope_signing_keys
      WHERE tenant_id = $1
        AND can_verify = true
        AND (retired_at IS NULL OR retired_at > NOW())
      ORDER BY is_active DESC, activated_at DESC
      `,
      [tenantId]
    );

    return result.rows.map((row) => this.rowToSigningKey(row));
  }

  /**
   * Rotate to a new signing key
   * - Retires active key with 30-day grace period
   * - Creates new active key
   * - Logs rotation event
   * Returns new key_id
   */
  async rotateKey(
    tenantId: string,
    newKeyMaterialEncrypted: Buffer,
    rotationReason: 'SCHEDULED' | 'COMPROMISE' | 'ALGORITHM_CHANGE' = 'SCHEDULED'
  ): Promise<string> {
    const result = await this.pool.query(
      `
      SELECT rotate_envelope_signing_key(
        $1::UUID,
        $2::BYTEA,
        $3::VARCHAR
      ) AS new_key_id
      `,
      [tenantId, newKeyMaterialEncrypted, rotationReason]
    );

    const newKeyId = result.rows[0].new_key_id;

    // Invalidate cache for active key
    this.keyCache.delete(`active:${tenantId}`);

    console.log('[ENVELOPE_KEY_ROTATION]', {
      tenantId,
      newKeyId,
      rotationReason,
    });

    return newKeyId;
  }

  /**
   * Decrypt key material from database (encrypted via KMS)
   * Requires KMS decrypt function to be provided
   */
  async decryptKeyMaterial(keyMaterialEncrypted: Buffer): Promise<string> {
    if (!this.kmsDecryptFn) {
      throw new Error('KMS_DECRYPT_NOT_CONFIGURED: Cannot decrypt key material without KMS function');
    }

    try {
      return await this.kmsDecryptFn(keyMaterialEncrypted);
    } catch (error) {
      console.error('[KEY_DECRYPTION_FAILED]', error);
      throw new Error('KEY_DECRYPTION_FAILED: Could not decrypt signing key material');
    }
  }

  /**
   * Log a signature verification failure for compromise detection
   */
  async logVerificationFailure(
    tenantId: string,
    envelopeId: string | undefined,
    attemptedKeyId: string,
    failureReason: 'KEY_NOT_FOUND' | 'SIGNATURE_MISMATCH' | 'KEY_EXPIRED'
  ): Promise<void> {
    try {
      await this.pool.query(
        `
        INSERT INTO envelope_signature_failures (tenant_id, envelope_id, attempted_key_id, failure_reason)
        VALUES ($1, $2, $3, $4)
        `,
        [tenantId, envelopeId || null, attemptedKeyId, failureReason]
      );
    } catch (error) {
      console.error('[LOG_VERIFICATION_FAILURE_ERROR]', error);
      // Don't throw — logging failures shouldn't break signature verification
    }
  }

  /**
   * Get recent verification failures for a tenant (for compromise detection)
   */
  async getRecentVerificationFailures(
    tenantId: string,
    windowMinutes: number = 5
  ): Promise<any[]> {
    const result = await this.pool.query(
      `
      SELECT failure_id, tenant_id, envelope_id, attempted_key_id, failure_reason, recorded_at
      FROM envelope_signature_failures
      WHERE tenant_id = $1
        AND recorded_at > NOW() - INTERVAL '1 minute' * $2
      ORDER BY recorded_at DESC
      `,
      [tenantId, windowMinutes]
    );

    return result.rows;
  }

  /**
   * Convert database row to SigningKey object
   */
  private rowToSigningKey(row: any): SigningKey {
    return {
      keyId: row.key_id,
      tenantId: row.tenant_id,
      keyMaterialEncrypted: row.key_material_encrypted,
      keyAlgorithm: row.key_algorithm,
      isActive: row.is_active,
      activatedAt: row.activated_at,
      retiredAt: row.retired_at,
      canSign: row.can_sign,
      canVerify: row.can_verify,
      rotationReason: row.rotation_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
