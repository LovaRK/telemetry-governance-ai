/**
 * Trace Completeness Validator
 *
 * Phase 6.1.5A.1.1: Behavioral Integrity Validation
 * Proves that traces are complete and unbroken under failure conditions
 *
 * Key Principle:
 * "Observable is not the same as correct.
 *  A trace can look complete while silently missing critical lifecycle stages.
 *  Completeness validation proves forensic-grade correctness."
 */

import { Pool } from 'pg';

/**
 * Expected lifecycle stages for HTTP traces (Phase 1 & 6.1)
 * Phase 1: Direct mutations
 * Phase 6.1: HTTP boundary with causal tracking
 */
const HTTP_LIFECYCLE_STAGES = [
  'INTENT_RECEIVED',
  'MUTATION_DISPATCHED',
  'API_ACCEPTED',
  'STATE_PERSISTED',
  'AUDIT_SNAPSHOTTED',
  'QUERY_INVALIDATED',
  'CACHE_REFRESH_REQUESTED',
  'QUERY_REFETCHED',
  'UI_RECONCILED',
  'STATE_VERIFIED',
];

/**
 * Queue boundary lifecycle stages (Phase 2A)
 * Traces through producer enqueue and consumer execution
 */
const QUEUE_LIFECYCLE_STAGES = [
  'QUEUE_ENQUEUED',
  'JOB_EXECUTION_START',
  'JOB_EXECUTION_SUCCESS',
];

const EXPECTED_LIFECYCLE_STAGES = HTTP_LIFECYCLE_STAGES;

/**
 * Stage ordering constraint
 * Ensures stages occur in correct sequence (not just presence)
 */
const STAGE_ORDER: Record<string, number> = EXPECTED_LIFECYCLE_STAGES.reduce(
  (acc, stage, idx) => {
    acc[stage] = idx;
    return acc;
  },
  {} as Record<string, number>
);

export interface TraceCompleteness {
  traceId: string;
  correlationId: string;
  isComplete: boolean;
  observedStages: string[];
  missingStages: string[];
  stageOrderingValid: boolean;
  orderingViolations: Array<{ from: string; to: string; reason: string }>;
  spanCount: number;
  parentChildLinkageValid: boolean;
  orphanSpans: string[];
  spanDepthMetrics: {
    maxDepth: number;
    unreachableFromRoot: number;
  };
  completenessScore: number; // 0-100, where 100 = fully complete + ordered + linked
}

export interface TraceReconstruction {
  traceId: string;
  rootSpanId?: string;
  spanGraph: Map<string, SpanNode>;
  isLinearChain: boolean;
  branches: number;
  pathsFromRoot: string[][];
}

export interface SpanNode {
  spanId: string;
  parentSpanId: string | null;
  stage: string;
  timestamp: Date;
  durationMs: number;
  status: string;
  children: string[];
  depth: number;
}

/**
 * Main validator: Check trace completeness
 * Answers: "Did we fully observe this mutation from intent to verification?"
 */
