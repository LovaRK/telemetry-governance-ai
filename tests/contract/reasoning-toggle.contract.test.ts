import { authGet, authPost, loginAndGetToken } from './_helpers';

describe('Contract: reasoning visibility toggle state', () => {
  test('reasoning visibility follows persisted explainability toggle state', async () => {
    const token = await loginAndGetToken();
    const userId = 'reasoning-toggle-contract-user';

    const off = await authPost('/api/settings/explainability', token, { explainabilityMode: false }, undefined, userId);
    expect(off.status).toBe(200);
    const offGet = await authGet('/api/settings/explainability', token, undefined, userId);
    expect(offGet.status).toBe(200);
    const offBody = await offGet.json() as any;
    expect(Boolean(offBody?.data?.explainabilityMode)).toBe(false);

    const on = await authPost('/api/settings/explainability', token, { explainabilityMode: true }, undefined, userId);
    expect(on.status).toBe(200);
    const onGet = await authGet('/api/settings/explainability', token, undefined, userId);
    expect(onGet.status).toBe(200);
    const onBody = await onGet.json() as any;
    expect(Boolean(onBody?.data?.explainabilityMode)).toBe(true);
  });
});

jest.setTimeout(20000);
