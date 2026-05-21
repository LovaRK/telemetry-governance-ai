import { authGet, loginAndGetToken } from './_helpers';

describe('Contract: /api/executive-summary', () => {
  test('returns stable data/meta contract', async () => {
    const token = await loginAndGetToken();
    const res = await authGet('/api/executive-summary', token);

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // Check for empty state contract
    if (body.empty === true) {
      expect(body.status).toBe('NO_PUBLISHED_SNAPSHOT');
      expect(body.summary).toBeNull();
      expect(Array.isArray(body.metrics)).toBe(true);
      return;
    }

    // Check for populated state contract
    expect(body.data).toEqual(expect.any(Object));
    expect(body.meta).toEqual(
      expect.objectContaining({
        source: expect.any(String),
        traceId: expect.any(String),
      })
    );

    expect(typeof body.data.kpis).toBe('object');
    expect(Array.isArray(body.data.snapshots)).toBe(true);
    expect(typeof body.data.kpis.totalSourcetypes).toBe('number');
    expect(typeof body.data.kpis.totalDailyGb).toBe('number');
  });
});
