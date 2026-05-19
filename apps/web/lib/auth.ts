import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query } from '@core/database/connection';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'datasensai-dev-secret-change-in-production';
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface JWTPayload {
  sub: string;       // user_id
  tenantId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export function signAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
}

export async function validateCredentials(
  email: string,
  password: string
): Promise<{ user: any; tenant: any } | null> {
  const result = await query(
    `SELECT u.*, t.slug as tenant_slug, t.name as tenant_name
     FROM users u
     JOIN tenants t ON t.id = u.tenant_id
     WHERE u.email = $1 AND t.tenant_status = 'active'
     LIMIT 1`,
    [email]
  );

  const user = result.rows[0];
  if (!user) return null;

  if (user.is_locked && user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new Error('Account locked. Try again later.');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    await query(
      `UPDATE users SET login_attempts = login_attempts + 1,
       is_locked = (login_attempts + 1 >= 5),
       locked_until = CASE WHEN login_attempts + 1 >= 5 THEN NOW() + INTERVAL '30 minutes' ELSE locked_until END
       WHERE id = $1`,
      [user.id]
    );
    return null;
  }

  // Reset failed attempts on success
  await query(`UPDATE users SET login_attempts = 0, is_locked = false, last_login = NOW() WHERE id = $1`, [user.id]);
  return { user, tenant: { id: user.tenant_id, slug: user.tenant_slug, name: user.tenant_name } };
}

export async function createRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(64).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt]
  );

  return token;
}

export async function rotateRefreshToken(
  oldToken: string
): Promise<{ accessToken: string; refreshToken: string; user: JWTPayload } | null> {
  const hash = crypto.createHash('sha256').update(oldToken).digest('hex');

  const result = await query(
    `SELECT rt.*, u.email, u.role, u.tenant_id
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1 AND rt.is_revoked = false AND rt.expires_at > NOW()`,
    [hash]
  );

  const row = result.rows[0];
  if (!row) return null;

  // Revoke old token
  await query(`UPDATE refresh_tokens SET is_revoked = true WHERE id = $1`, [row.id]);

  const payload: JWTPayload = {
    sub: row.user_id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role,
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = await createRefreshToken(row.user_id);

  return { accessToken, refreshToken, user: payload };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await query(`UPDATE refresh_tokens SET is_revoked = true WHERE token_hash = $1`, [hash]);
}

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}
