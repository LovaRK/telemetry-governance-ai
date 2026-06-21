/**
 * Route Contract Registry — Phase 0E
 *
 * Central registry of every API route's behavioral contract.
 * Enforces:
 *   - Which routes require authentication
 *   - Which routes are tenant-scoped (must carry tenant_id)
 *   - Which routes are allowed to return synthetic/mock data
 *   - Which routes are admin-only
 *
 * Also serves as the source of truth for OpenAPI spec generation.
 * Call generateOpenApiSpec() to emit a complete OpenAPI 3.0 document.
 *
 * Architectural rule:
 *   NO route may set mockDataAllowed: true unless ALLOW_SYNTHETIC_DATA=true
 *   in the environment. The assertNoMockData() middleware reads this registry
 *   to enforce the invariant at exit time.
 *
 * Usage:
 * ```typescript
 * import { getContract, assertContractCompliance } from './route-contracts';
 *
 * // At route exit, enforce the contract
 * assertContractCompliance('/api/telemetry', 'GET', payload, tenantId);
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RouteTag =
  | 'auth'
  | 'health'
  | 'setup'
  | 'telemetry'
  | 'governance'
  | 'llm'
  | 'pipeline'
  | 'recommendations'
  | 'splunk'
  | 'admin'
  | 'debug'
  | 'metrics';

export interface RouteContract {
  /** HTTP method */
  method:           HttpMethod;
  /** Path relative to /api. Use `:param` for path params. */
  path:             string;
  /** Human-readable description for OpenAPI */
  description:      string;
  /** True: request must carry a valid JWT or session token */
  requiresAuth:     boolean;
  /** True: request must carry a valid tenant_id; assertTenantIsolation() will run */
  tenantScoped:     boolean;
  /** True: only accessible by admin role */
  adminOnly:        boolean;
  /** True: response MAY contain synthetic data (requires ALLOW_SYNTHETIC_DATA=true) */
  mockDataAllowed:  boolean;
  /** OpenAPI tag grouping */
  tags:             RouteTag[];
  /** Response content-type (default: application/json) */
  contentType?:     string;
  /** Max response staleness (ms). Used by cache-control. undefined = no cache */
  maxStalenessMs?:  number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract Violation Error
// ─────────────────────────────────────────────────────────────────────────────

export class RouteContractViolation extends Error {
  constructor(
    public readonly path:    string,
    public readonly method:  HttpMethod,
    public readonly rule:    string,
    public readonly detail:  string,
  ) {
    super(`RouteContractViolation [${method} ${path}]: ${rule} — ${detail}`);
    this.name = 'RouteContractViolation';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Contract Registry
// ─────────────────────────────────────────────────────────────────────────────

export const ALL_CONTRACTS: RouteContract[] = [

  // ── Auth ──────────────────────────────────────────────────────────────────
  {
    method: 'POST', path: '/api/auth/login',
    description: 'Authenticate with username + password; returns JWT and session cookie',
    requiresAuth: false, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['auth'],
  },
  {
    method: 'POST', path: '/api/auth/logout',
    description: 'Invalidate session token',
    requiresAuth: true, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['auth'],
  },
  {
    method: 'GET', path: '/api/auth/me',
    description: 'Return current authenticated user profile',
    requiresAuth: true, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['auth'],
  },
  {
    method: 'POST', path: '/api/auth/refresh',
    description: 'Refresh an expiring JWT',
    requiresAuth: true, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['auth'],
  },
  {
    method: 'POST', path: '/api/auth',
    description: 'Generic auth endpoint (session creation)',
    requiresAuth: false, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['auth'],
  },

  // ── Health / Setup ────────────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/health',
    description: 'Platform liveness probe. Returns service health summary',
    requiresAuth: false, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['health'],
    maxStalenessMs: 10_000,
  },
  {
    method: 'GET', path: '/api/setup/status',
    description: 'Setup wizard completion status',
    requiresAuth: false, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['setup', 'health'],
  },
  {
    method: 'POST', path: '/api/setup/admin',
    description: 'Create initial admin user (one-time setup)',
    requiresAuth: false, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['setup'],
  },
  {
    method: 'POST', path: '/api/setup/tenant',
    description: 'Bootstrap initial tenant configuration',
    requiresAuth: true, tenantScoped: false, adminOnly: true,
    mockDataAllowed: false, tags: ['setup', 'admin'],
  },

  // ── Splunk Integration ────────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/splunk/status',
    description: 'Splunk connection status + circuit breaker state',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['splunk', 'health'],
  },
  {
    method: 'GET', path: '/api/splunk/config',
    description: 'Read current Splunk connection configuration',
    requiresAuth: true, tenantScoped: true, adminOnly: true,
    mockDataAllowed: false, tags: ['splunk', 'admin'],
  },
  {
    method: 'POST', path: '/api/splunk/config',
    description: 'Write Splunk connection configuration (encrypted at rest)',
    requiresAuth: true, tenantScoped: true, adminOnly: true,
    mockDataAllowed: false, tags: ['splunk', 'admin'],
  },
  {
    method: 'POST', path: '/api/splunk/test-connection',
    description: 'Test Splunk connectivity without saving config',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['splunk'],
  },
  {
    method: 'GET', path: '/api/splunk/diagnostics',
    description: 'Deep Splunk connection diagnostics (MCP + direct)',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['splunk', 'debug'],
  },
  {
    method: 'POST', path: '/api/test-connection',
    description: 'Generic connectivity test',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['splunk'],
  },

