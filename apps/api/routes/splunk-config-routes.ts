import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { SplunkConfigService } from '../services/splunk-config-service';

export function createSplunkConfigRouter(pool: Pool): Router {
  const router = Router();
  const splunkService = new SplunkConfigService(pool);

  /**
   * POST /splunk/test-connection
   * Test Splunk configuration without saving
   */
  router.post('/test-connection', async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      if (!user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { url, hec_token, username, password, ssl_verify } = req.body;

      const config = {
        url,
        hec_token,
        username,
        password,
        ssl_verify: ssl_verify !== false,
      };

      const testResult = await splunkService.testSplunkConnection(config);

      return res.json(testResult);
    } catch (error) {
      console.error('Splunk test connection error:', error);
      return res.status(500).json({
        error: 'Test connection failed',
        details: (error as Error).message,
      });
    }
  });

  /**
   * POST /splunk/config
   * Save Splunk configuration for tenant
   */
  router.post('/config', async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      if (!user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden - admin only' });
      }

      const { url, hec_token, username, password, ssl_verify, test_first } = req.body;

      const config = {
        url,
        hec_token,
        username,
        password,
        ssl_verify: ssl_verify !== false,
      };

      // Test first if requested
      if (test_first) {
        const testResult = await splunkService.testSplunkConnection(config);

        if (!testResult.success) {
          return res.status(400).json({
            error: 'Splunk connection test failed',
            message: testResult.message,
          });
        }
      }

      // Save configuration
      const status = await splunkService.saveSplunkConfig(user.tenant_id, config);

      // Mark as tested
      const testResult = await splunkService.testSplunkConnection(config);
      await splunkService.markSplunkConfigTested(user.tenant_id, testResult);

      // Log this action
      await pool.query(
        `
        SELECT log_tenant_action($1, $2, 'SPLUNK_CONFIG_UPDATED', 'tenants', $3, $4, $5)
        `,
        [
          user.tenant_id,
          user.user_id,
          user.tenant_id,
          JSON.stringify({
            splunk_url: url,
            splunk_username: username || null,
            test_success: testResult.success,
          }),
          req.headers['x-forwarded-for'] || null,
        ]
      );

      return res.json(status);
    } catch (error) {
      console.error('Splunk config error:', error);
      return res.status(500).json({
        error: 'Failed to save Splunk configuration',
        details: (error as Error).message,
      });
    }
  });

  /**
   * GET /splunk/status
   * Get Splunk configuration status for tenant
   */
  router.get('/status', async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      if (!user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const status = await splunkService.getSplunkStatus(user.tenant_id);

      if (!status) {
        return res.status(404).json({ error: 'No Splunk configuration found' });
      }

      return res.json(status);
    } catch (error) {
      console.error('Splunk status error:', error);
      return res.status(500).json({ error: 'Failed to get Splunk status' });
    }
  });

  /**
   * GET /splunk/config
   * Get stored Splunk configuration (without password)
   */
  router.get('/config', async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      if (!user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const config = await splunkService.getSplunkConfig(user.tenant_id);

      if (!config) {
        return res.status(404).json({ error: 'No Splunk configuration found' });
      }

      // Don't return token or password
      return res.json({
        url: config.url,
        username: config.username,
        ssl_verify: config.ssl_verify,
      });
    } catch (error) {
      console.error('Get splunk config error:', error);
      return res.status(500).json({ error: 'Failed to get Splunk configuration' });
    }
  });

  /**
   * DELETE /splunk/config
   * Clear Splunk configuration
   */
  router.delete('/config', async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      if (!user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden - admin only' });
      }

      await pool.query(
        `
        UPDATE tenants
        SET
          splunk_url = NULL,
          splunk_hec_token = NULL,
          splunk_username = NULL,
          splunk_password = NULL,
          is_configured = false,
          updated_at = NOW()
        WHERE id = $1
        `,
        [user.tenant_id]
      );

      // Log this action
      await pool.query(
        `
        SELECT log_tenant_action($1, $2, 'SPLUNK_CONFIG_DELETED', 'tenants', $3, NULL, $4)
        `,
        [user.tenant_id, user.user_id, user.tenant_id, req.headers['x-forwarded-for'] || null]
      );

      return res.json({ success: true });
    } catch (error) {
      console.error('Delete splunk config error:', error);
      return res.status(500).json({ error: 'Failed to delete Splunk configuration' });
    }
  });

  return router;
}
