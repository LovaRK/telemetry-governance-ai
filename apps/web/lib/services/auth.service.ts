/**
 * AUTHENTICATION SERVICE — User Authentication and Authorization
 * Single Responsibility: Only auth operations
 */

import { IAPIClient } from '../api/client';
import { AuthContext, UnauthorizedError, AppError } from '../types';

const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_CONTEXT_KEY = 'auth_context';

export interface IAuthService {
  login(email: string, password: string): Promise<AuthContext>;
  logout(): void;
  getAuthContext(): AuthContext | null;
  isAuthenticated(): boolean;
  hasPermission(permission: string): boolean;
  hasRole(role: string): boolean;
  refreshToken(): Promise<AuthContext>;
}

export class AuthService implements IAuthService {
  constructor(private apiClient: IAPIClient) {
    this.loadStoredContext();
  }

  private authContext: AuthContext | null = null;

  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<AuthContext> {
    this.validateEmail(email);
    if (!password || password.length < 6) {
      throw new AppError('INVALID_PASSWORD', 'Password must be at least 6 characters', 400);
    }

    try {
      const response = await this.apiClient.post<any>('/api/auth/login', {
        email,
        password,
      });

      // Map login response to AuthContext
      const context: AuthContext = {
        userId: response.user.id,
        email: response.user.email,
        role: response.user.role,
        tenantId: response.user.tenantId,
        permissions: this.derivePermissions(response.user.role),
        timestamp: Date.now(),
        token: response.accessToken,
      };

      this.setAuthContext(context);
      return context;
    } catch (error) {
      throw this.mapError(error, 'Login failed');
    }
  }

  /**
   * Logout and clear stored context
   */
  logout(): void {
    this.authContext = null;
    this.clearStoredContext();
  }

  /**
   * Get current auth context
   */
  getAuthContext(): AuthContext | null {
    return this.authContext;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.authContext !== null;
  }

  /**
   * Check if user has specific permission
   */
  hasPermission(permission: string): boolean {
    if (!this.authContext) return false;
    if (this.authContext.role === 'admin') return true; // Admin has all permissions
    return this.authContext.permissions.includes(permission);
  }

  /**
   * Check if user has minimum role
   */
  hasRole(requiredRole: string): boolean {
    if (!this.authContext) return false;

    const roleHierarchy = ['viewer', 'analyst', 'operator', 'admin'];
    const userRoleIndex = roleHierarchy.indexOf(this.authContext.role);
    const requiredRoleIndex = roleHierarchy.indexOf(requiredRole);

    return userRoleIndex >= requiredRoleIndex;
  }

  /**
   * Refresh authentication token
   */
  async refreshToken(): Promise<AuthContext> {
    if (!this.authContext?.token) {
      throw new UnauthorizedError('No active session to refresh');
    }

    try {
      const response = await this.apiClient.post<any>('/api/auth/refresh', {
        token: this.authContext.token,
      });

      // Map refresh response to AuthContext
      const context: AuthContext = {
        userId: response.user.id,
        email: response.user.email,
        role: response.user.role,
        tenantId: response.user.tenantId,
        permissions: this.derivePermissions(response.user.role),
        timestamp: Date.now(),
        token: response.accessToken,
      };

      this.setAuthContext(context);
      return context;
    } catch (error) {
      this.logout(); // Clear context on refresh failure
      throw this.mapError(error, 'Token refresh failed');
    }
  }

  // ========================================================================
  // PRIVATE STORAGE & UTILITY METHODS
  // ========================================================================

  /**
   * Load context from localStorage if available
   */
  private loadStoredContext(): void {
    if (typeof window === 'undefined') return;

    const stored = localStorage.getItem(AUTH_CONTEXT_KEY);
    if (stored) {
      try {
        this.authContext = JSON.parse(stored);
      } catch {
        this.clearStoredContext();
      }
    }
  }

  /**
   * Save context to localStorage
   */
  private setAuthContext(context: AuthContext): void {
    this.authContext = context;

    if (typeof window !== 'undefined') {
      localStorage.setItem(AUTH_TOKEN_KEY, context.token);
      localStorage.setItem(AUTH_CONTEXT_KEY, JSON.stringify(context));
    }
  }

  /**
   * Clear all stored auth data
   */
  private clearStoredContext(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_CONTEXT_KEY);
    }
  }

  /**
   * Validate email format
   */
  private validateEmail(email: string): void {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new AppError('INVALID_EMAIL', 'Invalid email format', 400);
    }
  }

  /**
   * Derive permissions from role
   */
  private derivePermissions(role: string): string[] {
    const permissionMap: Record<string, string[]> = {
      admin: ['read', 'write', 'delete', 'configure', 'manage_users'],
      analyst: ['read', 'write'],
      operator: ['read', 'write'],
      viewer: ['read'],
    };
    return permissionMap[role] || [];
  }

  /**
   * Map errors to AppError
   */
  private mapError(error: any, defaultMessage: string): AppError {
    if (error instanceof AppError) {
      return error;
    }
    if (error instanceof Error) {
      return new AppError('AUTH_ERROR', error.message, 500);
    }
    return new AppError('UNKNOWN_ERROR', defaultMessage, 500);
  }
}

export function createAuthService(apiClient: IAPIClient): IAuthService {
  return new AuthService(apiClient);
}
