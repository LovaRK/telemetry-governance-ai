import { NextRequest, NextResponse } from 'next/server';
import { verifyTokenEdge } from '@/lib/auth-edge';

export interface RequestContext {
  userId: string;
  tenantId: string;
  role: string;
  permissions: string[];
  traceId: string;
}

/**
 * Extract and validate RequestContext from authenticated request
 * Fail-closed: returns error response if context cannot be established
 * All services and routes must use this, not raw tenantId strings
 */
export async function requireContext(
  req: NextRequest
): Promise<RequestContext | NextResponse> {
  // Extract traceId (already injected by middleware)
  const traceId = req.headers.get('x-trace-id') || 'unknown';

  // Extract JWT token (required for context)
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json(
      { error: 'missing authentication' },
      { status: 401, headers: { 'x-trace-id': traceId } }
    );
  }

  // Verify token and extract claims
  let payload;
  try {
    payload = await verifyTokenEdge(token);
  } catch {
    return NextResponse.json(
      { error: 'Token expired or invalid' },
      { status: 401, headers: { 'x-trace-id': traceId } }
    );
  }

  // Extract tenant context from headers (injected by middleware)
  const tenantId = req.headers.get('x-tenant-id');
  const userId = req.headers.get('x-user-id');
  const role = req.headers.get('x-user-role');

  // Fail-closed: all context fields required
  if (!tenantId || !userId || !role) {
    return NextResponse.json(
      { error: 'Unauthorized - missing tenant context' },
      { status: 401, headers: { 'x-trace-id': traceId } }
    );
  }

  // Validate UUID format for tenantId (reject literal "default")
  if (tenantId === 'default' || !isValidUUID(tenantId)) {
    return NextResponse.json(
      { error: 'Invalid tenant context' },
      { status: 401, headers: { 'x-trace-id': traceId } }
    );
  }

  // Derive permissions from role (can be extended)
  const permissions = derivePermissions(role);

  return {
    userId,
    tenantId,
    role,
    permissions,
    traceId,
  };
}

function isValidUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

function derivePermissions(role: string): string[] {
  const permissionMap: Record<string, string[]> = {
    admin: ['read', 'write', 'delete', 'configure', 'manage_users'],
    analyst: ['read', 'write'],
    viewer: ['read'],
  };
  return permissionMap[role] || [];
}