  // ── Telemetry / KPIs ──────────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/telemetry',
    description: 'Current telemetry KPIs from Gold layer',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['telemetry'],
    maxStalenessMs: 30_000,
  },
  {
    method: 'GET', path: '/api/telemetry-value',
    description: 'Single telemetry metric value',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['telemetry'],
    maxStalenessMs: 30_000,
  },
  {
    method: 'GET', path: '/api/kpi-history',
    description: 'Historical KPI trend data from Gold snapshots',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['telemetry'],
    maxStalenessMs: 300_000,
  },
  {
    method: 'GET', path: '/api/kpi/:id/trace',
    description: 'KPI provenance trace to Bronze extraction',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['telemetry'],
  },
  {
    method: 'GET', path: '/api/kpi/history/:id',
    description: 'KPI history for a specific index',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['telemetry'],
    maxStalenessMs: 300_000,
  },
  {
    method: 'GET', path: '/api/security-coverage',
    description: 'Security coverage metrics by index and sourcetype',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['telemetry'],
    maxStalenessMs: 300_000,
  },
  {
    method: 'GET', path: '/api/quality-hotspots',
    description: 'Data quality hotspots: high-violation indexes',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['telemetry'],
  },
  {
    method: 'GET', path: '/api/field-usage',
    description: 'Field-level usage and coverage statistics',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['telemetry'],
  },

  // ── Pipeline ──────────────────────────────────────────────────────────────
  {
    method: 'POST', path: '/api/pipeline/refresh',
    description: 'Trigger incremental Bronze→Gold pipeline run',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['pipeline'],
  },
  {
    method: 'GET', path: '/api/pipeline/status/:executionId',
    description: 'Pipeline execution status by SID',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['pipeline'],
  },
  {
    method: 'GET', path: '/api/pipeline-runs/latest',
    description: 'Latest pipeline execution summary',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['pipeline'],
    maxStalenessMs: 30_000,
  },
  {
    method: 'GET', path: '/api/pipeline-runs/:runId',
    description: 'Pipeline execution detail by run ID',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['pipeline'],
  },
  {
    method: 'GET', path: '/api/job-status/latest',
    description: 'Latest async SID job status',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['pipeline'],
  },
  {
    method: 'GET', path: '/api/job-status/:jobId',
    description: 'Async SID job status by job ID',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['pipeline'],
  },
  {
    method: 'GET', path: '/api/job-stream',
    description: 'SSE stream of job progress events',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['pipeline'],
    contentType: 'text/event-stream',
  },

  // ── Recommendations ───────────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/recommendations',
    description: 'Deterministic recommendations from Gold layer (LLM-enriched)',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['recommendations'],
    maxStalenessMs: 60_000,
  },
  {
    method: 'GET', path: '/api/recommendations/:id',
    description: 'Recommendation detail with evidence chain',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['recommendations'],
  },
  {
    method: 'GET', path: '/api/recommendations/audit',
    description: 'Recommendation audit trail with governance decisions',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['recommendations', 'governance'],
  },
  {
    method: 'POST', path: '/api/bulk-actions',
    description: 'Execute bulk governance actions (requires approval)',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['recommendations', 'governance'],
  },

  // ── Governance ────────────────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/governance/events',
    description: 'Governance event log with filters',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['governance'],
    maxStalenessMs: 10_000,
  },
  {
    method: 'GET', path: '/api/governance/events/stream',
    description: 'SSE stream of real-time governance events',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['governance'],
    contentType: 'text/event-stream',
  },
  {
    method: 'GET', path: '/api/governance/health/policy',
    description: 'Policy engine health: eval latency, active policies',
    requiresAuth: true, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['governance', 'health'],
  },
  {
    method: 'GET', path: '/api/governance/health/invariants',
    description: 'Governance invariants check: snapshot integrity, audit continuity',
    requiresAuth: true, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['governance', 'health'],
  },
  {
    method: 'GET', path: '/api/governance/history/:indexName',
    description: 'Governance decision history for a specific index',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['governance'],
    maxStalenessMs: 30_000,
  },
  {
    method: 'GET', path: '/api/governance/mutations',
    description: 'Pending governance mutations (queued for approval)',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['governance'],
  },
  {
    method: 'GET', path: '/api/governance/mutation-lifecycle',
    description: 'Mutation lifecycle state machine for an in-flight change',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['governance'],
  },
  {
    method: 'GET', path: '/api/governance/replay',
    description: 'Replay certification status for scoring versions',
    requiresAuth: true, tenantScoped: false, adminOnly: true,
    mockDataAllowed: false, tags: ['governance', 'admin'],
  },
  {
    method: 'GET', path: '/api/governance/stream',
    description: 'SSE stream: combined governance + pipeline events',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['governance'],
    contentType: 'text/event-stream',
  },
  {
    method: 'GET', path: '/api/governance/telemetry',
    description: 'Governance self-observability metrics snapshot',
    requiresAuth: true, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['governance', 'metrics'],
    maxStalenessMs: 30_000,
  },
  {
    method: 'GET', path: '/api/governance/trace',
    description: 'Distributed trace for a governance decision',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['governance'],
  },
  {
    method: 'GET', path: '/api/governance/trust-status',
    description: 'Current trust state of the governance engine',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['governance'],
    maxStalenessMs: 10_000,
  },
  {
    method: 'GET', path: '/api/governance/cache-coherence',
    description: 'Cache coherence audit: cross-shard consistency check',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['governance', 'debug'],
  },

  // ── Governance Metrics ────────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/governance/metrics/time-series',
    description: 'Platform operational metric time-series data',
    requiresAuth: true, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['governance', 'metrics'],
    maxStalenessMs: 30_000,
  },
  {
    method: 'GET', path: '/api/governance/metrics/export',
    description: 'Export operational metrics in JSON or CSV format',
    requiresAuth: true, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['governance', 'metrics'],
  },

  // ── LLM ──────────────────────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/llm/health',
    description: 'LLM provider health: local Ollama + cloud fallback status',
    requiresAuth: true, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['llm', 'health'],
    maxStalenessMs: 15_000,
  },
  {
    method: 'GET', path: '/api/llm/metrics',
    description: 'LLM inference cost, latency, and fallback rate metrics',
    requiresAuth: true, tenantScoped: false, adminOnly: true,
    mockDataAllowed: false, tags: ['llm', 'metrics', 'admin'],
    maxStalenessMs: 60_000,
  },
  {
    method: 'GET', path: '/api/llm/governance/active',
    description: 'Active LLM governance constraints (cost caps, rate limits)',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['llm', 'governance'],
  },

  // ── Config / Settings ─────────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/config',
    description: 'Read tenant runtime configuration',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['admin'],
  },
  {
    method: 'POST', path: '/api/config',
    description: 'Update tenant runtime configuration',
    requiresAuth: true, tenantScoped: true, adminOnly: true,
    mockDataAllowed: false, tags: ['admin'],
  },
  {
    method: 'GET', path: '/api/settings/llm',
    description: 'LLM provider settings (model, temperature, fallback)',
    requiresAuth: true, tenantScoped: true, adminOnly: true,
    mockDataAllowed: false, tags: ['admin', 'llm'],
  },
  {
    method: 'POST', path: '/api/settings/llm',
    description: 'Update LLM provider settings',
    requiresAuth: true, tenantScoped: true, adminOnly: true,
    mockDataAllowed: false, tags: ['admin', 'llm'],
  },
  {
    method: 'GET', path: '/api/settings/weights',
    description: 'Scoring weight configuration (utilization/detection/quality)',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['admin'],
  },
  {
    method: 'POST', path: '/api/settings/weights',
    description: 'Update scoring weights (triggers replay certification gate)',
    requiresAuth: true, tenantScoped: true, adminOnly: true,
    mockDataAllowed: false, tags: ['admin'],
  },
  {
    method: 'GET', path: '/api/settings/explainability',
    description: 'Explainability and parser confidence settings',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['admin'],
  },

  // ── Executive / Dashboard ─────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/executive-summary',
    description: 'Executive KPI summary: ROI, tier distribution, top wins',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['telemetry'],
    maxStalenessMs: 60_000,
  },
  {
    method: 'GET', path: '/api/executive-summary/explain',
    description: 'LLM-generated executive summary narrative',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['telemetry', 'llm'],
    maxStalenessMs: 300_000,
  },
  {
    method: 'GET', path: '/api/dashboard/current',
    description: 'Current dashboard state (hydrated from server)',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['telemetry'],
    maxStalenessMs: 30_000,
  },
  {
    method: 'GET', path: '/api/drift-monitor',
    description: 'Scoring drift detection: composite score delta vs previous snapshot',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['telemetry'],
    maxStalenessMs: 60_000,
  },

  // ── Explainability / Trust ────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/explainability/coverage',
    description: 'SPL field coverage and parser confidence report',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['telemetry'],
    maxStalenessMs: 300_000,
  },
  {
    method: 'GET', path: '/api/trust-inspection',
    description: 'Trust inspection: governance state, confidence decomposition',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['governance'],
    maxStalenessMs: 10_000,
  },
  {
    method: 'GET', path: '/api/decision-history',
    description: 'Agent decision history with governance outcomes',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['governance'],
  },
  {
    method: 'GET', path: '/api/decision-lineage',
    description: 'Decision lineage graph (full causal chain)',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['governance'],
  },
  {
    method: 'GET', path: '/api/decision-lineage/:id',
    description: 'Decision lineage for a specific decision ID',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['governance'],
  },
  {
    method: 'GET', path: '/api/model-health',
    description: 'Scoring model health: version, certification, drift',
    requiresAuth: true, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['health'],
    maxStalenessMs: 60_000,
  },

  // ── Cache / Queue ─────────────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/cache-status',
    description: 'Redis/in-memory cache occupancy and hit rate',
    requiresAuth: true, tenantScoped: false, adminOnly: true,
    mockDataAllowed: false, tags: ['admin', 'health'],
    maxStalenessMs: 15_000,
  },
  {
    method: 'DELETE', path: '/api/cache',
    description: 'Flush tenant cache (admin)',
    requiresAuth: true, tenantScoped: true, adminOnly: true,
    mockDataAllowed: false, tags: ['admin'],
  },
  {
    method: 'GET', path: '/api/queue-health',
    description: 'Async job queue depth and worker health',
    requiresAuth: true, tenantScoped: false, adminOnly: false,
    mockDataAllowed: false, tags: ['health', 'pipeline'],
    maxStalenessMs: 15_000,
  },

  // ── Search / Audit ────────────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/search-audit',
    description: 'Search-level audit log: SPL queries with cost attribution',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['governance', 'admin'],
  },
  {
    method: 'GET', path: '/api/agent-decisions',
    description: 'Agent decision log with deterministic + LLM enrichment',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['governance'],
    maxStalenessMs: 30_000,
  },

  // ── Dashboard Validation ──────────────────────────────────────────────────
  {
    method: 'POST', path: '/api/dashboard-validation/run',
    description: 'Trigger dashboard validation run (CI gate)',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['health', 'debug'],
  },
  {
    method: 'GET', path: '/api/dashboard-validation/latest',
    description: 'Latest dashboard validation result',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['health'],
  },
  {
    method: 'GET', path: '/api/dashboard-validation/:runId',
    description: 'Dashboard validation result by run ID',
    requiresAuth: true, tenantScoped: true, adminOnly: false,
    mockDataAllowed: false, tags: ['health'],
  },

  // ── Debug (non-production) ────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/debug/latest-run',
    description: 'Latest pipeline execution debug dump (non-production only)',
    requiresAuth: true, tenantScoped: true, adminOnly: true,
    mockDataAllowed: true,  // debug endpoint may surface synthetic runs
    tags: ['debug'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Lookup Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Map for O(1) contract lookup: `METHOD /path` */
const CONTRACT_MAP = new Map<string, RouteContract>(
  ALL_CONTRACTS.map(c => [`${c.method} ${c.path}`, c]),
);

/**
 * Look up the contract for a route.
 * Normalizes path params (`:id`, `:jobId`, etc.) before lookup.
 * Returns undefined if no contract is registered.
 */
export function getContract(
  method: HttpMethod,
  path: string,
): RouteContract | undefined {
  // Exact match first
  const exact = CONTRACT_MAP.get(`${method} ${path}`);
  if (exact) return exact;

  // Normalize path params: replace /word after a slash that looks like an ID
  // e.g. /api/job-status/abc123 → /api/job-status/:jobId
  for (const [key, contract] of CONTRACT_MAP) {
    const [km, kp] = key.split(' ', 2);
    if (km !== method) continue;
    const pattern = kp.replace(/\/:[^/]+/g, '/[^/]+');
    if (new RegExp(`^${pattern}$`).test(path)) return contract;
  }

  return undefined;
}

/**
 * Assert that a response payload for a route satisfies the contract.
 *
 * Enforces:
 *   1. mockDataAllowed=false routes may never return synthetic payloads
 *      when ALLOW_SYNTHETIC_DATA is false in the environment.
 *   2. tenantScoped routes must have a non-empty tenantId.
 *
 * Throws RouteContractViolation on failure.
 * In SHADOW mode (APP_GOVERNANCE_MODE=SHADOW) violations are logged but not thrown.
 */
export function assertContractCompliance(
  method: HttpMethod,
  path:   string,
  opts:   { tenantId?: string; isSynthetic?: boolean },
): void {
  const contract = getContract(method, path);
  if (!contract) return; // no registered contract = no enforcement

  const allowSynthetic = process.env.ALLOW_SYNTHETIC_DATA === 'true';
  const shadow         = process.env.APP_GOVERNANCE_MODE === 'SHADOW';

  // Rule 1: no synthetic data unless explicitly allowed
  if (opts.isSynthetic && !contract.mockDataAllowed && !allowSynthetic) {
    const v = new RouteContractViolation(
      path, method,
      'NO_SYNTHETIC_DATA',
      'Response contains synthetic data but ALLOW_SYNTHETIC_DATA is not set',
    );
    if (shadow) {
      console.warn(`[RouteContract:SHADOW] ${v.message}`);
    } else {
      throw v;
    }
  }

  // Rule 2: tenant-scoped routes must carry tenant_id
  if (contract.tenantScoped && !opts.tenantId) {
    const v = new RouteContractViolation(
      path, method,
      'MISSING_TENANT_ID',
      'Route is tenant-scoped but no tenantId was provided',
    );
    if (shadow) {
      console.warn(`[RouteContract:SHADOW] ${v.message}`);
    } else {
      throw v;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAPI Generation Hook
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenApiSpec {
  openapi: '3.0.3';
  info:    { title: string; version: string; description: string };
  paths:   Record<string, Record<string, OpenApiOperation>>;
  tags:    Array<{ name: string; description: string }>;
}

export interface OpenApiOperation {
  summary:     string;
  operationId: string;
  tags:        string[];
  security?:   Array<Record<string, string[]>>;
  parameters?: Array<{ in: 'path'; name: string; required: true; schema: { type: 'string' } }>;
  responses:   Record<string, { description: string; content?: Record<string, unknown> }>;
}

const TAG_DESCRIPTIONS: Record<RouteTag, string> = {
  auth:            'Authentication and session management',
  health:          'Platform health and liveness probes',
  setup:           'One-time setup wizard',
  telemetry:       'Telemetry KPIs, snapshots, and scoring data',
  governance:      'Governance engine: policies, approvals, audit, replay',
  llm:             'LLM routing, cost tracking, and provider health',
  pipeline:        'Bronze/Silver/Gold pipeline execution and status',
  recommendations: 'Deterministic recommendations with LLM enrichment',
  splunk:          'Splunk MCP connection management and diagnostics',
  admin:           'Administrative configuration (requires admin role)',
  debug:           'Debug endpoints (non-production only)',
  metrics:         'Platform operational metrics and SLOs',
};

/**
 * Generate an OpenAPI 3.0.3 specification document from ALL_CONTRACTS.
 * Call from a /api/openapi.json route to serve the spec.
 */
export function generateOpenApiSpec(version = '1.0.0'): OpenApiSpec {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  const tagSet = new Set<RouteTag>();

  for (const contract of ALL_CONTRACTS) {
    // Convert :param → {param} for OpenAPI
    const oaPath = contract.path.replace(/:([^/]+)/g, '{$1}');
    const method = contract.method.toLowerCase();

    if (!paths[oaPath]) paths[oaPath] = {};

    // Extract path parameters
    const pathParams = [...contract.path.matchAll(/:([^/]+)/g)].map(m => m[1]);

    const operation: OpenApiOperation = {
      summary:     contract.description,
      operationId: `${method}_${oaPath.replace(/\//g, '_').replace(/[{}]/g, '').replace(/^_+/, '')}`,
      tags:        contract.tags,
      responses:   {
        '200': { description: 'Success' },
        '401': { description: 'Unauthorized' },
        '403': { description: 'Forbidden' },
        '500': { description: 'Internal server error' },
      },
    };

    if (contract.requiresAuth) {
      operation.security = [{ bearerAuth: [] }];
    }

    if (pathParams.length > 0) {
      operation.parameters = pathParams.map(name => ({
        in:       'path' as const,
        name,
        required: true as const,
        schema:   { type: 'string' as const },
      }));
    }

    if (contract.contentType === 'text/event-stream') {
      operation.responses['200'] = {
        description: 'Server-Sent Events stream',
        content:     { 'text/event-stream': {} },
      };
    }

    paths[oaPath][method] = operation;
    contract.tags.forEach(t => tagSet.add(t));
  }

  return {
    openapi: '3.0.3',
    info: {
      title:       'Enterprise Telemetry Governance Platform API',
      version,
      description: 'Internal API for the governance platform. All routes enforce tenant isolation, no-mock-data, and governance audit invariants.',
    },
    tags: [...tagSet].map(name => ({
      name,
      description: TAG_DESCRIPTIONS[name] ?? name,
    })),
    paths,
  };
}
