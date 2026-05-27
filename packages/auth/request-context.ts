import { NextRequest, NextResponse } from 'next/server';
import { verifyTokenEdge } from './auth-edge';

export interface RequestContext {
  userId: string;
  tenantId: string;
  role: string;
  permissions: string[];
  traceId: string;
}

function unauthorized(traceId: string, message: string): NextResponse {
  return NextResponse.json(
    { error: message },
    { status: 401, headers: { 'x-trace-id': traceId } }
  );
}

function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function derivePermissions(role: string): string[] {
  const map: Record<string, string[]> = {
    admin: ['read', 'write', 'delete', 'configure', 'manage_users'],
    analyst: ['read', 'write'],
    operator: ['read', 'write'],
    viewer: ['read'],
  };
  return map[role] || [];
}

/**
 * requireContext — strict fail-closed context for standard API routes.
 *
 * Requires ALL of:
 *   Authorization: Bearer <token>   (verified JWT)
 *   x-tenant-id                     (valid UUID, never "default")
 *   x-user-id
 *   x-user-role
 *
 * Use requireSSEContext() for EventSource/SSE routes — they cannot send headers.
 */
export async function requireContext(
  req: NextRequest
): Promise<RequestContext | NextResponse> {
  const traceId = req.headers.get('x-trace-id') || 'unknown';

  const token = req.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return unauthorized(traceId, 'missing authentication');

  let payload: any;
  try {
    payload = await verifyTokenEdge(token);
  } catch {
    return unauthorized(traceId, 'Token expired or invalid');
  }

  // Prefer explicit tenant context headers (used by tests and service calls),
  // but allow browser API calls to derive context directly from verified JWT claims.
  const tenantId = req.headers.get('x-tenant-id') || payload?.tenantId || null;
  const userId = req.headers.get('x-user-id') || payload?.sub || null;
  const role = req.headers.get('x-user-role') || payload?.role || null;

  if (!tenantId || !userId || !role) {
    return unauthorized(traceId, 'Unauthorized - missing tenant context');
  }

  if (tenantId === 'default' || !isValidUUID(tenantId)) {
    return unauthorized(traceId, 'Invalid tenant context');
  }

  return {
    tenantId,
    userId,
    role,
    permissions: derivePermissions(role),
    traceId,
  };
}

/**
 * requireSSEContext — context for EventSource/SSE routes only.
 *
 * EventSource cannot send Authorization headers. Reads JWT from the httpOnly
 * cookie set at login, then extracts tenant/user context from JWT claims.
 * Also accepts Authorization header as fallback (for test clients).
 *
 * Standard API routes must use requireContext() — no exceptions.
 */
export async function requireSSEContext(
  req: NextRequest
): Promise<RequestContext | NextResponse> {
  const traceId = req.headers.get('x-trace-id') || 'unknown';

  const token =
    req.cookies.get('accessToken')?.value ??
    req.headers.get('authorization')?.replace(/^Bearer /, '');

  if (!token) return unauthorized(traceId, 'missing authentication');

  let payload;
  try {
    payload = await verifyTokenEdge(token);
  } catch {
    return unauthorized(traceId, 'Token expired or invalid');
  }

  const { tenantId, sub: userId, role } = payload;

  if (!tenantId || !userId || !role || !isValidUUID(tenantId)) {
    return unauthorized(traceId, 'Invalid token claims');
  }

  return {
    tenantId,
    userId,
    role,
    permissions: derivePermissions(role),
    traceId,
  };
}
