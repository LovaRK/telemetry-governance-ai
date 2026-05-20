import { NextRequest, NextResponse } from 'next/server';
import { verifyTokenEdge, extractBearerToken } from '@/lib/auth-edge';
import { v4 as uuid } from 'uuid';

// Routes that don't require JWT auth
const PUBLIC_ROUTES = [
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/health',           // Docker health checks
  '/api/test-connection',  // needed for Splunk connection test before auth
  '/api/cache-status',     // needed for initial connection check
  '/api/job-stream',       // Job trigger endpoint
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
  if (llmModel) {
    const supported = ['gemma2:9b', 'gemma:2b', 'gemma4:e4b', 'mistral', 'llama2'];
    if (!supported.includes(llmModel)) {
      warnings.push(`LLM_MODEL="${llmModel}" is not in the standard list. Proceeding.`);
    }
    if (llmModel === 'gemma4:e4b') {
      warnings.push('LLM_MODEL=gemma4:e4b requires 32GB+ GPU. If you have only 16GB, switch to "gemma2:9b".');
    }
  } else {
    warnings.push(
      'LLM_MODEL is not set. Running in DEMO_MODE without LLM inference. ' +
      'Set to "gemma2:9b" for full-stack mode.'
    );
  }

  if (!process.env.DATABASE_URL) {
    warnings.push('DATABASE_URL is not set. Running in DEMO_MODE without database access. Set it for full-stack mode.');
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    warnings.push('ANTHROPIC_API_KEY is not set. Fallback to Anthropic will be unavailable.');
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
    console.log(`${tag} ✓ Configuration valid. LLM_MODEL=${process.env.LLM_MODEL || '(default)'}`);
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
    const token = extractBearerToken(request.headers.get('authorization'));

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
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
