/**
 * Tally Report Export (G3)
 *
 * Produces the side-by-side artifact shown during the Data Sensei tally:
 * per-index agent score vs Data Sensei score with deltas, plus portfolio
 * KPIs. Outputs tally-report.csv and a styled tally-report.html.
 *
 * Agent scores: read from the latest published snapshot in Postgres.
 * Data Sensei scores: optional CSV Teja provides (--datasensei <file>) with
 *   columns: index,composite (or index,score). When omitted, the report shows
 *   agent-only columns so it is still useful before Teja's export arrives.
 *
 * Usage:
 *   node scripts/export-tally-report.mjs
 *   node scripts/export-tally-report.mjs --datasensei datasensei_export.csv
 *   node scripts/export-tally-report.mjs --out ./artifacts
 *
 * Env: DATABASE_URL (default local docker), TENANT_ID (optional override)
 */

import pg from 'pg';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const { Pool } = pg;
const DB_URL = process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os';

function arg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? def : process.argv[i + 1];
}

const OUT_DIR = arg('--out', join(process.cwd(), 'artifacts'));
const DATASENSEI_CSV = arg('--datasensei', null);

function parseCsvSimple(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(',').map(h => h.trim().toLowerCase());
  const idxKey = header.findIndex(h => h === 'index' || h === 'index_name');
  const scoreKey = header.findIndex(h => h === 'composite' || h === 'score' || h === 'composite_score' || h === 'roi');
  const map = new Map();
  for (const line of lines) {
    const cols = line.split(',');
    const idx = (cols[idxKey] || '').trim();
    const score = parseFloat(cols[scoreKey]);
    if (idx && Number.isFinite(score)) map.set(idx.toLowerCase(), score);
  }
  return map;
}

