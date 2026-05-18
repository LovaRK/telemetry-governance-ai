import { Router, Request, Response } from 'express';
import { getTrustInspectionPayload } from '../services/trust-inspection-service';

const router = Router();

/**
 * GET /api/trust-inspection?indexName={indexName}
 * Returns complete trust inspection payload for diagnostic visibility
 */
router.get('/', async (req: Request, res: Response) => {
  const { indexName } = req.query;

  if (!indexName || typeof indexName !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid required parameter: indexName' });
  }

  try {
    const payload = await getTrustInspectionPayload(indexName);
    return res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Trust Inspection] Error fetching inspection for ${indexName}:`, message);
    return res.status(500).json({
      error: 'Failed to fetch trust inspection data',
      details: message,
    });
  }
});

export default router;
