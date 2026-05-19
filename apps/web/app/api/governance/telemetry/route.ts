import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { GovernanceTelemetryService } from '@/services/governance-telemetry-service';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * GET /api/governance/telemetry
 *
 * Real-time governance health summary
 * Aggregated metrics across all indexes
 *
 * Response:
 * {
 *   "indexes_with_mutations_24h": 42,
 *   "version_collisions_24h": 3,
 *   "invalidation_failures_24h": 1,
 *   "operations_abandoned_24h": 5,
 *   "degraded_indexes": 2,
 *   "avg_post_refresh_success_rate": 0.85,
 *   "avg_operator_abandon_rate": 0.12
 * }
 */
export async function GET(request: NextRequest) {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        {
          indexes_with_mutations_24h: 0,
          version_collisions_24h: 0,
          invalidation_failures_24h: 0,
          operations_abandoned_24h: 0,
          degraded_indexes: 0,
          avg_post_refresh_success_rate: 1.0,
          avg_operator_abandon_rate: 0.0,
        },
        { status: 200 }
      );
    }

    const telemetryService = new GovernanceTelemetryService(pool);
    const health = await telemetryService.getHealthSummary();

    return NextResponse.json(health, { status: 200 });
  } catch (error) {
    console.error('Error fetching telemetry:', error);
    return NextResponse.json(
      { error: 'Failed to fetch telemetry' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/governance/telemetry/:indexName
 *
 * Per-index telemetry and mutation statistics
 * Used to debug issues with specific indexes
 *
 * Query parameters:
 * - windowHours: Time window for stats (default: 24)
 */
async function getIndexTelemetry(indexName: string, windowHours: number = 24) {
  try {
    if (!process.env.DATABASE_URL) {
      return null;
    }

    const telemetryService = new GovernanceTelemetryService(pool);
    const stats = await telemetryService.getMutationStats(indexName, windowHours);

    return {
      indexName,
      timeWindow: `${windowHours}h`,
      ...stats,
    };
  } catch (error) {
    console.error('Error fetching index telemetry:', error);
    return null;
  }
}
