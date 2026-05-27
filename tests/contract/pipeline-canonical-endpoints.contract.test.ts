import { authGet, loginAndGetToken, unauthenticatedPost } from './_helpers';

describe('pipeline canonical endpoint aliases', () => {
  let token: string;

  beforeAll(async () => {
    token = await loginAndGetToken();
  });

  test('POST /api/pipeline/refresh enforces auth (non-mutating)', async () => {
    const response = await unauthenticatedPost('/api/pipeline/refresh', {
      disableSslVerify: true,
    });
    expect(response.status).toBe(401);
  });

  test('GET /api/dashboard/current is reachable', async () => {
    const response = await authGet('/api/dashboard/current', token);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toBeDefined();
  });

  test('GET /api/pipeline/status/:executionId returns 404 for unknown run', async () => {
    const response = await authGet('/api/pipeline/status/00000000-0000-0000-0000-000000000000', token);
    expect(response.status).toBe(404);
  });
});
