import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export interface User {
  user_id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'editor' | 'viewer';
  tenant_id: string;
}

export interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
}

export function useAuth() {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
    isAuthenticated: false,
  });

  // Check authentication on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch('/api/auth?action=me');

      if (!response.ok) {
        setState({
          user: null,
          loading: false,
          error: null,
          isAuthenticated: false,
        });
        return;
      }

      const user = await response.json();
      setState({
        user,
        loading: false,
        error: null,
        isAuthenticated: true,
      });
    } catch (error) {
      setState({
        user: null,
        loading: false,
        error: (error as Error).message,
        isAuthenticated: false,
      });
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string, tenant_slug: string) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const response = await fetch('/api/auth?action=login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, tenant_slug }),
        });

        if (!response.ok) {
          const error = await response.json();
          setState({
            user: null,
            loading: false,
            error: error.error || 'Login failed',
            isAuthenticated: false,
          });
          return false;
        }

        const user = await response.json();
        setState({
          user,
          loading: false,
          error: null,
          isAuthenticated: true,
        });

        return true;
      } catch (error) {
        setState({
          user: null,
          loading: false,
          error: (error as Error).message,
          isAuthenticated: false,
        });
        return false;
      }
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth?action=logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout error:', error);
    }

    setState({
      user: null,
      loading: false,
      error: null,
      isAuthenticated: false,
    });

    router.push('/login');
  }, [router]);

  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      try {
        const response = await fetch('/api/auth?action=change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to change password');
        }

        return true;
      } catch (error) {
        throw error;
      }
    },
    []
  );

  return {
    ...state,
    login,
    logout,
    changePassword,
    checkAuth,
  };
}
