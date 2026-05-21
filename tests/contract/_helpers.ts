export const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3002';

export async function loginAndGetToken() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@bitso.com', password: 'Admin@12345' }),
  });

  if (!res.ok) {
    throw new Error(`Login failed: ${res.status}`);
  }

  const body = await res.json();
  const token = body?.data?.accessToken;
  if (!token) {
    throw new Error('Missing access token in login response');
  }
  return token as string;
}

export async function authGet(path: string, token: string) {
  return fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}
