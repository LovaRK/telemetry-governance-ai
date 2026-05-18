import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { AuthService, TokenPayload } from '../services/auth-service';

export function createAuthRouter(pool: Pool): Router {
  const router = Router();
  const authService = new AuthService(pool);

  /**
   * POST /auth/login
   * Login with email and password
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

      // Set token as httpOnly cookie
      res.cookie('auth_token', session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      return res.json(session);
    } catch (error) {
      console.error('Login error:', error);
      return res.status(401).json({
        error: (error as Error).message || 'Authentication failed',
      });
    }
  });

  /**
   * POST /auth/logout
   * Logout and revoke session
   */
  router.post('/logout', async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];

      if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      await authService.logout(token);

      res.clearCookie('auth_token');
      return res.json({ success: true });
    } catch (error) {
      console.error('Logout error:', error);
      return res.status(500).json({ error: 'Logout failed' });
    }
  });

  /**
   * GET /auth/me
   * Get current user info
   */
  router.get('/me', async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.split(' ')[1] || req.cookies?.auth_token;

      if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const session = await authService.validateSession(token);

      if (!session) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      return res.json({
        user_id: session.user_id,
        email: session.email,
        name: session.name,
        role: session.role,
        tenant_id: session.tenant_id,
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
      const token = req.headers.authorization?.split(' ')[1];

      if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const session = await authService.validateSession(token);

      if (!session) {
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

      await authService.changePassword(session.user_id, old_password, new_password);

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
      const token = req.headers.authorization?.split(' ')[1];

      if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const session = await authService.validateSession(token);

      if (!session || session.role !== 'admin') {
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

      const user = await authService.createUser(session.tenant_id, email, password, name, role || 'viewer');

      // Log this action
      await pool.query(
        `
        SELECT log_tenant_action($1, $2, 'USER_CREATED', 'users', $3, $4, $5)
        `,
        [
          session.tenant_id,
          session.user_id,
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
   * Middleware to verify JWT token
   */
  function verifyTokenMiddleware(req: Request, res: Response, next: Function) {
    try {
      const token = req.headers.authorization?.split(' ')[1] || req.cookies?.auth_token;

      if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const payload = authService.verifyToken(token);
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
