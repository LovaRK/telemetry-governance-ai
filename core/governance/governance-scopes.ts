/**
 * Governance Scopes — Phase 12
 *
 * Named scope definitions that restrict where a permission applies.
 * Scopes constrain permissions to specific resource patterns within a tenant.
 *
 * Example usage:
 *   Grant actor:alice permission:decommission on scope:security_indexes_only
 *   → Alice can only decommission indexes matching the scope's resource_pattern
 *
 * Pattern matching: simple glob (* = any characters, ? = single character).
 * Patterns are case-insensitive.
 */

import * as crypto from 'crypto';
import { query } from '../database/connection';
import { assertTenantIsolation } from '../../apps/api/middleware/assert-tenant-isolation';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceScope {
  id:              string;
  tenantId:        string;
  scopeName:       string;
  description?:    string;
  resourceType:    string;
  resourcePattern: string;
  environment:     'production' | 'sandbox' | 'both';
  isActive:        boolean;
  createdBy:       string;
  createdAt:       Date;
  updatedAt:       Date;
}

export interface CreateScopeOpts {
  tenantId:        string;
  scopeName:       string;
  description?:    string;
  resourceType:    string;
  resourcePattern: string;
  environment?:    'production' | 'sandbox' | 'both';
  createdBy:       string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the resourceName matches the glob pattern.
 * '*' matches any sequence; '?' matches a single character.
 * Case-insensitive.
 */
export function matchesScope(pattern: string, resourceName: string): boolean {
  if (pattern === '*') return true;

  // Convert glob to RegExp
  const regexStr = '^' + pattern
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape special chars
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.') + '$';

  try {
    return new RegExp(regexStr).test(resourceName.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Checks if a scope covers the given resource in the given environment.
 * Used by governance-ttl.checkPermission to validate scope constraints.
 */
export function scopeCoversResource(
  scope: GovernanceScope,
  resourceType: string,
  resourceName: string,
  environment: string,
): boolean {
  // Resource type must match (or scope covers '*')
  if (scope.resourceType !== '*' && scope.resourceType !== resourceType) {
    return false;
  }

  // Environment must match
  if (scope.environment !== 'both' && scope.environment !== environment) {
    return false;
  }

  // Pattern must match
  return matchesScope(scope.resourcePattern, resourceName);
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function createScope(opts: CreateScopeOpts): Promise<GovernanceScope> {
  assertTenantIsolation(opts.tenantId, 'governance-scopes:createScope');

  const id  = `scope-${crypto.randomBytes(10).toString('hex')}`;

  const result = await query<Record<string, unknown>>(
    `INSERT INTO governance_scopes
       (id, tenant_id, scope_name, description, resource_type, resource_pattern,
        environment, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      id,
      opts.tenantId,
      opts.scopeName,
      opts.description ?? null,
      opts.resourceType,
      opts.resourcePattern,
      opts.environment ?? 'both',
      opts.createdBy,
    ],
  );

  return mapScopeRow(result.rows[0]);
}

export async function getScope(tenantId: string, scopeId: string): Promise<GovernanceScope | null> {
  assertTenantIsolation(tenantId, 'governance-scopes:getScope');

  const result = await query<Record<string, unknown>>(
    `SELECT * FROM governance_scopes WHERE id = $1 AND tenant_id = $2`,
    [scopeId, tenantId],
  );

  return result.rows.length ? mapScopeRow(result.rows[0]) : null;
}

export async function getScopeByName(
  tenantId: string,
  scopeName: string,
): Promise<GovernanceScope | null> {
  assertTenantIsolation(tenantId, 'governance-scopes:getScopeByName');

  // Check tenant-specific scope first, then SYSTEM scopes
  const result = await query<Record<string, unknown>>(
    `SELECT * FROM governance_scopes
     WHERE (tenant_id = $1 OR tenant_id = 'SYSTEM')
       AND scope_name = $2
       AND is_active = true
     ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [tenantId, scopeName],
  );

  return result.rows.length ? mapScopeRow(result.rows[0]) : null;
}

export async function listScopes(
  tenantId: string,
  opts: { resourceType?: string; isActive?: boolean } = {},
): Promise<GovernanceScope[]> {
  assertTenantIsolation(tenantId, 'governance-scopes:listScopes');

  const params: unknown[] = [tenantId];
  const filters = ['(tenant_id = $1 OR tenant_id = \'SYSTEM\')'];

  if (opts.resourceType) {
    params.push(opts.resourceType);
    filters.push(`resource_type = $${params.length}`);
  }
  if (opts.isActive !== undefined) {
    params.push(opts.isActive);
    filters.push(`is_active = $${params.length}`);
  }

  const result = await query<Record<string, unknown>>(
    `SELECT * FROM governance_scopes
     WHERE ${filters.join(' AND ')}
     ORDER BY scope_name`,
    params,
  );

  return result.rows.map(mapScopeRow);
}

export async function deactivateScope(tenantId: string, scopeId: string): Promise<void> {
  assertTenantIsolation(tenantId, 'governance-scopes:deactivateScope');

  await query(
    `UPDATE governance_scopes
     SET is_active = false, updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [scopeId, tenantId],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row mapper
// ─────────────────────────────────────────────────────────────────────────────

function mapScopeRow(r: Record<string, unknown>): GovernanceScope {
  return {
    id:              r.id as string,
    tenantId:        r.tenant_id as string,
    scopeName:       r.scope_name as string,
    description:     r.description as string | undefined,
    resourceType:    r.resource_type as string,
    resourcePattern: r.resource_pattern as string,
    environment:     r.environment as 'production' | 'sandbox' | 'both',
    isActive:        r.is_active as boolean,
    createdBy:       r.created_by as string,
    createdAt:       r.created_at as Date,
    updatedAt:       r.updated_at as Date,
  };
}
