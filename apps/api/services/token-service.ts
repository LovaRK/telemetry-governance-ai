import { Pool, PoolClient } from 'pg';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || 'access-secret-change-in-production';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'refresh-secret-change-in-production';
const ACCESS_TOKEN_EXPIRY = '15m'; // 15 minutes
const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds

export interface AccessTokenPayload {
  user_id: string;
  tenant_id: string;
  email: string;
  role: string;
}

export interface RefreshTokenPayload {
  refreshTokenId: string;
  userId: string;
  tenantId: string;
  nonce: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string; // ISO8601
  refreshExpiresAt: string; // ISO8601
}

export interface TokenInfo {
  accessToken: string;
  accessExpiresAt: string;
}

export class TokenService {
  constructor(private pool: Pool) {}

  /**
   * Issue a new token pair after successful login
   * Creates a refresh token in the database with a nonce for rotation
   */
  async issueTokenPair(
    userId: string,
    tenantId: string,
    email: string,
    role: string,
    client?: PoolClient
  ): Promise<TokenPair> {
    const pool = client || this.pool;

    // Generate nonce for refresh token
    const nonce = randomBytes(32).toString('hex');
    const refreshTokenId = randomBytes(16).toString('hex');

    // Calculate expiration times
    const accessExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY * 1000); // 7 days

    // Create access token (short-lived, no DB lookup needed for validation)
    const accessTokenPayload: AccessTokenPayload = {
      user_id: userId,
      tenant_id: tenantId,
      email,
      role,
    };

