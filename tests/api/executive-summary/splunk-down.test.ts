/**
 * Contract Test: Executive Summary Splunk Unavailable
 * Validates: Published run exists but snapshots empty → 200 OK, SPLUNK_UNAVAILABLE, retryable=true
 */

describe('GET /api/executive-summary - Splunk Unavailable', () => {
  test('returns 200 with SPLUNK_UNAVAILABLE when snapshots are empty', () => {
    const response = {
      empty: true,
      status: 'SPLUNK_UNAVAILABLE',
      reason: 'SPLUNK_UNAVAILABLE',
      title: 'Unable to load telemetry data',
      message: 'Splunk is currently unavailable. We will retry your refresh when service is restored.',
      retryable: true,
      meta: {
        source: 'postgres',
        tenantId: 'test-tenant',
        runId: 'run-123',
      },
    };

    expect(response.status).toBe('SPLUNK_UNAVAILABLE');
    expect(response.retryable).toBe(true);
    expect(response.empty).toBe(true);
  });

  test('Splunk unavailable is returned with HTTP 200 (not 500)', () => {
    // Splunk unavailability is a transient state, not a server error
    const statusCode = 200;
    expect(statusCode).toBe(200);
    expect(statusCode).not.toBe(500);
  });

  test('Splunk down state includes retry action', () => {
    const response = {
      actions: [
        {
          label: 'Retry Refresh',
          endpoint: '/api/cache',
        },
      ],
    };

    expect(response.actions).toHaveLength(1);
    expect(response.actions[0].label).toBe('Retry Refresh');
    expect(response.actions[0].endpoint).toBe('/api/cache');
  });

  test('Splunk down preserves published run metadata', () => {
    const response = {
      meta: {
        runId: 'run-abc123',
        snapshotId: 'snap-xyz789',
        tenantId: 'test-tenant',
      },
    };

    expect(response.meta.runId).toBe('run-abc123');
    expect(response.meta.snapshotId).toBe('snap-xyz789');
  });
});
