/**
 * Boundary Evidence
 *
 * Phase 6.1.5A.2: Immutable forensic snapshots proving propagation at system boundaries
 *
 * Problem: When propagation confidence is low, we need to know WHERE the chain broke.
 * Was it:
 * - HTTP header parsing (extraction boundary)?
 * - AsyncLocalStorage binding (ALS boundary)?
 * - Queue enqueue/dequeue (message broker boundary)?
 * - SSE broadcast/receive (streaming boundary)?
 * - Worker topology change (deployment boundary)?
 *
 * Solution: Capture evidence snapshot at each boundary showing:
 * - What context arrived
 * - What context departed
 * - Success/failure status
 * - Timestamp with clock source
 *
 * These snapshots are immutable (written once, never modified) and used for:
 * 1. Root cause analysis when propagation fails
 * 2. Forensic replay: given a broken trace, walk through boundaries to find fork point
 * 3. Validation: prove that context WAS propagated (or wasn't) at specific boundary
 */

/**
 * W3C Trace Context snapshot
 * Captures what the traceparent header looked like at moment of capture
 */
export interface TraceContextSnapshot {
  // W3C Trace Context format: traceparent: version-trace_id-parent_id-trace_flags
  traceparent: string; // e.g., "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"

  // Parsed components for analysis
  version: string; // "00" for W3C 1.0
  traceId: string; // 128-bit hex
  parentSpanId: string; // 64-bit hex
  traceFlags: string; // "01" = sampled, "00" = not sampled

  // Extract timestamp from anywhere available
  capturedAt: string; // ISO8601 when this snapshot was taken
  captureMethod: 'HEADER_PARSE' | 'ALS_READ' | 'MESSAGE_EXTRACT' | 'REPLAY_INJECT'; // How did we get this?
}

/**
 * Boundary Evidence: Immutable forensic record
 * Written at system boundaries to prove propagation succeeded/failed
 */
export interface BoundaryEvidence {
  // ===== IDENTITY =====
  evidenceId: string; // UUID — globally unique forensic record
  traceId: string; // Which trace generated this evidence?
  boundaryType: 'HTTP_INGRESS' | 'HTTP_EGRESS' | 'QUEUE_ENQUEUE' | 'QUEUE_DEQUEUE' | 'SSE_BROADCAST' | 'SSE_RECEIVE' | 'WORKER_TOPOLOGY' | 'CACHE_INVALIDATION';

  // ===== CONTEXT STATE =====
  inboundContext: TraceContextSnapshot | null; // What arrived at this boundary?
  outboundContext: TraceContextSnapshot | null; // What departed from this boundary?

  // ===== PROPAGATION SUCCESS/FAILURE =====
  propagationStatus: 'SUCCESS' | 'PARTIAL_LOSS' | 'COMPLETE_LOSS' | 'FORK_DETECTED';
  propagationFailureReason?: string; // e.g., "Traceparent header missing", "ALS context undefined", "Message broker didn't preserve trace_id"

  // ===== FORENSIC METADATA =====
  subsystem: string; // e.g., "express_http", "bullmq_queue", "sse_broadcast", "worker_pool"
  boundaryOperationId: string; // Request ID, Message ID, Subscription ID at this boundary
  operatorHash?: string; // SHA-256 of operator performing action
  topologyHash?: string; // Which worker pool / deployment epoch?

  // ===== CONCURRENCY SIGNALS (for fork detection) =====
  visibilityTimeout?: {
    // Queue visibility timeout: how long until this message is redeliverable?
    duration_seconds: number;
    expiresAt: string; // ISO8601 when message becomes visible again
  };
  claimedByWorkers?: number; // How many workers claimed this message? (>1 = fork)
  forkDetectionMethod?: 'VISIBILITY_TIMEOUT' | 'IDEMPOTENCY_KEY' | 'TRACE_ID_COLLISION' | 'TOPOLOGY_MISMATCH';

  // ===== TIMING =====
  capturedAt: string; // ISO8601 when evidence was captured
  boundaryLatency_ms?: number; // How long did propagation take through this boundary?
  timestampSource: 'SERVER_CLOCK' | 'CLIENT_CLOCK' | 'BROKER_CLOCK'; // Which clock was authoritative?

  // ===== AUTHORIZATION =====
  // Was this boundary traversal authorized? (for replay scenarios)
  authorizationContext?: {
    operatorHash: string; // Who performed this action?
    replayToken?: string; // If this was a replay, token used?
    replayAuthorized: boolean; // Did authorization succeed?
  };

  // ===== IMMUTABILITY GUARANTEE =====
  // These fields are set once and never modified
  readonly writtenAt: string; // ISO8601 when evidence was first persisted
  readonly isPersisted: boolean; // Has this been written to immutable store?
  persistenceMethod?: 'DIRECT_WRITE_COLD_TIER' | 'ASYNC_BATCH_AGGREGATE' | 'SAMPLED_SNAPSHOT';
}

/**
 * Boundary Evidence Collection
 * For a single trace, accumulate evidence at each boundary
 */
export interface BoundaryEvidenceChain {
  traceId: string;
  evidenceSnapshots: BoundaryEvidence[];

  // Aggregated analysis
  propagationIntegrity: {
    totalBoundariesCrossed: number;
    boundariesWithCompleteLoss: number; // evidence.propagationStatus === 'COMPLETE_LOSS'
    boundariesWithPartialLoss: number;
    forksDetected: number; // evidence.propagationStatus === 'FORK_DETECTED'
    integrityScore: number; // [0, 1] = (boundaries_ok / total_boundaries)
  };

  // Forensic timeline
  firstEvidenceAt: string; // ISO8601 of first boundary
  lastEvidenceAt: string; // ISO8601 of last boundary
  totalChainDuration_ms: number;

