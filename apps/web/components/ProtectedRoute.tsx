'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'admin' | 'editor' | 'viewer';
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const router = useRouter();
  const { isAuthenticated, loading, user } = useAuth();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, loading, router]);

  useEffect(() => {
    if (!loading && isAuthenticated && requiredRole && user) {
      const roles = ['viewer', 'editor', 'admin'];
      const userRoleIndex = roles.indexOf(user.role);
      const requiredRoleIndex = roles.indexOf(requiredRole);

      if (userRoleIndex < requiredRoleIndex) {
        router.push('/');
      }
    }
  }, [isAuthenticated, loading, user, requiredRole, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Will redirect to login
  }

  if (requiredRole && user) {
    const roles = ['viewer', 'editor', 'admin'];
    const userRoleIndex = roles.indexOf(user.role);
    const requiredRoleIndex = roles.indexOf(requiredRole);

    if (userRoleIndex < requiredRoleIndex) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <p className="text-slate-600">You don't have permission to access this page</p>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
