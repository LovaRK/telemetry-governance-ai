import { NextRequest } from 'next/server';

export interface TenantContext {
  tenantId: string;
  userId: string;
  userRole: string;
  traceId: string;
}

/**
 * Extract and validate tenant context from authenticated request
 * FAIL CLOSED: returns null if any required context is missing
 * All routes should check this and return 401 if null
 */
export function extractTenantContext(request: NextRequest): TenantContext | null {
  const tenantId = request.headers.get('x-tenant-id');
  const userId = request.headers.get('x-user-id');
  const userRole = request.headers.get('x-user-role');
  const traceId = request.headers.get('x-trace-id') || 'unknown';

  // Fail closed: all context fields are required
  if (!tenantId || !userId || !userRole) {
    console.warn('[TenantContext] Missing auth context', {
      hasTenantId: !!tenantId,
      hasUserId: !!userId,
      hasUserRole: !!userRole,
    });
    return null;
  }

  // Validate tenantId is a UUID, not "default"
  if (tenantId === 'default' || !isValidUUID(tenantId)) {
    console.warn('[TenantContext] Invalid tenant_id format', { tenantId });
    return null;
  }

  return {
    tenantId,
    userId,
    userRole,
    traceId,
  };
}

function isValidUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Helper to enforce admin role
 */
export function requireAdminRole(context: TenantContext | null): boolean {
  return context?.userRole === 'admin';
}
