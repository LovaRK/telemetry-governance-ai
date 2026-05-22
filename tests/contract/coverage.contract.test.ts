import { authGet, loginAndGetToken } from './_helpers';

describe('Contract: explainability coverage API', () => {
  test('GET /api/explainability/coverage returns hard coverage metrics', async () => {
    const token = await loginAndGetToken();
    const res = await authGet('/api/explainability/coverage', token);

    expect([200, 503]).toContain(res.status);
    if (res.status !== 200) return;

    const body = await res.json() as any;
    expect(body?.data).toBeTruthy();
    expect(typeof body.data.totalKpis).toBe('number');
    expect(typeof body.data.expandableKpis).toBe('number');
    expect(typeof body.data.coveragePercent).toBe('number');
    expect(typeof body.data.missingProvenance).toBe('number');
    expect(typeof body.data.missingConfidence).toBe('number');
    expect(typeof body.data.missingFormulas).toBe('number');

    expect(body.data.totalKpis).toBeGreaterThan(0);
    expect(body.data.expandableKpis).toBeLessThanOrEqual(body.data.totalKpis);
    expect(body.data.coveragePercent).toBeGreaterThanOrEqual(0);
    expect(body.data.coveragePercent).toBeLessThanOrEqual(100);
  });
});
