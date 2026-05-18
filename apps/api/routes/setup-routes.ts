import { Router, Request, Response } from 'express';
import { Pool, PoolClient } from 'pg';
import { AuthService } from '../services/auth-service';
import { v4 as uuidv4 } from 'uuid';

export function createSetupRouter(pool: Pool): Router {
  const router = Router();
  const authService = new AuthService(pool);

  /**
   * POST /setup/tenant
   * Create a new tenant (organization)
   * Can be called without authentication for initial setup
   */
  router.post('/tenant', async (req: Request, res: Response) => {
    const client = await pool.connect();

    try {
      const { name, slug } = req.body;

      if (!name || !slug) {
        return res.status(400).json({
          error: 'Name and slug are required',
        });
      }

      // Validate slug format (lowercase alphanumeric and hyphens)
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({
          error: 'Slug must contain only lowercase letters, numbers, and hyphens',
        });
      }

      // Check if slug already exists
      const existingTenant = await client.query(
        `SELECT id FROM tenants WHERE slug = $1`,
        [slug]
      );

      if (existingTenant.rows.length > 0) {
        return res.status(409).json({
          error: 'Organization slug already exists',
        });
      }

      // Create tenant
      const result = await client.query(
        `
        INSERT INTO tenants (name, slug, tenant_status)
        VALUES ($1, $2, 'active')
        RETURNING id, name, slug
        `,
        [name, slug]
      );

      const tenant = result.rows[0];

      // Create default tenant configuration
      await client.query(
        `
        INSERT INTO tenant_config (tenant_id)
        VALUES ($1)
        `,
        [tenant.id]
      );

      return res.status(201).json(tenant);
    } catch (error) {
      console.error('Create tenant error:', error);
      return res.status(500).json({
        error: 'Failed to create tenant',
      });
    } finally {
      client.release();
    }
  });

  /**
   * POST /setup/admin
   * Create admin user for a tenant
   * Should be called after tenant creation
   */
  router.post('/admin', async (req: Request, res: Response) => {
    const client = await pool.connect();

    try {
      const { tenant_id, email, password, name } = req.body;

      if (!tenant_id || !email || !password || !name) {
        return res.status(400).json({
          error: 'tenant_id, email, password, and name are required',
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          error: 'Password must be at least 8 characters',
        });
      }

      // Verify tenant exists
      const tenantCheck = await client.query(
        `SELECT id FROM tenants WHERE id = $1`,
        [tenant_id]
      );

      if (tenantCheck.rows.length === 0) {
        return res.status(404).json({
          error: 'Tenant not found',
        });
      }

      // Create admin user
      const user = await authService.createUser(tenant_id, email, password, name, 'admin');

      // Log this action
      await client.query(
        `
        SELECT log_tenant_action($1, $2, 'ADMIN_USER_CREATED', 'users', $3, $4, $5)
        `,
        [
          tenant_id,
          user.user_id,
          user.user_id,
          JSON.stringify({ email: user.email, role: 'admin' }),
          req.headers['x-forwarded-for'] || null,
        ]
      );

      return res.status(201).json(user);
    } catch (error) {
      console.error('Create admin error:', error);

      if ((error as any).code === '23505') {
        // Unique constraint violation
        return res.status(409).json({
          error: 'User already exists',
        });
      }

      return res.status(500).json({
        error: 'Failed to create admin user',
      });
    } finally {
      client.release();
    }
  });

  /**
   * GET /setup/status
   * Check setup status
   */
  router.get('/status', async (req: Request, res: Response) => {
    try {
      const result = await pool.query(`SELECT COUNT(*) as count FROM tenants`);
      const tenantCount = parseInt(result.rows[0].count);

      return res.json({
        is_set_up: tenantCount > 0,
        tenant_count: tenantCount,
      });
    } catch (error) {
      console.error('Setup status error:', error);
      return res.status(500).json({
        error: 'Failed to get setup status',
      });
    }
  });

  return router;
}
