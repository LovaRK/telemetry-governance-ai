/**
 * Splunk SID Job Service
 *
 * Implements the async Splunk search job lifecycle:
 * 1. Create SID (POST /services/search/jobs)
 * 2. Poll status (GET /services/search/jobs/{sid})
 * 3. Retrieve partial/complete results (GET /services/search/jobs/{sid}/results)
 * 4. Cancel / cleanup expired jobs
 *
 * Required for all heavy analytics:
 * - NLQ (natural language queries)
 * - Root cause analysis
 * - Anomaly detection
 * - Large trend windows (>7 days)
 *
 * CRITICAL: Never use synchronous search execution for queries that could
 * run >5 seconds. The SID system is mandatory for enterprise environments.
 *
 * Usage:
 * ```typescript
 * const job = await sidJobService.createJob(tenantId, spl, { maxResults: 1000 });
 * const result = await sidJobService.waitForCompletion(job.sid, { timeoutMs: 30000 });
 * if (result.status === 'completed') {
 *   const data = await sidJobService.getResults(job.sid);
 * }
 * ```
 */

import * as crypto from 'crypto';
import { query } from '../../../core/database/connection';
import { queryBudgetService } from './query-budget-service';
import { getCircuitBreaker } from './mcp-circuit-breaker';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type SIDJobStatus = 'pending' | 'running' | 'partial' | 'completed' | 'failed' | 'expired' | 'cancelled';

export interface SIDJob {
  sid: string;
  tenant_id: string;
  query_hash: string;
  spl: string;
  status: SIDJobStatus;
  started_at?: string;
  completed_at?: string;
  expires_at?: string;
  result_count?: number;
  runtime_ms?: number;
  scan_volume_mb?: number;
  error_message?: string;
  created_at: string;
}

export interface CreateJobOptions {
  maxResults?: number;
  earliestTime?: string;
  latestTime?: string;
  statusBuckets?: number;
  ttlSeconds?: number;   // how long Splunk keeps the job
}

export interface JobResult<T = Record<string, unknown>> {
  sid: string;
  status: SIDJobStatus;
  results: T[];
  result_count: number;
  runtime_ms?: number;
  scan_volume_mb?: number;
}

// ─────────────────────────────────────────────
// SID Job Service
// ─────────────────────────────────────────────

class SplunkSIDJobService {
  private readonly circuitBreaker = getCircuitBreaker('splunk_sid');
  private readonly DEFAULT_TTL_SECONDS = 600; // 10 minutes
  private readonly POLL_INTERVAL_MS = 2000;
  private readonly MAX_POLL_ATTEMPTS = 150; // 5 minutes at 2s intervals

  /**
   * Create a new Splunk search job.
   * Records the job in the DB and initiates the search.
   *
   * @param tenantId - Tenant scope
   * @param spl      - SPL query to execute
   * @param splunk   - Splunk client instance
   * @param options  - Job options (max results, time range, etc.)
   */
  async createJob(
    tenantId: string,
    spl: string,
    splunk: { createSearchJob?: (spl: string, opts: CreateJobOptions) => Promise<{ sid: string }> },
    options: CreateJobOptions = {}
  ): Promise<SIDJob> {
    const queryHash = crypto
      .createHash('sha256')
      .update(spl.trim().toLowerCase())
      .digest('hex')
      .substring(0, 32);

    // Check budget before creating job
    const budgetCheck = await queryBudgetService.checkBudget(tenantId, 0);
    if (budgetCheck.action === 'DENY') {
      throw new Error(`Query blocked by budget enforcement: ${budgetCheck.reason}`);
    }

    // Create job in Splunk (with circuit breaker)
    const { data: splunkJob, error } = await this.circuitBreaker.execute(
      async () => {
        if (!splunk.createSearchJob) {
          throw new Error('Splunk client does not support async SID jobs');
        }
        return splunk.createSearchJob(spl, {
          maxResults: options.maxResults ?? 10000,
          earliestTime: options.earliestTime ?? '-24h',
          latestTime: options.latestTime ?? 'now',
          ttlSeconds: options.ttlSeconds ?? this.DEFAULT_TTL_SECONDS,
          ...options
        });
      }
    );

    if (!splunkJob || error) {
      throw new Error(`Failed to create Splunk search job: ${error ?? 'unknown error'}`);
    }

    const sid = splunkJob.sid;
    const expiresAt = new Date(Date.now() + (options.ttlSeconds ?? this.DEFAULT_TTL_SECONDS) * 1000);

    // Persist job to DB
    await query(
      `INSERT INTO splunk_search_jobs
         (sid, tenant_id, query_hash, spl, status, started_at, expires_at, created_at)
       VALUES ($1, $2, $3, $4, 'running', NOW(), $5, NOW())
       ON CONFLICT (sid) DO NOTHING`,
      [sid, tenantId, queryHash, spl, expiresAt.toISOString()]
    );

    console.log('[SID_JOB_CREATED]', {
      sid,
      tenant_id: tenantId,
      query_hash: queryHash,
      expires_at: expiresAt.toISOString(),
      timestamp: new Date().toISOString()
    });

    return {
      sid,
      tenant_id: tenantId,
      query_hash: queryHash,
      spl,
      status: 'running',
      started_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString()
    };
  }

