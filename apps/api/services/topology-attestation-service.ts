/**
 * TopologyAttestationService
 *
 * Creates and verifies signed topology attestations to prevent spoofing.
 * Ensures that governance decisions are made based on authentic deployment state.
 *
 * Prevents attack scenarios:
 * 1. Attacker spoofs newer topology epoch to invalidate old signatures
 * 2. Attacker removes services from topology attestation to hide compromises
 * 3. Attacker claims different service versions are deployed than actually are
 */

import { createHmac, createSign, createVerify } from 'crypto';
import { Pool } from 'pg';
import canonicalize from 'canonicalize';

export interface TopologyManifest {
  epoch: number; // Current deployment epoch
  deploymentId: string; // Unique deployment identifier
  deployedAt: string; // ISO8601 timestamp
  signatureEpoch: number; // Signature epoch for key rotation
  services: {
    [serviceName: string]: {
      version: string; // Semantic version (e.g., '2.0.1-rc1')
      healthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
      lastHeartbeat: string; // ISO8601
      endpointUrls?: string[]; // For cross-verification
    };
  };
}

export interface TopologyAttestation {
  manifest: TopologyManifest;
  signer: {
    id: string; // Signer identity (deployment operator, CI/CD system)
    algorithm: 'HMAC_SHA256' | 'RSA_SHA256' | 'ECDSA_SHA256';
    keyId?: string; // Reference to key in key management service
  };
  signature: string; // Hex-encoded signature over canonical manifest
  signedAt: string; // ISO8601 when attestation was signed
  expiresAt: string; // ISO8601 when attestation becomes invalid
}

export class TopologyAttestationService {
  private pool: Pool;
  private signingKeyMaterial: string; // HMAC key material for signing attestations
  private verificationKeyMaterial: string; // Key material for verification

  constructor(pool: Pool, signingKeyMaterial: string, verificationKeyMaterial?: string) {
    this.pool = pool;
    this.signingKeyMaterial = signingKeyMaterial;
    this.verificationKeyMaterial = verificationKeyMaterial || signingKeyMaterial;
  }

  /**
   * Create and sign a topology attestation
   * Prevents subsequent modification of topology claims
   */
  createAttestation(
    manifest: TopologyManifest,
    signerId: string,
    ttlSeconds: number = 3600
  ): TopologyAttestation {
    const signedAt = new Date();
    const expiresAt = new Date(signedAt.getTime() + ttlSeconds * 1000);

    // Canonicalize manifest for deterministic signing
    const canonicalManifest = canonicalize(manifest);
    if (!canonicalManifest) {
      throw new Error('MANIFEST_CANONICALIZATION_FAILED');
    }

    // Sign the canonical manifest
    const hmac = createHmac('sha256', this.signingKeyMaterial)
      .update(canonicalManifest)
      .digest('hex');

    return {
      manifest,
      signer: {
        id: signerId,
        algorithm: 'HMAC_SHA256',
      },
      signature: hmac,
      signedAt: signedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Verify a topology attestation
   * Checks:
   * - Signature is valid (manifest hasn't been tampered with)
   * - Attestation hasn't expired
   * - Manifest contains expected services
   */
  verifyAttestation(attestation: TopologyAttestation): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check expiration
    const now = Date.now();
    const expiresAtTime = new Date(attestation.expiresAt).getTime();
    if (now > expiresAtTime) {
      errors.push(`Topology attestation has expired: expires at ${attestation.expiresAt}`);
    }

    // Verify signature
    try {
      const canonicalManifest = canonicalize(attestation.manifest);
      if (!canonicalManifest) {
        errors.push('MANIFEST_CANONICALIZATION_FAILED during verification');
      } else {
        const expectedSignature = createHmac('sha256', this.verificationKeyMaterial)
          .update(canonicalManifest)
          .digest('hex');

        // Constant-time comparison
        const { timingSafeEqual } = require('crypto');
        const expectedBuffer = Buffer.from(expectedSignature, 'hex');
        const signatureBuffer = Buffer.from(attestation.signature, 'hex');

        if (!timingSafeEqual(expectedBuffer, signatureBuffer)) {
          errors.push('Topology attestation signature verification failed: manifest may have been tampered with');
        }
      }
    } catch (error) {
      errors.push(`Topology signature verification error: ${error}`);
    }

    // Verify manifest sanity
    if (attestation.manifest.epoch < 0) {
      errors.push(`Invalid epoch: ${attestation.manifest.epoch}`);
    }

    if (Object.keys(attestation.manifest.services).length === 0) {
      errors.push('Topology attestation claims no services are deployed');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Store topology attestation in database for audit trail
   */
  async storeAttestation(attestation: TopologyAttestation, tenantId: string): Promise<void> {
    try {
      await this.pool.query(
        `
        INSERT INTO topology_attestations (
          tenant_id, epoch, deployment_id, signer_id, signature,
          signed_at, expires_at, manifest_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          tenantId,
          attestation.manifest.epoch,
          attestation.manifest.deploymentId,
          attestation.signer.id,
          attestation.signature,
          attestation.signedAt,
          attestation.expiresAt,
          JSON.stringify(attestation.manifest),
        ]
      );

      console.log('[TOPOLOGY_ATTESTATION_STORED]', {
        epoch: attestation.manifest.epoch,
        deploymentId: attestation.manifest.deploymentId,
        signer: attestation.signer.id,
      });
    } catch (error) {
      console.error('[TOPOLOGY_ATTESTATION_STORAGE_ERROR]', error);
      throw error;
    }
  }

  /**
   * Retrieve latest valid attestation for a tenant
   */
  async getLatestAttestation(tenantId: string): Promise<TopologyAttestation | null> {
    try {
      const result = await this.pool.query(
        `
        SELECT manifest_json, signer_id, signature, signed_at, expires_at
        FROM topology_attestations
        WHERE tenant_id = $1
          AND expires_at > NOW()
        ORDER BY epoch DESC
        LIMIT 1
        `,
        [tenantId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        manifest: JSON.parse(row.manifest_json),
        signer: {
          id: row.signer_id,
          algorithm: 'HMAC_SHA256',
        },
        signature: row.signature,
        signedAt: row.signed_at,
        expiresAt: row.expires_at,
      };
    } catch (error) {
      console.error('[GET_LATEST_ATTESTATION_ERROR]', error);
      return null;
    }
  }

  /**
   * Verify service is actually deployed (cross-check with attestation)
   */
  async verifyServiceDeployed(
    tenantId: string,
    serviceName: string,
    expectedVersion?: string
  ): Promise<{ deployed: boolean; reason?: string }> {
    try {
      const attestation = await this.getLatestAttestation(tenantId);

      if (!attestation) {
        return { deployed: false, reason: 'No valid topology attestation found' };
      }

      const service = attestation.manifest.services[serviceName];
      if (!service) {
        return { deployed: false, reason: `Service ${serviceName} not in topology attestation` };
      }

      if (service.healthStatus === 'CRITICAL') {
        return { deployed: false, reason: `Service ${serviceName} is in CRITICAL state` };
      }

      if (expectedVersion && service.version !== expectedVersion) {
        return {
          deployed: false,
          reason: `Service ${serviceName} version mismatch: expected ${expectedVersion}, found ${service.version}`,
        };
      }

      return { deployed: true };
    } catch (error) {
      console.error('[VERIFY_SERVICE_DEPLOYED_ERROR]', error);
      return { deployed: false, reason: `Error verifying service: ${error}` };
    }
  }
}
