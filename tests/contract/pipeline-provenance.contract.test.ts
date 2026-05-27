import { authGet, loginAndGetToken } from './_helpers';

describe('Contract: pipeline provenance metadata', () => {
  test('cache-status returns canonical provenance envelope', async () => {
    const token = await loginAndGetToken();
    const res = await authGet('/api/cache-status', token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body?.data?.provenance).toBeTruthy();
    expect(body.data.provenance.lifecycleVersion).toBe('v1');
    expect(body.data.provenance.sourceOrigin).toBe('pipeline_ledger');
    expect(typeof body.data.provenance.tenantId).toBe('string');
    expect(body.data.provenance).toHaveProperty('runId');
    expect(body.data.provenance).toHaveProperty('requestId');
    expect(body.data.provenance).toHaveProperty('updatedAt');
  });
});
