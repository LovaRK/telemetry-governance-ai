export const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3002';
export const TEST_TENANT_ID = process.env.TEST_TENANT_ID || '550e8400-e29b-41d4-a716-446655440000';

export async function loginAndGetToken() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@bitso.com', password: 'Admin@12345' }),
  });

  if (!res.ok) {
    throw new Error(`Login failed: ${res.status}`);
  }

  const body = await res.json() as any;
  const token = body?.data?.accessToken;
  if (!token) {
    throw new Error('Missing access token in login response');
  }
  return token as string;
}

export async function authGet(path: string, token: string, tenantId?: string) {
  return fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-tenant-id': tenantId || TEST_TENANT_ID,
      'x-user-id': 'test-user',
      'x-user-role': 'admin',
    },
  });
}

export async function authPost(path: string, token: string, body: any, tenantId?: string) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-tenant-id': tenantId || TEST_TENANT_ID,
      'x-user-id': 'test-user',
      'x-user-role': 'admin',
    },
    body: JSON.stringify(body),
  });
}

export async function unauthenticatedGet(path: string) {
  return fetch(`${BASE_URL}${path}`, {
    headers: {},
  });
}

export async function unauthenticatedPost(path: string, body: any) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
