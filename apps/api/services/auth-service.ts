import { Pool, PoolClient } from 'pg';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRY = '7d'; // 7 days

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
  token: string;
  expires_at: string;
}

export class AuthService {
  constructor(private pool: Pool) {}

  /**
   * Authenticate user with email and password
   * Returns JWT token and session info
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

      // Create session
      const session = await this.createSession(user.id, tenant_id, ipAddress, client);

      return {
        user_id: user.id,
        tenant_id,
        email: user.email,
        name: user.name,
        role: user.role,
        token: session.token,
        expires_at: session.expires_at,
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
   * Verify JWT token and return decoded payload
   */
  verifyToken(token: string): TokenPayload {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
      return decoded;
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Validate session token (check database)
   */
  async validateSession(token: string): Promise<AuthSession | null> {
    const result = await this.pool.query(
      `
      SELECT
        us.id,
        us.user_id,
        us.tenant_id,
        us.expires_at,
        u.email,
        u.name,
        u.role
      FROM user_sessions us
      JOIN users u ON us.user_id = u.id
      WHERE us.token = $1
        AND us.expires_at > NOW()
        AND NOT us.is_revoked
        AND NOT u.is_locked
      `,
      [token]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const session = result.rows[0];

    // Update last activity
    await this.pool.query(
      `UPDATE user_sessions SET last_activity_at = NOW() WHERE id = $1`,
      [session.id]
    );

    return {
      user_id: session.user_id,
      tenant_id: session.tenant_id,
      email: session.email,
      name: session.name,
      role: session.role,
      token,
      expires_at: session.expires_at,
    };
  }

  /**
   * Logout: revoke session token
   */
  async logout(token: string): Promise<void> {
    await this.pool.query(
      `UPDATE user_sessions SET is_revoked = true WHERE token = $1`,
      [token]
    );
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

  // ============ PRIVATE HELPER METHODS ============

  private async createSession(
    user_id: string,
    tenant_id: string,
    ipAddress: string | undefined,
    client: PoolClient
  ): Promise<{ token: string; expires_at: string }> {
    // Create JWT token
    const tokenPayload: TokenPayload = {
      user_id,
      tenant_id,
      email: '', // Will be set during verification
      role: '', // Will be set during verification
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRY });

    // Store session in database
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await client.query(
      `
      INSERT INTO user_sessions (user_id, tenant_id, token, ip_address, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [user_id, tenant_id, token, ipAddress || null, expiresAt]
    );

    return {
      token,
      expires_at: expiresAt.toISOString(),
    };
  }
}
