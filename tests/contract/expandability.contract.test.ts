import { authGet, loginAndGetToken } from './_helpers';

describe('Contract: KPI expandability coverage', () => {
  test('explainability payload supports safe expandability metadata rendering', async () => {
    const token = await loginAndGetToken();
    const res = await authGet('/api/executive-summary/explain', token);

    expect([200, 503]).toContain(res.status);
    const body = await res.json() as any;

    if (res.status === 503) return;

    expect(Array.isArray(body.data)).toBe(true);
    for (const row of body.data as any[]) {
      expect(row).toHaveProperty('formulaExpression');
      expect(row).toHaveProperty('inputs');
      expect(row).toHaveProperty('sourceTable');
      expect(row).toHaveProperty('updatedAt');
      expect(row).toHaveProperty('confidence');
      expect(row).toHaveProperty('computedValue');
    }
  });
});