  /**
   * Poll for job completion.
   * Returns when the job is done, failed, or the timeout is reached.
   *
   * @param sid     - Splunk job ID
   * @param splunk  - Splunk client instance
   * @param opts    - Polling options
   */
  async waitForCompletion(
    sid: string,
    splunk: { getSearchJobStatus?: (sid: string) => Promise<{ status: string; isDone: boolean; resultCount: number; scanCount: number; runDuration: number }> },
    opts: { timeoutMs?: number; onProgress?: (pct: number) => void } = {}
  ): Promise<SIDJob> {
    const timeoutMs = opts.timeoutMs ?? 30000;
    const deadline = Date.now() + timeoutMs;
    let attempts = 0;

    while (Date.now() < deadline && attempts < this.MAX_POLL_ATTEMPTS) {
      attempts++;

      const { data: status } = await this.circuitBreaker.execute(
        async () => {
          if (!splunk.getSearchJobStatus) return null;
          return splunk.getSearchJobStatus(sid);
        }
      );

      if (status?.isDone) {
        const runtimeMs = Math.round((status.runDuration ?? 0) * 1000);
        const scanVolumeMb = (status.scanCount ?? 0) / 1000;

        // Update DB
        await query(
          `UPDATE splunk_search_jobs
           SET status = 'completed', completed_at = NOW(),
               result_count = $1, runtime_ms = $2, scan_volume_mb = $3
           WHERE sid = $4`,
          [status.resultCount, runtimeMs, scanVolumeMb, sid]
        );

        // Record actual usage
        const tenantResult = await query<{ tenant_id: string }>(
          `SELECT tenant_id FROM splunk_search_jobs WHERE sid = $1`,
          [sid]
        );
        if (tenantResult.rows[0]) {
          await queryBudgetService.recordUsage(tenantResult.rows[0].tenant_id, {
            scan_gb: scanVolumeMb / 1024
          });
        }

        return await this.getJob(sid) as SIDJob;
      }

      if (status && (status.status === 'FAILED' || status.status === 'FAILED_KILLED')) {
        await query(
          `UPDATE splunk_search_jobs SET status = 'failed', completed_at = NOW() WHERE sid = $1`,
          [sid]
        );
        return await this.getJob(sid) as SIDJob;
      }

      await sleep(this.POLL_INTERVAL_MS);
    }

    // Timeout
    await query(
      `UPDATE splunk_search_jobs SET status = 'partial', error_message = 'polling_timeout' WHERE sid = $1`,
      [sid]
    );
    return await this.getJob(sid) as SIDJob;
  }

  /**
   * Get a job by SID.
   */
  async getJob(sid: string): Promise<SIDJob | null> {
    const result = await query<SIDJob>(
      `SELECT sid, tenant_id, query_hash, spl, status,
              started_at::TEXT, completed_at::TEXT, expires_at::TEXT,
              result_count, runtime_ms, scan_volume_mb, error_message, created_at::TEXT
       FROM splunk_search_jobs WHERE sid = $1`,
      [sid]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Cancel a job.
   */
  async cancelJob(sid: string): Promise<void> {
    await query(
      `UPDATE splunk_search_jobs SET status = 'cancelled', completed_at = NOW() WHERE sid = $1`,
      [sid]
    );
  }

  /**
   * Expire old jobs (cleanup maintenance task).
   * Call from a periodic job (every 15 minutes).
   */
  async expireOldJobs(): Promise<number> {
    const result = await query(
      `UPDATE splunk_search_jobs
       SET status = 'expired'
       WHERE expires_at < NOW() AND status IN ('pending', 'running', 'partial')
       RETURNING sid`
    );
    const count = result.rows.length;
    if (count > 0) {
      console.log('[SID_JOB_EXPIRY]', {
        expired_count: count,
        timestamp: new Date().toISOString()
      });
    }
    return count;
  }

  /**
   * List recent jobs for a tenant.
   */
  async listJobs(tenantId: string, limit = 20): Promise<SIDJob[]> {
    const result = await query<SIDJob>(
      `SELECT sid, tenant_id, query_hash, spl, status,
              started_at::TEXT, completed_at::TEXT, expires_at::TEXT,
              result_count, runtime_ms, scan_volume_mb, error_message, created_at::TEXT
       FROM splunk_search_jobs
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [tenantId, limit]
    );
    return result.rows;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const splunkSIDJobService = new SplunkSIDJobService();
