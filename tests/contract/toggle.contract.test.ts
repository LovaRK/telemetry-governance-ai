import { authGet, authPost, loginAndGetToken } from './_helpers';

describe('Contract: explainability toggle state', () => {
  test('enabled=false and enabled=true are both persisted safely', async () => {
    const token = await loginAndGetToken();

    const setFalse = await authPost('/api/settings/explainability', token, { explainabilityMode: false });
    expect(setFalse.status).toBe(200);
    const getFalse = await authGet('/api/settings/explainability', token);
    expect(getFalse.status).toBe(200);
    const bodyFalse = await getFalse.json() as any;
    expect(Boolean(bodyFalse?.data?.explainabilityMode)).toBe(false);

    const setTrue = await authPost('/api/settings/explainability', token, { explainabilityMode: true });
    expect(setTrue.status).toBe(200);
    const getTrue = await authGet('/api/settings/explainability', token);
    expect(getTrue.status).toBe(200);
    const bodyTrue = await getTrue.json() as any;
    expect(Boolean(bodyTrue?.data?.explainabilityMode)).toBe(true);
  });
});
