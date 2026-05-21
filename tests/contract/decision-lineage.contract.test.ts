import { authGet, loginAndGetToken } from './_helpers';

describe('Contract: /api/decision-lineage', () => {
  test('returns array payload with meta trace fields', async () => {
    const token = await loginAndGetToken();
    const res = await authGet('/api/decision-lineage?limit=20', token);

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.meta.source).toBe('string');
    expect(typeof body.meta.mode).toBe('string');
    expect(typeof body.meta.traceId).toBe('string');
  });
});