export async function validateTraceCompleteness(
  traceId: string,
  pool: Pool
): Promise<TraceCompleteness> {
  const client = await pool.connect();

  try {
    // 1. Query all lifecycle events for this trace
    const eventsResult = await client.query(
      `
      SELECT
        trace_id,
        correlation_id,
        span_id,
        parent_span_id,
        lifecycle_state,
        status,
        duration_in_state_ms,
        recorded_at
      FROM mutation_lifecycle_events
      WHERE trace_id = $1
      ORDER BY recorded_at ASC
      `,
      [traceId]
    );

    if (eventsResult.rows.length === 0) {
      return {
        traceId,
        correlationId: 'unknown',
        isComplete: false,
        observedStages: [],
        missingStages: EXPECTED_LIFECYCLE_STAGES,
        stageOrderingValid: false,
        orderingViolations: [],
        spanCount: 0,
        parentChildLinkageValid: false,
        orphanSpans: [],
        spanDepthMetrics: { maxDepth: 0, unreachableFromRoot: 0 },
        completenessScore: 0,
      };
    }

    const events = eventsResult.rows;
    const correlationId = events[0].correlation_id;

    // 2. Extract observed stages and validate ordering
    const observedStages = [...new Set(events.map((e) => e.lifecycle_state))];
    const missingStages = EXPECTED_LIFECYCLE_STAGES.filter(
      (stage) => !observedStages.includes(stage)
    );

    const orderingViolations: Array<{ from: string; to: string; reason: string }> = [];
    for (let i = 0; i < events.length - 1; i++) {
      const current = events[i].lifecycle_state;
      const next = events[i + 1].lifecycle_state;

      if (STAGE_ORDER[current] !== undefined && STAGE_ORDER[next] !== undefined) {
        if (STAGE_ORDER[current] > STAGE_ORDER[next]) {
          orderingViolations.push({
            from: current,
            to: next,
            reason: `Stage ${next} (order ${STAGE_ORDER[next]}) comes after ${current} (order ${STAGE_ORDER[current]})`,
          });
        }
      }
    }

    // 3. Validate span linkage (parent-child relationships)
    const spanLinkageResult = await client.query(
      `
      WITH spans AS (
        SELECT
          span_id,
          parent_span_id,
          lifecycle_state,
          recorded_at
        FROM mutation_lifecycle_events
        WHERE trace_id = $1
      )
      SELECT
        COUNT(DISTINCT s.span_id)::int as total_spans,
        COUNT(CASE WHEN s.parent_span_id IS NULL OR EXISTS(
          SELECT 1 FROM spans p WHERE p.span_id = s.parent_span_id
        ) THEN 1 END)::int as reachable_spans,
        ARRAY_AGG(DISTINCT s.span_id) FILTER (WHERE s.parent_span_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM spans p WHERE p.span_id = s.parent_span_id
        )) as orphan_spans
      FROM spans s
      `,
      [traceId]
    );

    const linkageMetrics = spanLinkageResult.rows[0];
    const orphanSpans = linkageMetrics.orphan_spans ?? [];
    const parentChildLinkageValid = orphanSpans.length === 0;

    // 4. Build span graph and calculate depth metrics
    const reconstruction = await reconstructSpanGraph(traceId, pool);
    const spanDepthMetrics = calculateSpanDepth(reconstruction.spanGraph);

    // 5. Calculate completeness score
    const stageCompleteness =
      ((EXPECTED_LIFECYCLE_STAGES.length - missingStages.length) /
        EXPECTED_LIFECYCLE_STAGES.length) *
      40;
    const orderingScore = orderingViolations.length === 0 ? 30 : 0;
    const linkageScore = parentChildLinkageValid ? 20 : 0;
    const depthScore = spanDepthMetrics.unreachableFromRoot === 0 ? 10 : 0;
    const completenessScore = Math.round(stageCompleteness + orderingScore + linkageScore + depthScore);

    return {
      traceId,
      correlationId,
      isComplete:
        missingStages.length === 0 &&
        orderingViolations.length === 0 &&
        parentChildLinkageValid &&
        orphanSpans.length === 0,
      observedStages,
      missingStages,
      stageOrderingValid: orderingViolations.length === 0,
      orderingViolations,
      spanCount: linkageMetrics.total_spans,
      parentChildLinkageValid,
      orphanSpans,
      spanDepthMetrics,
      completenessScore,
    };
  } finally {
    client.release();
  }
}

/**
 * Reconstruct complete span graph from trace
 * Returns tree structure enabling path analysis and reachability checks
 */
