import { NextRequest, NextResponse } from 'next/server';
import { query } from '@core/database/connection';

const DEFAULT_WEIGHTS = { utilization: 0.35, detection: 0.40, quality: 0.25 };

/**
 * GET /api/settings/weights
 * Returns current scoring weights from user_config table.
 */
export async function GET() {
  try {
    const res = await query<any>(
      `SELECT decision_weights FROM user_config ORDER BY updated_at DESC LIMIT 1`
    );
    const weights = res.rows[0]?.decision_weights || DEFAULT_WEIGHTS;
    return NextResponse.json({ weights });
  } catch (e) {
    return NextResponse.json({ weights: DEFAULT_WEIGHTS });
  }
}

/**
 * POST /api/settings/weights
 * Body: { utilization: number, detection: number, quality: number }
 * Saves weights to user_config, validates they sum to 1.0.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { utilization, detection, quality } = body;

    // Validate
    if (typeof utilization !== 'number' || typeof detection !== 'number' || typeof quality !== 'number') {
      return NextResponse.json({ error: 'All three weights must be numbers' }, { status: 400 });
    }
    const sum = utilization + detection + quality;
    if (Math.abs(sum - 1.0) > 0.005) {
      return NextResponse.json(
        { error: `Weights must sum to 1.00. Got: ${sum.toFixed(3)}` },
        { status: 400 }
      );
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

    return NextResponse.json({ ok: true, weights });
  } catch (e: any) {
    // If no singleton constraint, try an upsert by id=1 pattern
    try {
      const body = await request.clone().json().catch(() => ({}));
      const { utilization = 0.35, detection = 0.40, quality = 0.25 } = body;
      const weights = { utilization, detection, quality };

      await query(
        `UPDATE user_config SET decision_weights = $1::jsonb, updated_at = NOW()`,
        [JSON.stringify(weights)]
      );
      return NextResponse.json({ ok: true, weights });
    } catch (e2) {
      console.error('[settings/weights]', e2);
      return NextResponse.json({ error: 'Failed to save weights' }, { status: 500 });
    }
  }
}
