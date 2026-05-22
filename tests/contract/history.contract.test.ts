import { authGet, loginAndGetToken } from './_helpers';

describe('Contract: KPI history API', () => {
  test('GET /api/kpi/history/[id] returns before/after/delta/reason shape', async () => {
    const token = await loginAndGetToken();
    const res = await authGet('/api/kpi/history/roi', token);

    expect([200, 404]).toContain(res.status);
    if (res.status !== 200) return;

    const body = await res.json() as any;
    expect(body?.data).toBeTruthy();
    expect(body.data).toHaveProperty('before');
    expect(body.data).toHaveProperty('after');
    expect(body.data).toHaveProperty('delta');
    expect(body.data).toHaveProperty('evidence');
    expect(body.data).toHaveProperty('reason');
    expect(Array.isArray(body.data.evidence)).toBe(true);
  });
});