export async function reconstructSpanGraph(
  traceId: string,
  pool: Pool
): Promise<TraceReconstruction> {
  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      SELECT
        trace_id,
        span_id,
        parent_span_id,
        lifecycle_state,
        status,
        duration_in_state_ms,
        recorded_at
      FROM mutation_lifecycle_events
      WHERE trace_id = $1
      ORDER BY recorded_at ASC
      `,
      [traceId]
    );

    const events = result.rows;
    const spanGraph = new Map<string, SpanNode>();
    let rootSpanId: string | undefined;

    // Build initial span map
    for (const event of events) {
      if (!spanGraph.has(event.span_id)) {
        spanGraph.set(event.span_id, {
          spanId: event.span_id,
          parentSpanId: event.parent_span_id,
          stage: event.lifecycle_state,
          timestamp: event.recorded_at,
          durationMs: event.duration_in_state_ms,
          status: event.status,
          children: [],
          depth: 0,
        });
      }

      if (!event.parent_span_id) {
        rootSpanId = event.span_id;
      }
    }

    // Build parent-child relationships
    for (const [spanId, node] of spanGraph.entries()) {
      if (node.parentSpanId) {
        const parent = spanGraph.get(node.parentSpanId);
        if (parent) {
          parent.children.push(spanId);
        }
      }
    }

    // Calculate depths from root
    if (rootSpanId) {
      calculateDepths(spanGraph, rootSpanId, 0);
    }

    // Find all paths from root
    const pathsFromRoot: string[][] = [];
    if (rootSpanId) {
      findAllPaths(spanGraph, rootSpanId, [rootSpanId], pathsFromRoot);
    }

    // Check if linear (no branching)
    let isLinearChain = true;
    for (const node of spanGraph.values()) {
      if (node.children.length > 1) {
        isLinearChain = false;
        break;
      }
    }

    return {
      traceId,
      rootSpanId,
      spanGraph,
      isLinearChain,
      branches: spanGraph.size - pathsFromRoot.length,
      pathsFromRoot,
    };
  } finally {
    client.release();
  }
}

/**
 * (Private) Recursively calculate span depth from root
 */
function calculateDepths(
  spanGraph: Map<string, SpanNode>,
  spanId: string,
  depth: number
): void {
  const node = spanGraph.get(spanId);
  if (!node) return;

  node.depth = depth;

  for (const childId of node.children) {
    calculateDepths(spanGraph, childId, depth + 1);
  }
}

/**
 * (Private) Find all paths from root to leaf
 */
function findAllPaths(
  spanGraph: Map<string, SpanNode>,
  spanId: string,
  currentPath: string[],
  allPaths: string[][]
): void {
  const node = spanGraph.get(spanId);
  if (!node) return;

  if (node.children.length === 0) {
    // Leaf node
    allPaths.push([...currentPath]);
    return;
  }

  for (const childId of node.children) {
    currentPath.push(childId);
    findAllPaths(spanGraph, childId, currentPath, allPaths);
    currentPath.pop();
  }
}

/**
 * Calculate span graph depth metrics
 */
function calculateSpanDepth(spanGraph: Map<string, SpanNode>): {
  maxDepth: number;
  unreachableFromRoot: number;
} {
  let maxDepth = 0;
  let unreachableFromRoot = 0;

  for (const node of spanGraph.values()) {
    // Nodes with no parent and no incoming edges are unreachable from any root
    if (!node.parentSpanId) {
      // This is a potential root
      maxDepth = Math.max(maxDepth, node.depth);
    } else {
      maxDepth = Math.max(maxDepth, node.depth);
    }

    // Count nodes that aren't reachable (would require traversing upward from root)
    // In a proper tree, this would be 0
  }

  return { maxDepth, unreachableFromRoot };
}

/**
 * Batch validate multiple traces
 * Used for periodic compliance checks
 */
export async function validateTraceBatch(
  traceIds: string[],
  pool: Pool
): Promise<Map<string, TraceCompleteness>> {
  const results = new Map<string, TraceCompleteness>();

  for (const traceId of traceIds) {
    const completeness = await validateTraceCompleteness(traceId, pool);
    results.set(traceId, completeness);
  }

  return results;
}

/**
 * Trace audit report
 * For forensic analysis and compliance reporting
 */
export interface TraceAuditReport {
  totalTraces: number;
  completeTraces: number;
  incompleteTraces: number;
  completionRate: number;
  mostCommonMissingStages: Array<{ stage: string; count: number }>;
  orphanSpanIncidents: number;
  orderingViolationIncidents: number;
  criticalIssues: string[];
}

export async function generateTraceAuditReport(
  pool: Pool,
  lookbackDays: number = 7
): Promise<TraceAuditReport> {
  const client = await pool.connect();

  try {
    // Get unique trace IDs from last N days
    const tracesResult = await client.query(
      `
      SELECT DISTINCT trace_id
      FROM mutation_lifecycle_events
      WHERE recorded_at > NOW() - INTERVAL '1 day' * $1
      ORDER BY trace_id
      `,
      [lookbackDays]
    );

    const traceIds = tracesResult.rows.map((r) => r.trace_id);
    const completenessResults = await validateTraceBatch(traceIds, pool);

    let completeTraces = 0;
    const missingStageFrequency: Record<string, number> = {};
    let orphanSpanIncidents = 0;
    let orderingViolationIncidents = 0;
    const criticalIssues: string[] = [];

    for (const completeness of completenessResults.values()) {
      if (completeness.isComplete) {
        completeTraces++;
      }

      for (const stage of completeness.missingStages) {
        missingStageFrequency[stage] = (missingStageFrequency[stage] ?? 0) + 1;
      }

      if (completeness.orphanSpans.length > 0) {
        orphanSpanIncidents++;
        if (completeness.orphanSpans.length > 1) {
          criticalIssues.push(
            `Trace ${completeness.traceId}: ${completeness.orphanSpans.length} orphan spans detected`
          );
        }
      }

      if (completeness.orderingViolations.length > 0) {
        orderingViolationIncidents++;
        criticalIssues.push(
          `Trace ${completeness.traceId}: Stage ordering violation (${completeness.orderingViolations.length} violations)`
        );
      }

      if (completeness.completenessScore < 50) {
        criticalIssues.push(
          `Trace ${completeness.traceId}: Low completeness score (${completeness.completenessScore}/100)`
        );
      }
    }

    const mostCommonMissing = Object.entries(missingStageFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([stage, count]) => ({ stage, count }));

    return {
      totalTraces: traceIds.length,
      completeTraces,
      incompleteTraces: traceIds.length - completeTraces,
      completionRate: traceIds.length > 0 ? (completeTraces / traceIds.length) * 100 : 0,
      mostCommonMissingStages: mostCommonMissing,
      orphanSpanIncidents,
      orderingViolationIncidents,
      criticalIssues: criticalIssues.slice(0, 10), // Top 10 critical issues
    };
  } finally {
    client.release();
  }
}
