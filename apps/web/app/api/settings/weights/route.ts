import { NextRequest } from 'next/server';
import { createRoute } from '@/lib/api-route-factory';
import { query } from '@core/database/connection';

const DEFAULT_WEIGHTS = { utilization: 0.35, detection: 0.40, quality: 0.25 };

/**
 * GET /api/settings/weights
 * Returns current scoring weights from user_config table.
 */
export const GET = createRoute(async () => {
  const res = await query<any>(
    `SELECT decision_weights FROM user_config ORDER BY updated_at DESC LIMIT 1`
  );
  const weights = res.rows[0]?.decision_weights || DEFAULT_WEIGHTS;
  return {
    data: { weights },
    meta: { source: 'postgres' },
  };
});

/**
 * POST /api/settings/weights
 * Body: { utilization: number, detection: number, quality: number }
 * Saves weights to user_config, validates they sum to 1.0.
 */
export const POST = createRoute(async (request: NextRequest) => {
  const body = await request.json();
  const { utilization, detection, quality } = body;

  // Validate
  if (typeof utilization !== 'number' || typeof detection !== 'number' || typeof quality !== 'number') {
    throw new Error('All three weights must be numbers');
  }
  const sum = utilization + detection + quality;
  if (Math.abs(sum - 1.0) > 0.005) {
    throw new Error(`Weights must sum to 1.00. Got: ${sum.toFixed(3)}`);
  }

  const weights = {
    utilization: Math.round(utilization * 1000) / 1000,
    detection:   Math.round(detection   * 1000) / 1000,
    quality:     Math.round(quality     * 1000) / 1000,
  };

  // Upsert into user_config — use a stable primary key row
  await query(
    `INSERT INTO user_config (decision_weights, updated_at)
     VALUES ($1::jsonb, NOW())
     ON CONFLICT ON CONSTRAINT user_config_singleton
     DO UPDATE SET decision_weights = $1::jsonb, updated_at = NOW()`,
    [JSON.stringify(weights)]
  );

  return {
    data: { ok: true, weights },
    meta: { source: 'postgres' },
  };
});
