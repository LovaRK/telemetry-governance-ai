import { Pool, PoolClient } from 'pg';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { TokenService } from './token-service';

export interface LoginCredentials {
  email: string;
  password: string;
  tenant_slug: string;
}

export interface TokenPayload {
  user_id: string;
  tenant_id: string;
  email: string;
  role: string;
}

export interface AuthSession {
  user_id: string;
  tenant_id: string;
  email: string;
  name: string | null;
  role: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string; // ISO8601
  refreshExpiresAt: string; // ISO8601
}

export interface TokenRefreshResult {
  accessToken: string;
  accessExpiresAt: string;
}

export class AuthService {
  private tokenService: TokenService;

  constructor(private pool: Pool) {
    this.tokenService = new TokenService(pool);
  }

  /**
   * Authenticate user with email and password
   * Returns both short-lived access token and long-lived refresh token
   */
  async login(credentials: LoginCredentials, ipAddress?: string): Promise<AuthSession> {
    const client = await this.pool.connect();

    try {
      // Get tenant
      const tenantResult = await client.query(
        `SELECT id FROM tenants WHERE slug = $1 AND tenant_status = 'active'`,
        [credentials.tenant_slug]
      );

      if (tenantResult.rows.length === 0) {
        throw new Error('Tenant not found or inactive');
      }

      const tenant_id = tenantResult.rows[0].id;

      // Get user
      const userResult = await client.query(
        `
        SELECT id, email, name, password_hash, role, is_locked, locked_until
        FROM users
        WHERE tenant_id = $1 AND email = $2
        `,
        [tenant_id, credentials.email]
      );

      if (userResult.rows.length === 0) {
        throw new Error('Invalid credentials');
      }

      const user = userResult.rows[0];

      // Check if account is locked
      if (user.is_locked) {
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
          throw new Error('Account is locked. Please try again later.');
        } else {
          // Unlock the account
          await client.query(`UPDATE users SET is_locked = false WHERE id = $1`, [user.id]);
        }
      }

      // Verify password
      const passwordValid = await bcrypt.compare(credentials.password, user.password_hash);

      if (!passwordValid) {
        // Increment login attempts
        const newAttempts = user.login_attempts + 1;
        const lockAccount = newAttempts >= 5;
        const lockedUntil = lockAccount ? new Date(Date.now() + 30 * 60 * 1000) : null; // Lock for 30 min

        await client.query(
          `
          UPDATE users
          SET login_attempts = $1, is_locked = $2, locked_until = $3
          WHERE id = $4
          `,
          [newAttempts, lockAccount, lockedUntil, user.id]
        );

        throw new Error('Invalid credentials');
      }

      // Reset login attempts on successful login
      await client.query(
        `UPDATE users SET login_attempts = 0, last_login = NOW() WHERE id = $1`,
        [user.id]
      );

      // Issue token pair via TokenService
      const tokenPair = await this.tokenService.issueTokenPair(
        user.id,
        tenant_id,
        user.email,
        user.role,
        client
      );

      return {
        user_id: user.id,
        tenant_id,
        email: user.email,
        name: user.name,
        role: user.role,
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        accessExpiresAt: tokenPair.accessExpiresAt,
        refreshExpiresAt: tokenPair.refreshExpiresAt,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Create a new user (admin only, for tenant setup)
   */
  async createUser(
    tenant_id: string,
    email: string,
    password: string,
    name: string,
    role: string = 'viewer'
  ): Promise<{ user_id: string; email: string }> {
    try {
      const password_hash = await bcrypt.hash(password, 12);

      const result = await this.pool.query(
        `
        INSERT INTO users (tenant_id, email, name, password_hash, role, auth_provider)
        VALUES ($1, $2, $3, $4, $5, 'local')
        RETURNING id, email
        `,
        [tenant_id, email, name, password_hash, role]
      );

      if (result.rows.length === 0) {
        throw new Error('Failed to create user');
      }

      return {
        user_id: result.rows[0].id,
        email: result.rows[0].email,
      };
    } catch (error) {
      if ((error as any).code === '23505') {
        // Unique constraint violation
        throw new Error('User already exists');
      }
      throw error;
    }
  }

  /**
   * Verify access token (fast, no database lookup)
   * Returns decoded access token payload
   */
  verifyToken(accessToken: string): TokenPayload {
    const decoded = this.tokenService.verifyAccessToken(accessToken);
    return {
      user_id: decoded.user_id,
      tenant_id: decoded.tenant_id,
      email: decoded.email,
      role: decoded.role,
    };
  }

  /**
   * Refresh an access token using a refresh token
   * Returns new access token with updated expiry
   */
  async refreshToken(refreshToken: string): Promise<TokenRefreshResult> {
    return await this.tokenService.refreshAccessToken(refreshToken);
  }

  /**
   * Get current user info from access token
   * Does not require database lookup (info is in JWT)
   */
  async getCurrentUser(accessToken: string): Promise<TokenPayload | null> {
    try {
      const payload = this.tokenService.verifyAccessToken(accessToken);
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Validate access token and return user info
   * Used by middleware to verify requests
   */
  async validateAccessToken(accessToken: string): Promise<TokenPayload | null> {
    return this.getCurrentUser(accessToken);
  }

  /**
   * Logout: revoke refresh token
   * Access token will naturally expire after 15 minutes
   */
  async logout(refreshToken: string): Promise<void> {
    try {
      await this.tokenService.revokeRefreshToken(refreshToken);
    } catch (error) {
      // Token might be invalid or expired, but we still mark as revoked if possible
      console.warn('Error revoking refresh token:', error);
    }
  }

  /**
   * Logout user from all devices
   * Revokes all refresh tokens for a user
   */
  async logoutAllDevices(userId: string, tenantId: string): Promise<void> {
    await this.tokenService.revokeAllUserTokens(userId, tenantId);
  }

  /**
   * Change user password
   */
  async changePassword(user_id: string, oldPassword: string, newPassword: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [user_id]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = result.rows[0];
    const passwordValid = await bcrypt.compare(oldPassword, user.password_hash);

    if (!passwordValid) {
      throw new Error('Current password is incorrect');
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await this.pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [newPasswordHash, user_id]
    );
  }

  /**
   * Reset password (admin function)
   */
  async resetPassword(user_id: string, newPassword: string): Promise<void> {
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await this.pool.query(
      `UPDATE users SET password_hash = $1, login_attempts = 0, is_locked = false, updated_at = NOW() WHERE id = $2`,
      [newPasswordHash, user_id]
    );
  }

}
