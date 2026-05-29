/**
 * Governance Policy Engine
 *
 * Evaluates governance_policies DSL rules against an incoming governance request.
 * Loaded by the Runtime Governance Engine BEFORE falling back to hardcoded TypeScript rules.
 *
 * Policy DSL Rule Shape (JSONB):
 * {
 *   type: 'AND' | 'OR' | 'NOT' | 'CONDITION',
 *   field?: string,
 *   operator?: 'eq' | 'neq' | 'in' | 'not_in' | 'gte' | 'lte' | 'contains' | 'matches' | 'in_window',
 *   value?: scalar | array | TimeWindowValue,
 *   children?: PolicyRule[],
 *   escalate_to?: 'REQUIRE_APPROVAL' | 'BLOCK' | 'SHADOW_BLOCK' | 'WARN',
 *   ttl_seconds?: number,
 *   required_approvals?: number,
 *   time_window?: { days: string[]; hours_utc: [number, number] }
 * }
 *
 * CRITICAL:
 * - Policy cache has 10-second TTL (governance state SLO from architecture decision 11)
 * - Policy evaluation is synchronous and CPU-only — never awaits in hot path
 * - Write failures are tracked as metrics, never thrown
 * - DB unavailability falls back to empty policy list (RGE hardcoded rules take over)
 */

import { RiskLevel } from './engine/decision-model';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type PolicyEscalation = 'REQUIRE_APPROVAL' | 'BLOCK' | 'SHADOW_BLOCK' | 'WARN';
export type PolicyOperator =
  | 'eq' | 'neq' | 'in' | 'not_in'
  | 'gte' | 'lte'
  | 'contains' | 'matches' | 'in_window';
export type PolicyRuleType = 'AND' | 'OR' | 'NOT' | 'CONDITION';

export interface TimeWindowValue {
  days: Array<'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'>;
  hours_utc: [number, number]; // [startHour, endHour) — exclusive end
}

export interface PolicyRule {
  type: PolicyRuleType;
  field?: string;
  operator?: PolicyOperator;
  value?: unknown;
  children?: PolicyRule[];
  escalate_to?: PolicyEscalation;
  ttl_seconds?: number;
  required_approvals?: number;
  time_window?: TimeWindowValue;
}

