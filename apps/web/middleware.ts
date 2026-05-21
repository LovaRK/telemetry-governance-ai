import { NextRequest, NextResponse } from 'next/server';
import { verifyTokenEdge, extractBearerToken } from '@packages/auth/auth-edge';
import { v4 as uuid } from 'uuid';

// Routes that don't require JWT auth
// CRITICAL: All data endpoints require authentication to enforce tenant isolation
const PUBLIC_ROUTES = [
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/health',           // Docker health checks
  '/api/test-connection',  // needed for Splunk connection test before auth
  '/api/splunk/test-connection', // Splunk connection test endpoint
  '/api/setup/',           // Setup endpoints (tenant creation, admin user creation)
  '/login',
  '/_next',
  '/favicon.ico',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_ROUTES.some((p) => pathname.startsWith(p));
}

// Inline startup validation (runs once per server instance)
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateStartupConfig(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const llmModel = process.env.LLM_MODEL;
  const enforcedLocalModel = 'gemma2:9b';
  if (llmModel && llmModel !== enforcedLocalModel) {
    warnings.push(
      `LLM_MODEL="${llmModel}" is configured, but the runtime enforces local model "${enforcedLocalModel}" for decision authority.`
    );
  }
  if (!llmModel) {
    warnings.push(
      `LLM_MODEL is not set. Defaulting to local model "${enforcedLocalModel}".`
    );
  }

  if (!process.env.DATABASE_URL) {
    warnings.push('DATABASE_URL is not set. Running in DEMO_MODE without database access. Set it for full-stack mode.');
  }

  if (process.env.ENABLE_ANTHROPIC_FALLBACK === 'true' && !process.env.ANTHROPIC_API_KEY) {
    warnings.push('ENABLE_ANTHROPIC_FALLBACK=true but ANTHROPIC_API_KEY is not set. Anthropic fallback is unavailable.');
  }

  // No hard errors for web-only mode — let APIs handle DEMO_MODE gracefully
  return { valid: true, errors, warnings };
}

function logValidation(result: ValidationResult): void {
  const tag = '[StartupValidation]';
  if (result.errors.length > 0) {
    console.error(`${tag} FATAL configuration errors:`);
    result.errors.forEach((err) => console.error(`  ❌ ${err}`));
  }
  if (result.warnings.length > 0) {
    console.warn(`${tag} Configuration warnings:`);
    result.warnings.forEach((warn) => console.warn(`  ⚠ ${warn}`));
  }
  if (result.valid) {
    console.log(`${tag} ✓ Configuration valid. LLM_MODEL=${process.env.LLM_MODEL || 'gemma2:9b (default)'}`);
  }
}

let validationRun = false;

export async function middleware(request: NextRequest) {
  if (!validationRun) {
    validationRun = true;
    const result = validateStartupConfig();
    logValidation(result);

    if (!result.valid) {
      return NextResponse.json(
        {
          error: 'Service startup failed',
          details: 'Critical configuration errors. Check logs.',
          errors: result.errors,
        },
        { status: 503 }
      );
    }
  }

  // Trace Context Injection (Phase 3)
  // CRITICAL: Establish traceId at request boundary for end-to-end correlation
  const { pathname } = request.nextUrl;

  // Extract W3C traceparent header or generate new traceId
  const traceparent = request.headers.get('traceparent');
  const traceId = traceparent
    ? traceparent.split('-')[1] // Extract traceId from "00-{traceId}-{spanId}-{flags}"
    : uuid();

  // Create new request headers with traceId injected
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-trace-id', traceId);

  // Re-set the request with updated headers for all downstream handlers
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  // JWT auth enforcement
  // Page routes: browsers never send Authorization headers on navigation.
  // Client-side auth hook handles redirect to /login for pages.
  // Middleware only hard-enforces JWT on /api/ routes.

  if (!isPublic(pathname) && pathname.startsWith('/api/')) {
    // Try to get token from Authorization header first (standard API calls)
    let token = extractBearerToken(request.headers.get('authorization'));

    // Fallback to token in cookie (needed for EventSource/SSE which doesn't send Authorization headers)
    if (!token) {
      token = request.cookies.get('accessToken')?.value;
    }

    if (!token) {
      return NextResponse.json(
        { error: 'missing authentication' },
        { status: 401, headers: { 'x-trace-id': traceId } }
      );
    }

    try {
      const payload = await verifyTokenEdge(token);
      // Inject tenant + auth context into request headers for downstream use
      requestHeaders.set('x-tenant-id', payload.tenantId);
      requestHeaders.set('x-user-id', payload.sub);
      requestHeaders.set('x-user-role', payload.role);
      // traceId already set above
      return NextResponse.next({ request: { headers: requestHeaders } });
    } catch {
      return NextResponse.json(
        { error: 'Token expired or invalid' },
        { status: 401, headers: { 'x-trace-id': traceId } }
      );
    }
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
