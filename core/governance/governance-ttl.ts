/**
 * Governance TTL — Phase 12
 *
 * Manages time-bounded permission grants and automated expiry sweeps.
 *
 * Rules:
 * - All permissions must have an expires_at (no indefinite grants)
 * - TTL sweep runs periodically; expired permissions become inactive
 * - Expired permissions are NEVER deleted — they remain for audit lineage
 * - Revoked permissions (before expiry) are tracked in governance_revocations
 * - Sweep results written to governance_ttl_sweep_log
 */

import * as crypto from 'crypto';
import { query } from '../database/connection';
import { assertTenantIsolation } from '../../apps/api/middleware/assert-tenant-isolation';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PermissionGrant {
  id:            string;
  tenantId:      string;
  actorId:       string;
  resourceType:  string;
  resourceId:    string;
  permission:    string;
  scopeId?:      string;
  grantedBy:     string;
  grantedAt:     Date;
  expiresAt:     Date;
  revokedAt?:    Date;
  revokedBy?:    string;
  revocationId?: string;
  lastUsedAt?:   Date;
  useCount:      number;
  metadata:      Record<string, unknown>;
}

export interface GrantPermissionOpts {
  tenantId:      string;
  actorId:       string;
  resourceType:  string;
  resourceId:    string;
  permission:    string;
  scopeId?:      string;
  grantedBy:     string;
  ttlSeconds:    number;    // max 365 days
  metadata?:     Record<string, unknown>;
}

export interface TTLSweepResult {
  checkedCount:  number;
  expiredCount:  number;
  durationMs:    number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TTL limits
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TTL_SECONDS    = 365 * 24 * 3600;   // 1 year hard cap
const MIN_TTL_SECONDS    = 60;                 // 1 minute minimum

// ─────────────────────────────────────────────────────────────────────────────
// Grant a time-bounded permission
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Row mapper
// ─────────────────────────────────────────────────────────────────────────────

function mapRow(r: Record<string, unknown>): PermissionGrant {
  return {
    id:            r.id as string,
    tenantId:      r.tenant_id as string,
    actorId:       r.actor_id as string,
    resourceType:  r.resource_type as string,
    resourceId:    r.resource_id as string,
    permission:    r.permission as string,
    scopeId:       r.scope_id as string | undefined,
    grantedBy:     r.granted_by as string,
    grantedAt:     r.granted_at as Date,
    expiresAt:     r.expires_at as Date,
    revokedAt:     r.revoked_at as Date | undefined,
    revokedBy:     r.revoked_by as string | undefined,
    revocationId:  r.revocation_id as string | undefined,
    lastUsedAt:    r.last_used_at as Date | undefined,
    useCount:      r.use_count as number,
    metadata:      (r.metadata ?? {}) as Record<string, unknown>,
  };
}

export async function grantPermission(opts: GrantPermissionOpts): Promise<PermissionGrant> {
  assertTenantIsolation(opts.tenantId, 'governance-ttl:grantPermission');

  const clampedTtl = Math.min(Math.max(opts.ttlSeconds, MIN_TTL_SECONDS), MAX_TTL_SECONDS);
  const expiresAt  = new Date(Date.now() + clampedTtl * 1000);
  const id         = `perm-${crypto.randomBytes(12).toString('hex')}`;

  const result = await query<Record<string, unknown>>(
    `INSERT INTO governance_permissions_ttl
       (id, tenant_id, actor_id, resource_type, resource_id, permission,
        scope_id, granted_by, expires_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING *`,
    [
      id,
      opts.tenantId,
      opts.actorId,
      opts.resourceType,
      opts.resourceId,
      opts.permission,
      opts.scopeId ?? null,
      opts.grantedBy,
      expiresAt.toISOString(),
      JSON.stringify(opts.metadata ?? {}),
    ],
  );

  return mapRow(result.rows[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Check if a permission is currently active
// ─────────────────────────────────────────────────────────────────────────────

export async function checkPermission(opts: {
  tenantId:     string;
  actorId:      string;
  resourceType: string;
  resourceId:   string;
  permission:   string;
}): Promise<{ granted: boolean; grant?: PermissionGrant; reason?: string }> {
  assertTenantIsolation(opts.tenantId, 'governance-ttl:checkPermission');

  const result = await query<Record<string, unknown>>(
    `SELECT * FROM governance_permissions_ttl
     WHERE tenant_id    = $1
       AND actor_id     = $2
       AND resource_type = $3
       AND resource_id  = $4
       AND permission   = $5
       AND revoked_at IS NULL
       AND expires_at   > NOW()
     ORDER BY expires_at DESC
     LIMIT 1`,
    [opts.tenantId, opts.actorId, opts.resourceType, opts.resourceId, opts.permission],
  );

  if (!result.rows.length) {
    return { granted: false, reason: 'no active grant found' };
  }

  const grant = mapRow(result.rows[0]);

  // Record usage (fire-and-forget)
  void query(
    `UPDATE governance_permissions_ttl
     SET use_count    = use_count + 1,
         last_used_at = NOW()
     WHERE id = $1`,
    [grant.id],
  ).catch(() => { /* non-fatal */ });

  return { granted: true, grant };
}

// ─────────────────────────────────────────────────────────────────────────────
// List active permissions for a tenant
// ─────────────────────────────────────────────────────────────────────────────

export async function listActivePermissions(
  tenantId: string,
  opts: { actorId?: string; resourceType?: string; limit?: number } = {},
): Promise<PermissionGrant[]> {
  assertTenantIsolation(tenantId, 'governance-ttl:listActivePermissions');

  const params: unknown[] = [tenantId];
  const filters: string[] = ['tenant_id = $1', 'revoked_at IS NULL', 'expires_at > NOW()'];

  if (opts.actorId) {
    params.push(opts.actorId);
    filters.push(`actor_id = $${params.length}`);
  }
  if (opts.resourceType) {
    params.push(opts.resourceType);
    filters.push(`resource_type = $${params.length}`);
  }

  params.push(opts.limit ?? 100);

  const result = await query<Record<string, unknown>>(
    `SELECT * FROM governance_permissions_ttl
     WHERE ${filters.join(' AND ')}
     ORDER BY expires_at ASC
     LIMIT $${params.length}`,
    params,
  );

  return result.rows.map(mapRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// Automated TTL expiry sweep
// ─────────────────────────────────────────────────────────────────────────────

export async function runTtlSweep(): Promise<TTLSweepResult> {
  const t0 = Date.now();

  // Count how many are about to be "swept"
  const checked = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM governance_permissions_ttl
     WHERE revoked_at IS NULL`,
  );

  // Nothing to update — TTL is enforced at read time, not write time.
  // The sweep exists to log and report. A future enhancement could
  // set an `expired` boolean column for index efficiency.
  const expired = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM governance_permissions_ttl
     WHERE revoked_at IS NULL AND expires_at <= NOW()`,
  );

  const durationMs    = Date.now() - t0;
  const checkedCount  = parseInt(checked.rows[0].count, 10);
  const expiredCount  = parseInt(expired.rows[0].count, 10);

  // Log sweep (fire-and-forget)
  const sweepId = `sweep-${crypto.randomBytes(8).toString('hex')}`;
  void query(
    `INSERT INTO governance_ttl_sweep_log
       (id, swept_at, expired_count, checked_count, duration_ms, environment)
     VALUES ($1, NOW(), $2, $3, $4, $5)`,
    [sweepId, expiredCount, checkedCount, durationMs, process.env.APP_ENV ?? 'sandbox'],
  ).catch(() => { /* non-fatal */ });

  return { checkedCount, expiredCount, durationMs };
}
