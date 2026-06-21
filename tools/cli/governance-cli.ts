#!/usr/bin/env ts-node
/**
 * Governance CLI — Phase 11
 *
 * Operator command-line interface for the Enterprise Telemetry Governance Platform.
 * Connects directly to the database (not through the web API) for low-latency
 * operator access during incidents and routine maintenance.
 *
 * Usage:
 *   npx ts-node tools/cli/governance-cli.ts <command> [options]
 *
 * Commands:
 *   metrics    [--hours N] [--tenant T]         — show recent platform metrics
 *   violations [--tenant T]                     — show active SLO violations
 *   slos                                        — list configured SLO definitions
 *   audit      [--tenant T] [--limit N]         — show recent governance audit events
 *   freeze     --on | --off                     — toggle global governance freeze
 *   snapshot   --tenant T [--index I]           — show gold snapshot summary for tenant
 *   purge      --tenant CHAOS_SANDBOX [--confirm] — wipe chaos sandbox data
 *   health                                      — platform health check
 *
 * Environment:
 *   DATABASE_URL  — required (default: postgresql://telemetry:telemetry@localhost:5433/telemetry_os)
 */

import * as crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Arg parsing
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

function flag(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

// ─────────────────────────────────────────────────────────────────────────────
// DB connection
// ─────────────────────────────────────────────────────────────────────────────

async function getPool() {
  const { Pool } = await import('pg');
  return new Pool({
    connectionString: process.env.DATABASE_URL ??
      'postgresql://telemetry:telemetry@localhost:5433/telemetry_os',
    max:                      3,
    connectionTimeoutMillis:  10_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

const RESET   = '\x1b[0m';
const BOLD    = '\x1b[1m';
const DIM     = '\x1b[2m';
const RED     = '\x1b[31m';
const GREEN   = '\x1b[32m';
const YELLOW  = '\x1b[33m';
const BLUE    = '\x1b[34m';
const CYAN    = '\x1b[36m';

function header(text: string): void {
  console.log(`\n${BOLD}${BLUE}══ ${text} ══${RESET}\n`);
}

function row(label: string, value: string | number | boolean | null, color = ''): void {
  const pad = '                                '.slice(0, Math.max(0, 30 - String(label).length));
  console.log(`  ${DIM}${label}${RESET}${pad}${color}${value}${color ? RESET : ''}`);
}

function tableRow(cols: string[], widths: number[]): void {
  const line = cols.map((c, i) => c.padEnd(widths[i] ?? 12).slice(0, widths[i] ?? 12)).join('  ');
  console.log('  ' + line);
}

function ok(msg: string):    void { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function warn(msg: string):  void { console.log(`  ${YELLOW}⚠${RESET} ${msg}`); }
function error(msg: string): void { console.log(`  ${RED}✗${RESET} ${msg}`); }
function info(msg: string):  void { console.log(`  ${CYAN}→${RESET} ${msg}`); }

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

async function cmdMetrics(): Promise<void> {
  const hours    = parseInt(flag('--hours') ?? '24', 10);
  const tenantId = flag('--tenant');

  header(`Platform Metrics (last ${hours}h)`);

  const pool = await getPool();
  try {
    const params: unknown[] = [hours];
    let filter = '';
    if (tenantId) {
      params.push(tenantId);
      filter = ` AND (tenant_id = $${params.length} OR tenant_id IS NULL)`;
    }

    const result = await pool.query(
      `SELECT metric_name,
              COUNT(*) as sample_count,
              AVG(value)::NUMERIC(10,2) as avg_val,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value)::NUMERIC(10,2) as p95,
              MAX(value)::NUMERIC(10,2) as max_val,
              MIN(recorded_at) as oldest,
              MAX(recorded_at) as latest,
              unit
       FROM governance_operational_metrics
       WHERE recorded_at > NOW() - ($1 || ' hours')::INTERVAL
         ${filter}
       GROUP BY metric_name, unit
       ORDER BY metric_name`,
      params,
    );

    if (!result.rows.length) {
      warn('No metrics found for the given window.');
      return;
    }

    tableRow(['METRIC', 'COUNT', 'AVG', 'P95', 'MAX', 'UNIT'], [50, 8, 10, 10, 10, 12]);
    console.log('  ' + '─'.repeat(104));
    for (const r of result.rows) {
      tableRow([
        r.metric_name,
        String(r.sample_count),
        String(r.avg_val),
        String(r.p95),
        String(r.max_val),
        r.unit,
      ], [50, 8, 10, 10, 10, 12]);
    }
  } finally {
    await pool.end();
  }
}

async function cmdViolations(): Promise<void> {
  const tenantId = flag('--tenant');

  header('Active SLO Violations');

  const pool = await getPool();
  try {
    const params: unknown[] = [];
    let filter = 'resolved_at IS NULL';
    if (tenantId) {
      params.push(tenantId);
      filter += ` AND (tenant_id = $${params.length} OR tenant_id IS NULL)`;
    }

    const result = await pool.query(
      `SELECT id, slo_id, metric_name, observed_value, threshold_value,
              enforcement_mode, created_at, context
       FROM data_quality_violation_log
       WHERE ${filter}
       ORDER BY created_at DESC
       LIMIT 50`,
      params,
    );

    if (!result.rows.length) {
      ok('No active SLO violations.');
      return;
    }

    for (const r of result.rows) {
      const ageMs    = Date.now() - new Date(r.created_at).getTime();
      const ageMin   = Math.round(ageMs / 60_000);
      const modeColor = r.enforcement_mode === 'BLOCK' ? RED
        : r.enforcement_mode === 'ALERT' ? YELLOW : DIM;

      console.log(`\n  ${BOLD}${r.metric_name}${RESET}`);
      row('SLO ID',         r.slo_id);
      row('Observed',       r.observed_value, RED);
      row('Threshold',      r.threshold_value, DIM);
      row('Mode',           r.enforcement_mode, modeColor);
      row('Age',            `${ageMin}m ago`);
      if (Object.keys(r.context ?? {}).length) {
        row('Context',      JSON.stringify(r.context), DIM);
      }
    }

    console.log(`\n  ${result.rows.length} active violation(s)`);
  } finally {
    await pool.end();
  }
}

async function cmdSlos(): Promise<void> {
  header('Configured SLO Definitions');

  const pool = await getPool();
  try {
    const result = await pool.query(
      `SELECT id, metric_name, description, expected_min, expected_max,
              violation_threshold, enforcement_mode, is_active
       FROM data_quality_slos
       ORDER BY metric_name`,
    );

    tableRow(['ID', 'METRIC', 'THRESHOLD', 'MODE', 'ACTIVE'], [28, 40, 12, 8, 8]);
    console.log('  ' + '─'.repeat(100));
    for (const r of result.rows) {
      const modeColor = r.enforcement_mode === 'BLOCK' ? RED
        : r.enforcement_mode === 'ALERT' ? YELLOW : '';
      console.log('  ' + [
        r.id.padEnd(28).slice(0, 28),
        r.metric_name.padEnd(40).slice(0, 40),
        String(r.violation_threshold).padEnd(12),
        `${modeColor}${r.enforcement_mode}${RESET}`.padEnd(8 + (modeColor ? 10 : 0)),
        r.is_active ? `${GREEN}yes${RESET}` : `${RED}no${RESET}`,
      ].join('  '));
    }
  } finally {
    await pool.end();
  }
}

async function cmdAudit(): Promise<void> {
  const tenantId = flag('--tenant');
  const limit    = parseInt(flag('--limit') ?? '20', 10);

  header('Recent Governance Audit Events');

  const pool = await getPool();
  try {
    const params: unknown[] = [limit];
    let filter = '';
    if (tenantId) {
      params.push(tenantId);
      filter = ` AND tenant_id = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT id, tenant_id, event_type, actor_id, resource_type, resource_id,
              decision, created_at
       FROM governance_audit_events
       WHERE true ${filter}
       ORDER BY created_at DESC
       LIMIT $1`,
      params,
    );

    if (!result.rows.length) {
      warn('No audit events found.');
      return;
    }

    tableRow(['TIMESTAMP', 'TENANT', 'EVENT TYPE', 'DECISION', 'RESOURCE'], [25, 16, 25, 10, 30]);
    console.log('  ' + '─'.repeat(110));
    for (const r of result.rows) {
      const decisionColor = r.decision === 'approved' ? GREEN
        : r.decision === 'denied' ? RED : DIM;
      console.log('  ' + [
        new Date(r.created_at).toISOString().slice(0, 19).padEnd(25),
        (r.tenant_id ?? '').slice(0, 14).padEnd(16),
        (r.event_type ?? '').slice(0, 23).padEnd(25),
        `${decisionColor}${(r.decision ?? '-').slice(0, 8)}${RESET}`.padEnd(10 + 10),
        `${r.resource_type}/${r.resource_id}`.slice(0, 28).padEnd(30),
      ].join('  '));
    }
  } finally {
    await pool.end();
  }
}

async function cmdFreeze(): Promise<void> {
  const on  = hasFlag('--on');
  const off = hasFlag('--off');

  if (!on && !off) {
    error('Specify --on or --off');
    process.exit(1);
  }

  header(`Governance Global Freeze — turning ${on ? 'ON' : 'OFF'}`);

  if (on) {
    warn('FREEZE ON: All governance enforcement suspended. Audit writes continue.');
    warn('Set GOVERNANCE_GLOBAL_BYPASS=true in environment and restart services.');
  } else {
    ok('FREEZE OFF: Normal governance enforcement will resume on next service restart.');
    info('Clear GOVERNANCE_GLOBAL_BYPASS from environment and restart services.');
  }

  // Record the freeze event in audit log
  const pool = await getPool();
  try {
    const id = `freeze-${crypto.randomBytes(8).toString('hex')}`;
    await pool.query(
      `INSERT INTO governance_audit_events
         (id, tenant_id, event_type, actor_id, resource_type, resource_id, decision, payload, created_at)
       VALUES ($1, 'SYSTEM', $2, 'governance-cli', 'governance_freeze', 'global', $3, $4::jsonb, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        on ? 'governance_freeze_activated' : 'governance_freeze_released',
        on ? 'suspended' : 'restored',
        JSON.stringify({ activated_via: 'governance-cli', pid: process.pid }),
      ],
    ).catch(() => { /* audit table may not exist yet */ });
  } finally {
    await pool.end();
  }
}

async function cmdSnapshot(): Promise<void> {
  const tenantId = flag('--tenant');
  const indexName = flag('--index');

  if (!tenantId) {
    error('--tenant is required');
    process.exit(1);
  }

  header(`Gold Snapshot Summary — tenant: ${tenantId}`);

  const pool = await getPool();
  try {
    const params: unknown[] = [tenantId];
    let filter = '';
    if (indexName) {
      params.push(indexName);
      filter = ` AND index_name = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT tier,
              COUNT(*) as count,
              AVG(composite_score)::NUMERIC(5,1) as avg_score,
              SUM(CASE WHEN minimum_activity_gated THEN 1 ELSE 0 END) as gated_count,
              MAX(scored_at) as latest_scored_at
       FROM gold_telemetry_snapshots
       WHERE tenant_id = $1 ${filter}
       GROUP BY tier
       ORDER BY avg_score DESC`,
      params,
    );

    if (!result.rows.length) {
      warn(`No gold snapshots found for tenant: ${tenantId}`);
      return;
    }

    tableRow(['TIER', 'COUNT', 'AVG SCORE', 'GATED', 'LATEST'], [20, 8, 12, 8, 30]);
    console.log('  ' + '─'.repeat(82));
    for (const r of result.rows) {
      const tierColor = r.tier === 'critical' ? RED
        : r.tier === 'high-value' ? GREEN
        : r.tier === 'medium-value' ? YELLOW : DIM;
      tableRow([
        `${tierColor}${r.tier}${RESET}`,
        String(r.count),
        String(r.avg_score),
        String(r.gated_count),
        new Date(r.latest_scored_at).toISOString().slice(0, 19),
      ], [20, 8, 12, 8, 30]);
    }

    // Overall stats
    const total = await pool.query(
      `SELECT COUNT(*) as total, MAX(scored_at) as latest
       FROM gold_telemetry_snapshots
       WHERE tenant_id = $1 ${filter}`,
      params,
    );

    console.log(`\n  Total snapshots: ${BOLD}${total.rows[0].total}${RESET}`);
    console.log(`  Latest scored:   ${new Date(total.rows[0].latest).toISOString().slice(0, 19)}`);
  } finally {
    await pool.end();
  }
}

async function cmdPurge(): Promise<void> {
  const tenantId = flag('--tenant');
  const confirm  = hasFlag('--confirm');

  if (!tenantId) {
    error('--tenant is required');
    process.exit(1);
  }

  if (tenantId !== 'CHAOS_SANDBOX') {
    error(`Purge is only allowed for CHAOS_SANDBOX tenant. Got: ${tenantId}`);
    process.exit(1);
  }

  if (!confirm) {
    warn(`This will delete all data for tenant: ${tenantId}`);
    warn('Add --confirm to proceed.');
    process.exit(0);
  }

  header(`Purging tenant: ${tenantId}`);

  const pool = await getPool();
  try {
    const tables = [
      'gold_telemetry_snapshots',
      'silver_normalized_telemetry',
      'bronze_splunk_events',
      'agent_decisions',
      'parser_confidence_audit',
    ];

    for (const table of tables) {
      try {
        const res = await pool.query(
          `DELETE FROM ${table} WHERE tenant_id = $1`,
          [tenantId],
        );
        ok(`Deleted ${res.rowCount} rows from ${table}`);
      } catch (e) {
        warn(`Skipped ${table}: ${(e as Error).message}`);
      }
    }

    // Remove tenant config
    try {
      await pool.query('DELETE FROM tenant_config WHERE tenant_id = $1', [tenantId]);
      ok('Removed tenant_config entry');
    } catch {
      // Non-fatal
    }

    console.log(`\n  ${BOLD}${GREEN}Purge complete.${RESET}`);
  } finally {
    await pool.end();
  }
}

async function cmdHealth(): Promise<void> {
  header('Platform Health Check');

  const pool = await getPool();
  try {
    // 1. DB connectivity
    await pool.query('SELECT 1');
    ok('Database: reachable');

    // 2. Recent gold snapshots
    const snapshotAge = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(scored_at)))/3600 as hours_ago
       FROM gold_telemetry_snapshots
       WHERE tenant_id != 'CHAOS_SANDBOX'`
    ).catch(() => ({ rows: [{ hours_ago: null }] }));

    const hoursAgo = snapshotAge.rows[0]?.hours_ago;
    if (hoursAgo == null) {
      warn('Gold snapshots: none found (no non-chaos tenants)');
    } else if (hoursAgo > 48) {
      error(`Gold snapshots: stale — last scored ${Math.round(hoursAgo)}h ago (SLO: <48h)`);
    } else {
      ok(`Gold snapshots: fresh — last scored ${Math.round(hoursAgo * 10) / 10}h ago`);
    }

    // 3. Active SLO violations
    const violations = await pool.query(
      `SELECT COUNT(*) as count, enforcement_mode
       FROM data_quality_violation_log
       WHERE resolved_at IS NULL
       GROUP BY enforcement_mode`
    ).catch(() => ({ rows: [] }));

    if (!violations.rows.length) {
      ok('SLO violations: none active');
    } else {
      for (const v of violations.rows) {
        const color = v.enforcement_mode === 'BLOCK' ? RED : v.enforcement_mode === 'ALERT' ? YELLOW : '';
        console.log(`  ${color}⚠${RESET} SLO violations (${v.enforcement_mode}): ${v.count}`);
      }
    }

    // 4. Audit write health
    const auditHealth = await pool.query(
      `SELECT COUNT(*) as count FROM governance_audit_events
       WHERE created_at > NOW() - INTERVAL '1 hour'`
    ).catch(() => ({ rows: [{ count: 0 }] }));

    ok(`Governance audit: ${auditHealth.rows[0].count} events in last 1h`);

    // 5. Recent metric entries
    const metricCount = await pool.query(
      `SELECT COUNT(*) as count FROM governance_operational_metrics
       WHERE recorded_at > NOW() - INTERVAL '1 hour'`
    ).catch(() => ({ rows: [{ count: 0 }] }));

    if (parseInt(String(metricCount.rows[0].count), 10) === 0) {
      warn('OTel metrics: no entries in last 1h (pipeline may be idle)');
    } else {
      ok(`OTel metrics: ${metricCount.rows[0].count} entries in last 1h`);
    }

    console.log('');

  } catch (err) {
    error(`Health check failed: ${(err as Error).message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(`
${BOLD}governance-cli${RESET} — Enterprise Telemetry Governance Platform Operator CLI

${BOLD}Commands:${RESET}
  ${CYAN}metrics${RESET}    [--hours N] [--tenant T]         Show recent platform metrics
  ${CYAN}violations${RESET} [--tenant T]                     Show active SLO violations
  ${CYAN}slos${RESET}                                        List SLO definitions
  ${CYAN}audit${RESET}      [--tenant T] [--limit N]         Show recent governance audit events
  ${CYAN}freeze${RESET}     --on | --off                     Toggle global governance freeze
  ${CYAN}snapshot${RESET}   --tenant T [--index I]           Show gold snapshot summary
  ${CYAN}purge${RESET}      --tenant CHAOS_SANDBOX [--confirm]  Wipe chaos sandbox data
  ${CYAN}health${RESET}                                      Platform health check

${BOLD}Environment:${RESET}
  DATABASE_URL   postgresql://telemetry:telemetry@localhost:5433/telemetry_os
`);
    return;
  }

  const dispatch: Record<string, () => Promise<void>> = {
    metrics:    cmdMetrics,
    violations: cmdViolations,
    slos:       cmdSlos,
    audit:      cmdAudit,
    freeze:     cmdFreeze,
    snapshot:   cmdSnapshot,
    purge:      cmdPurge,
    health:     cmdHealth,
  };

  const fn = dispatch[command];
  if (!fn) {
    error(`Unknown command: ${command}`);
    info('Run without arguments to see available commands.');
    process.exit(1);
  }

  await fn();
  console.log('');
}

main().catch(err => {
  console.error(`\n${RED}Fatal error:${RESET}`, err.message);
  process.exit(1);
});
