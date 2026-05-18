/**
 * AuditChainForkDetectionService
 *
 * Detects and prevents audit chain forks where a binding has multiple successors.
 * Enforces the invariant: (trace_id, previous_binding_hash) → single successor only
 *
 * A fork occurs when:
 * - Binding A has signature_hash H_A
 * - Binding B has previous_binding_hash = H_A (normal)
 * - Binding C ALSO has previous_binding_hash = H_A (FORK - two branches from A)
 *
 * This service:
 * 1. Detects existing forks in the ledger
 * 2. Prevents new forks via database constraints
 * 3. Logs fork attempts for forensic analysis
 */

import { Pool, PoolClient } from 'pg';

export interface ForkDetectionResult {
  hasFork: boolean;
  forkPointHash?: string;
  successorCount?: number;
  branchIds?: string[];
  reason?: string;
}

export interface ChainIntegrityResult {
  valid: boolean;
  reason: string;
  forkedAt?: string;
  affectedBindings?: string[];
}

export class AuditChainForkDetectionService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Detect if a trace has forked (any point with multiple successors)
   * Returns details of the fork point(s) if found
   */
  async detectTraceFork(traceId: string): Promise<ForkDetectionResult> {
    try {
      const result = await this.pool.query(
        `
        SELECT
          previous_binding_hash,
          COUNT(*) as successor_count,
          ARRAY_AGG(id::TEXT) as branch_ids
        FROM operator_trace_bindings
        WHERE trace_id = $1
          AND previous_binding_hash IS NOT NULL
        GROUP BY previous_binding_hash
        HAVING COUNT(*) > 1
        LIMIT 1
        `,
        [traceId]
      );

      if (result.rows.length === 0) {
        return {
          hasFork: false,
        };
      }

      const row = result.rows[0];
      return {
        hasFork: true,
        forkPointHash: row.previous_binding_hash,
        successorCount: parseInt(row.successor_count),
        branchIds: row.branch_ids,
      };
    } catch (error) {
      console.error('[FORK_DETECTION_ERROR]', error);
      return {
        hasFork: false,
        reason: 'Fork detection query failed',
      };
    }
  }

  /**
   * Verify chain integrity including fork detection
   * Returns comprehensive chain state assessment
   */
  async verifyChainIntegrity(
    tenantId: string,
    traceId: string
  ): Promise<ChainIntegrityResult> {
    const client = await this.pool.connect();

    try {
      // Check for forks in the trace
      const forkResult = await this.pool.query(
        `SELECT * FROM verify_chain_has_no_forks($1, $2)`,
        [traceId, tenantId]
      );

      if (!forkResult.rows[0].valid) {
        // Find the fork point(s) for detailed reporting
        const forkDetails = await this.detectTraceFork(traceId);

        return {
          valid: false,
          reason: forkResult.rows[0].reason,
          forkedAt: forkDetails.forkPointHash,
          affectedBindings: forkDetails.branchIds,
        };
      }

      // Also verify monotonic ordering and hash chain integrity
      const bindingsResult = await client.query(
        `
        SELECT
          id, chain_position, previous_binding_hash, signature_hash
        FROM operator_trace_bindings
        WHERE trace_id = $1 AND tenant_id = $2
        ORDER BY chain_position ASC
        `,
        [traceId, tenantId]
      );

      let lastChainPosition: bigint | null = null;
      let lastSignatureHash: string | null = null;

      for (const binding of bindingsResult.rows) {
        // Check monotonic chain_position
        if (lastChainPosition !== null && binding.chain_position <= lastChainPosition) {
          return {
            valid: false,
            reason: `Chain position not strictly monotonic: ${lastChainPosition} >= ${binding.chain_position}`,
          };
        }

        // Check previous hash continuity
        if (lastSignatureHash !== null && binding.previous_binding_hash !== lastSignatureHash) {
          return {
            valid: false,
            reason: `Previous hash pointer broken at position ${binding.chain_position}`,
          };
        }

        lastChainPosition = binding.chain_position;
        lastSignatureHash = binding.signature_hash;
      }

      return {
        valid: true,
        reason: 'Chain integrity verified: no forks, monotonic ordering maintained',
      };
    } catch (error) {
      console.error('[CHAIN_INTEGRITY_VERIFICATION_ERROR]', error);
      return {
        valid: false,
        reason: `Verification error: ${error}`,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Safely append a binding to the chain with fork prevention
   * Will fail if it would create a fork
   */
  async appendBindingWithForkPrevention(
    bindingId: string,
    traceId: string,
    tenantId: string,
    previousBindingHash: string | null,
    signatureHash: string,
    operatorHash: string,
    actionType: string,
    authContext: Record<string, any>,
    actionPayload: Record<string, any>,
    signedAt: Date
  ): Promise<{
    success: boolean;
    newBindingId?: string;
    chainPosition?: number;
    reason?: string;
  }> {
    try {
      // Use the stored procedure that enforces the fork prevention constraint
      const result = await this.pool.query(
        `
        SELECT success, new_binding_id, chain_position, reason
        FROM append_binding_to_chain(
          $1::VARCHAR, $2::VARCHAR, $3::UUID, $4::VARCHAR, $5::VARCHAR,
          $6::VARCHAR, $7::VARCHAR, $8::JSONB, $9::JSONB, $10::TIMESTAMPTZ
        )
        `,
        [
          bindingId,
          traceId,
          tenantId,
          previousBindingHash,
          signatureHash,
          operatorHash,
          actionType,
          JSON.stringify(authContext),
          JSON.stringify(actionPayload),
          signedAt,
        ]
      );

      if (result.rows.length === 0) {
        return {
          success: false,
          reason: 'No response from append_binding_to_chain procedure',
        };
      }

      const row = result.rows[0];

      if (!row.success) {
        // Log fork attempt for forensic analysis
        console.warn('[FORK_PREVENTION_TRIGGERED]', {
          bindingId,
          traceId,
          previousBindingHash,
          reason: row.reason,
        });

        // Record the fork attempt
        await this.logForkAttempt(traceId, tenantId, previousBindingHash, row.reason);

        return {
          success: false,
          reason: row.reason,
        };
      }

      console.log('[BINDING_APPENDED_SUCCESSFULLY]', {
        bindingId,
        traceId,
        chainPosition: row.chain_position,
      });

      return {
        success: true,
        newBindingId: row.new_binding_id,
        chainPosition: row.chain_position,
      };
    } catch (error) {
      console.error('[APPEND_BINDING_ERROR]', error);
      return {
        success: false,
        reason: `Error appending binding: ${error}`,
      };
    }
  }

  /**
   * Log a fork attempt for forensic analysis and intrusion detection
   */
  private async logForkAttempt(
    traceId: string,
    tenantId: string,
    forkPointHash: string | null,
    reason: string
  ): Promise<void> {
    try {
      await this.pool.query(
        `
        INSERT INTO audit_log (tenant_id, action, details, created_at)
        VALUES ($1, 'FORK_ATTEMPT_DETECTED', $2, NOW())
        `,
        [
          tenantId,
          JSON.stringify({
            traceId,
            forkPointHash,
            reason,
            detectedAt: new Date().toISOString(),
          }),
        ]
      );
    } catch (error) {
      console.error('[FORK_ATTEMPT_LOG_ERROR]', error);
    }
  }

  /**
   * Get all fork attempts in the recent past for incident response
   */
  async getRecentForkAttempts(
    tenantId: string,
    windowMinutes: number = 60
  ): Promise<any[]> {
    try {
      const result = await this.pool.query(
        `
        SELECT signal_id, tenant_id, topology_hash, affected_trace_count,
               systemic_trust_level, root_cause, observed_at
        FROM systemic_failure_signals
        WHERE tenant_id = $1
          AND observed_at > NOW() - INTERVAL '1 minute' * $2
          AND root_cause = 'UNKNOWN'
        ORDER BY observed_at DESC
        `,
        [tenantId, windowMinutes]
      );

      return result.rows;
    } catch (error) {
      console.error('[GET_FORK_ATTEMPTS_ERROR]', error);
      return [];
    }
  }

  /**
   * List current fork points in the ledger (if any)
   */
  async listCurrentForks(tenantId: string): Promise<Array<{
    traceId: string;
    forkPointHash: string;
    successorCount: number;
    bindingIds: string[];
  }>> {
    try {
      const result = await this.pool.query(
        `
        SELECT
          trace_id,
          previous_binding_hash,
          COUNT(*) as successor_count,
          ARRAY_AGG(id::TEXT) as binding_ids
        FROM operator_trace_bindings
        WHERE (SELECT DISTINCT tenant_id FROM operator_trace_bindings LIMIT 1) = $1
          AND previous_binding_hash IS NOT NULL
        GROUP BY trace_id, previous_binding_hash
        HAVING COUNT(*) > 1
        ORDER BY trace_id, previous_binding_hash
        `,
        [tenantId]
      );

      return result.rows.map((row: any) => ({
        traceId: row.trace_id,
        forkPointHash: row.previous_binding_hash,
        successorCount: parseInt(row.successor_count),
        bindingIds: row.binding_ids,
      }));
    } catch (error) {
      console.error('[LIST_FORKS_ERROR]', error);
      return [];
    }
  }
}
