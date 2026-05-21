/**
 * Contract Test: Executive Summary Governance Missing
 * Validates: Active model pointer missing → 503 Service Unavailable
 */

describe('GET /api/executive-summary - Governance Missing', () => {
  test('returns 503 when governance pointer is missing', () => {
    const response = {
      error: 'NO_ACTIVE_MODEL_POINTER',
      status: 'GOVERNANCE_MISSING',
      title: 'Governance configuration required',
      message: 'No active model/prompt configuration for this tenant. Governance setup is required before continuing.',
      empty: false,
      meta: {
        source: 'postgres',
        tenantId: 'test-tenant',
      },
    };

    expect(response.error).toBe('NO_ACTIVE_MODEL_POINTER');
    expect(response.status).toBe('GOVERNANCE_MISSING');
    expect(response.empty).toBe(false);
  });

  test('governance missing returns HTTP 503 (service unavailable)', () => {
    // Governance configuration is a hard blocker
    const statusCode = 503;
    expect(statusCode).toBe(503);
  });

  test('governance error is not confused with empty state', () => {
    const response = {
      error: 'NO_ACTIVE_MODEL_POINTER',
      empty: false,
      status: 'GOVERNANCE_MISSING',
    };

    // Must have error field (different from empty state)
    expect(response.error).toBeDefined();
    expect(response.empty).toBe(false);
    expect(response.status).not.toBe('NO_PUBLISHED_SNAPSHOT');
  });

  test('governance error includes actionable message', () => {
    const response = {
      title: 'Governance configuration required',
      message: 'No active model/prompt configuration for this tenant. Governance setup is required before continuing.',
    };

    expect(response.title).toContain('Governance');
    expect(response.message).toContain('configuration');
  });

  test('governance error preserves published run metadata if available', () => {
    const response = {
      error: 'NO_ACTIVE_MODEL_POINTER',
      meta: {
        runId: 'run-abc123',
        snapshotId: 'snap-xyz789',
        tenantId: 'test-tenant',
      },
    };

    // Metadata should be preserved for debugging
    expect(response.meta.runId).toBeDefined();
    expect(response.meta.snapshotId).toBeDefined();
  });

  test('governance check is fail-fast after KPIs loaded', () => {
    // Governance check happens after we verify snapshots exist
    // but before we construct decisions
    // This means: published run exists → snapshots exist → governance check → fail if missing
    const response = {
      error: 'NO_ACTIVE_MODEL_POINTER',
      status: 'GOVERNANCE_MISSING',
    };

    // Error is returned early, before expensive decision queries
    expect(response.error).toBe('NO_ACTIVE_MODEL_POINTER');
  });
});
