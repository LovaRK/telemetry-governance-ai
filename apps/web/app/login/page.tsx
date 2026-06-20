'use client';

import { useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const email = emailRef.current?.value || '';
      const password = passwordRef.current?.value || '';

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const response = await res.json();

      if (!res.ok) {
        setError(response.error || 'Login failed');
        return;
      }

      // Store access token — used by all API calls
      localStorage.setItem('access_token', response.data.accessToken);
      localStorage.setItem('user', JSON.stringify(response.data.user));

      // Store auth_context with tenant info — required for context headers in apiFetch
      const permissionMap: Record<string, string[]> = {
        admin: ['read', 'write', 'delete', 'configure', 'manage_users'],
        analyst: ['read', 'write'],
        operator: ['read', 'write'],
        viewer: ['read'],
      };
      const authContext = {
        userId: response.data.user.id,
        email: response.data.user.email,
        role: response.data.user.role,
        tenantId: response.data.user.tenantId,
        permissions: permissionMap[response.data.user.role] || [],
        timestamp: Date.now(),
        token: response.data.accessToken,
      };
      localStorage.setItem('auth_context', JSON.stringify(authContext));

      const next = searchParams?.get('next') || '/';
      router.push(next);
    } catch {
      setError('Network error. Check server is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#0f172a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#1e293b', borderRadius: 12, padding: '2.5rem',
        width: '100%', maxWidth: 400, border: '1px solid #334155',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1rem', fontSize: 22, fontWeight: 700, color: '#fff',
          }}>d</div>
          <h1 style={{ color: '#f1f5f9', fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>datasensAI</h1>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: '0.5rem 0 0' }}>Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="login-email" style={{ display: 'block', color: '#94a3b8', fontSize: '0.8rem', marginBottom: 6, fontWeight: 500 }}>
              EMAIL
            </label>
            <input
              ref={emailRef}
              id="login-email"
              type="email"
              defaultValue="admin@bitso.com"
              required
              suppressHydrationWarning
              autoComplete="email"
              style={{
                width: '100%', padding: '0.625rem 0.75rem',
                background: '#0f172a', border: '1px solid #334155',
                borderRadius: 6, color: '#f1f5f9', fontSize: '0.9rem',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label htmlFor="login-password" style={{ display: 'block', color: '#94a3b8', fontSize: '0.8rem', marginBottom: 6, fontWeight: 500 }}>
              PASSWORD
            </label>
            <input
              ref={passwordRef}
              id="login-password"
              type="password"
              defaultValue="Admin@12345"
              required
              placeholder="Enter password"
              suppressHydrationWarning
              autoComplete="current-password"
              style={{
                width: '100%', padding: '0.625rem 0.75rem',
                background: '#0f172a', border: '1px solid #334155',
                borderRadius: 6, color: '#f1f5f9', fontSize: '0.9rem',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <div style={{
              padding: '0.625rem 0.75rem', background: '#ef444420',
              border: '1px solid #ef4444', borderRadius: 6,
              color: '#fca5a5', fontSize: '0.875rem', marginBottom: '1rem',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '0.75rem',
              background: loading ? '#4c1d95' : '#6366f1',
              color: '#fff', border: 'none', borderRadius: 6,
              fontSize: '0.9rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s',
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
