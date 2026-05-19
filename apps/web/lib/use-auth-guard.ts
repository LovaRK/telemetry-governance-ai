'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Client-side auth guard.
 * Pages cannot carry Authorization headers on navigation, so the middleware
 * only enforces JWT on /api/ routes. This hook handles page-level auth:
 * if no valid access_token in localStorage → redirect to /login.
 */
export function useAuthGuard() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      // If token expires within 30s, proactively refresh
      const expiresIn = payload.exp - Date.now() / 1000;
      if (expiresIn < 30) {
        fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (data?.accessToken) {
              localStorage.setItem('access_token', data.accessToken);
            } else {
              localStorage.removeItem('access_token');
              localStorage.removeItem('user');
              router.replace('/login');
            }
          })
          .catch(() => {
            localStorage.removeItem('access_token');
            router.replace('/login');
          });
      }
    } catch {
      // Malformed token
      localStorage.removeItem('access_token');
      router.replace('/login');
    }
  }, [router]);
}
