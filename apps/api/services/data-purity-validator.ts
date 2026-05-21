import { Pool } from 'pg';

interface PurityViolation {
  type: string;
  table: string;
  count: number;
  examples: any[];
}

export class DataPurityValidator {
  constructor(private pool: Pool) {}

  async validate(): Promise<void> {
    // Allow synthetic data in test/dev environments
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.ALLOW_SYNTHETIC_DATA === 'true'
    ) {
      console.log('[DataPurityValidator] Skipped (test environment or ALLOW_SYNTHETIC_DATA=true)');
      return;
    }

    const violations: PurityViolation[] = [];

    console.log('[DataPurityValidator] Checking for synthetic data...');

    // Check for demo tenants
    const demoTenants = await this.findDemoTenants();
    if (demoTenants.count > 0) {
      violations.push({
        type: 'Demo tenant',
        table: 'tenants',
        count: demoTenants.count,
        examples: demoTenants.rows,
      });
    }

    // Check for synthetic snapshots
    const syntheticSnapshots = await this.findSyntheticSnapshots();
    if (syntheticSnapshots.count > 0) {
      violations.push({
        type: 'Synthetic snapshot',
        table: 'telemetry_snapshots',
        count: syntheticSnapshots.count,
        examples: syntheticSnapshots.rows,
      });
    }

    // Check for hardcoded KPIs
    const hardcodedKpis = await this.findHardcodedKpis();
    if (hardcodedKpis.count > 0) {
      violations.push({
        type: 'Hardcoded KPI',
        table: 'executive_kpis',
        count: hardcodedKpis.count,
        examples: hardcodedKpis.rows,
      });
    }

    // Check for mock published runs
    const mockPublishedRuns = await this.findMockPublishedRuns();
    if (mockPublishedRuns.count > 0) {
      violations.push({
        type: 'Mock published run',
        table: 'published_runs',
        count: mockPublishedRuns.count,
        examples: mockPublishedRuns.rows,
      });
    }

    // Check for hardcoded telemetry
    const hardcodedTelemetry = await this.findHardcodedTelemetry();
    if (hardcodedTelemetry.count > 0) {
      violations.push({
        type: 'Hardcoded telemetry',
        table: 'telemetry_snapshots',
        count: hardcodedTelemetry.count,
        examples: hardcodedTelemetry.rows,
      });
    }

    // Fail startup if violations detected
    if (violations.length > 0) {
      this.throwPurityError(violations);
    }

    console.log('✓ Data purity validation passed - no synthetic data detected');
  }

  private async findDemoTenants() {
    const res = await this.pool.query(
      `SELECT COUNT(*) as count, id, slug FROM tenants
       WHERE LOWER(slug) ILIKE '%demo%' OR LOWER(name) ILIKE '%demo%'
       GROUP BY id, slug
       LIMIT 5`
    );
    return {
      count: res.rows.reduce((sum, row) => sum + parseInt(row.count), 0),
      rows: res.rows.map((r) => ({ id: r.id, slug: r.slug })),
    };
  }

  private async findSyntheticSnapshots() {
    const res = await this.pool.query(
      `SELECT COUNT(*) as count, snapshot_id, run_id FROM telemetry_snapshots
       WHERE snapshot_id ILIKE '%demo%'
          OR snapshot_id ILIKE '%synthetic%'
          OR snapshot_id ILIKE '%test%'
       GROUP BY snapshot_id, run_id
       LIMIT 5`
    );
    return {
      count: res.rows.reduce((sum, row) => sum + parseInt(row.count), 0),
      rows: res.rows.map((r) => ({ snapshot_id: r.snapshot_id, run_id: r.run_id })),
    };
  }

  private async findHardcodedKpis() {
    const res = await this.pool.query(
      `SELECT COUNT(*) as count, tenant_id, metric_date FROM executive_kpis
       WHERE tenant_id = 'demo'
          OR tenant_id ILIKE '%fake%'
          OR metric_date < DATE '2024-01-01'  -- Very old bootstrap data
       GROUP BY tenant_id, metric_date
       LIMIT 5`
    );
    return {
      count: res.rows.reduce((sum, row) => sum + parseInt(row.count), 0),
      rows: res.rows.map((r) => ({ tenant_id: r.tenant_id, metric_date: r.metric_date })),
    };
  }

  private async findMockPublishedRuns() {
    const res = await this.pool.query(
      `SELECT COUNT(*) as count, run_id, notes FROM published_runs
       WHERE LOWER(notes) ILIKE '%mock%'
          OR LOWER(notes) ILIKE '%demo%'
          OR LOWER(notes) ILIKE '%synthetic%'
       GROUP BY run_id, notes
       LIMIT 5`
    );
    return {
      count: res.rows.reduce((sum, row) => sum + parseInt(row.count), 0),
      rows: res.rows.map((r) => ({ run_id: r.run_id, notes: r.notes })),
    };
  }

  private async findHardcodedTelemetry() {
    const res = await this.pool.query(
      `SELECT COUNT(*) as count, index_name FROM telemetry_snapshots
       WHERE index_name IN ('splunk_network_traffic', 'splunk_api_events', 'splunk_security_events')
          AND sourcetype IN ('network_logs', 'json_api_logs', 'cim_security')
          AND snapshot_date < DATE '2024-01-01'
       GROUP BY index_name
       LIMIT 5`
    );
    return {
      count: res.rows.reduce((sum, row) => sum + parseInt(row.count), 0),
      rows: res.rows.map((r) => ({ index_name: r.index_name })),
    };
  }

  private throwPurityError(violations: PurityViolation[]): void {
    const lines = ['', '❌ DATA PURITY VIOLATION', 'Synthetic data detected in production database', ''];

    for (const violation of violations) {
      lines.push(`${violation.type} (${violation.table}): ${violation.count} rows detected`);
      for (const example of violation.examples) {
        lines.push(`  Example: ${JSON.stringify(example)}`);
      }
      lines.push('');
    }

    lines.push('Startup aborted.');
    lines.push('Action: Remove synthetic data and restart.');

    const message = lines.join('\n');
    console.error(message);
    throw new Error(`Data purity validation failed\n${message}`);
  }
}
