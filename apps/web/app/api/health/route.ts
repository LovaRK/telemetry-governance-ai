import { NextRequest, NextResponse } from 'next/server';
import { query } from '@core/database/connection';

export async function GET(request: NextRequest) {
  try {
    // Check database connectivity
    const result = await query('SELECT NOW() as timestamp');
    const dbHealthy = !!result.rows.length;

    // Check applied migrations
    const migrationsResult = await query(
      'SELECT COUNT(*) as count FROM applied_migrations WHERE status = $1',
      ['success']
    );
    const migrationsApplied = parseInt(migrationsResult.rows[0]?.count || '0', 10);
    const migrationsHealthy = migrationsApplied >= 6; // At least bootstrap + 6 main migrations

    // Check for failed migrations
    const failedResult = await query(
      'SELECT COUNT(*) as count FROM applied_migrations WHERE status = $1',
      ['failed']
    );
    const failedMigrations = parseInt(failedResult.rows[0]?.count || '0', 10);

    // Check migration health records
    const healthResult = await query(
      `SELECT status FROM migration_health
       WHERE check_type = 'migrations'
       ORDER BY checked_at DESC LIMIT 1`
    );
    const lastHealthCheck = healthResult.rows[0]?.status || 'unknown';

    const allHealthy = dbHealthy && migrationsHealthy && failedMigrations === 0;

    return NextResponse.json({
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      database: {
        healthy: dbHealthy,
        message: dbHealthy ? 'Connected' : 'Not responding',
      },
      migrations: {
        healthy: migrationsHealthy,
        applied: migrationsApplied,
        failed: failedMigrations,
        message:
          failedMigrations > 0
            ? `${failedMigrations} migration(s) failed`
            : migrationsHealthy
              ? `${migrationsApplied} migrations applied`
              : `Only ${migrationsApplied} migrations applied (expected >= 7)`,
      },
      lastCheck: lastHealthCheck,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Health check failed',
      },
      { status: 503 }
    );
  }
}
