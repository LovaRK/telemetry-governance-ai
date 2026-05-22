import { authGet, authPost, loginAndGetToken } from './_helpers';

describe('Contract: chart explainability toggle state', () => {
  test('chart mode follows same persisted explainability toggle state', async () => {
    const token = await loginAndGetToken();

    const off = await authPost('/api/settings/explainability', token, { explainabilityMode: false });
    expect(off.status).toBe(200);
    const offGet = await authGet('/api/settings/explainability', token);
    expect(offGet.status).toBe(200);
    const offBody = await offGet.json() as any;
    expect(Boolean(offBody?.data?.explainabilityMode)).toBe(false);

    const on = await authPost('/api/settings/explainability', token, { explainabilityMode: true });
    expect(on.status).toBe(200);
    const onGet = await authGet('/api/settings/explainability', token);
    expect(onGet.status).toBe(200);
    const onBody = await onGet.json() as any;
    expect(Boolean(onBody?.data?.explainabilityMode)).toBe(true);
  });
});
