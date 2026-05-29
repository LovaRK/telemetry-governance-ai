/**
 * Governance Revocation — Phase 12
 *
 * Handles early revocation of active permission grants.
 *
 * Rules:
 * - Revocations are IMMUTABLE — once created, never deleted
 * - Revocation takes effect immediately at the DB row level (sets revoked_at)
 * - Every revocation produces a governance_audit_events record
 * - Cannot revoke an already-expired permission (it's already inactive)
 * - Cannot revoke a previously-revoked permission (idempotency guard)
 */

import * as crypto from 'crypto';
import { query } from '../database/connection';
import { assertTenantIsolation } from '../../apps/api/middleware/assert-tenant-isolation';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RevocationRecord {
  id:             string;
  tenantId:       string;
  permissionId:   string;
  revokedBy:      string;
  reason:         string;
  effectiveAt:    Date;
  auditEventId?:  string;
  metadata:       Record<string, unknown>;
}

export interface RevokePermissionOpts {
  permissionId: string;
  tenantId:     string;
  revokedBy:    string;
  reason:       string;
  metadata?:    Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Revoke a permission grant
// ─────────────────────────────────────────────────────────────────────────────

export async function revokePermission(opts: RevokePermissionOpts): Promise<RevocationRecord> {
  assertTenantIsolation(opts.tenantId, 'governance-revocation:revokePermission');

  // Verify the grant exists and belongs to this tenant
  const existing = await query<{ id: string; tenant_id: string; expires_at: Date; revoked_at: Date | null }>(
    `SELECT id, tenant_id, expires_at, revoked_at
     FROM governance_permissions_ttl
     WHERE id = $1 AND tenant_id = $2`,
    [opts.permissionId, opts.tenantId],
  );

  if (!existing.rows.length) {
    throw new Error(`Permission not found: ${opts.permissionId} for tenant ${opts.tenantId}`);
  }

  const grant = existing.rows[0];

  if (grant.revoked_at) {
    throw new Error(`Permission ${opts.permissionId} is already revoked`);
  }

  if (new Date(grant.expires_at) <= new Date()) {
    throw new Error(`Permission ${opts.permissionId} has already expired — revocation not needed`);
  }

  // Create revocation record
  const revocationId = `rev-${crypto.randomBytes(12).toString('hex')}`;
  const auditEventId = `aud-rev-${crypto.randomBytes(8).toString('hex')}`;

  await query(
    `INSERT INTO governance_revocations
       (id, tenant_id, permission_id, revoked_by, reason, effective_at, audit_event_id, metadata)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7::jsonb)`,
    [
      revocationId,
      opts.tenantId,
      opts.permissionId,
      opts.revokedBy,
      opts.reason,
      auditEventId,
      JSON.stringify(opts.metadata ?? {}),
    ],
  );

  // Mark the permission as revoked
  await query(
    `UPDATE governance_permissions_ttl
     SET revoked_at    = NOW(),
         revoked_by    = $1,
         revocation_id = $2
     WHERE id = $3 AND tenant_id = $4`,
    [opts.revokedBy, revocationId, opts.permissionId, opts.tenantId],
  );

  // Audit event — ALWAYS written, even when GOVERNANCE_GLOBAL_BYPASS=true
  void query(
    `INSERT INTO governance_audit_events
       (id, tenant_id, event_type, actor_id, resource_type, resource_id,
        decision, payload, created_at)
     VALUES ($1, $2, 'permission_revoked', $3, 'permission', $4, 'revoked', $5::jsonb, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      auditEventId,
      opts.tenantId,
      opts.revokedBy,
      opts.permissionId,
      JSON.stringify({
        revocation_id: revocationId,
        reason:        opts.reason,
        metadata:      opts.metadata ?? {},
      }),
    ],
  ).catch(() => { /* audit write failure is non-fatal — OTel records it */ });

  return {
    id:           revocationId,
    tenantId:     opts.tenantId,
    permissionId: opts.permissionId,
    revokedBy:    opts.revokedBy,
    reason:       opts.reason,
    effectiveAt:  new Date(),
    auditEventId,
    metadata:     opts.metadata ?? {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// List revocations for a tenant
// ─────────────────────────────────────────────────────────────────────────────

export async function listRevocations(
  tenantId: string,
  opts: { limit?: number; since?: Date } = {},
): Promise<RevocationRecord[]> {
  assertTenantIsolation(tenantId, 'governance-revocation:listRevocations');

  const params: unknown[] = [tenantId];
  const filters = ['tenant_id = $1'];

  if (opts.since) {
    params.push(opts.since.toISOString());
    filters.push(`effective_at >= $${params.length}`);
  }

  params.push(opts.limit ?? 50);

  const result = await query<Record<string, unknown>>(
    `SELECT * FROM governance_revocations
     WHERE ${filters.join(' AND ')}
     ORDER BY effective_at DESC
     LIMIT $${params.length}`,
    params,
  );

  return result.rows.map((r: Record<string, unknown>) => ({
    id:             r.id as string,
    tenantId:       r.tenant_id as string,
    permissionId:   r.permission_id as string,
    revokedBy:      r.revoked_by as string,
    reason:         r.reason as string,
    effectiveAt:    r.effective_at as Date,
    auditEventId:   r.audit_event_id as string | undefined,
    metadata:       (r.metadata ?? {}) as Record<string, unknown>,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Get revocation by ID
// ─────────────────────────────────────────────────────────────────────────────

export async function getRevocation(
  tenantId: string,
  revocationId: string,
): Promise<RevocationRecord | null> {
  assertTenantIsolation(tenantId, 'governance-revocation:getRevocation');

  const result = await query<Record<string, unknown>>(
    `SELECT * FROM governance_revocations
     WHERE id = $1 AND tenant_id = $2`,
    [revocationId, tenantId],
  );

  if (!result.rows.length) return null;

  const r: Record<string, unknown> = result.rows[0];
  return {
    id:           r.id as string,
    tenantId:     r.tenant_id as string,
    permissionId: r.permission_id as string,
    revokedBy:    r.revoked_by as string,
    reason:       r.reason as string,
    effectiveAt:  r.effective_at as Date,
    auditEventId: r.audit_event_id as string | undefined,
    metadata:     (r.metadata ?? {}) as Record<string, unknown>,
  };
}