async function resolveTenantId(pool) {
  if (process.env.TENANT_ID) return process.env.TENANT_ID;
  const r = await pool.query(
    `SELECT tenant_id FROM telemetry_snapshots GROUP BY tenant_id ORDER BY max(created_at) DESC LIMIT 1`
  );
  return r.rows[0]?.tenant_id || null;
}

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  try {
    const tenantId = await resolveTenantId(pool);
    if (!tenantId) { console.error('No telemetry snapshots found — run a refresh first.'); process.exit(1); }

    // Latest snapshot's index-level agent scores
    const { rows } = await pool.query(
      `SELECT ad.index_name,
              ROUND(ad.composite_score::numeric, 1) AS agent_composite,
              ROUND(ad.utilization_score::numeric, 1) AS utilization,
              ROUND(ad.detection_score::numeric, 1) AS detection,
              ROUND(ad.quality_score::numeric, 1) AS quality,
              ad.tier,
              ROUND(COALESCE(ts.daily_avg_gb,0)::numeric, 3) AS daily_gb,
              ROUND(ad.annual_license_cost::numeric, 0) AS annual_cost
       FROM agent_decisions ad
       LEFT JOIN LATERAL (
         SELECT daily_avg_gb FROM telemetry_snapshots t
         WHERE t.tenant_id = ad.tenant_id AND t.snapshot_id = ad.snapshot_id
           AND t.index_name = ad.index_name AND t.sourcetype IS NULL
         LIMIT 1
       ) ts ON true
       WHERE ad.tenant_id = $1
         AND ad.snapshot_id = (
           SELECT snapshot_id FROM telemetry_snapshots
           WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1
         )
         AND ad.sourcetype IS NULL
       ORDER BY ad.composite_score DESC`,
      [tenantId]
    );

    const kpiRow = (await pool.query(
      `SELECT roi_score, gainscope_score, total_daily_gb, total_sourcetypes,
              license_spend_low_value, total_license_spend
       FROM executive_kpis WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tenantId]
    )).rows[0] || {};

    // Optional Data Sensei comparison
    let dsMap = new Map();
    if (DATASENSEI_CSV) {
      if (!existsSync(DATASENSEI_CSV)) { console.error(`Data Sensei CSV not found: ${DATASENSEI_CSV}`); process.exit(1); }
      dsMap = parseCsvSimple(readFileSync(DATASENSEI_CSV, 'utf-8'));
    }
    const hasDs = dsMap.size > 0;

    // Build rows with deltas
    const report = rows.map(r => {
      const agent = parseFloat(r.agent_composite) || 0;
      const ds = hasDs ? (dsMap.get(r.index_name.toLowerCase()) ?? null) : null;
      const delta = ds !== null ? Math.round((agent - ds) * 10) / 10 : null;
      return { ...r, agent_composite: agent, datasensei: ds, delta };
    });

    mkdirSync(OUT_DIR, { recursive: true });

    // ── CSV ──
    const csvHeader = ['index', 'agent_composite', 'datasensei_score', 'delta', 'utilization', 'detection', 'quality', 'tier', 'daily_gb', 'annual_cost'];
    const csvLines = [csvHeader.join(',')];
    for (const r of report) {
      csvLines.push([
        r.index_name, r.agent_composite, r.datasensei ?? '', r.delta ?? '',
        r.utilization, r.detection, r.quality, r.tier, r.daily_gb, r.annual_cost,
      ].join(','));
    }
    const csvPath = join(OUT_DIR, 'tally-report.csv');
    writeFileSync(csvPath, csvLines.join('\n'));

    // ── HTML ──
    const within = (d) => d === null ? '' : Math.abs(d) <= 2 ? 'ok' : Math.abs(d) <= 5 ? 'warn' : 'bad';
    const htmlRows = report.map(r => `
      <tr>
        <td class="idx">${r.index_name}</td>
        <td class="num">${r.agent_composite.toFixed(1)}</td>
        <td class="num">${r.datasensei !== null ? r.datasensei.toFixed(1) : '<span class=muted>—</span>'}</td>
        <td class="num ${within(r.delta)}">${r.delta !== null ? (r.delta > 0 ? '+' : '') + r.delta.toFixed(1) : ''}</td>
        <td class="num muted">${r.utilization}</td>
        <td class="num muted">${r.detection}</td>
        <td class="num muted">${r.quality}</td>
        <td><span class="tier ${String(r.tier).toLowerCase().replace(/[^a-z]/g,'')}">${r.tier}</span></td>
        <td class="num muted">${r.daily_gb}</td>
        <td class="num muted">$${Number(r.annual_cost).toLocaleString()}</td>
      </tr>`).join('');

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>datasensAI ↔ Data Sensei Tally</title>
<style>
 body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e2e8f0;margin:0;padding:2rem}
 h1{font-size:1.4rem;margin:0 0 .25rem}.sub{color:#94a3b8;font-size:.8rem;margin-bottom:1.5rem}
 .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;margin-bottom:1.5rem}
 .kpi{background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:1rem}
 .kpi .l{font-size:.62rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em}
 .kpi .v{font-size:1.6rem;font-weight:800;color:#f8fafc}
 table{width:100%;border-collapse:collapse;font-size:.82rem;background:#0f172a;border-radius:10px;overflow:hidden}
 th{background:#111c30;color:#94a3b8;text-align:left;padding:.6rem .75rem;font-size:.65rem;text-transform:uppercase;letter-spacing:.04em}
 td{padding:.5rem .75rem;border-top:1px solid #1e293b}.num{text-align:right;font-variant-numeric:tabular-nums}
 .idx{font-weight:600;color:#f8fafc}.muted{color:#64748b}
 .ok{color:#22c55e}.warn{color:#f59e0b}.bad{color:#ef4444;font-weight:700}
 .tier{padding:.1rem .45rem;border-radius:4px;font-size:.65rem;font-weight:700}
 .tier.critical{background:#22c55e22;color:#22c55e}.tier.important{background:#3b82f622;color:#3b82f6}
 .tier.nicetohave{background:#f59e0b22;color:#f59e0b}.tier.lowvalue{background:#ef444422;color:#ef4444}
 .legend{margin-top:1rem;font-size:.7rem;color:#64748b}
</style></head><body>
 <h1>datasensAI ↔ Data Sensei — Score Tally</h1>
 <div class="sub">Generated ${new Date().toISOString()} · tenant ${tenantId} · ${report.length} indexes${hasDs ? '' : ' · Data Sensei column awaiting export (--datasensei)'}</div>
 <div class="kpis">
   <div class="kpi"><div class="l">ROI Score</div><div class="v">${Number(kpiRow.roi_score || 0).toFixed(1)}</div></div>
   <div class="kpi"><div class="l">GainScope %</div><div class="v">${Number(kpiRow.gainscope_score || 0).toFixed(1)}%</div></div>
   <div class="kpi"><div class="l">Total GB/day</div><div class="v">${Number(kpiRow.total_daily_gb || 0).toFixed(1)}</div></div>
   <div class="kpi"><div class="l">Sourcetypes</div><div class="v">${kpiRow.total_sourcetypes || report.length}</div></div>
   <div class="kpi"><div class="l">Low-Value Spend</div><div class="v">$${Math.round(Number(kpiRow.license_spend_low_value || 0)).toLocaleString()}</div></div>
 </div>
 <table>
   <thead><tr><th>Index</th><th class=num>Agent</th><th class=num>Data Sensei</th><th class=num>Δ</th>
     <th class=num>Util</th><th class=num>Det</th><th class=num>Qual</th><th>Tier</th><th class=num>GB/day</th><th class=num>Annual $</th></tr></thead>
   <tbody>${htmlRows}</tbody>
 </table>
 <div class="legend">Δ tolerance: <span class="ok">≤2 green</span> · <span class="warn">≤5 amber</span> · <span class="bad">&gt;5 red</span>. GB-derived differences up to ±2% are expected (license_usage vs tstats measurement).</div>
</body></html>`;
    const htmlPath = join(OUT_DIR, 'tally-report.html');
    writeFileSync(htmlPath, html);

    console.log(`✓ Tally report written:`);
    console.log(`  ${csvPath}`);
    console.log(`  ${htmlPath}`);
    console.log(`  ${report.length} indexes${hasDs ? ` · compared against ${dsMap.size} Data Sensei rows` : ' · agent-only (pass --datasensei <file> to compare)'}`);
    if (hasDs) {
      const over = report.filter(r => r.delta !== null && Math.abs(r.delta) > 5).length;
      console.log(`  ${over} indexes exceed ±5 composite delta`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error('✗ tally export failed:', e.message); process.exit(1); });
