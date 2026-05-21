import { authGet, loginAndGetToken } from './_helpers';

describe('Contract: /api/executive-summary', () => {
  test('returns stable data/meta contract', async () => {
    const token = await loginAndGetToken();
    const res = await authGet('/api/executive-summary', token);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toMatchObject({
      data: expect.any(Object),
      meta: expect.objectContaining({
        source: expect.any(String),
        mode: expect.any(String),
        traceId: expect.any(String),
      }),
    });

    expect(typeof body.data.kpis).toBe('object');
    expect(Array.isArray(body.data.snapshots)).toBe(true);
    expect(typeof body.data.kpis.totalSourcetypes).toBe('number');
    expect(typeof body.data.kpis.totalDailyGb).toBe('number');
  });
});
