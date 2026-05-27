#!/usr/bin/env node
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os',
});

function uuid() {
  return crypto.randomUUID();
}

const TENANT_ID = process.env.TENANT_ID || 'e84f31d3-d285-46a1-a0d0-2f64698cd0df';

const INDEXES = [
  { index: 'main',          sourcetype: 'access_combined', events: 450000, gb: 2.3, classification: 'KEEP' },
  { index: 'main',          sourcetype: 'syslog',          events: 820000, gb: 1.8, classification: 'KEEP' },
  { index: 'security',      sourcetype: 'wineventlog',     events: 320000, gb: 0.9, classification: 'KEEP' },
  { index: 'security',      sourcetype: 'crowdstrike',     events: 120000, gb: 0.4, classification: 'KEEP' },
  { index: 'network',       sourcetype: 'cisco:asa',       events: 680000, gb: 3.1, classification: 'OPTIMIZE' },
  { index: 'audit',         sourcetype: '_json',           events: 25000,  gb: 0.1, classification: 'ARCHIVE' },
  { index: 'cloudtrail',    sourcetype: 'aws:cloudtrail',  events: 95000,  gb: 0.3, classification: 'KEEP' },
  { index: 'infra',         sourcetype: 'linux:syslog',    events: 1200000, gb: 2.7, classification: 'OPTIMIZE' },
  { index: '_internal',     sourcetype: 'splunkd',         events: 50000,  gb: 0.2, classification: 'ELIMINATE' },
  { index: 'applications',  sourcetype: 'nginx:access',    events: 310000, gb: 1.1, classification: 'KEEP' },
];

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d;
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify tenant exists
    const tenantCheck = await client.query('SELECT id FROM tenants WHERE id = $1', [TENANT_ID]);
    if (tenantCheck.rows.length === 0) {
      console.error(`Tenant ${TENANT_ID} not found. Run init first.`);
      await client.query('ROLLBACK');
      process.exit(1);
    }

    // Create 3 publishes: 10 days ago, 6 days ago, 2 days ago
    const publishDates = [10, 6, 2];

    for (let i = 0; i < publishDates.length; i++) {
      const daysBack = publishDates[i];
      const snapshotId = uuid();
      const runId = uuid();
      const publishDate = daysAgo(daysBack);
      const dateStr = publishDate.toISOString().split('T')[0];

      // Pipeline run
      await client.query(
        `INSERT INTO pipeline_runs (run_id, snapshot_id, tenant_id, status, published, started_at, published_at,
          pipeline_version, model_version, prompt_version, splunk_query_version,
          total_llm_tokens, total_llm_latency_ms, fallback_triggered)
         VALUES ($1,$2,$3,'SUCCEEDED',true,$4,$4,'1.0.0','gemma2:9b','2.0','1.0',1500,4200,false)`,
        [runId, snapshotId, TENANT_ID, publishDate]
      );

      // Pre-compute deterministic per-index scores so executive_kpis can be derived consistently
      const indexScores = INDEXES.map((idx) => {
        const baseScore = 55 + i * 5;
        const util = Math.round((baseScore - 5 + idx.gb * 15 + (i * 2)) * 10) / 10;
        const det = Math.round((baseScore + 10 + idx.gb * 10 + (i * 1.5)) * 10) / 10;
        const qual = Math.round((baseScore + 15 + idx.gb * 8 + (i * 2)) * 10) / 10;
        const comp = Math.round(Math.min(100, Math.max(0, (util * 0.35 + det * 0.40 + qual * 0.25))) * 10) / 10;
        const tier = comp >= 65 ? 'critical' : comp >= 40 ? 'important' : comp >= 20 ? 'nice-to-have' : 'low-value';
        const action = idx.classification === 'KEEP' ? 'KEEP' : idx.classification === 'OPTIMIZE' ? 'OPTIMIZE' : idx.classification === 'ARCHIVE' ? 'ARCHIVE' : 'ELIMINATE';
        const dailyGb = Math.round(idx.gb * (1 + (i - 1) * 0.03) * 10000) / 10000;
        return { ...idx, dailyGb, util, det, qual, comp, tier, action };
      });

      // Telemetry snapshots (index-level rows)
      for (const is of indexScores) {
        const events = Math.round(is.events * (1 + (i - 1) * 0.02));
        const costYear = Math.round(is.dailyGb * 365 * 150);
        const riskScore = is.classification === 'ARCHIVE' || is.classification === 'ELIMINATE' ? 70 + i * 5 : 20 + i * 10;

        await client.query(
          `INSERT INTO telemetry_snapshots
           (snapshot_id, snapshot_date, granularity, index_name, sourcetype, total_events, daily_avg_gb,
            retention_days, utilization_pct, cost_per_year, risk_score, classification, confidence, tenant_id)
           VALUES ($1,$2,'index',$3,$4,$5,$6,90,$7,$8,$9,$10,$11,$12)`,
          [snapshotId, dateStr, is.index, is.sourcetype, events, is.dailyGb, is.util, costYear, riskScore, is.classification, 0.85 + i * 0.03, TENANT_ID]
        );
      }

      // Agent decisions
      for (const is of indexScores) {
        const isQw = is.classification === 'ARCHIVE' || is.classification === 'ELIMINATE';
        const annualCost = Math.round(is.dailyGb * 365 * 150 * 100) / 100;
        await client.query(
          `INSERT INTO agent_decisions
           (snapshot_id, snapshot_date, index_name, sourcetype, tenant_id,
            tier, action, composite_score, utilization_score, detection_score, quality_score,
            annual_license_cost, estimated_savings, confidence, is_quick_win,
            recommendation, reasoning, model_provider, model_name, tokens_processed, latency_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          [
            snapshotId, dateStr, is.index, is.sourcetype, TENANT_ID,
            is.tier, is.action,
            is.comp, is.util, is.det, is.qual,
            annualCost,
            Math.round(is.dailyGb * 365 * 75 * 100) / 100,
            Math.round((0.7 + i * 0.05) * 10000) / 10000,
            isQw,
            is.classification === 'KEEP' ? 'Retain index for security monitoring' :
              is.classification === 'OPTIMIZE' ? 'Review retention and reduce volume' :
              is.classification === 'ARCHIVE' ? 'Move to cold storage' : 'Eliminate low-value data',
            `Analysis suggests ${is.classification === 'KEEP' ? 'ongoing security value' : is.classification === 'OPTIMIZE' ? 'optimization opportunity' : is.classification === 'ARCHIVE' ? 'archival candidate' : 'low-value data elimination'}`,
            'ollama', 'gemma2:9b', Math.round(800 + i * 100), Math.round(2000 + i * 500),
          ]
        );
      }

      // Compute executive_kpis deterministically from indexScores
      const composites = indexScores.map(s => s.comp);
      const roiScore = Math.round((composites.reduce((a, b) => a + b, 0) / composites.length) * 10) / 10;

      const tier12Gb = indexScores.filter(s => s.tier === 'critical' || s.tier === 'important').reduce((sum, s) => sum + s.dailyGb, 0);
      const totalGb = indexScores.reduce((sum, s) => sum + s.dailyGb, 0);
      const gainScope = totalGb > 0 ? Math.round((tier12Gb / totalGb) * 100 * 10) / 10 : 0;

      const avgUtil = Math.round(indexScores.reduce((sum, s) => sum + s.util, 0) / indexScores.length * 100) / 100;
      const avgDet = Math.round(indexScores.reduce((sum, s) => sum + s.det, 0) / indexScores.length * 100) / 100;
      const avgQual = Math.round(indexScores.reduce((sum, s) => sum + s.qual, 0) / indexScores.length * 100) / 100;

      const tierCritical = indexScores.filter(s => s.tier === 'critical').length;
      const tierImportant = indexScores.filter(s => s.tier === 'important').length;
      const tierNiceToHave = indexScores.filter(s => s.tier === 'nice-to-have').length;
      const tierLowValue = indexScores.filter(s => s.tier === 'low-value').length;

      const totalLicenseSpend = Math.round(indexScores.reduce((sum, s) => sum + s.dailyGb, 0) * 365 * 150);
      const lowValueSpend = Math.round(indexScores.filter(s => s.tier === 'nice-to-have' || s.tier === 'low-value').reduce((sum, s) => sum + s.dailyGb * 365 * 150, 0));
      const savingsPotential = Math.round(indexScores.filter(s => s.action !== 'KEEP').reduce((sum, s) => sum + s.dailyGb * 365 * 75, 0));

      await client.query(
        `INSERT INTO executive_kpis
         (snapshot_id, snapshot_date, tenant_id,
          roi_score, gainscope_score, total_license_spend, license_spend_low_value,
          storage_savings_potential, total_daily_gb, total_sourcetypes,
          tier_critical, tier_important, tier_nice_to_have, tier_low_value,
          security_gaps, operational_gaps, avg_utilization, avg_detection, avg_quality, avg_confidence)
         VALUES ($1,$2,$3,
          $4,$5,$6,$7,
          $8,$9,$10,
          $11,$12,$13,$14,
          $15,$16,$17,$18,$19,$20)`,
        [
          snapshotId, dateStr, TENANT_ID,
          roiScore, gainScope, totalLicenseSpend, lowValueSpend,
          savingsPotential, Math.round(totalGb * 10000) / 10000, indexScores.length,
          tierCritical, tierImportant, tierNiceToHave, tierLowValue,
          Math.max(0, 3 - i), Math.max(0, 4 - i),
          avgUtil, avgDet, avgQual,
          Math.round((75 + i * 4) * 100) / 100,
        ]
      );

      console.log(`  ✓ Published snapshot ${i + 1}/3 (date: ${dateStr}, snapshot: ${snapshotId})`);
    }

    // Update tenant_snapshot_pointer to point to the latest run
    const lastRun = await client.query(
      `SELECT run_id, snapshot_id FROM pipeline_runs
       WHERE tenant_id = $1 AND status = 'SUCCEEDED' AND published = true
       ORDER BY published_at DESC LIMIT 1`,
      [TENANT_ID]
    );
    if (lastRun.rows.length > 0) {
      await client.query(
        `INSERT INTO tenant_snapshot_pointer (tenant_id, active_run_id, active_snapshot_id, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (tenant_id) DO UPDATE SET
           active_run_id = $2, active_snapshot_id = $3, updated_at = NOW()`,
        [TENANT_ID, lastRun.rows[0].run_id, lastRun.rows[0].snapshot_id]
      );
      console.log('  ✓ tenant_snapshot_pointer updated');
    }

    // Detail seed data: field_usage, security_coverage, quality_hotspots, search_audit, decision_lineage
    for (let i = 0; i < publishDates.length; i++) {
      const daysBack = publishDates[i];
      const dateStr = daysAgo(daysBack).toISOString().split('T')[0];
      const detailSnapshotId = (
        await client.query(
          `SELECT snapshot_id FROM pipeline_runs WHERE tenant_id = $1 AND published_at::date = $2::date AND status = 'SUCCEEDED' ORDER BY published_at DESC LIMIT 1`,
          [TENANT_ID, dateStr]
        )
      ).rows[0]?.snapshot_id;
      if (!detailSnapshotId) continue;

      for (const idx of INDEXES) {
        // field_usage
        const fi = Math.round(150 + idx.events / 8000 + idx.gb * 20);
        const fu = Math.round(fi * Math.min(0.92, 0.5 + idx.gb * 0.08));
        await client.query(
          `INSERT INTO field_usage (snapshot_date, sourcetype, fields_indexed, fields_used, optimization_pct)
           VALUES ($1,$2,$3,$4,$5)`,
          [dateStr, idx.sourcetype, fi, fu, Math.round(fi > 0 ? ((fi - fu) / fi) * 100 : 0)]
        );

        // security_coverage
        await client.query(
          `INSERT INTO security_coverage (snapshot_date, sourcetype, coverage_pct, active_alerts, detection_gaps)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            dateStr, idx.sourcetype,
            Math.round((55 + i * 8 + idx.gb * 10) * 10) / 10,
            Math.round(idx.classification === 'KEEP' ? 10 + i * 3 : 1 + i),
            Math.round(idx.classification === 'KEEP' ? 1 : 3 + i),
          ]
        );

        // quality_hotspots
        await client.query(
          `INSERT INTO quality_hotspots (snapshot_date, sourcetype, issue_count, quality_score, estimated_impact)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            dateStr, idx.sourcetype,
            Math.round(Math.max(0, 30 - idx.gb * 25 - i * 5)),
            Math.round((60 + idx.gb * 15 + i * 4) * 10) / 10,
            idx.classification === 'KEEP' ? 'low' : idx.classification === 'OPTIMIZE' ? 'medium' : 'high',
          ]
        );

        // decision_lineage (backfill into review queue)
        const compScore = await client.query(
          `SELECT composite_score FROM agent_decisions WHERE tenant_id = $1 AND snapshot_id = $2 AND index_name = $3 LIMIT 1`,
          [TENANT_ID, detailSnapshotId, idx.index]
        );
        if (compScore.rows.length > 0) {
          await client.query(
            `INSERT INTO decision_lineage (snapshot_id, index_name, sourcetype, deterministic_signals, cognitive_signals, decision_status, fingerprint_version, calibrated_confidence)
             VALUES ($1,$2,$3,$4,$5,'PROPOSED','v1',$6)
             ON CONFLICT DO NOTHING`,
            [
              detailSnapshotId, idx.index, idx.sourcetype,
              JSON.stringify({ utilization_pct: 50 + i * 5, cost_per_year_usd: Math.round(idx.gb * 365 * 150), signal_source: 'DETERMINISTIC' }),
              JSON.stringify({ confidence_score: 0.75 + i * 0.05, reasoning: `Auto-backfill from seed for ${idx.index}`, signal_source: 'AI' }),
              Math.round((0.7 + i * 0.05) * 100) / 100,
            ]
          );
        }
      }

      // search_audit
      for (let s = 0; s < 12; s++) {
        const searchNames = ['Splunk - Audit - summary', 'Splunk - Audit - sourcetype', 'Splunk - All events search (last 60 minutes)', 'Errors in the last 24 hours', 'Indexing Dashboard - Indexes', 'Hosts by sourcetype', 'Search Optimization Report', 'All Indexes Overview', 'Security - Notable Events', 'Security - Threat Campaigns', 'Operational - Last 24 hours', 'Maintenance - Index Monitoring'];
        const searchTypes = ['adhoc', 'adhoc', 'scheduled', 'scheduled', 'scheduled', 'scheduled', 'scheduled', 'scheduled', 'alert', 'alert', 'adhoc', 'scheduled'];
        const riskLevels = ['LOW', 'LOW', 'LOW', 'MEDIUM', 'LOW', 'MEDIUM', 'HIGH', 'LOW', 'HIGH', 'MEDIUM', 'LOW', 'LOW'];
        const apps = ['search', 'search', 'search', 'search', 'search', 'search', 'search', 'search', 'SA-ThreatIntelligence', 'SA-ThreatIntelligence', 'search', 'search'];
        const statuses = ['enabled', 'enabled', 'enabled', 'disabled', 'enabled', 'enabled', 'disabled', 'enabled', 'enabled', 'enabled', 'enabled', 'disabled'];
        await client.query(
          `INSERT INTO search_audit (snapshot_date, search_name, search_type, app, schedule, is_scheduled, is_alert, last_run, confidence_score, reason, status, risk_level, is_unused, tenant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() - INTERVAL '${i * 2} hours',$8,$9,$10,$11,$12,$13)`,
          [
            dateStr, searchNames[s], searchTypes[s], apps[s],
            searchTypes[s] === 'scheduled' ? '*/30 * * * *' : null,
            searchTypes[s] === 'scheduled', searchTypes[s] === 'alert',
            Math.round((80 - s * 3 + i * 2) * 10) / 10,
            statuses[s] === 'disabled' ? 'Not needed - no longer relevant' : 'Active search',
            statuses[s], riskLevels[s],
            statuses[s] === 'disabled',
            TENANT_ID,
          ]
        );
      }
    }

    await client.query('COMMIT');
    console.log('\n✓ Seed complete: 3 publishes inserted with trends data');
    console.log('  - pipeline_runs: 3 rows');
    console.log(`  - telemetry_snapshots: ${INDEXES.length * 3} rows`);
    console.log('  - executive_kpis: 3 rows');
    console.log(`  - agent_decisions: ${INDEXES.length * 3} rows`);
    console.log('  - field_usage: seeded');
    console.log('  - security_coverage: seeded');
    console.log('  - quality_hotspots: seeded');
    console.log('  - search_audit: 36 rows');
    console.log('  - decision_lineage: seeded');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✗ Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
