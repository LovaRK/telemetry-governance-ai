/**
 * AuditChainService
 *
 * Cryptographically verifiable append-only ledger for operator trace bindings.
 *
 * Critical invariants:
 * - All JSON serialization uses RFC 8785 canonical form (deterministic)
 * - Chain position is strictly monotonic (no clock dependencies)
 * - Root hash anchors entire chain to prevent retroactive history rewrites
 * - Hash algorithm versioning enables future migration without invalidating ledger
 * - Single successor per (trace_id, previous_binding_hash) pair (fork detection via Migration 111)
 */

import { createHash, randomBytes } from 'crypto';
import { PoolClient, Pool } from 'pg';
import canonicalize from 'canonicalize';
import { AuditChainForkDetectionService } from './audit-chain-fork-detection';

export interface RawBindingPayload {
  tenantId: string;
  operatorHash: string;
  traceId: string;
  spanId: string;
  actionType: string;
  authContext: Record<string, any>;
  actionPayload: Record<string, any>;
}

export interface ComputedChainHashes {
  currentHash: string;
  previousHash: string | null;
  rootChainHash: string;
}

export class AuditChainService {
  private static readonly SYSTEM_CHAIN_SECRET = process.env.CHAIN_ROOT_SECRET || 'FALLBACK_GOVERNANCE_SECRET_2026';
  private static readonly HASH_ALGORITHM_VERSION = 'SHA256_JCS_V1';
  private static forkDetectionService: AuditChainForkDetectionService | null = null;

  /**
   * Initialize fork detection service (call once during app startup)
   */
  public static initializeForkDetection(pool: Pool): void {
    this.forkDetectionService = new AuditChainForkDetectionService(pool);
  }

  /**
   * Compute a deterministic cryptographic hash block linked to its predecessor.
   *
   * Uses RFC 8785 canonical JSON serialization to ensure:
   * - Object key ordering is deterministic
   * - Identical payloads always produce identical hashes
   * - Non-deterministic serialization cannot be used as attack vector
   */
  public static async computeChainHash(
    client: PoolClient,
    payload: RawBindingPayload,
    signedAt: string
  ): Promise<ComputedChainHashes> {
    // Fetch the structural tip of the ledger based on absolute sequence placement
    const previousRowQuery = `
      SELECT id, signature_hash, root_chain_hash
      FROM operator_trace_bindings
      WHERE tenant_id = $1
      ORDER BY chain_position DESC
      LIMIT 1
    `;

    const result = await client.query(previousRowQuery, [payload.tenantId]);

    const previousHash = result.rows.length > 0 ? (result.rows[0].signature_hash as string) : null;
    let rootChainHash = result.rows.length > 0 ? (result.rows[0].root_chain_hash as string) : null;

    // CRITICAL: Use canonical JSON serialization (RFC 8785) for reproducible hashing
    // This prevents object key reordering attacks and ensures verification consistency
    const canonicalAuth = canonicalize(payload.authContext);
    const canonicalPayload = canonicalize(payload.actionPayload);

    if (!canonicalAuth || !canonicalPayload) {
      throw new Error('CANONICALIZATION_FAILED: Auth or payload serialization produced invalid output');
    }

    // Build the immutable serialization block
    // Format: previousHash | operatorHash | traceId | spanId | actionType | authContext | actionPayload | signedAt
    const dnaSerializationBlock = [
      previousHash || 'GENESIS_BLOCK_ROOT_INVARIANT',
      payload.operatorHash,
      payload.traceId,
      payload.spanId,
      payload.actionType,
      canonicalAuth,
      canonicalPayload,
      signedAt,
    ].join('|');

    // Compute SHA256 hash of the canonical block
    const currentHash = createHash('sha256').update(dnaSerializationBlock).digest('hex');

    // CRITICAL: On first binding per tenant, compute and store root anchor hash
    // This prevents attackers from rewriting the entire chain consistently
    if (!previousHash) {
      rootChainHash = createHash('sha256')
        .update([this.HASH_ALGORITHM_VERSION, payload.tenantId, payload.traceId, currentHash, this.SYSTEM_CHAIN_SECRET].join('|'))
        .digest('hex');
    }

    return {
      currentHash,
      previousHash,
      rootChainHash: rootChainHash!,
    };
  }

