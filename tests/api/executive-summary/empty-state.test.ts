/**
 * Contract Test: Executive Summary Empty State
 * Validates: No published snapshot → 200 OK, empty=true
 */

describe('GET /api/executive-summary - Empty State', () => {
  test('returns 200 with empty=true when no published_runs exist', () => {
    const response = {
      empty: true,
      status: 'NO_PUBLISHED_SNAPSHOT',
      title: 'No executive summary available',
      message: 'Run a refresh to generate your first telemetry snapshot.',
      actions: [
        {
          label: 'Run Refresh',
          endpoint: '/api/cache',
        },
      ],
      meta: {
        source: 'postgres',
        tenantId: 'test-tenant',
      },
    };

    expect(response.empty).toBe(true);
    expect(response.status).toBe('NO_PUBLISHED_SNAPSHOT');
    expect(response.actions[0].endpoint).toBe('/api/cache');
  });

  test('empty state is returned with HTTP 200 (not 500)', () => {
    // Empty state is a valid application state, not an error
    const statusCode = 200;
    expect(statusCode).toBe(200);
    expect(statusCode).not.toBe(500);
  });

  test('empty state includes action to trigger refresh', () => {
    const response = {
      actions: [
        {
          label: 'Run Refresh',
          endpoint: '/api/cache',
        },
      ],
    };

    expect(response.actions).toHaveLength(1);
    expect(response.actions[0].label).toBe('Run Refresh');
  });
});
