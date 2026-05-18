import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { AuthService, TokenPayload } from '../services/auth-service';

export function createAuthRouter(pool: Pool): Router {
  const router = Router();
  const authService = new AuthService(pool);

  /**
   * POST /auth/login
   * Login with email and password, returns access token + refresh token
   */
  router.post('/login', async (req: Request, res: Response) => {
    try {
      const { email, password, tenant_slug } = req.body;

      if (!email || !password || !tenant_slug) {
        return res.status(400).json({
          error: 'Email, password, and tenant_slug are required',
        });
      }

      const ipAddress = req.headers['x-forwarded-for'] as string | undefined;
      const session = await authService.login({ email, password, tenant_slug }, ipAddress);

      // Set refresh token as httpOnly cookie (inaccessible to JavaScript)
      res.cookie('refresh_token', session.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      // Return access token in response body (for Authorization header)
      return res.json({
        user_id: session.user_id,
        tenant_id: session.tenant_id,
        email: session.email,
        name: session.name,
        role: session.role,
        accessToken: session.accessToken,
        accessExpiresAt: session.accessExpiresAt,
      });
    } catch (error) {
      console.error('Login error:', error);
      return res.status(401).json({
        error: (error as Error).message || 'Authentication failed',
      });
    }
  });

  /**
   * POST /auth/refresh
   * Refresh access token using refresh token from httpOnly cookie
   */
  router.post('/refresh', async (req: Request, res: Response) => {
    try {
      const refreshToken = req.cookies?.refresh_token;

      if (!refreshToken) {
        return res.status(401).json({ error: 'No refresh token found' });
      }

      const result = await authService.refreshToken(refreshToken);

      return res.json({
        accessToken: result.accessToken,
        accessExpiresAt: result.accessExpiresAt,
      });
    } catch (error) {
      console.error('Token refresh error:', error);
      res.clearCookie('refresh_token');
      return res.status(401).json({
        error: (error as Error).message || 'Failed to refresh token',
      });
    }
  });

  /**
   * POST /auth/logout
   * Logout and revoke refresh token
   */
  router.post('/logout', async (req: Request, res: Response) => {
    try {
      const refreshToken = req.cookies?.refresh_token;

      if (refreshToken) {
        await authService.logout(refreshToken);
      }

      res.clearCookie('refresh_token');
      return res.json({ success: true });
    } catch (error) {
      console.error('Logout error:', error);
      return res.status(500).json({ error: 'Logout failed' });
    }
  });

  /**
   * GET /auth/me
   * Get current user info from access token
   */
  router.get('/me', async (req: Request, res: Response) => {
    try {
      const accessToken = req.headers.authorization?.split(' ')[1];

      if (!accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const payload = await authService.validateAccessToken(accessToken);

      if (!payload) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      return res.json({
        user_id: payload.user_id,
        email: payload.email,
        role: payload.role,
        tenant_id: payload.tenant_id,
      });
    } catch (error) {
      console.error('Get me error:', error);
      return res.status(401).json({ error: 'Unauthorized' });
    }
  });

  /**
   * POST /auth/change-password
   * Change current user's password
   */
  router.post('/change-password', async (req: Request, res: Response) => {
    try {
      const accessToken = req.headers.authorization?.split(' ')[1];

      if (!accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const payload = await authService.validateAccessToken(accessToken);

      if (!payload) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { old_password, new_password } = req.body;

      if (!old_password || !new_password) {
        return res.status(400).json({
          error: 'Old password and new password are required',
        });
      }

      if (new_password.length < 8) {
        return res.status(400).json({
          error: 'New password must be at least 8 characters',
        });
      }

      await authService.changePassword(payload.user_id, old_password, new_password);

      return res.json({ success: true });
    } catch (error) {
      console.error('Change password error:', error);
      return res.status(400).json({
        error: (error as Error).message || 'Failed to change password',
      });
    }
  });

  /**
   * POST /auth/register (admin only)
   * Create a new user for a tenant
   */
  router.post('/register', async (req: Request, res: Response) => {
    try {
      const accessToken = req.headers.authorization?.split(' ')[1];

      if (!accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const payload = await authService.validateAccessToken(accessToken);

      if (!payload || payload.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden - admin only' });
      }

      const { email, password, name, role } = req.body;

      if (!email || !password || !name) {
        return res.status(400).json({
          error: 'Email, password, and name are required',
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          error: 'Password must be at least 8 characters',
        });
      }

      const user = await authService.createUser(payload.tenant_id, email, password, name, role || 'viewer');

      // Log this action
      await pool.query(
        `
        SELECT log_tenant_action($1, $2, 'USER_CREATED', 'users', $3, $4, $5)
        `,
        [
          payload.tenant_id,
          payload.user_id,
          user.user_id,
          JSON.stringify({ email: user.email, role }),
          req.headers['x-forwarded-for'] || null,
        ]
      );

      return res.status(201).json(user);
    } catch (error) {
      console.error('Register error:', error);
      return res.status(400).json({
        error: (error as Error).message || 'Failed to create user',
      });
    }
  });

  /**
   * Middleware to verify access token (Bearer token from Authorization header)
   */
  function verifyTokenMiddleware(req: Request, res: Response, next: Function) {
    try {
      const accessToken = req.headers.authorization?.split(' ')[1];

      if (!accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const payload = authService.verifyToken(accessToken);
      (req as any).user = payload;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // Export middleware for use in other routes
  (router as any).verifyToken = verifyTokenMiddleware;

  return router;
}