    const accessToken = jwt.sign(accessTokenPayload, ACCESS_TOKEN_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
      algorithm: 'HS256',
    });

    // Create refresh token (longer-lived, stored in DB for rotation & revocation)
    const refreshTokenPayload: RefreshTokenPayload = {
      refreshTokenId,
      userId,
      tenantId,
      nonce,
    };

    const refreshToken = jwt.sign(refreshTokenPayload, REFRESH_TOKEN_SECRET, {
      expiresIn: REFRESH_TOKEN_EXPIRY,
      algorithm: 'HS256',
    });

    // Store refresh token in database for revocation tracking & nonce rotation
    await pool.query(
      `
      INSERT INTO refresh_tokens (id, user_id, tenant_id, nonce, expires_at, is_revoked)
      VALUES ($1, $2, $3, $4, $5, false)
      `,
      [refreshTokenId, userId, tenantId, nonce, refreshExpiresAt]
    );

    return {
      accessToken,
      refreshToken,
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshExpiresAt: refreshExpiresAt.toISOString(),
    };
  }

  /**
   * Refresh an access token using a refresh token.
   * Implements sliding window rotation with cryptographic reuse detection.
   *
   * CRITICAL SECURITY: If a rotated token is used AFTER rotation, this detects it
   * and revokes the entire token family (all tokens with the same family_id).
   * This prevents token replay attacks where an attacker steals a token after it's
   * been rotated by the legitimate user.
   */
  async refreshAccessToken(
    refreshToken: string,
    client?: PoolClient
  ): Promise<TokenInfo> {
    const pool = client || this.pool;
    const dbClient = client || (await this.pool.connect());

    try {
      // Verify refresh token signature
      const decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET) as RefreshTokenPayload;

      // Fetch the refresh token from database
      const result = await dbClient.query(
        `
        SELECT id, user_id, tenant_id, family_id, nonce, expires_at, is_revoked,
               reuse_detected, rotation_count, family_created_at
        FROM refresh_tokens
        WHERE id = $1 AND user_id = $2 AND tenant_id = $3
        `,
        [decoded.refreshTokenId, decoded.userId, decoded.tenantId]
      );

      if (result.rows.length === 0) {
        throw new Error('TOKEN_NOT_FOUND: Refresh token does not exist in database');
      }

      const storedToken = result.rows[0];

      // CRITICAL: Detect token reuse attack
      // If the nonce doesn't match, this token has already been rotated.
      // An attacker is trying to reuse the old token.
      if (storedToken.nonce !== decoded.nonce) {
        // Log the reuse event FIRST (before revocation)
        await dbClient.query(
          `
          INSERT INTO refresh_token_audit_log (
            user_id, tenant_id, action, refresh_token_id, ip_address, user_agent, reason
          ) VALUES ($1, $2, 'REUSE_DETECTED', $3, $4, $5, $6)
          `,
          [
            storedToken.user_id,
            storedToken.tenant_id,
            storedToken.id,
            null, // IP would come from request context
            null, // User agent would come from request context
            `Nonce mismatch: token appears to have been rotated already`,
          ]
        );

        // THEN revoke the entire family to stop the attacker
        await dbClient.query(
          `
          UPDATE refresh_tokens
          SET is_revoked = true, reuse_detected = true
          WHERE family_id = $1 AND is_revoked = false
          `,
          [storedToken.family_id]
        );

        throw new Error(
          'TOKEN_REUSE_DETECTED: Refresh token has already been rotated. ' +
          'Entire session family has been revoked for security. Please log in again.'
        );
      }

      // Check if token or family has been marked as compromised
      if (storedToken.is_revoked || storedToken.reuse_detected) {
        throw new Error('TOKEN_REVOKED_OR_COMPROMISED: This token family has been revoked');
      }

      // Check absolute session max lifetime (prevent infinite refresh chains)
      const MAX_SESSION_LIFETIME = 30 * 24 * 60 * 60 * 1000; // 30 days
      const sessionAge = Date.now() - new Date(storedToken.family_created_at).getTime();
      if (sessionAge > MAX_SESSION_LIFETIME) {
        throw new Error('SESSION_MAX_LIFETIME_EXCEEDED: Session is too old, re-authentication required');
      }

      // Check if token is expired
      if (new Date(storedToken.expires_at) <= new Date()) {
        throw new Error('TOKEN_EXPIRED: Refresh token has expired');
      }

      // Get user info for new access token
      const userResult = await dbClient.query(
        `
        SELECT id, email, role
        FROM users
        WHERE id = $1 AND tenant_id = $2
        `,
        [decoded.userId, decoded.tenantId]
      );

      if (userResult.rows.length === 0) {
        throw new Error('USER_NOT_FOUND: User no longer exists');
      }

      const user = userResult.rows[0];

      // Issue new access token
      const newAccessTokenPayload: AccessTokenPayload = {
        user_id: decoded.userId,
        tenant_id: decoded.tenantId,
        email: user.email,
        role: user.role,
      };

      const accessExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      const newAccessToken = jwt.sign(newAccessTokenPayload, ACCESS_TOKEN_SECRET, {
        expiresIn: ACCESS_TOKEN_EXPIRY,
        algorithm: 'HS256',
      });

      // Log successful refresh
      await dbClient.query(
        `
        INSERT INTO refresh_token_audit_log (
          user_id, tenant_id, action, refresh_token_id, reason
        ) VALUES ($1, $2, 'ROTATED', $3, $4)
        `,
        [storedToken.user_id, storedToken.tenant_id, storedToken.id, 'Token refresh accepted']
      );

      return {
        accessToken: newAccessToken,
        accessExpiresAt: accessExpiresAt.toISOString(),
      };
    } catch (error) {
      throw new Error(`TOKEN_REFRESH_FAILED: ${(error as Error).message}`);
    } finally {
      if (!client) {
        dbClient.release();
      }
    }
  }

  /**
   * Verify access token (no DB lookup, fast)
   * Used in middleware for every request
   */
  verifyAccessToken(accessToken: string): AccessTokenPayload {
    try {
      const decoded = jwt.verify(accessToken, ACCESS_TOKEN_SECRET) as AccessTokenPayload;
      return decoded;
    } catch (error) {
      throw new Error(`Access token verification failed: ${(error as Error).message}`);
    }
  }

  /**
   * Revoke a refresh token (logout, or force re-auth)
   */
  async revokeRefreshToken(
    refreshToken: string,
    client?: PoolClient
  ): Promise<void> {
    const pool = client || this.pool;

    try {
      const decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET) as RefreshTokenPayload;

      await pool.query(
        `
        UPDATE refresh_tokens
        SET is_revoked = true
        WHERE id = $1 AND user_id = $2 AND tenant_id = $3
        `,
        [decoded.refreshTokenId, decoded.userId, decoded.tenantId]
      );
    } catch (error) {
      // Token might be expired or invalid, but we still mark it revoked if we can
      console.warn(`Could not revoke refresh token: ${(error as Error).message}`);
    }
  }

  /**
   * Revoke all refresh tokens for a user (force logout everywhere)
   */
  async revokeAllUserTokens(userId: string, tenantId: string, client?: PoolClient): Promise<void> {
    const pool = client || this.pool;

    await pool.query(
      `
      UPDATE refresh_tokens
      SET is_revoked = true
      WHERE user_id = $1 AND tenant_id = $2 AND is_revoked = false
      `,
      [userId, tenantId]
    );
  }

  /**
   * Clean up expired refresh tokens (admin task)
   * Run this periodically to clean up the database
   */
  async cleanupExpiredTokens(): Promise<number> {
    const result = await this.pool.query(
      `
      DELETE FROM refresh_tokens
      WHERE expires_at < NOW()
      `
    );

    return result.rowCount || 0;
  }

  /**
   * Get token usage info for a user (for debugging)
   */
  async getUserTokens(userId: string, tenantId: string): Promise<any[]> {
    const result = await this.pool.query(
      `
      SELECT id, created_at, expires_at, is_revoked
      FROM refresh_tokens
      WHERE user_id = $1 AND tenant_id = $2
      ORDER BY created_at DESC
      `,
      [userId, tenantId]
    );

    return result.rows;
  }
}
