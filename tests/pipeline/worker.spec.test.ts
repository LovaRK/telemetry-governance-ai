import { authGet, loginAndGetToken } from '../contract/_helpers';

describe('Pipeline: worker outputs', () => {
  test('queue-health endpoint returns stable structure', async () => {
    const token = await loginAndGetToken();
    const res = await authGet('/api/queue-health?limit=10', token);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.meta.traceId).toBe('string');
  });
});
