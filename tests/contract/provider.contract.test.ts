import { authGet, authPost, loginAndGetToken } from './_helpers';

describe('Contract: ExplainabilityProvider persistence API', () => {
  test('toggle -> persist -> reload returns same explainability state', async () => {
    const token = await loginAndGetToken();

    const currentRes = await authGet('/api/settings/explainability', token);
    expect(currentRes.status).toBe(200);
    const currentBody = await currentRes.json() as any;
    const initial = Boolean(currentBody?.data?.explainabilityMode ?? false);

    const next = !initial;
    const setRes = await authPost('/api/settings/explainability', token, { explainabilityMode: next });
    expect(setRes.status).toBe(200);

    const verifyRes = await authGet('/api/settings/explainability', token);
    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json() as any;
    expect(Boolean(verifyBody?.data?.explainabilityMode)).toBe(next);

    // Restore original state to avoid polluting later tests
    const restoreRes = await authPost('/api/settings/explainability', token, { explainabilityMode: initial });
    expect(restoreRes.status).toBe(200);
  });
});