export interface GovernancePolicy {
  id: string;
  name: string;
  description?: string;
  rule: PolicyRule;
  priority: number;
  environment: 'sandbox' | 'production' | 'both';
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface PolicyEvaluationContext {
  risk_level: RiskLevel | string;
  actor_id: string;
  actor_type: 'human' | 'agent' | 'service';
  action: string;
  resource: string;
  tenant_id: string;
  decision_id?: string;
  metadata?: Record<string, unknown>;
  /** Evaluation timestamp — defaults to now if not provided */
  _now?: Date;
}

export interface PolicyEvaluationResult {
  matched: boolean;
  policy_id?: string;
  policy_name?: string;
  escalation?: PolicyEscalation;
  ttl_seconds?: number;
  required_approvals?: number;
  reason?: string;
}

// ─────────────────────────────────────────────
// Policy cache (10-second TTL per architecture decision #11)
// ─────────────────────────────────────────────

interface CachedPolicies {
  policies: GovernancePolicy[];
  loaded_at: number;
}

const CACHE_TTL_MS = 10_000; // 10 seconds — governance_state SLO
let _cache: CachedPolicies | null = null;
let _loadFailures = 0;
let _loadSuccesses = 0;

export function getPolicyLoadFailureCount(): number { return _loadFailures; }
export function getPolicyLoadSuccessCount(): number { return _loadSuccesses; }

/**
 * Synchronous read of the policy cache.
 * Returns cached policies if valid (within 10s TTL), otherwise empty array.
 * Used by the RGE's synchronous evaluatePolicy() hot path.
 * The async getActivePolicies() is called on a background refresh cycle.
 */
export function getActivePoliciesSync(): GovernancePolicy[] {
  if (isCacheValid()) return _cache!.policies;
  return [];
}

function isCacheValid(): boolean {
  return _cache !== null && (Date.now() - _cache.loaded_at) < CACHE_TTL_MS;
}

/** For testing only */
export function _clearPolicyCache(): void {
  _cache = null;
  _loadFailures = 0;
  _loadSuccesses = 0;
}

// ─────────────────────────────────────────────
// DB loader (lazy require — avoids circular deps)
// ─────────────────────────────────────────────

async function loadPoliciesFromDB(environment: 'sandbox' | 'production'): Promise<GovernancePolicy[]> {
  try {
    const dbModule = require('../../core/database/connection');
    const queryFn = dbModule.query;
    if (!queryFn) throw new Error('query function not available');

    const result = await queryFn(
      `SELECT id, name, description, rule, priority, environment,
              is_active, created_by,
              created_at::TEXT, updated_at::TEXT, version
       FROM governance_policies
       WHERE is_active = true
         AND environment IN ($1, 'both')
       ORDER BY priority ASC, updated_at DESC`,
      [environment]
    );

    _loadSuccesses++;
    return result.rows.map((row: any): GovernancePolicy => ({
      id: row.id,
      name: row.name,
      description: row.description,
      rule: typeof row.rule === 'string' ? JSON.parse(row.rule) : row.rule,
      priority: row.priority,
      environment: row.environment,
      is_active: row.is_active,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      version: row.version
    }));
  } catch (error) {
    _loadFailures++;
    console.warn('[GOVERNANCE_POLICY_LOAD_FAILED]', {
      error: error instanceof Error ? error.message : String(error),
      load_failures_total: _loadFailures,
      timestamp: new Date().toISOString()
    });
    return []; // Fail-open: RGE hardcoded rules take over
  }
}

/**
 * Get active policies for the current environment.
 * Returns cached result if within TTL, otherwise reloads from DB.
 * DB failure returns empty array (graceful degradation).
 */
export async function getActivePolicies(
  environment: 'sandbox' | 'production' = 'sandbox'
): Promise<GovernancePolicy[]> {
  if (isCacheValid()) {
    return _cache!.policies;
  }

  const policies = await loadPoliciesFromDB(environment);
  _cache = { policies, loaded_at: Date.now() };
  return policies;
}

// ─────────────────────────────────────────────
// Rule evaluator (synchronous — no async in hot path)
// ─────────────────────────────────────────────

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function evaluateRule(rule: PolicyRule, ctx: PolicyEvaluationContext, now: Date): boolean {
  switch (rule.type) {
    case 'AND':
      return (rule.children ?? []).every(child => evaluateRule(child, ctx, now));

    case 'OR':
      return (rule.children ?? []).some(child => evaluateRule(child, ctx, now));

    case 'NOT': {
      const children = rule.children ?? [];
      if (children.length === 0) return false;
      return !evaluateRule(children[0], ctx, now);
    }

    case 'CONDITION':
      return evaluateCondition(rule, ctx, now);

    default:
      return false;
  }
}

function evaluateCondition(rule: PolicyRule, ctx: PolicyEvaluationContext, now: Date): boolean {
  const field = rule.field;
  const operator = rule.operator;
  const value = rule.value;

  if (!field || !operator) return false;

  // Special field: _time (current evaluation time)
  if (field === '_time') {
    if (operator === 'in_window' && value && typeof value === 'object') {
      return isInTimeWindow(value as TimeWindowValue, now);
    }
    return false;
  }

  // Resolve field value from context
  const ctxValue = resolveField(field, ctx);

  switch (operator) {
    case 'eq':
      return String(ctxValue).toLowerCase() === String(value).toLowerCase();

    case 'neq':
      return String(ctxValue).toLowerCase() !== String(value).toLowerCase();

    case 'in': {
      const arr = Array.isArray(value) ? value : [value];
      return arr.map((v: unknown) => String(v).toLowerCase()).includes(String(ctxValue).toLowerCase());
    }

    case 'not_in': {
      const arr = Array.isArray(value) ? value : [value];
      return !arr.map((v: unknown) => String(v).toLowerCase()).includes(String(ctxValue).toLowerCase());
    }

    case 'gte':
      return Number(ctxValue) >= Number(value);

    case 'lte':
      return Number(ctxValue) <= Number(value);

    case 'contains':
      return String(ctxValue).toLowerCase().includes(String(value).toLowerCase());

    case 'matches': {
      try {
        const rx = new RegExp(String(value), 'i');
        return rx.test(String(ctxValue));
      } catch {
        return false;
      }
    }

    case 'in_window':
      if (field === '_time' && value && typeof value === 'object') {
        return isInTimeWindow(value as TimeWindowValue, now);
      }
      return false;

    default:
      return false;
  }
}

function resolveField(field: string, ctx: PolicyEvaluationContext): unknown {
  switch (field) {
    case 'risk_level': return ctx.risk_level;
    case 'actor_id':   return ctx.actor_id;
    case 'actor_type': return ctx.actor_type;
    case 'action':     return ctx.action;
    case 'resource':   return ctx.resource;
    case 'tenant_id':  return ctx.tenant_id;
    default:
      // Support metadata field access via dot notation: metadata.foo
      if (field.startsWith('metadata.') && ctx.metadata) {
        const key = field.slice('metadata.'.length);
        return ctx.metadata[key];
      }
      return undefined;
  }
}

function isInTimeWindow(window: TimeWindowValue, now: Date): boolean {
  const dayName = DAY_NAMES[now.getUTCDay()];
  if (!window.days.includes(dayName as any)) return false;

  const hour = now.getUTCHours();
  const [start, end] = window.hours_utc;
  return hour >= start && hour < end;
}

// ─────────────────────────────────────────────
// Public evaluation API
// ─────────────────────────────────────────────

/**
 * Evaluate a single policy rule against the context.
 * Returns matched=true if the rule fires.
 * Also returns the escalation directive and parameters from the matched rule.
 */
export function evaluatePolicy(
  policy: GovernancePolicy,
  ctx: PolicyEvaluationContext
): PolicyEvaluationResult {
  const now = ctx._now ?? new Date();
  const matched = evaluateRule(policy.rule, ctx, now);

  if (!matched) {
    return { matched: false };
  }

  // Extract escalation from the root rule (or the first matched branch)
  const escalation = policy.rule.escalate_to;
  const ttl = policy.rule.ttl_seconds;
  const requiredApprovals = policy.rule.required_approvals;

  return {
    matched: true,
    policy_id: policy.id,
    policy_name: policy.name,
    escalation,
    ttl_seconds: ttl,
    required_approvals: requiredApprovals,
    reason: policy.description ?? policy.name
  };
}

/**
 * Evaluate all active policies against the context.
 * Returns the FIRST matched policy (lowest priority number wins).
 * Policies are pre-sorted by priority ASC when loaded from DB.
 *
 * @param policies - Sorted active policy list (call getActivePolicies() first)
 * @param ctx      - Evaluation context
 */
export function evaluateAllPolicies(
  policies: GovernancePolicy[],
  ctx: PolicyEvaluationContext
): PolicyEvaluationResult {
  for (const policy of policies) {
    const result = evaluatePolicy(policy, ctx);
    if (result.matched) {
      return result;
    }
  }
  return { matched: false };
}

// ─────────────────────────────────────────────
// CRUD helpers (used by policy routes)
// ─────────────────────────────────────────────

export interface CreatePolicyInput {
  name: string;
  description?: string;
  rule: PolicyRule;
  priority?: number;
  environment?: 'sandbox' | 'production' | 'both';
  created_by: string;
}

export interface UpdatePolicyInput {
  name?: string;
  description?: string;
  rule?: PolicyRule;
  priority?: number;
  environment?: 'sandbox' | 'production' | 'both';
  is_active?: boolean;
  updated_by: string;
}

export async function createPolicy(input: CreatePolicyInput): Promise<GovernancePolicy> {
  const crypto = require('crypto');
  const id = `policy-${crypto.randomBytes(8).toString('hex')}`;

  const dbModule = require('../../core/database/connection');
  const queryFn = dbModule.query;

  const result = await queryFn(
    `INSERT INTO governance_policies
       (id, name, description, rule, priority, environment, is_active, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, true, $7)
     RETURNING id, name, description, rule, priority, environment,
               is_active, created_by, created_at::TEXT, updated_at::TEXT, version`,
    [
      id,
      input.name,
      input.description ?? null,
      JSON.stringify(input.rule),
      input.priority ?? 100,
      input.environment ?? 'both',
      input.created_by
    ]
  );

  _cache = null; // Invalidate cache on write
  return mapRow(result.rows[0]);
}

export async function updatePolicy(id: string, input: UpdatePolicyInput): Promise<GovernancePolicy | null> {
  const dbModule = require('../../core/database/connection');
  const queryFn = dbModule.query;

  const result = await queryFn(
    `UPDATE governance_policies
     SET name        = COALESCE($2, name),
         description = COALESCE($3, description),
         rule        = COALESCE($4::jsonb, rule),
         priority    = COALESCE($5, priority),
         environment = COALESCE($6, environment),
         is_active   = COALESCE($7, is_active),
         updated_at  = NOW(),
         version     = version + 1
     WHERE id = $1
     RETURNING id, name, description, rule, priority, environment,
               is_active, created_by, created_at::TEXT, updated_at::TEXT, version`,
    [
      id,
      input.name ?? null,
      input.description ?? null,
      input.rule ? JSON.stringify(input.rule) : null,
      input.priority ?? null,
      input.environment ?? null,
      input.is_active ?? null
    ]
  );

  if (result.rows.length === 0) return null;
  _cache = null; // Invalidate cache on write
  return mapRow(result.rows[0]);
}

export async function getPolicyById(id: string): Promise<GovernancePolicy | null> {
  const dbModule = require('../../core/database/connection');
  const queryFn = dbModule.query;

  const result = await queryFn(
    `SELECT id, name, description, rule, priority, environment,
            is_active, created_by, created_at::TEXT, updated_at::TEXT, version
     FROM governance_policies WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

export async function listPolicies(opts?: {
  environment?: string;
  is_active?: boolean;
  limit?: number;
}): Promise<GovernancePolicy[]> {
  const dbModule = require('../../core/database/connection');
  const queryFn = dbModule.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (opts?.environment && opts.environment !== 'all') {
    conditions.push(`environment IN ($${paramIdx}, 'both')`);
    params.push(opts.environment);
    paramIdx++;
  }
  if (opts?.is_active !== undefined) {
    conditions.push(`is_active = $${paramIdx}`);
    params.push(opts.is_active);
    paramIdx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts?.limit ?? 100;

  const result = await queryFn(
    `SELECT id, name, description, rule, priority, environment,
            is_active, created_by, created_at::TEXT, updated_at::TEXT, version
     FROM governance_policies
     ${where}
     ORDER BY priority ASC, created_at DESC
     LIMIT ${limit}`,
    params
  );

  return result.rows.map(mapRow);
}

export async function deletePolicy(id: string): Promise<boolean> {
  const dbModule = require('../../core/database/connection');
  const queryFn = dbModule.query;

  const result = await queryFn(
    `DELETE FROM governance_policies WHERE id = $1 RETURNING id`,
    [id]
  );

  _cache = null;
  return result.rows.length > 0;
}

function mapRow(row: any): GovernancePolicy {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    rule: typeof row.rule === 'string' ? JSON.parse(row.rule) : row.rule,
    priority: row.priority,
    environment: row.environment,
    is_active: row.is_active,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    version: row.version
  };
}