  // Causal root cause analysis
  rootCauseIfFailed?: {
    type: 'EXTRACTION_FAILURE' | 'ALS_LOSS' | 'BROKER_DROP' | 'TOPOLOGY_MISMATCH' | 'VISIBILITY_TIMEOUT_FORK' | 'UNKNOWN';
    evidenceId: string; // Which boundary evidence identified the failure?
    explanation: string;
    remediationSuggestion: string;
  };
}

/**
 * Boundary Evidence Query Interface
 * For forensic analysis: given a broken trace, trace through boundaries
 */
export interface BoundaryEvidenceQuery {
  // Reconstruct causal path
  traceId: string;
  startingBoundaryType?: 'HTTP_INGRESS' | 'QUEUE_DEQUEUE'; // Where to start investigation

  // Filter to specific boundaries
  includeOnlyFailedBoundaries?: boolean; // Only show PARTIAL_LOSS or COMPLETE_LOSS?
  includeOnlyForkedBoundaries?: boolean; // Only show FORK_DETECTED?

  // Time window
  after?: string; // ISO8601
  before?: string; // ISO8601
}

/**
 * Helper: Create boundary evidence snapshot at HTTP ingress
 * Call this in request middleware when traceparent arrives
 */
export function createHttpIngressEvidence(
  traceId: string,
  inboundTraceparent: string | null,
  operatorHash: string | undefined,
  capturedAt: string
): BoundaryEvidence {
  const hasTraceparent = inboundTraceparent !== null && inboundTraceparent.length > 0;

  return {
    evidenceId: `boundary_${traceId}_http_ingress_${Date.now()}`,
    traceId,
    boundaryType: 'HTTP_INGRESS',
    inboundContext: hasTraceparent
      ? parseTraceparent(inboundTraceparent)
      : null,
    outboundContext: null, // Not yet known at ingress
    propagationStatus: hasTraceparent ? 'SUCCESS' : 'COMPLETE_LOSS',
    propagationFailureReason: hasTraceparent ? undefined : 'No traceparent header in HTTP request',
    subsystem: 'express_http',
    boundaryOperationId: `http_request_${traceId}`,
    operatorHash,
    capturedAt,
    timestampSource: 'SERVER_CLOCK',
    writtenAt: new Date().toISOString(),
    isPersisted: false,
  };
}

/**
 * Helper: Create boundary evidence snapshot at queue dequeue
 * Call this in worker when pulling job from queue
 */
export function createQueueDequeueEvidence(
  traceId: string,
  messageId: string,
  inboundTraceparent: string | null,
  claimedByWorkers: number,
  visibilityTimeoutSeconds: number,
  operatorHash: string | undefined,
  topologyHash: string | undefined,
  capturedAt: string
): BoundaryEvidence {
  const hasTraceparent = inboundTraceparent !== null && inboundTraceparent.length > 0;
  const forkDetected = claimedByWorkers > 1;

  return {
    evidenceId: `boundary_${traceId}_queue_dequeue_${messageId}`,
    traceId,
    boundaryType: 'QUEUE_DEQUEUE',
    inboundContext: hasTraceparent
      ? parseTraceparent(inboundTraceparent)
      : null,
    outboundContext: null, // Will be set after execution
    propagationStatus: forkDetected ? 'FORK_DETECTED' : hasTraceparent ? 'SUCCESS' : 'COMPLETE_LOSS',
    propagationFailureReason: forkDetected
      ? `Message claimed by ${claimedByWorkers} workers`
      : hasTraceparent
        ? undefined
        : 'Trace context lost at queue boundary',
    subsystem: 'bullmq_queue',
    boundaryOperationId: messageId,
    operatorHash,
    topologyHash,
    visibilityTimeout: {
      duration_seconds: visibilityTimeoutSeconds,
      expiresAt: new Date(Date.now() + visibilityTimeoutSeconds * 1000).toISOString(),
    },
    claimedByWorkers,
    forkDetectionMethod: forkDetected ? 'VISIBILITY_TIMEOUT' : undefined,
    capturedAt,
    timestampSource: 'SERVER_CLOCK',
    writtenAt: new Date().toISOString(),
    isPersisted: false,
  };
}

/**
 * Helper: Parse W3C traceparent header
 */
function parseTraceparent(traceparent: string): TraceContextSnapshot {
  const parts = traceparent.split('-');
  return {
    traceparent,
    version: parts[0] || '00',
    traceId: parts[1] || 'unknown',
    parentSpanId: parts[2] || 'unknown',
    traceFlags: parts[3] || '00',
    capturedAt: new Date().toISOString(),
    captureMethod: 'HEADER_PARSE',
  };
}

/**
 * Determine if boundary evidence shows propagation failure
 */
export function isBoundaryFailure(evidence: BoundaryEvidence): boolean {
  return evidence.propagationStatus === 'COMPLETE_LOSS' || evidence.propagationStatus === 'FORK_DETECTED';
}

/**
 * Reconstruct causal path from evidence chain
 * Useful for forensic UI: show user "trace broke here at [boundary name] when [reason]"
 */
export function reconstructCausalPath(chain: BoundaryEvidenceChain): string[] {
  const path: string[] = [];
  for (const evidence of chain.evidenceSnapshots) {
    const status = evidence.propagationStatus === 'SUCCESS' ? '✓' : '✗';
    const summary = `${status} ${evidence.boundaryType} (${evidence.subsystem})`;
    if (evidence.propagationFailureReason) {
      path.push(`${summary}: ${evidence.propagationFailureReason}`);
    } else {
      path.push(summary);
    }
  }
  return path;
}
