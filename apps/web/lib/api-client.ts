'use client';

// Authenticated fetch — auto-attaches Bearer token, auto-refreshes on 401
export async function apiFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;

  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && !(init?.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  let res = await fetch(input, { ...init, headers });

  // Auto-refresh on 401
  if (res.status === 401 && token) {
    const refreshRes = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (refreshRes.ok) {
      const refreshBody = await refreshRes.json();
      const accessToken = refreshBody?.data?.accessToken || refreshBody?.accessToken;
      if (!accessToken) {
        throw new Error('Refresh succeeded but no access token returned');
      }
      localStorage.setItem('access_token', accessToken);

      const retryHeaders = new Headers(init?.headers);
      retryHeaders.set('Authorization', `Bearer ${accessToken}`);
      if (!retryHeaders.has('Content-Type') && !(init?.body instanceof FormData)) {
        retryHeaders.set('Content-Type', 'application/json');
      }
      res = await fetch(input, { ...init, headers: retryHeaders });
    } else {
      // Refresh failed — redirect to login
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      if (typeof window !== 'undefined') window.location.href = '/login';
    }
  }

  return res;
}
