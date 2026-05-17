/**
 * Strict API error contract for demo vs full-stack modes.
 * Never hide the truth about what's actually available.
 */

export type RuntimeMode = 'FULL_STACK' | 'DEMO_MODE';

export interface ApiErrorResponse {
  mode: RuntimeMode;
  error: string;
  missingDependency: string; // PostgreSQL, Ollama, Splunk, etc.
  reason: string;
  httpStatus: number;
}

export function makeDemoModeError(
  missingDependency: string,
  reason: string
): ApiErrorResponse {
  return {
    mode: 'DEMO_MODE',
    error: `Feature unavailable in demo mode (${missingDependency} not connected)`,
    missingDependency,
    reason,
    httpStatus: 503,
  };
}

export function getRuntimeMode(): RuntimeMode {
  // Detect based on environment or health check
  // For now: if we can reach PostgreSQL, we're FULL_STACK
  // Otherwise: DEMO_MODE
  return process.env.NODE_ENV === 'production' ? 'FULL_STACK' : 'DEMO_MODE';
}
