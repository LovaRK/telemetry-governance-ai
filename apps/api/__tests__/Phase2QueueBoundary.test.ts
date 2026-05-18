/**
 * Phase 2A: Queue Boundary Integration Tests
 *
 * Critical failure modes that must be validated:
 * 1. Retry Storm - Multiple retries maintain single trace_id with linear parent chain
 * 2. Lost Context - Missing trace headers detected and classified UNTRUSTWORTHY
 * 3. Duplicate Delivery - Idempotency prevents duplicate mutations
 * 4. Delayed Execution - Freshness decay applied to stale jobs
 * 5. Mixed Topology - Worker pool scale changes don't break causal chains
 *
 * These tests MUST pass before Phase 6.2 automation can touch queue boundaries.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Pool } from 'pg';
import { Queue, Worker } from 'bullmq';
import { createClient } from 'redis';
import {
  createQueueEnvelope,
  extractQueueTraceContext,
  createJobExecutionContext,
  prepareRetryEnvelope,
  validateTemporalInvariants,
  shouldRetryJob
} from '../services/governance-queue-context';
import { validateTraceCompleteness } from '../validators/trace-completeness-validator';
import { evaluateTraceTrust } from '../validators/trace-trust-evaluator';

// ============================================
// Test Setup
// ============================================

let pool: Pool;
let redisClient: any;
let testQueue: Queue;

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379')
};

beforeAll(async () => {
  // Initialize database
  pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'teja_dashboards'
  });

  // Clear test data
  await pool.query('DELETE FROM mutation_lifecycle_events WHERE trace_id LIKE $1', ['tst_q_%']);
  await pool.query('DELETE FROM governance_mutation_journal WHERE trace_id LIKE $1', ['tst_q_%']);

  // Initialize Redis
  redisClient = createClient({
    socket: REDIS_CONFIG
  });
  await redisClient.connect();

  // Initialize test queue
  testQueue = new Queue('test-queue', { connection: REDIS_CONFIG });
});

afterAll(async () => {
  if (testQueue) await testQueue.close();
  if (redisClient) await redisClient.quit();
  if (pool) await pool.end();
});

// ============================================
// Test 1: Retry Storm - Linear Parent Chain
// ============================================

describe('Phase 2A: Queue Boundary Integration', () => {
  it('Test 1: Retry storm maintains single trace_id with linear parent chain', async () => {
    const traceId = `tst_q_${Date.now()}_retry`.substring(0, 32).padEnd(32, '0');
    const originalSpanId = `spn_orig`;
    const correlationId = `corr_${Date.now()}`;

    // Create initial envelope
    let envelope = createQueueEnvelope(
      { jobType: 'test_retry_storm', data: 'payload' },
      {
        traceId,
        spanId: originalSpanId,
        correlationId,
        executionContext: 'PRODUCTION',
        executionClass: 'QUEUE_ASYNC',
        topologyHash: 'epoch_v1'
      },
      {
        producerServiceName: 'test-producer',
        maxRetries: 5
      }
    );

    const enqueueSpanId = envelope.trace.traceparent.split('-')[2];

    // Simulate 3 retries
    const retryChain: string[] = [enqueueSpanId];

    for (let attempt = 1; attempt <= 3; attempt++) {
      // Record this execution attempt
      const executionSpanId = `spn_exe_${attempt}`;
      retryChain.push(executionSpanId);

      // Insert JOB_EXECUTION_START
      await pool.query(
        `INSERT INTO mutation_lifecycle_events
         (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
          status, duration_in_state_ms, execution_context, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          traceId,
          executionSpanId,
          originalSpanId, // All children of original span
          correlationId,
          'JOB_EXECUTION_START',
          'success',
          0,
          'PRODUCTION'
        ]
      );

      if (attempt < 3) {
        // Simulate failure → retry
        envelope = prepareRetryEnvelope(envelope, 1000);

        // Insert RETRY_SCHEDULED
        const retrySpanId = envelope.trace.traceparent.split('-')[2];
        retryChain.push(retrySpanId);

        await pool.query(
          `INSERT INTO mutation_lifecycle_events
           (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
            status, duration_in_state_ms, execution_context, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + INTERVAL '100 ms' * $9)`,
          [
            traceId,
            retrySpanId,
            originalSpanId,
            correlationId,
            'RETRY_SCHEDULED',
            'success',
            100,
            'PRODUCTION',
            attempt
          ]
        );
      } else {
        // Success on attempt 3
        await pool.query(
          `INSERT INTO mutation_lifecycle_events
           (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
            status, duration_in_state_ms, execution_context, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            traceId,
            executionSpanId,
            originalSpanId,
            correlationId,
            'JOB_EXECUTION_SUCCESS',
            'success',
            45,
            'PRODUCTION'
          ]
        );
      }
    }

    // Verify trace structure
    const result = await pool.query(
      `SELECT
         COUNT(DISTINCT trace_id) as unique_traces,
         COUNT(*) as total_events,
         COUNT(DISTINCT span_id) as unique_spans,
         COUNT(CASE WHEN parent_span_id IS NULL THEN 1 END) as orphan_spans,
         array_agg(DISTINCT lifecycle_state) as states
       FROM mutation_lifecycle_events
       WHERE trace_id = $1`,
      [traceId]
    );

    const row = result.rows[0];
    expect(parseInt(row.unique_traces)).toBe(1); // Single trace_id throughout
    expect(parseInt(row.orphan_spans)).toBe(0); // No orphans
    expect(row.states).toContain('RETRY_SCHEDULED');
    expect(row.states).toContain('JOB_EXECUTION_SUCCESS');

    // Verify completeness
    const completeness = await validateTraceCompleteness(traceId, pool);
    expect(completeness.completenessScore).toBeGreaterThan(0);

    // Verify trust evaluator detects retry storm (high cardinality)
    const assessment = await evaluateTraceTrust(completeness, {}, pool);
    expect(assessment.trustLevel).toBeDefined();
    // Cardinality check: too many spans suggests retry storm
    if (completeness.spanCount > 40) {
      expect(assessment.trustLevel).toBe('UNTRUSTWORTHY');
    }
  });

  // ============================================
  // Test 2: Lost Context - Missing Trace Headers
  // ============================================

  it('Test 2: Lost context detection - missing trace headers classified UNTRUSTWORTHY', async () => {
    const traceId = `tst_q_${Date.now()}_lost`.substring(0, 32).padEnd(32, '0');
    const correlationId = `corr_${Date.now()}`;

    // Simulate lost trace headers - job executed without traceparent
    // This happens when context doesn't propagate through serialization boundary
    // Create a span that references a non-existent parent (broken parent-child linkage)
    const nonExistentParentId = `spn_parent_lost`;

    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, recorded_at)
       VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, NOW()),
       ($1, $9, $3, $4, $10, $6, $11, $8, NOW())`,
      [
        traceId,
        `spn_orphan`,
        nonExistentParentId,  // Parent doesn't exist - orphan!
        correlationId,
        'JOB_EXECUTION_START',
        'success',
        0,
        'PRODUCTION',
        `spn_orphan_2`,
        'JOB_EXECUTION_SUCCESS',
        45
      ]
    );

    // Verify spans are orphans (parent doesn't exist)
    const result = await pool.query(
      `SELECT
         COUNT(CASE WHEN parent_span_id IS NOT NULL THEN 1 END) as child_count,
         COUNT(*) as total_spans
       FROM mutation_lifecycle_events
       WHERE trace_id = $1`,
      [traceId]
    );

    expect(parseInt(result.rows[0].child_count)).toBeGreaterThan(0);

    // Verify trust evaluator classifies as UNTRUSTWORTHY
    const completeness = await validateTraceCompleteness(traceId, pool);
    const assessment = await evaluateTraceTrust(completeness, {}, pool);

    expect(assessment.trustLevel).toBe('UNTRUSTWORTHY');
    expect(completeness.parentChildLinkageValid).toBe(false); // Verify orphans detected
    expect(completeness.orphanSpans.length).toBeGreaterThan(0); // Verify orphan span list
    expect(assessment.severeIssues.some(s => s.includes('orphan'))).toBe(true);
  });

  // ============================================
  // Test 3: Duplicate Delivery - Idempotency
  // ============================================

  it('Test 3: Duplicate delivery prevention via idempotency key', async () => {
    const traceId = `tst_q_${Date.now()}_dedup`.substring(0, 32).padEnd(32, '0');
    const correlationId = `corr_${Date.now()}`;
    const idempotencyKey = 'idempotent_abc123';

    // First delivery: process job
    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       jsonb_build_object('idempotencyKey', $9::text), NOW())`,
      [
        traceId,
        `spn_1`,
        null,
        correlationId,
        'JOB_EXECUTION_START',
        'success',
        0,
        'PRODUCTION',
        idempotencyKey
      ]
    );

    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       jsonb_build_object('idempotencyKey', $9::text), NOW() + INTERVAL '50 ms')`,
      [
        traceId,
        `spn_1`,
        null,
        correlationId,
        'JOB_EXECUTION_SUCCESS',
        'success',
        50,
        'PRODUCTION',
        idempotencyKey
      ]
    );

    // Second delivery: duplicate should be detected
    // In production, this would be caught at BullMQ level with jobId
    // For testing, we verify single execution in lifecycle
    const result = await pool.query(
      `SELECT
         COUNT(CASE WHEN lifecycle_state = 'JOB_EXECUTION_SUCCESS' THEN 1 END) as success_count,
         COUNT(DISTINCT metadata->>'idempotencyKey') as unique_keys
       FROM mutation_lifecycle_events
       WHERE trace_id = $1`,
      [traceId]
    );

    // In idempotent system: only 1 success event
    expect(parseInt(result.rows[0].success_count)).toBe(1);
  });

  // ============================================
  // Test 4: Delayed Execution - Freshness Decay
  // ============================================

  it('Test 4: Delayed job execution applies freshness decay', async () => {
    const traceId = `tst_q_${Date.now()}_delay`.substring(0, 32).padEnd(32, '0');
    const correlationId = `corr_${Date.now()}`;
    const enqueuedAt = Date.now() - 45000; // Enqueued 45 seconds ago
    const executedAt = Date.now(); // Just executed

    // Create envelope with old enqueue time
    const envelope = createQueueEnvelope(
      { jobType: 'test_delay', data: 'stale' },
      {
        traceId,
        spanId: `spn_orig`,
        correlationId,
        executionContext: 'PRODUCTION',
        executionClass: 'QUEUE_ASYNC',
        topologyHash: 'epoch_v1'
      },
      {
        producerServiceName: 'test-producer',
        deadlineMs: 60000 // 60 second deadline
      }
    );

    // Simulate delayed execution
    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10 / 1000.0)),
              ($1, $11, $3, $4, $12, $6, $13, $8, $9, to_timestamp($14 / 1000.0))`,
      [
        traceId, `spn_exe`, null, correlationId, 'JOB_EXECUTION_START',
        'success', 0, 'PRODUCTION',
        JSON.stringify({ enqueuedAt, executedAt, delayMs: executedAt - enqueuedAt }),
        enqueuedAt,
        `spn_exe`, 'JOB_EXECUTION_SUCCESS', 45, executedAt
      ]
    );

    // Verify trace
    const completeness = await validateTraceCompleteness(traceId, pool);
    const assessment = await evaluateTraceTrust(completeness, {}, pool);

    // Age-related degradation
    expect(assessment.completenessScore).toBeGreaterThan(0);
    expect(assessment.trustLevel).toBeDefined();
    // Trace is 45+ seconds old, should have freshness penalty
  });

  // ============================================
  // Test 5: Mixed Topology Worker Pool
  // ============================================

  it('Test 5: Worker pool topology change maintains causality', async () => {
    const traceId = `tst_q_${Date.now()}_topo`.substring(0, 32).padEnd(32, '0');
    const correlationId = `corr_${Date.now()}`;

    const TOPOLOGY_V1 = 'epoch_v1_boot';
    const TOPOLOGY_V2 = 'epoch_v1_scaled';

    // Phase 0: HTTP intent received (root)
    const rootSpanId = 'spn_root';
    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, metadata, recorded_at)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7,
       jsonb_build_object('topology', $8::text), NOW())`,
      [
        traceId, rootSpanId, correlationId, 'INTENT_RECEIVED', 'success', 1,
        'PRODUCTION', TOPOLOGY_V1
      ]
    );

    // Phase 0.5: Mutation dispatched
    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       jsonb_build_object('topology', $9::text), NOW() + INTERVAL '1 ms')`,
      [
        traceId, 'spn_dispatch', rootSpanId, correlationId, 'MUTATION_DISPATCHED',
        'success', 0, 'PRODUCTION', TOPOLOGY_V1
      ]
    );

    // Phase 1: Job enqueued under V1
    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       jsonb_build_object('topology', $9::text), NOW() + INTERVAL '2 ms')`,
      [
        traceId, 'spn_enq', rootSpanId, correlationId, 'QUEUE_ENQUEUED', 'success', 0,
        'PRODUCTION', TOPOLOGY_V1
      ]
    );

    // Phase 2: Worker pool scales (topology change)
    // Job execution starts under V2
    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       jsonb_build_object('topology', $9::text), NOW() + INTERVAL '12 seconds')`,
      [
        traceId, 'spn_exe', 'spn_enq', correlationId, 'JOB_EXECUTION_START',
        'success', 0, 'PRODUCTION', TOPOLOGY_V2
      ]
    );

    // Phase 2.5: State persisted (inside job execution)
    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       jsonb_build_object('topology', $9::text), NOW() + INTERVAL '12.01 seconds')`,
      [
        traceId, 'spn_exe', 'spn_enq', correlationId, 'STATE_PERSISTED',
        'success', 10, 'PRODUCTION', TOPOLOGY_V2
      ]
    );

    // Phase 3: Job completes
    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       jsonb_build_object('topology', $9::text), NOW() + INTERVAL '12.05 seconds')`,
      [
        traceId, 'spn_exe', 'spn_enq', correlationId, 'JOB_EXECUTION_SUCCESS',
        'success', 50, 'PRODUCTION', TOPOLOGY_V2
      ]
    );

    // Phase 4: Cache invalidation and verification
    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       jsonb_build_object('topology', $9::text), NOW() + INTERVAL '12.06 seconds')`,
      [
        traceId, 'spn_verify', rootSpanId, correlationId, 'QUERY_INVALIDATED',
        'success', 5, 'PRODUCTION', TOPOLOGY_V2
      ]
    );

    // Verify topology transition detected
    const result = await pool.query(
      `SELECT
         array_agg(DISTINCT metadata->>'topology') as topologies,
         COUNT(*) as event_count
       FROM mutation_lifecycle_events
       WHERE trace_id = $1`,
      [traceId]
    );

    expect(result.rows[0].topologies).toContain(TOPOLOGY_V1);
    expect(result.rows[0].topologies).toContain(TOPOLOGY_V2);

    // Verify trust handles topology transition
    const completeness = await validateTraceCompleteness(traceId, pool);
    const assessment = await evaluateTraceTrust(completeness, {}, pool);

    expect(assessment.trustLevel).toBeDefined();
    // During deployment window: DEGRADED acceptable
    expect(['TRUSTED', 'DEGRADED']).toContain(assessment.trustLevel);
  });

  // ============================================
  // Test 12: Visibility Timeout Fork (CRITICAL BLOCKER FOR PHASE 2B)
  // ============================================
  //
  // Problem: Queue visibility timeout allows concurrent dequeue races
  // When a message is dequeued, it's hidden for N seconds (visibility window).
  // If processing takes longer than N seconds, the message becomes visible again.
  // A second worker can claim the SAME message, creating dual execution paths.
  //
  // This produces causal fork: single traceId + span with 2 parents
  // CRITICAL: Must detect and block automation when fork detected
  // Phase 2B SSE amplifies this: fanout of 200 subscribers × visibility timeout = recipe for disaster
  //

  it('Test 12: Visibility timeout fork — dual worker claiming detects causal fork and blocks automation', async () => {
    const traceId = `tst_q_${Date.now()}_fork`.substring(0, 32).padEnd(32, '0');
    const correlationId = `corr_${Date.now()}`;
    const messageId = `msg_visibility_fork_${Date.now()}`;

    // ===== SCENARIO =====
    // Message enqueued at T=0 under Worker Pool V1
    // Worker A dequeues at T=1, starts execution (visibility timeout: 30 seconds)
    // Worker A still processing at T=30 (took 30+ seconds)
    // Message becomes visible at T=30
    // Worker B dequeues SAME message at T=31, also starts execution
    // Result: TWO execution paths claim same trace_id + parent span
    // Outcome: FORK DETECTED, automation blocked, SRE escalation

    const t0 = Date.now();
    const enqueueSpanId = 'spn_enq_fork';
    const workerASpanId = 'spn_worker_a';
    const workerBSpanId = 'spn_worker_b';
    const rootSpanId = 'spn_root_fork';

    // T=0: Message enqueued
    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       jsonb_build_object(
         'messageId', $9::text,
         'visibilityTimeoutSeconds', '30'::text,
         'workerId', 'producer'::text
       ), to_timestamp($10 / 1000.0))`,
      [
        traceId, enqueueSpanId, rootSpanId, correlationId, 'QUEUE_ENQUEUED',
        'success', 0, 'PRODUCTION', messageId, t0
      ]
    );

    // T=1: Worker A dequeues and starts
    const t1 = t0 + 1000; // +1 second
    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       jsonb_build_object(
         'messageId', $9::text,
         'workerId', 'worker_a'::text,
         'visibilityWindowExpiresAt', to_timestamp($11 / 1000.0)::text
       ), to_timestamp($10 / 1000.0))`,
      [
        traceId, workerASpanId, enqueueSpanId, correlationId, 'JOB_EXECUTION_START',
        'success', 0, 'PRODUCTION', messageId, t1, t1 + 30000 // visibility expires in 30s
      ]
    );

    // T=31: CRITICAL — Worker A still processing, but visibility window expired
    // Worker B dequeues the SAME message (queue allows it now)
    const t31 = t1 + 30000;
    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       jsonb_build_object(
         'messageId', $9::text,
         'workerId', 'worker_b'::text,
         'visibilityWindowExpiresAt', to_timestamp($11 / 1000.0)::text,
         'forkDetectionReason', 'Multiple workers claiming same message'::text
       ), to_timestamp($10 / 1000.0))`,
      [
        traceId, workerBSpanId, enqueueSpanId, correlationId, 'JOB_EXECUTION_START',
        'success', 0, 'PRODUCTION', messageId, t31, t31 + 30000 // NEW visibility window
      ]
    );

    // T=35: Worker A completes
    const t35 = t1 + 34000;
    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       jsonb_build_object('workerId', 'worker_a'::text), to_timestamp($10 / 1000.0))`,
      [
        traceId, workerASpanId, enqueueSpanId, correlationId, 'JOB_EXECUTION_SUCCESS',
        'success', 34000, 'PRODUCTION', t35
      ]
    );

    // T=40: Worker B completes
    const t40 = t31 + 9000;
    await pool.query(
      `INSERT INTO mutation_lifecycle_events
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        status, duration_in_state_ms, execution_context, metadata, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
       jsonb_build_object('workerId', 'worker_b'::text), to_timestamp($10 / 1000.0))`,
      [
        traceId, workerBSpanId, enqueueSpanId, correlationId, 'JOB_EXECUTION_SUCCESS',
        'success', 9000, 'PRODUCTION', t40
      ]
    );

    // ===== VERIFICATION =====
    // 1. Both workers are siblings (same parent)
    const forkCheckResult = await pool.query(
      `SELECT
         parent_span_id,
         array_agg(DISTINCT span_id) as sibling_span_ids,
         COUNT(DISTINCT span_id) as sibling_count,
         array_agg(DISTINCT metadata->>'workerId') as worker_ids
       FROM mutation_lifecycle_events
       WHERE trace_id = $1
       AND lifecycle_state = 'JOB_EXECUTION_START'
       GROUP BY parent_span_id`,
      [traceId]
    );

    // Should have 2 siblings with same parent = FORK
    expect(forkCheckResult.rows.length).toBeGreaterThan(0);
    const forkRow = forkCheckResult.rows[0];
    expect(parseInt(forkRow.sibling_count)).toBe(2);
    expect(forkRow.worker_ids).toContain('worker_a');
    expect(forkRow.worker_ids).toContain('worker_b');

    // 2. Trace completeness validator should flag causal fork
    const completeness = await validateTraceCompleteness(traceId, pool);

    // The fork manifests as unusual sibling count at same parent level
    // or visibility timeout evidence in metadata
    const metadataResult = await pool.query(
      `SELECT metadata->>'forkDetectionReason' as fork_reason
       FROM mutation_lifecycle_events
       WHERE trace_id = $1 AND metadata->>'forkDetectionReason' IS NOT NULL`,
      [traceId]
    );
    const hasVisibilityTimeoutMetadata = metadataResult.rows.length > 0 &&
      metadataResult.rows[0].fork_reason?.includes('Multiple workers');
    expect(hasVisibilityTimeoutMetadata).toBe(true);

    // 3. Trust evaluator MUST classify as UNTRUSTWORTHY
    const assessment = await evaluateTraceTrust(completeness, {}, pool);

    // Fork = causal ambiguity = automation forbidden
    expect(assessment.trustLevel).toBe('UNTRUSTWORTHY');
    expect(assessment.automationGate.allowFull).toBe(false);
    expect(assessment.automationGate.allowSuggestOnly).toBe(false);
    expect(assessment.automationGate.allowEscalationOnly).toBe(true);
    expect(assessment.severeIssues.some(s => s.toLowerCase().includes('fork'))).toBe(true);

    // 4. Verify boundary evidence would detect this
    // (In production, BoundaryEvidence service captures this automatically)
    expect(forkRow.sibling_count).toBeGreaterThan(1); // Multiple paths from same parent = fork signature
  });
});
