import { BASE_URL, loginAndGetToken } from '../contract/_helpers';

describe('Pipeline: job-stream', () => {
  test('can enqueue a pipeline run and receive runId', async () => {
    const token = await loginAndGetToken();
    const res = await fetch(`${BASE_URL}/api/job-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ source: 'splunk', mode: 'live' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.runId).toEqual(expect.any(String));
    expect(body.meta.traceId).toEqual(expect.any(String));
  });
});
