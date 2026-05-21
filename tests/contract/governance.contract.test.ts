import { authGet, loginAndGetToken } from './_helpers';

describe('Contract: governance endpoints', () => {
  test('cache-coherence + mutation-lifecycle return stable shape', async () => {
    const token = await loginAndGetToken();

    const coherence = await authGet('/api/governance/cache-coherence?limit=10', token);
    expect(coherence.status).toBe(200);
    const cBody = await coherence.json() as any;
    expect(typeof cBody.data.summary).toBe('object');
    expect(Array.isArray(cBody.data.records)).toBe(true);
    expect(typeof cBody.meta.traceId).toBe('string');

    const lifecycle = await authGet('/api/governance/mutation-lifecycle?limit=10', token);
    expect(lifecycle.status).toBe(200);
    const lBody = await lifecycle.json() as any;
    expect(typeof lBody.data.summary).toBe('object');
    expect(Array.isArray(lBody.data.events)).toBe(true);
    expect(typeof lBody.meta.traceId).toBe('string');
  });
});