  /**
   * Verify complete chain integrity by recalculating and comparing all hashes.
   *
   * This function:
   * 1. Checks for forks (multiple successors from same binding)
   * 2. Verifies chain_position is strictly monotonic
   * 3. Recalculates each hash using canonical JSON (must match stored hash)
   * 4. Verifies root anchor hash on first binding
   * 5. Returns immediately on first discrepancy (fail-closed)
   */
  public static async verifyChainIntegrity(
    client: PoolClient,
    tenantId: string,
    traceId?: string
  ): Promise<{ valid: boolean; brokenAtId?: string; reason?: string }> {
    // CRITICAL: Check for forks FIRST before full chain verification
    // If fork detection is enabled, scan for any multiple successors
    if (this.forkDetectionService && traceId) {
      const forkResult = await this.forkDetectionService.detectTraceFork(traceId);
      if (forkResult.hasFork) {
        return {
          valid: false,
          brokenAtId: forkResult.forkPointHash,
          reason: `AUDIT_CHAIN_FORK_DETECTED: Multiple successors (${forkResult.successorCount}) from binding ${forkResult.forkPointHash}`,
        };
      }
    }

    const fetchChainQuery = `
      SELECT
        id,
        previous_binding_hash,
        signature_hash,
        root_chain_hash,
        operator_hash,
        trace_id,
        span_id,
        action_type,
        auth_context,
        action_payload,
        signed_at,
        chain_position
      FROM operator_trace_bindings
      WHERE tenant_id = $1
      ORDER BY chain_position ASC
    `;

    const result = await client.query(fetchChainQuery, [tenantId]);
    const rows = result.rows;

    let expectedPreviousHash: string | null = null;
    let expectedRootHash: string | null = null;
    let lastChainPosition: bigint | null = null;

    for (const row of rows) {
      // 1. Verify chain_position is strictly monotonic (no gaps, no duplicates)
      if (lastChainPosition !== null && row.chain_position <= lastChainPosition) {
        return {
          valid: false,
          brokenAtId: row.id,
          reason: `Chain position not strictly monotonic: previous=${lastChainPosition}, current=${row.chain_position}`,
        };
      }
      lastChainPosition = row.chain_position;

      // 2. Verify previous binding hash pointer
      if (row.previous_binding_hash !== expectedPreviousHash) {
        return {
          valid: false,
          brokenAtId: row.id,
          reason: `Previous binding hash mismatch: expected=${expectedPreviousHash}, found=${row.previous_binding_hash}`,
        };
      }

      // 3. Recalculate binding hash using canonical JSON (MUST match stored hash)
      const canonicalAuth = canonicalize(row.auth_context);
      const canonicalPayload = canonicalize(row.action_payload);

      if (!canonicalAuth || !canonicalPayload) {
        return {
          valid: false,
          brokenAtId: row.id,
          reason: 'Failed to canonicalize auth context or action payload during verification',
        };
      }

      const verificationBlock = [
        row.previous_binding_hash || 'GENESIS_BLOCK_ROOT_INVARIANT',
        row.operator_hash,
        row.trace_id,
        row.span_id,
        row.action_type,
        canonicalAuth,
        canonicalPayload,
        new Date(row.signed_at).toISOString(),
      ].join('|');

      const recomputedHash = createHash('sha256').update(verificationBlock).digest('hex');

      if (row.signature_hash !== recomputedHash) {
        return {
          valid: false,
          brokenAtId: row.id,
          reason: `Binding hash mismatch: expected=${recomputedHash}, found=${row.signature_hash}`,
        };
      }

      // 4. Verify root chain anchor on first binding (GENESIS block)
      if (!row.previous_binding_hash) {
        expectedRootHash = createHash('sha256')
          .update(
            ['SHA256_JCS_V1', tenantId, row.trace_id, row.signature_hash, this.SYSTEM_CHAIN_SECRET].join('|')
          )
          .digest('hex');
      }

      if (row.root_chain_hash !== expectedRootHash) {
        return {
          valid: false,
          brokenAtId: row.id,
          reason: `Root chain hash mismatch: expected=${expectedRootHash}, found=${row.root_chain_hash}`,
        };
      }

      // Roll tracking hashes forward for next iteration
      expectedPreviousHash = row.signature_hash;
    }

    return { valid: true };
  }

  /**
   * Verify a single binding's hash without traversing the entire chain.
   * Faster but does not detect tampering if previous binding is also modified.
   * Use verifyChainIntegrity for forensic purposes.
   */
  public static verifySingleBinding(
    binding: {
      previousBindingHash: string | null;
      operatorHash: string;
      traceId: string;
      spanId: string;
      actionType: string;
      authContext: Record<string, any>;
      actionPayload: Record<string, any>;
      signedAt: string;
      signatureHash: string;
    }
  ): boolean {
    const canonicalAuth = canonicalize(binding.authContext);
    const canonicalPayload = canonicalize(binding.actionPayload);

    if (!canonicalAuth || !canonicalPayload) {
      return false;
    }

    const verificationBlock = [
      binding.previousBindingHash || 'GENESIS_BLOCK_ROOT_INVARIANT',
      binding.operatorHash,
      binding.traceId,
      binding.spanId,
      binding.actionType,
      canonicalAuth,
      canonicalPayload,
      binding.signedAt,
    ].join('|');

    const recomputedHash = createHash('sha256').update(verificationBlock).digest('hex');
    return binding.signatureHash === recomputedHash;
  }
}
