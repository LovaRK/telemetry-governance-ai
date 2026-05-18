/**
 * Operator Anonymization Middleware
 *
 * Phase 6.1: PII elimination for governance audit trails
 * Applies SHA-256 hashing with rotating monthly salt cluster
 *
 * Transforms original_operator_id → anonymized_token before database storage
 * Preserves behavioral analytics while eliminating direct identity linkage
 */

import { Pool } from 'pg';
import { governanceCausalityService } from '@/services/governance-causality-service';

export interface OperatorContext {
  originalOperatorId: string;
  anonymizedToken?: string;
  tokenVersion?: number;
}

export class OperatorAnonymizationMiddleware {
  constructor(private pool: Pool) {}

  /**
   * Anonymize operator ID and store mapping
   * Creates entry in operator_identity_mapping table if not exists
   */
  async anonymizeOperator(originalOperatorId: string): Promise<OperatorContext> {
    const tokenVersion = 1; // Current version of the salt cluster
    const anonymized = governanceCausalityService.anonymizeOperatorId(
      originalOperatorId,
      tokenVersion
    );

    const client = await this.pool.connect();
    try {
      // Check if mapping already exists
      const existing = await client.query(
        'SELECT anonymized_token, token_version FROM operator_identity_mapping WHERE original_operator_id = $1',
        [originalOperatorId]
      );

      if (existing.rows.length > 0) {
        return {
          originalOperatorId,
          anonymizedToken: existing.rows[0].anonymized_token,
          tokenVersion: existing.rows[0].token_version,
        };
      }

      // Create new mapping
      await client.query(
        `
        INSERT INTO operator_identity_mapping (
          original_operator_id,
          anonymized_token,
          token_version,
          created_at
        ) VALUES ($1, $2, $3, NOW())
        ON CONFLICT (original_operator_id) DO NOTHING
        `,
        [originalOperatorId, anonymized.anonymizedToken, tokenVersion]
      );

      return {
        originalOperatorId,
        anonymizedToken: anonymized.anonymizedToken,
        tokenVersion,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Replace reviewer_id in mutation journal with anonymized token
   * Called after governance mutation is recorded
   */
  async replaceReviewerIdWithAnonymized(mutationEventId: string, reviewerId: string): Promise<void> {
    const anonymized = await this.anonymizeOperator(reviewerId);

    const client = await this.pool.connect();
    try {
      await client.query(
        `
        UPDATE governance_mutation_journal
        SET reviewer_id = $1
        WHERE event_id = $2
        `,
        [anonymized.anonymizedToken, mutationEventId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Get anonymized representation of operator
   * For use in queries and reports
   */
  async getAnonymizedOperator(originalOperatorId: string): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT anonymized_token FROM operator_identity_mapping WHERE original_operator_id = $1',
        [originalOperatorId]
      );

      return result.rows.length > 0 ? result.rows[0].anonymized_token : null;
    } finally {
      client.release();
    }
  }

  /**
   * Rotate salt cluster (monthly maintenance task)
   * Called on the 1st of each month by cron job
   */
  async rotateSaltCluster(): Promise<void> {
    // Trigger salt rotation in service
    governanceCausalityService.rotateSaltCluster();

    // Optionally: create new tokens for next month (can be deferred or batched)
    console.log(
      `Salt cluster rotated to version: ${governanceCausalityService.getCurrentSaltVersion()}`
    );
  }

  /**
   * Check operator opt-out status for behavioral tracking
   */
  async isOptedOutOfTracking(originalOperatorId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT opt_out_of_behavioral_tracking FROM operator_identity_mapping WHERE original_operator_id = $1',
        [originalOperatorId]
      );

      return result.rows.length > 0 && result.rows[0].opt_out_of_behavioral_tracking;
    } finally {
      client.release();
    }
  }

  /**
   * Query operator activity using anonymized tokens
   * Returns behavioral analytics without PII linkage
   */
  async getAnonymizedOperatorActivity(
    anonymizedToken: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        SELECT
          oim.anonymized_token,
          COUNT(*) as mutation_count,
          SUM(CASE WHEN event_type = 'GOVERNANCE_MUTATION_SUCCESS' THEN 1 ELSE 0 END) as successful,
          SUM(CASE WHEN event_type = 'GOVERNANCE_MUTATION_ABANDONED' THEN 1 ELSE 0 END) as abandoned,
          ROUND(100.0 * SUM(CASE WHEN event_type = 'GOVERNANCE_MUTATION_ABANDONED' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) as abandon_rate_pct
        FROM governance_mutation_journal gmj
        JOIN operator_identity_mapping oim ON gmj.reviewer_id = oim.anonymized_token
        WHERE oim.anonymized_token = $1
          AND gmj.recorded_at BETWEEN $2 AND $3
          AND oim.opt_out_of_behavioral_tracking = FALSE
        GROUP BY oim.anonymized_token
        `,
        [anonymizedToken, startDate, endDate]
      );

      return result.rows.length > 0 ? result.rows[0] : null;
    } finally {
      client.release();
    }
  }
}

// Export singleton instance
export let operatorAnonymizationMiddleware: OperatorAnonymizationMiddleware;

export function initializeOperatorAnonymization(pool: Pool): void {
  operatorAnonymizationMiddleware = new OperatorAnonymizationMiddleware(pool);
}
