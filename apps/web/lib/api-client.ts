'use client';

// Helper to read AuthContext from localStorage and extract tenant/user info
function getContextHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window === 'undefined') return headers;

  // Try auth_context first (written on login after the fix)
  const authContextJson = localStorage.getItem('auth_context');
  if (authContextJson) {
    try {
      const authContext = JSON.parse(authContextJson);
      if (authContext.tenantId) headers['x-tenant-id'] = authContext.tenantId;
      if (authContext.userId) headers['x-user-id'] = authContext.userId;
      if (authContext.role) headers['x-user-role'] = authContext.role;
      if (Object.keys(headers).length === 3) return headers;
    } catch {
      // Fall through to user key
    }
  }

  // Fallback: read from the 'user' key (written directly by login page)
  const userJson = localStorage.getItem('user');
  if (userJson) {
    try {
      const user = JSON.parse(userJson);
      if (user.tenantId) headers['x-tenant-id'] = user.tenantId;
      if (user.id) headers['x-user-id'] = user.id;
      if (user.role) headers['x-user-role'] = user.role;
    } catch {
      // Silently ignore parse errors
    }
  }

  return headers;
}

// Single-flight refresh: every 401 handler awaits the same refresh promise so
// only ONE /api/auth/refresh call goes out at a time. Without this guard,
// parallel fetches (cache-status poll + job-stream SSE + executive-summary)
// all hit 401 the instant the 15-min access token expires, each independently
// calls /refresh, the first rotates the refresh cookie, and every subsequent
// call fails with the now-revoked token → forced redirect to /login mid-run.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!r.ok) return null;
      const body = await r.json();
      const newToken: string | undefined = body?.data?.accessToken || body?.accessToken;
      if (!newToken) return null;
      localStorage.setItem('access_token', newToken);
      return newToken;
    } catch {
      return null;
    } finally {
      // Release the gate on a microtask so any 401 that lost the race to enter
      // this function still finds the in-flight promise and shares its result.
      setTimeout(() => { refreshInFlight = null; }, 0);
    }
  })();
  return refreshInFlight;
}

// Authenticated fetch — auto-attaches Bearer token + context headers, auto-refreshes on 401
export async function apiFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const contextHeaders = getContextHeaders();

  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  Object.entries(contextHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
  if (!headers.has('Content-Type') && !(init?.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  let res = await fetch(input, { ...init, headers });

  // Auto-refresh on 401 (single-flight; concurrent 401s share one refresh)
  if (res.status === 401 && token) {
    const accessToken = await refreshAccessToken();
    if (accessToken) {
      const retryHeaders = new Headers(init?.headers);
      retryHeaders.set('Authorization', `Bearer ${accessToken}`);
      Object.entries(contextHeaders).forEach(([key, value]) => {
        retryHeaders.set(key, value);
      });
      if (!retryHeaders.has('Content-Type') && !(init?.body instanceof FormData)) {
        retryHeaders.set('Content-Type', 'application/json');
      }
      res = await fetch(input, { ...init, headers: retryHeaders });
    } else {
      // Refresh genuinely failed (not just a race) — clear and redirect
      localStorage.removeItem('access_token');
      localStorage.removeItem('auth_context');
      if (typeof window !== 'undefined') window.location.href = '/login';
    }
  }

  return res;
}
