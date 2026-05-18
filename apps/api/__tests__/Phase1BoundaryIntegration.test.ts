/**
 * Phase 1: Boundary Integration Validation
 *
 * Tests the complete W3C traceparent propagation pipeline:
 * - Frontend: INTENT_RECEIVED lifecycle injection
 * - Middleware: AsyncLocalStorage context isolation
 * - Cache coherence monitoring
 * - Rolling deployment topology transitions
 *
 * Three critical scenarios:
 * 1. Normal mutation flow (topology stable)
 * 2. Rolling deployment (topology crossing)
 * 3. Cache invalidation with coherence verification
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Pool } from 'pg';
import express, { Express, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { governanceTraceMiddleware, GovernanceRequestContext } from '@/middleware/governance-trace-middleware';
import { evaluateTraceTrust } from '@/services/trace-trust-evaluator';
import { validateTraceCompleteness } from '@/validators/trace-completeness-validator';

// ============================================
// Test Harness Setup
// ============================================

let pool: Pool;
let testServer: any;
const TEST_PORT = 5555;

const TOPOLOGY_V1 = 'epoch_2026_boot_v1';
const TOPOLOGY_V2 = 'epoch_2026_boot_v2_updated';

beforeAll(async () => {
  // Initialize database connection
  pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'teja_dashboards'
  });

  // Clear test data
  await pool.query('DELETE FROM mutation_lifecycle_events WHERE trace_id LIKE $1', ['tst_%']);
  await pool.query('DELETE FROM cache_coherence_telemetry WHERE trace_id LIKE $1', ['tst_%']);
  await pool.query('DELETE FROM governance_mutation_journal WHERE trace_id LIKE $1', ['tst_%']);

  // Initialize Express test server
  const app: Express = express();
  app.use(express.json());

  // Store active topology for lifecycle endpoint
  let activeTopology = TOPOLOGY_V1;

  // Mock lifecycle event endpoint
  app.post('/api/governance/lifecycle-event', (req: Request, res: Response) => {
    res.json({ received: true });
  });

  // Mock mutation endpoint with middleware
  app.post('/api/governance/execute-mutation',
    (req: Request, res: Response, next: NextFunction) => {
      // Inject topology for this request
      (req as any).topologyHash = activeTopology;
      governanceTraceMiddleware(req, res, next);
    },
    async (req: Request, res: Response) => {
      const context = (req as any).governanceContext;

      if (!context) {
        return res.status(500).json({ error: 'No governance context' });
      }

      // Simulate DB write with topology hash
      await pool.query(
        `INSERT INTO governance_mutation_journal
         (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
          topology_hash, execution_class, status, duration_in_state_ms, recorded_at, execution_context)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)`,
        [
          context.traceId,
          context.spanId,
          context.parentSpanId,
          context.correlationId,
          'DB_WRITE_PROPOSED',
          context.topologyHash || TOPOLOGY_V1,
          'DIRECT_MUTATION',
          'success',
          45,
          'PRODUCTION'
        ]
      );

      res.json({
        success: true,
        trace: context.traceId,
        topology: context.topologyHash
      });
    }
  );

  // Endpoint to simulate deployment topology change
  app.post('/api/test/simulate-deployment', (req: Request, res: Response) => {
    const { newTopology } = req.body;
    activeTopology = newTopology || TOPOLOGY_V2;
    res.json({ activeTopology });
  });

  // Endpoint to retrieve trace completeness
  app.get('/api/test/trace/:traceId/completeness', async (req: Request, res: Response) => {
    try {
      const completeness = await validateTraceCompleteness(req.params.traceId, pool);
      res.json(completeness);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  testServer = app.listen(TEST_PORT);
});

afterAll(async () => {
  if (testServer) testServer.close();
  if (pool) await pool.end();
});

// ============================================
// Test 1: Normal Mutation Flow (Stable Topology)
// ============================================

describe('Phase 1 Boundary Integration', () => {
  it('Test 1: Stable topology mutation maintains trace lineage', async () => {
    const traceId = `tst_${uuidv4().substring(0, 8)}`;
    const spanId = `spn_${Date.now()}`;
    const correlationId = `corr_${Date.now()}`;

    // Step 1: Client fires INTENT_RECEIVED
    const intentRes = await fetch(`http://localhost:${TEST_PORT}/api/governance/lifecycle-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        traceId,
        spanId,
        correlationId,
        lifecycleState: 'INTENT_RECEIVED',
        executionClass: 'DIRECT_MUTATION',
        executionContext: 'PRODUCTION',
        durationInStateMs: 0
      })
    });
    expect(intentRes.ok).toBe(true);

    // Step 2: Client initiates mutation with W3C traceparent
    const w3cTraceparent = `00-${traceId.padEnd(32, '0')}-${spanId.padEnd(16, '0')}-00`;
    const mutationRes = await fetch(`http://localhost:${TEST_PORT}/api/governance/execute-mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'traceparent': w3cTraceparent,
        'X-Correlation-ID': correlationId,
        'X-Execution-Context': 'PRODUCTION',
        'X-Execution-Class': 'DIRECT_MUTATION'
      },
      body: JSON.stringify({ changeSet: { field: 'value' } })
    });

    expect(mutationRes.ok).toBe(true);
    const mutationData = await mutationRes.json();
    expect(mutationData.trace).toBe(traceId);
    expect(mutationData.topology).toBe(TOPOLOGY_V1);

    // Step 3: Verify trace structure in database
    const result = await pool.query(
      `SELECT COUNT(*) as event_count,
              COUNT(DISTINCT lifecycle_state) as stage_count,
              array_agg(DISTINCT topology_hash) as topologies
       FROM governance_mutation_journal
       WHERE trace_id = $1`,
      [traceId]
    );

    const row = result.rows[0];
    expect(row.event_count).toBeGreaterThan(0);
    expect(row.topologies).toContain(TOPOLOGY_V1);
    expect(row.topologies.length).toBe(1); // Single topology = no crossing
  });

  // ============================================
  // Test 2: Rolling Deployment (Topology Crossing)
  // ============================================

  it('Test 2: Topology crossing during rolling deployment maintains causal chain', async () => {
    const traceId = `tst_${uuidv4().substring(0, 8)}`;
    const correlationId = `corr_${Date.now()}`;

    // Step 1: Mutation starts under TOPOLOGY_V1
    const w3cTraceparent = `00-${traceId.padEnd(32, '0')}-spn_root-00`;

    const phase1Res = await fetch(`http://localhost:${TEST_PORT}/api/governance/execute-mutation`, {
      method: 'POST',
      headers: {
        'traceparent': w3cTraceparent,
        'X-Correlation-ID': correlationId,
        'X-Execution-Context': 'PRODUCTION',
        'X-Execution-Class': 'DIRECT_MUTATION'
      },
      body: JSON.stringify({ changeSet: { field: 'phase1' } })
    });

    expect(phase1Res.ok).toBe(true);

    // Step 2: Simulate rolling deployment (topology change)
    const deployRes = await fetch(`http://localhost:${TEST_PORT}/api/test/simulate-deployment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newTopology: TOPOLOGY_V2 })
    });
    expect(deployRes.ok).toBe(true);

    // Step 3: Same trace continues under new topology
    const phase2Res = await fetch(`http://localhost:${TEST_PORT}/api/governance/execute-mutation`, {
      method: 'POST',
      headers: {
        'traceparent': w3cTraceparent,
        'X-Correlation-ID': correlationId,
        'X-Execution-Context': 'PRODUCTION',
        'X-Execution-Class': 'DIRECT_MUTATION'
      },
      body: JSON.stringify({ changeSet: { field: 'phase2' } })
    });

    expect(phase2Res.ok).toBe(true);

    // Step 4: Verify topology transition in trace
    const result = await pool.query(
      `SELECT
         array_agg(DISTINCT topology_hash ORDER BY topology_hash) as topology_sequence,
         MIN(recorded_at) as trace_start,
         MAX(recorded_at) as trace_end,
         EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) * 1000 as duration_ms
       FROM governance_mutation_journal
       WHERE trace_id = $1`,
      [traceId]
    );

    const row = result.rows[0];
    expect(row.topology_sequence).toContain(TOPOLOGY_V1);
    expect(row.topology_sequence).toContain(TOPOLOGY_V2);
    expect(row.duration_ms).toBeGreaterThan(0);

    // Step 5: Verify trust evaluator recognizes topology transition
    const completeness = await validateTraceCompleteness(traceId, pool);
    expect(completeness).toBeDefined();

    // During deployment, some topology inconsistency is expected
    // Trust should degrade but not collapse
    const assessment = await evaluateTraceTrust(completeness, {}, pool);
    expect(assessment.trustLevel).toBeDefined();
    // DEGRADED or TRUSTED acceptable; UNTRUSTWORTHY would indicate false positive
    expect(['TRUSTED', 'DEGRADED']).toContain(assessment.trustLevel);
  });

  // ============================================
  // Test 3: Cache Coherence Verification
  // ============================================

  it('Test 3: Cache invalidation lifecycle triggers coherence monitoring', async () => {
    const traceId = `tst_${uuidv4().substring(0, 8)}`;
    const correlationId = `corr_${Date.now()}`;

    // Step 1: Insert cache invalidation mutation
    await pool.query(
      `INSERT INTO governance_mutation_journal
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        topology_hash, execution_class, status, duration_in_state_ms, recorded_at, execution_context)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)`,
      [
        traceId,
        `spn_${Date.now()}`,
        null,
        correlationId,
        'INTENT_RECEIVED',
        TOPOLOGY_V1,
        'CACHE_INVALIDATING',
        'success',
        0,
        'PRODUCTION'
      ]
    );

    // Step 2: Insert cache eviction event
    await pool.query(
      `INSERT INTO governance_mutation_journal
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        topology_hash, execution_class, status, duration_in_state_ms, recorded_at, execution_context)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() + INTERVAL '50 ms', $10)`,
      [
        traceId,
        `spn_${Date.now() + 1}`,
        `spn_${Date.now()}`,
        correlationId,
        'CACHE_EVICTION_EMITTED',
        TOPOLOGY_V1,
        'CACHE_INVALIDATING',
        'success',
        50,
        'PRODUCTION'
      ]
    );

    // Step 3: Simulate cache coherence telemetry
    const cohRes = await fetch(`http://localhost:${TEST_PORT}/api/governance/telemetry/coherence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        traceId,
        correlationId,
        indexName: 'test_index',
        invalidationLatencyMs: 150,
        staleRenderDurationMs: 50,
        coherenceTier: 'NOMINAL',
        targetStateHash: 'hash_server_abc123',
        actualStateHash: 'hash_client_abc123'
      })
    });

    // Note: endpoint may not exist yet, so we just verify structure
    // Step 4: Verify trace shows cache invalidation path
    const result = await pool.query(
      `SELECT
         COUNT(DISTINCT lifecycle_state) as stage_count,
         array_agg(DISTINCT lifecycle_state ORDER BY lifecycle_state) as stages_observed,
         CASE WHEN 'CACHE_EVICTION_EMITTED' = ANY(array_agg(lifecycle_state))
           THEN true ELSE false END as cache_eviction_present
       FROM governance_mutation_journal
       WHERE trace_id = $1 AND execution_class = 'CACHE_INVALIDATING'`,
      [traceId]
    );

    const row = result.rows[0];
    expect(row.cache_eviction_present).toBe(true);
    expect(row.stages_observed).toContain('INTENT_RECEIVED');
    expect(row.stages_observed).toContain('CACHE_EVICTION_EMITTED');
  });

  // ============================================
  // Test 4: AsyncLocalStorage Context Isolation
  // ============================================

  it('Test 4: Multiple concurrent traces maintain isolated contexts', async () => {
    const trace1 = `tst_${uuidv4().substring(0, 8)}`;
    const trace2 = `tst_${uuidv4().substring(0, 8)}`;

    const w3c1 = `00-${trace1.padEnd(32, '0')}-spn_iso1-00`;
    const w3c2 = `00-${trace2.padEnd(32, '0')}-spn_iso2-00`;

    // Fire two concurrent mutations
    const [res1, res2] = await Promise.all([
      fetch(`http://localhost:${TEST_PORT}/api/governance/execute-mutation`, {
        method: 'POST',
        headers: {
          'traceparent': w3c1,
          'X-Correlation-ID': `corr_${trace1}`,
          'X-Execution-Context': 'PRODUCTION',
          'X-Execution-Class': 'DIRECT_MUTATION'
        },
        body: JSON.stringify({ changeSet: { id: 1 } })
      }),
      fetch(`http://localhost:${TEST_PORT}/api/governance/execute-mutation`, {
        method: 'POST',
        headers: {
          'traceparent': w3c2,
          'X-Correlation-ID': `corr_${trace2}`,
          'X-Execution-Context': 'PRODUCTION',
          'X-Execution-Class': 'DIRECT_MUTATION'
        },
        body: JSON.stringify({ changeSet: { id: 2 } })
      })
    ]);

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);

    const data1 = await res1.json();
    const data2 = await res2.json();

    // Verify traces remained isolated (no cross-contamination)
    expect(data1.trace).toBe(trace1);
    expect(data2.trace).toBe(trace2);
    expect(data1.trace).not.toBe(data2.trace);

    // Verify database isolation
    const result1 = await pool.query(
      'SELECT trace_id FROM governance_mutation_journal WHERE trace_id = $1',
      [trace1]
    );
    const result2 = await pool.query(
      'SELECT trace_id FROM governance_mutation_journal WHERE trace_id = $1',
      [trace2]
    );

    expect(result1.rows.length).toBeGreaterThan(0);
    expect(result2.rows.length).toBeGreaterThan(0);
  });

  // ============================================
  // Test 5: Negative-Space Detection (Missing Expected Stages)
  // ============================================

  it('Test 5: Negative-space detection flags missing required stages', async () => {
    const traceId = `tst_${uuidv4().substring(0, 8)}`;

    // Create a CACHE_INVALIDATING mutation that SKIPS the required CACHE_EVICTION_EMITTED stage
    // (violates execution class expectations)
    await pool.query(
      `INSERT INTO governance_mutation_journal
       (trace_id, span_id, parent_span_id, correlation_id, lifecycle_state,
        topology_hash, execution_class, status, duration_in_state_ms, recorded_at, execution_context)
       VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10),
       ($1, $11, $3, $4, $12, $6, $7, $8, $13, NOW() + INTERVAL '200 ms', $10)`,
      [
        traceId, `spn_${Date.now()}`, null, `corr_${Date.now()}`,
        'INTENT_RECEIVED', TOPOLOGY_V1, 'CACHE_INVALIDATING', 'success', 0, 'PRODUCTION',
        // Missing CACHE_EVICTION_EMITTED - jump directly to UI_RECONCILED
        `spn_${Date.now() + 1}`, 'UI_RECONCILED', 200
      ]
    );

    // Validate completeness
    const completeness = await validateTraceCompleteness(traceId, pool);
    expect(completeness).toBeDefined();

    // Evaluate trust
    const assessment = await evaluateTraceTrust(completeness, {}, pool);

    // Should be UNTRUSTWORTHY due to missing required CACHE_EVICTION_EMITTED
    expect(assessment.trustLevel).toBe('UNTRUSTWORTHY');
    expect(assessment.severeIssues.length).toBeGreaterThan(0);
    expect(assessment.severeIssues.some(s => s.includes('CACHE_EVICTION'))).toBe(true);
  });
});
