/**
 * Governance Audit Store
 * Immutable audit trail for every governance decision.
 *
 * CRITICAL: This is the foundation for compliance, approval workflows,
 * revocation tracking, and forensic operator visibility.
 *
 * Architecture:
 * - Dual-write: in-memory ring buffer (for fast queries) + DB persistence
 * - Write errors are tracked as metrics, never thrown (audit must not block governance)
 * - All writes are fire-and-forget async from the governance hot path
 * - Query methods return from in-memory buffer first, fall back to DB
 */

import { v4 as uuidv4 } from 'uuid';
import { GovernanceDecision, Decision, RiskLevel } from './engine/decision-model';
import { GovernanceSnapshot } from './governance-snapshot';
import { GovernanceIntegrityState } from './governance-integrity';
import { GovernanceMode } from './governance-mode';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface GovernanceAuditEvent {
  id: string;
  decisionId: string;
  decision: Decision;
  riskLevel: RiskLevel;
  actor: string;          // display name / email
  actorId: string;
  actorType: string;
  action: string;
  resource: string;
  environment: 'sandbox' | 'production';
  traceId: string;
  correlationId: string;
  causationId?: string;
  integrityState?: GovernanceIntegrityState;
  governanceMode: GovernanceMode;
  policySnapshotHash?: string;
  matchedPolicies?: string;   // comma-separated policy IDs
  reasons?: string[];
  evaluationMs?: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface AuditQueryOptions {
  from?: string;       // ISO timestamp
  to?: string;         // ISO timestamp
  actor?: string;
  actorId?: string;
  action?: string;
  decision?: Decision;
  riskLevel?: RiskLevel;
  environment?: 'sandbox' | 'production';
  limit?: number;      // default 100
  offset?: number;     // default 0
}

export interface AuditQueryResult {
  events: GovernanceAuditEvent[];
  total: number;
  from_cache: boolean;
}

// ─────────────────────────────────────────────
// In-memory ring buffer
// ─────────────────────────────────────────────

const RING_BUFFER_MAX = 500;
const ringBuffer: GovernanceAuditEvent[] = [];

function appendToBuffer(event: GovernanceAuditEvent): void {
  ringBuffer.push(event);
  if (ringBuffer.length > RING_BUFFER_MAX) {
    ringBuffer.shift(); // evict oldest
  }
}

// ─────────────────────────────────────────────
// Write failure tracking
// ─────────────────────────────────────────────

let _writeFailureCount = 0;
let _writeSuccessCount = 0;

export function getAuditWriteFailureCount(): number {
  return _writeFailureCount;
}

export function getAuditWriteSuccessCount(): number {
  return _writeSuccessCount;
}

export function resetAuditWriteCounters(): void {
  _writeFailureCount = 0;
  _writeSuccessCount = 0;
}

// ─────────────────────────────────────────────
// DB persistence (deferred import to avoid circular deps)
// ─────────────────────────────────────────────

async function persistToDB(event: GovernanceAuditEvent): Promise<void> {
  try {
    // Lazy-require database module to avoid circular deps at module load time
    // Matches the pattern used in governance-integrity.ts and governance-metrics.ts
    const dbModule = require('../database/db-client');
    const pool = dbModule.getPool?.() || dbModule.pool || dbModule.default;

    if (!pool) {
      throw new Error('Database pool not available');
    }

    await pool.query(
      `INSERT INTO governance_audit_events (
        id, "decisionId", decision, "riskLevel",
        actor, "actorId", "actorType",
        action, resource, environment,
        "traceId", "correlationId", "causationId",
        "integrityState", "governanceMode",
        "policySnapshotHash", "matchedPolicies", reasons,
        "evaluationMs", "createdAt", metadata
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10,
        $11, $12, $13,
        $14, $15,
        $16, $17, $18,
        $19, $20, $21
      ) ON CONFLICT (id) DO NOTHING`,
      [
        event.id,
        event.decisionId,
        String(event.decision),
        String(event.riskLevel),
        event.actor,
        event.actorId,
        event.actorType,
        event.action,
        event.resource,
        event.environment,
        event.traceId,
        event.correlationId,
        event.causationId ?? null,
        event.integrityState ? String(event.integrityState) : null,
        String(event.governanceMode),
        event.policySnapshotHash ?? null,
        event.matchedPolicies ?? null,
        event.reasons ? JSON.stringify(event.reasons) : null,
        event.evaluationMs ?? null,
        event.createdAt,
        event.metadata ? JSON.stringify(event.metadata) : null
      ]
    );

    _writeSuccessCount++;
  } catch (error) {
    _writeFailureCount++;
    // Never throw — audit write must not interrupt governance flow
    console.warn('[GOVERNANCE_AUDIT_WRITE_FAILED]', {
      event_id: event.id,
      decision_id: event.decisionId,
      error: error instanceof Error ? error.message : String(error),
      write_failures_total: _writeFailureCount,
      timestamp: new Date().toISOString()
    });
  }
}

// ─────────────────────────────────────────────
// Core write API
// ─────────────────────────────────────────────

/**
 * Log a governance decision to the audit trail.
 *
 * CRITICAL: Fire-and-forget. Never awaited on the hot path.
 * Errors are tracked in _writeFailureCount only.
 */
export function logDecision(
  decision: GovernanceDecision,
  snapshot: GovernanceSnapshot,
  integrityState: GovernanceIntegrityState,
  evaluationMs: number,
  metadata?: Record<string, unknown>
): void {
  const event: GovernanceAuditEvent = {
    id: uuidv4(),
    decisionId: decision.decision_id,
    decision: decision.decision,
    riskLevel: decision.risk_level,
    actor: decision.actor_id, // actor display name = actor_id in Phase 2A
    actorId: decision.actor_id,
    actorType: decision.actor_type,
    action: decision.action,
    resource: decision.resource,
    environment: decision.environment as 'sandbox' | 'production',
    traceId: decision.trace_id ?? '',
    correlationId: decision.correlation_id ?? '',
    causationId: decision.causation_id,
    integrityState,
    governanceMode: snapshot.enforcement_mode,
    policySnapshotHash: decision.policy_snapshot_hash,
    matchedPolicies: decision.matched_policy_ids?.join(','),
    reasons: decision.reasons,
    evaluationMs,
    createdAt: decision.created_at,
    metadata
  };

  // 1. Write to in-memory buffer (synchronous, always succeeds)
  appendToBuffer(event);

  // 2. Persist to DB asynchronously (fire-and-forget — do not await)
  void persistToDB(event);
}

/**
 * Log a raw audit event (for non-RGE callers like approval workflows, TTL revocations).
 */
export function logRawEvent(event: Omit<GovernanceAuditEvent, 'id' | 'createdAt'>): void {
  const full: GovernanceAuditEvent = {
    ...event,
    id: uuidv4(),
    createdAt: new Date().toISOString()
  };
  appendToBuffer(full);
  persistToDB(full);
}

// ─────────────────────────────────────────────
// Query API
// ─────────────────────────────────────────────

/**
 * Query audit events with filters.
 * Returns in-memory buffer results for recent events.
 * For historical queries (beyond buffer), DB fallback is used.
 */
export function queryAuditEvents(options: AuditQueryOptions = {}): AuditQueryResult {
  const {
    from,
    to,
    actor,
    actorId,
    action,
    decision,
    riskLevel,
    environment,
    limit = 100,
    offset = 0
  } = options;

  let filtered = [...ringBuffer];

  if (from) {
    const fromMs = new Date(from).getTime();
    filtered = filtered.filter(e => new Date(e.createdAt).getTime() >= fromMs);
  }
  if (to) {
    const toMs = new Date(to).getTime();
    filtered = filtered.filter(e => new Date(e.createdAt).getTime() <= toMs);
  }
  if (actor) {
    filtered = filtered.filter(e => e.actor === actor || e.actor.includes(actor));
  }
  if (actorId) {
    filtered = filtered.filter(e => e.actorId === actorId);
  }
  if (action) {
    filtered = filtered.filter(e => e.action === action || e.action.includes(action));
  }
  if (decision) {
    filtered = filtered.filter(e => e.decision === decision);
  }
  if (riskLevel) {
    filtered = filtered.filter(e => e.riskLevel === riskLevel);
  }
  if (environment) {
    filtered = filtered.filter(e => e.environment === environment);
  }

  // Sort newest first
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = filtered.length;
  const events = filtered.slice(offset, offset + limit);

  return { events, total, from_cache: true };
}

/**
 * Get all audit events for a specific actor.
 */
export function getByActor(actorId: string, limit = 50): GovernanceAuditEvent[] {
  return queryAuditEvents({ actorId, limit }).events;
}

/**
 * Get all audit events for a specific action.
 */
export function getByAction(action: string, limit = 50): GovernanceAuditEvent[] {
  return queryAuditEvents({ action, limit }).events;
}

/**
 * Get all audit events for a specific decision_id.
 */
export function getByDecisionId(decisionId: string): GovernanceAuditEvent[] {
  return ringBuffer.filter(e => e.decisionId === decisionId);
}

/**
 * Get events within a time range.
 */
export function getByTimeRange(from: string, to: string, limit = 200): GovernanceAuditEvent[] {
  return queryAuditEvents({ from, to, limit }).events;
}

/**
 * Get all DENY decisions (for approval review).
 */
export function getDenyDecisions(limit = 100): GovernanceAuditEvent[] {
  return queryAuditEvents({ decision: Decision.DENY, limit }).events;
}

/**
 * Get recent events (last N from buffer).
 */
export function getRecent(count = 20): GovernanceAuditEvent[] {
  const sorted = [...ringBuffer].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return sorted.slice(0, count);
}

/**
 * Get buffer size.
 */
export function getBufferSize(): number {
  return ringBuffer.length;
}

/**
 * Clear the in-memory buffer (for testing only).
 */
export function clearBuffer(): void {
  ringBuffer.length = 0;
  _writeFailureCount = 0;
  _writeSuccessCount = 0;
}

// ─────────────────────────────────────────────
// Async DB query (for deep historical queries beyond buffer)
// ─────────────────────────────────────────────

/**
 * Query audit events directly from DB.
 * Used when buffer doesn't have enough history.
 */
export async function queryAuditEventsFromDB(
  options: AuditQueryOptions = {}
): Promise<AuditQueryResult> {
  try {
    const { pool } = await import('../database/connection');

    if (!pool) {
      return { events: [], total: 0, from_cache: false };
    }

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (options.from) {
      conditions.push(`"createdAt" >= $${idx++}`);
      values.push(new Date(options.from));
    }
    if (options.to) {
      conditions.push(`"createdAt" <= $${idx++}`);
      values.push(new Date(options.to));
    }
    if (options.actorId) {
      conditions.push(`"actorId" = $${idx++}`);
      values.push(options.actorId);
    }
    if (options.action) {
      conditions.push(`action = $${idx++}`);
      values.push(options.action);
    }
    if (options.decision) {
      conditions.push(`decision = $${idx++}`);
      values.push(String(options.decision));
    }
    if (options.riskLevel) {
      conditions.push(`"riskLevel" = $${idx++}`);
      values.push(String(options.riskLevel));
    }
    if (options.environment) {
      conditions.push(`environment = $${idx++}`);
      values.push(options.environment);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    values.push(limit, offset);

    const result = await pool.query(
      `SELECT * FROM governance_audit_events
       ${whereClause}
       ORDER BY "createdAt" DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      values
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM governance_audit_events ${whereClause}`,
      values.slice(0, -2) // exclude limit/offset for count
    );

    const events: GovernanceAuditEvent[] = result.rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      decisionId: String(row.decisionId),
      decision: row.decision as Decision,
      riskLevel: row.riskLevel as RiskLevel,
      actor: String(row.actor),
      actorId: String(row.actorId),
      actorType: String(row.actorType),
      action: String(row.action),
      resource: String(row.resource),
      environment: (row.environment === 'production' ? 'production' : 'sandbox') as 'sandbox' | 'production',
      traceId: String(row.traceId),
      correlationId: String(row.correlationId),
      causationId: row.causationId ? String(row.causationId) : undefined,
      integrityState: row.integrityState as GovernanceIntegrityState | undefined,
      governanceMode: row.governanceMode as GovernanceMode,
      policySnapshotHash: row.policySnapshotHash ? String(row.policySnapshotHash) : undefined,
      matchedPolicies: row.matchedPolicies ? String(row.matchedPolicies) : undefined,
      reasons: Array.isArray(row.reasons) ? row.reasons : (row.reasons ? JSON.parse(String(row.reasons)) : undefined),
      evaluationMs: row.evaluationMs ? Number(row.evaluationMs) : undefined,
      createdAt: row.createdAt instanceof Date ? (row.createdAt as Date).toISOString() : String(row.createdAt),
      metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata as Record<string, unknown>) : undefined
    }));

    return {
      events,
      total: parseInt(String((countResult.rows[0] as Record<string, unknown>).count), 10),
      from_cache: false
    };
  } catch (error) {
    console.warn('[GOVERNANCE_AUDIT_DB_QUERY_FAILED]', {
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
    // Fall back to in-memory
    return queryAuditEvents(options);
  }
}

// ─────────────────────────────────────────────
// Health summary (for integrity checks)
// ─────────────────────────────────────────────

export interface AuditHealthSummary {
  buffer_size: number;
  write_failures: number;
  write_successes: number;
  write_failure_rate: number; // percent
  oldest_event?: string;
  newest_event?: string;
}

export function getAuditHealthSummary(): AuditHealthSummary {
  const total = _writeFailureCount + _writeSuccessCount;
  const sorted = ringBuffer.length > 0
    ? [...ringBuffer].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    : [];

  return {
    buffer_size: ringBuffer.length,
    write_failures: _writeFailureCount,
    write_successes: _writeSuccessCount,
    write_failure_rate: total > 0 ? (_writeFailureCount / total) * 100 : 0,
    oldest_event: sorted.length > 0 ? sorted[0].createdAt : undefined,
    newest_event: sorted.length > 0 ? sorted[sorted.length - 1].createdAt : undefined
  };
}

/**
 * Log audit health summary (for observer ticks).
 */
export function logAuditHealth(): void {
  const summary = getAuditHealthSummary();
  const level = summary.write_failures > 5 ? 'ERROR' : summary.write_failures > 0 ? 'WARN' : 'INFO';

  console.log(`[GOVERNANCE_AUDIT_HEALTH:${level}]`, {
    ...summary,
    timestamp: new Date().toISOString()
  });
}
