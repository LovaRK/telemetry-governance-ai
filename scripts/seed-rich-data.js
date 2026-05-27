#!/usr/bin/env node
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os',
});

const TENANT_ID = '4fb5e7fd-895e-4320-a080-8a2380659296';
const SNAPSHOT_ID = crypto.randomUUID();
const TODAY = new Date().toISOString().split('T')[0];
const RUN_ID = crypto.randomUUID();
const PUBLISHED_AT = new Date().toISOString();

const TIERS = ['Critical', 'Important', 'Nice-to-Have', 'Low-Value'];
const ACTIONS = ['KEEP', 'OPTIMIZE', 'ARCHIVE', 'ELIMINATE'];

const SOURCETYPES = [
  // Critical: high utilization, high detection, high quality
  { index: 'security', sourcetype: 'WinEventLog:Security', tier: 'Critical', action: 'KEEP', util: 92, det: 96, qual: 98, composite: 95.0, dailyGb: 35.2, retentionDays: 365, totalEvents: 7200000, costPerYear: 45600, savings: 0, riskScore: 15, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.95, alerts: 120, scheduled: 310, dashboards: 41, users: 210, adhoc: 6100, mitreCount: 68, lanternCount: 10, issues: 2, evidence: ['Highest utilization score across all sources', 'Critical security signals (MITRE 68 techniques)', 'Active alert coverage: 120 alerts configured'] },
  { index: 'security', sourcetype: 'o365:management:activity', tier: 'Critical', action: 'KEEP', util: 88, det: 93, qual: 95, composite: 91.4, dailyGb: 28.5, retentionDays: 365, totalEvents: 5800000, costPerYear: 36900, savings: 0, riskScore: 18, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.92, alerts: 85, scheduled: 220, dashboards: 34, users: 180, adhoc: 4200, mitreCount: 63, lanternCount: 8, issues: 1, evidence: ['Office 365 management activity: high business value', 'Strong detection posture with 85 active alerts', 'Comprehensive MITRE coverage across cloud domains'] },
  { index: 'endpoint', sourcetype: 'crowdstrike:events', tier: 'Critical', action: 'KEEP', util: 82, det: 96, qual: 93, composite: 89.7, dailyGb: 22.1, retentionDays: 365, totalEvents: 3400000, costPerYear: 28600, savings: 0, riskScore: 12, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.94, alerts: 95, scheduled: 180, dashboards: 28, users: 95, adhoc: 2800, mitreCount: 72, lanternCount: 9, issues: 3, evidence: ['CrowdStrike EDR: highest detection coverage', '72 MITRE techniques mapped', 'Critical endpoint security data source'] },
  { index: 'security', sourcetype: 'linux:secure', tier: 'Critical', action: 'KEEP', util: 78, det: 90, qual: 91, composite: 85.6, dailyGb: 18.4, retentionDays: 365, totalEvents: 4100000, costPerYear: 23800, savings: 0, riskScore: 20, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.90, alerts: 52, scheduled: 140, dashboards: 22, users: 75, adhoc: 3200, mitreCount: 45, lanternCount: 6, issues: 4, evidence: ['Linux auth logs: security-critical', '45 MITRE techniques detected', 'SSH/key-based attack coverage'] },
  { index: 'cloud', sourcetype: 'aws:cloudtrail', tier: 'Critical', action: 'KEEP', util: 75, det: 92, qual: 88, composite: 84.2, dailyGb: 25.0, retentionDays: 365, totalEvents: 6200000, costPerYear: 32400, savings: 0, riskScore: 22, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.91, alerts: 60, scheduled: 200, dashboards: 30, users: 120, adhoc: 3800, mitreCount: 50, lanternCount: 7, issues: 5, evidence: ['AWS CloudTrail: full API audit trail', '50 MITRE techniques covered', 'Essential for cloud security monitoring'] },
  { index: 'endpoint', sourcetype: 'WinEventLog:System', tier: 'Critical', action: 'KEEP', util: 80, det: 88, qual: 92, composite: 86.0, dailyGb: 15.8, retentionDays: 365, totalEvents: 2800000, costPerYear: 20500, savings: 0, riskScore: 16, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.89, alerts: 48, scheduled: 160, dashboards: 18, users: 185, adhoc: 2500, mitreCount: 38, lanternCount: 5, issues: 2, evidence: ['Windows system events: service/task monitoring', '38 MITRE techniques for persistence detection', 'Widely used across security teams'] },

  // Important: good utilization/detection, some gaps
  { index: 'network', sourcetype: 'cisco:asa', tier: 'Important', action: 'OPTIMIZE', util: 62, det: 72, qual: 85, composite: 71.2, dailyGb: 15.0, retentionDays: 180, totalEvents: 2200000, costPerYear: 19400, savings: 2400, riskScore: 30, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.85, alerts: 34, scheduled: 90, dashboards: 15, users: 70, adhoc: 1800, mitreCount: 29, lanternCount: 4, issues: 4, evidence: ['Cisco ASA: network security monitoring', '29 MITRE techniques', 'Reduce retention from 365 to 180 days to save costs'] },
  { index: 'network', sourcetype: 'pan:traffic', tier: 'Important', action: 'OPTIMIZE', util: 58, det: 68, qual: 82, composite: 67.8, dailyGb: 12.5, retentionDays: 180, totalEvents: 1800000, costPerYear: 16200, savings: 3200, riskScore: 28, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.83, alerts: 22, scheduled: 70, dashboards: 10, users: 45, adhoc: 1400, mitreCount: 22, lanternCount: 3, issues: 6, evidence: ['Palo Alto firewall traffic', '22 MITRE techniques covered', 'Retention optimization candidate'] },
  { index: 'app', sourcetype: 'apache:access', tier: 'Important', action: 'OPTIMIZE', util: 55, det: 52, qual: 90, composite: 62.5, dailyGb: 20.0, retentionDays: 90, totalEvents: 4500000, costPerYear: 25900, savings: 5000, riskScore: 35, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.80, alerts: 12, scheduled: 45, dashboards: 8, users: 35, adhoc: 2200, mitreCount: 8, lanternCount: 2, issues: 1, evidence: ['Apache web access logs: high volume', 'Moderate detection value', 'Consider reducing verbosity'] },
  { index: 'infra', sourcetype: 'vcenter:events', tier: 'Important', action: 'OPTIMIZE', util: 52, det: 56, qual: 80, composite: 60.8, dailyGb: 4.5, retentionDays: 365, totalEvents: 600000, costPerYear: 5800, savings: 1000, riskScore: 25, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.78, alerts: 8, scheduled: 35, dashboards: 5, users: 20, adhoc: 800, mitreCount: 12, lanternCount: 2, issues: 8, evidence: ['VMware vCenter events', 'Infrastructure visibility', 'Moderate utilization but useful for operations'] },
  { index: 'identity', sourcetype: 'okta:events', tier: 'Important', action: 'KEEP', util: 68, det: 82, qual: 90, composite: 78.3, dailyGb: 10.2, retentionDays: 365, totalEvents: 1800000, costPerYear: 13200, savings: 0, riskScore: 20, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.87, alerts: 40, scheduled: 110, dashboards: 16, users: 85, adhoc: 2100, mitreCount: 35, lanternCount: 5, issues: 2, evidence: ['Okta SSO events: IAM security', '35 MITRE techniques for identity', 'Growing utilization trend'] },
  { index: 'cloud', sourcetype: 'gws:activity', tier: 'Important', action: 'OPTIMIZE', util: 60, det: 75, qual: 88, composite: 72.4, dailyGb: 9.0, retentionDays: 180, totalEvents: 1400000, costPerYear: 11700, savings: 2800, riskScore: 24, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.82, alerts: 20, scheduled: 65, dashboards: 12, users: 55, adhoc: 1500, mitreCount: 25, lanternCount: 4, issues: 3, evidence: ['Google Workspace audit logs', '25 MITRE techniques', 'Reduce retention to 180 days'] },
  { index: 'app', sourcetype: 'nginx:error', tier: 'Important', action: 'OPTIMIZE', util: 48, det: 42, qual: 88, composite: 55.4, dailyGb: 8.0, retentionDays: 90, totalEvents: 900000, costPerYear: 10400, savings: 3500, riskScore: 32, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.75, alerts: 6, scheduled: 30, dashboards: 4, users: 25, adhoc: 1200, mitreCount: 5, lanternCount: 1, issues: 2, evidence: ['Nginx error logs: debugging value', 'Low detection but important for app ops', 'Prune after 90 days'] },
  { index: 'infra', sourcetype: 'syslog:kernel', tier: 'Important', action: 'KEEP', util: 58, det: 62, qual: 85, composite: 66.3, dailyGb: 6.5, retentionDays: 365, totalEvents: 1100000, costPerYear: 8400, savings: 0, riskScore: 28, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.84, alerts: 18, scheduled: 55, dashboards: 8, users: 40, adhoc: 900, mitreCount: 20, lanternCount: 3, issues: 5, evidence: ['Linux kernel syslog: system health', '20 MITRE techniques', 'Stable utilization across teams'] },

  // Nice-to-Have: moderate scores, lower business impact
  { index: 'app', sourcetype: 'tomcat:access', tier: 'Nice-to-Have', action: 'ARCHIVE', util: 35, det: 28, qual: 85, composite: 45.4, dailyGb: 14.0, retentionDays: 90, totalEvents: 300000, costPerYear: 18100, savings: 12000, riskScore: 40, isQuickWin: true, isS3: true, detectionGap: false, confidence: 0.72, alerts: 4, scheduled: 5, dashboards: 2, users: 6, adhoc: 120, mitreCount: 5, lanternCount: 0, issues: 12, evidence: ['Tomcat access logs: low search count (120 adhoc)', 'High volume (14 GB/day) for minimal usage', 'Archive to S3 after 30 days'] },
  { index: 'infra', sourcetype: 'kubernetes:events', tier: 'Nice-to-Have', action: 'OPTIMIZE', util: 30, det: 22, qual: 82, composite: 40.4, dailyGb: 8.5, retentionDays: 90, totalEvents: 150000, costPerYear: 11000, savings: 5500, riskScore: 38, isQuickWin: false, isS3: true, detectionGap: false, confidence: 0.68, alerts: 3, scheduled: 8, dashboards: 3, users: 12, adhoc: 200, mitreCount: 8, lanternCount: 1, issues: 8, evidence: ['K8s events: used for pod lifecycle', 'Only 3 alerts configured', 'Move to warm storage after 30 days'] },
  { index: 'app', sourcetype: 'docker:logs', tier: 'Nice-to-Have', action: 'ARCHIVE', util: 28, det: 18, qual: 80, composite: 38.2, dailyGb: 5.0, retentionDays: 30, totalEvents: 800000, costPerYear: 6500, savings: 4000, riskScore: 42, isQuickWin: true, isS3: true, detectionGap: false, confidence: 0.65, alerts: 2, scheduled: 3, dashboards: 1, users: 8, adhoc: 150, mitreCount: 3, lanternCount: 0, issues: 15, evidence: ['Container logs: verbose but rarely searched', 'Only 2 alerts; 150 adhoc searches/month', 'Archive to S3, keep 7 days hot'] },
  { index: 'database', sourcetype: 'mysql:slow', tier: 'Nice-to-Have', action: 'OPTIMIZE', util: 25, det: 12, qual: 88, composite: 37.4, dailyGb: 3.0, retentionDays: 90, totalEvents: 400000, costPerYear: 3900, savings: 1500, riskScore: 35, isQuickWin: false, isS3: false, detectionGap: true, confidence: 0.62, alerts: 0, scheduled: 4, dashboards: 2, users: 10, adhoc: 80, mitreCount: 0, lanternCount: 0, issues: 3, evidence: ['MySQL slow query logs: DBA debugging', 'No MITRE coverage (detection=0)', 'Reduce retention to 30 days'] },
  { index: 'infra', sourcetype: 'haproxy:metrics', tier: 'Nice-to-Have', action: 'KEEP', util: 32, det: 20, qual: 85, composite: 42.0, dailyGb: 2.5, retentionDays: 90, totalEvents: 350000, costPerYear: 3200, savings: 0, riskScore: 30, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.70, alerts: 5, scheduled: 12, dashboards: 4, users: 15, adhoc: 180, mitreCount: 4, lanternCount: 1, issues: 6, evidence: ['HAProxy metrics: load balancer health', 'Moderate utilization from ops team', 'Keep for capacity planning'] },
  { index: 'infra', sourcetype: 'redis:slowlog', tier: 'Nice-to-Have', action: 'ARCHIVE', util: 22, det: 15, qual: 88, composite: 37.4, dailyGb: 1.2, retentionDays: 30, totalEvents: 200000, costPerYear: 1600, savings: 1000, riskScore: 28, isQuickWin: true, isS3: false, detectionGap: false, confidence: 0.60, alerts: 1, scheduled: 2, dashboards: 1, users: 5, adhoc: 60, mitreCount: 2, lanternCount: 0, issues: 4, evidence: ['Redis slow logs: cache debugging', 'Very low usage (60 adhoc searches/month)', 'Short retention sufficient'] },
  { index: 'messaging', sourcetype: 'kafka:broker', tier: 'Nice-to-Have', action: 'KEEP', util: 24, det: 18, qual: 90, composite: 40.2, dailyGb: 4.0, retentionDays: 90, totalEvents: 600000, costPerYear: 5200, savings: 0, riskScore: 25, isQuickWin: false, isS3: false, detectionGap: false, confidence: 0.72, alerts: 4, scheduled: 10, dashboards: 3, users: 18, adhoc: 250, mitreCount: 6, lanternCount: 1, issues: 2, evidence: ['Kafka broker logs: streaming infrastructure', 'Moderate utilization from platform team', 'Keep for operational monitoring'] },

  // Low-Value (Wasteful): low scores, eliminate candidates  
  { index: 'dev', sourcetype: 'dev:app:debug', tier: 'Low-Value', action: 'ELIMINATE', util: 5, det: 8, qual: 60, composite: 19.5, dailyGb: 7.0, retentionDays: 30, totalEvents: 1500000, costPerYear: 9100, savings: 8200, riskScore: 65, isQuickWin: true, isS3: true, detectionGap: false, confidence: 0.88, alerts: 0, scheduled: 2, dashboards: 0, users: 4, adhoc: 35, mitreCount: 2, lanternCount: 0, issues: 45, evidence: ['Debug logs from dev environment', 'Zero dashboards, only 35 adhoc searches', 'High parse error rate (45 issues)'] },
  { index: 'legacy', sourcetype: 'old:infra:logs', tier: 'Low-Value', action: 'ELIMINATE', util: 3, det: 5, qual: 55, composite: 16.8, dailyGb: 5.0, retentionDays: 365, totalEvents: 800000, costPerYear: 6500, savings: 5800, riskScore: 60, isQuickWin: true, isS3: true, detectionGap: false, confidence: 0.85, alerts: 1, scheduled: 1, dashboards: 0, users: 3, adhoc: 20, mitreCount: 1, lanternCount: 0, issues: 35, evidence: ['Legacy infrastructure logs from decommissioned servers', 'Only 1 scheduled search, 20 adhoc/month', '365-day retention on dead data - cut to 30 days then eliminate'] },
  { index: 'poc', sourcetype: 'poc:index', tier: 'Low-Value', action: 'ELIMINATE', util: 2, det: 3, qual: 50, composite: 14.0, dailyGb: 2.0, retentionDays: 365, totalEvents: 50000, costPerYear: 2600, savings: 2400, riskScore: 55, isQuickWin: true, isS3: true, detectionGap: false, confidence: 0.90, alerts: 0, scheduled: 0, dashboards: 0, users: 2, adhoc: 10, mitreCount: 0, lanternCount: 0, issues: 20, evidence: ['POC index from abandoned project', 'Zero scheduled searches, zero dashboards', 'Eliminate immediately'] },
  { index: 'legacy', sourcetype: 'deprecated:app', tier: 'Low-Value', action: 'ELIMINATE', util: 1, det: 0, qual: 45, composite: 11.3, dailyGb: 4.0, retentionDays: 365, totalEvents: 20000, costPerYear: 5200, savings: 4800, riskScore: 58, isQuickWin: true, isS3: true, detectionGap: false, confidence: 0.92, alerts: 0, scheduled: 0, dashboards: 0, users: 1, adhoc: 5, mitreCount: 0, lanternCount: 0, issues: 30, evidence: ['Deprecated application log source', 'App decommissioned 6 months ago', 'Data has zero business value'] },
  { index: 'legacy', sourcetype: 'legacy:syslog', tier: 'Low-Value', action: 'ELIMINATE', util: 2, det: 5, qual: 40, composite: 12.7, dailyGb: 3.0, retentionDays: 730, totalEvents: 100000, costPerYear: 3900, savings: 3500, riskScore: 62, isQuickWin: true, isS3: false, detectionGap: false, confidence: 0.87, alerts: 0, scheduled: 0, dashboards: 0, users: 2, adhoc: 15, mitreCount: 1, lanternCount: 0, issues: 42, evidence: ['Legacy syslog from retired network gear', '730-day retention on 0-value data', 'Eliminate after 30-day grace'] },
  { index: 'app', sourcetype: 'old:tomcat:logs', tier: 'Low-Value', action: 'ELIMINATE', util: 4, det: 2, qual: 35, composite: 11.6, dailyGb: 3.5, retentionDays: 365, totalEvents: 600000, costPerYear: 4500, savings: 4000, riskScore: 55, isQuickWin: true, isS3: true, detectionGap: false, confidence: 0.86, alerts: 0, scheduled: 0, dashboards: 0, users: 3, adhoc: 25, mitreCount: 0, lanternCount: 0, issues: 38, evidence: ['Old Tomcat logs from migrated app', 'App migrated to container 1 year ago', 'Legacy source kept out of caution'] },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Delete old seed data (today's date) ──
    await client.query(`DELETE FROM tenant_snapshot_pointer WHERE tenant_id = $1`, [TENANT_ID]);
    await client.query(`DELETE FROM pipeline_stage_events WHERE run_id IN (SELECT run_id FROM pipeline_runs WHERE tenant_id = $1)`, [TENANT_ID]);
    await client.query(`DELETE FROM pipeline_runs WHERE tenant_id = $1`, [TENANT_ID]);
    await client.query(`DELETE FROM agent_decisions WHERE tenant_id = $1 AND snapshot_date >= $2::date`, [TENANT_ID, TODAY]);
    await client.query(`DELETE FROM telemetry_snapshots WHERE tenant_id = $1 AND snapshot_date >= $2::date`, [TENANT_ID, TODAY]);
    await client.query(`DELETE FROM executive_kpis WHERE tenant_id = $1 AND snapshot_date >= $2::date`, [TENANT_ID, TODAY]);
    await client.query(`DELETE FROM security_coverage WHERE snapshot_date >= $1::date`, [TODAY]);
    await client.query(`DELETE FROM quality_hotspots WHERE snapshot_date >= $1::date`, [TODAY]);
    await client.query(`DELETE FROM field_usage WHERE snapshot_date >= $1::date`, [TODAY]);

    // ── 2. Insert telemetry_snapshots ──
    let totalDailyGb = 0;
    let totalCost = 0;
    let tierCounts = { Critical: 0, Important: 0, 'Nice-to-Have': 0, 'Low-Value': 0 };
    let totalQuickWins = 0;

    for (const s of SOURCETYPES) {
      totalDailyGb += s.dailyGb;
      totalCost += s.costPerYear;
      tierCounts[s.tier]++;
      if (s.isQuickWin) totalQuickWins++;

      const classificationMap = { KEEP: 'KEEP', OPTIMIZE: 'OPTIMIZE', ARCHIVE: 'ARCHIVE', ELIMINATE: 'ELIMINATE' };
      await client.query(`
        INSERT INTO telemetry_snapshots (
          snapshot_id, snapshot_date, granularity, parent_index, index_name, sourcetype,
          total_events, daily_avg_gb, retention_days, utilization_pct, cost_per_year,
          risk_score, classification, confidence, recommendation, evidence, raw_metadata, tenant_id
        ) VALUES ($1, $2::date, 'sourcetype', $3, $4, $5,
          $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17)
        ON CONFLICT (tenant_id, snapshot_id, granularity, index_name, sourcetype) DO UPDATE SET
          total_events = EXCLUDED.total_events, daily_avg_gb = EXCLUDED.daily_avg_gb,
          retention_days = EXCLUDED.retention_days, utilization_pct = EXCLUDED.utilization_pct,
          cost_per_year = EXCLUDED.cost_per_year, risk_score = EXCLUDED.risk_score,
          classification = EXCLUDED.classification, confidence = EXCLUDED.confidence,
          recommendation = EXCLUDED.recommendation, evidence = EXCLUDED.evidence
      `, [
        SNAPSHOT_ID, TODAY, s.sourcetype, s.index, s.sourcetype,
        s.totalEvents, s.dailyGb, s.retentionDays, s.util, s.costPerYear,
        s.riskScore, classificationMap[s.action], s.confidence,
        s.evidence[0] + ' | ' + (s.evidence[1] || ''),
        JSON.stringify(s.evidence),
        JSON.stringify({ source: 'seed-rich-data', tier: s.tier, compositeScore: s.composite }),
        TENANT_ID
      ]);
    }

    // ── 3. Insert agent_decisions ──
    for (const s of SOURCETYPES) {
      const confScore = Math.round(s.confidence * 100);
      const recommendation = s.action === 'KEEP' ? `Maintain ${s.sourcetype} — ${s.tier} tier with strong metrics.` :
        s.action === 'OPTIMIZE' ? `Optimize ${s.sourcetype} — reduce retention, prune unused fields.` :
        s.action === 'ARCHIVE' ? `Archive ${s.sourcetype} to S3 after 30 days hot retention.` :
        `Eliminate ${s.sourcetype} — ${s.tier} tier, ${s.dailyGb.toFixed(1)} GB/day, $${s.savings.toFixed(0)}/yr savings.`;
      const reasoning = `${s.sourcetype} scores: utilization=${s.util}/100, detection=${s.det}/100, quality=${s.qual}/100. ` +
        `Composite=${s.composite} (${s.tier}). Action: ${s.action}. Annual cost: $${s.costPerYear.toFixed(0)}.`;

      await client.query(`
        INSERT INTO agent_decisions (
          snapshot_id, snapshot_date, index_name, sourcetype,
          tier, action, composite_score, utilization_score, detection_score,
          quality_score, risk_score, annual_license_cost, estimated_savings,
          confidence, confidence_score, recommendation, reasoning, evidence,
          is_quick_win, is_s3_candidate, detection_gap, tenant_id,
          candidate_reason, model_provider, model_name
        ) VALUES ($1, $2::date, $3, $4,
          $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18::jsonb,
          $19, $20, $21, $22,
          $23, $24, $25)
        ON CONFLICT (tenant_id, snapshot_id, index_name, sourcetype) DO UPDATE SET
          tier = EXCLUDED.tier, action = EXCLUDED.action,
          composite_score = EXCLUDED.composite_score,
          annual_license_cost = EXCLUDED.annual_license_cost,
          estimated_savings = EXCLUDED.estimated_savings,
          recommendation = EXCLUDED.recommendation
      `, [
        SNAPSHOT_ID, TODAY, s.index, s.sourcetype,
        s.tier, s.action, s.composite, s.util, s.det, s.qual,
        s.riskScore, s.costPerYear, s.savings,
        s.confidence, confScore, recommendation, reasoning,
        JSON.stringify(s.evidence),
        s.isQuickWin, s.isS3, s.detectionGap, TENANT_ID,
        s.tier === 'Low-Value' ? ['ZERO_UTILIZATION', 'HIGH_COST'] :
          s.tier === 'Nice-to-Have' ? ['LOW_UTILIZATION'] :
          s.tier === 'Important' ? ['MODERATE_UTILIZATION'] : ['CRITICAL_SOURCE'],
        'ollama', 'gemma2:9b'
      ]);
    }

    // ── 4. Compute executive KPIs ──
    const criticalGb = SOURCETYPES.filter(s => s.tier === 'Critical').reduce((sum, s) => sum + s.dailyGb, 0);
    const importantGb = SOURCETYPES.filter(s => s.tier === 'Important').reduce((sum, s) => sum + s.dailyGb, 0);
    const niceGb = SOURCETYPES.filter(s => s.tier === 'Nice-to-Have').reduce((sum, s) => sum + s.dailyGb, 0);
    const lowGb = SOURCETYPES.filter(s => s.tier === 'Low-Value').reduce((sum, s) => sum + s.dailyGb, 0);
    const totalGb = totalDailyGb;
    const gainScope = totalGb > 0 ? Math.round(((criticalGb + importantGb) / totalGb) * 1000) / 10 : 0;
    const avgUtil = Math.round(SOURCETYPES.reduce((sum, s) => sum + s.util, 0) / SOURCETYPES.length * 10) / 10;
    const avgDet = Math.round(SOURCETYPES.reduce((sum, s) => sum + s.det, 0) / SOURCETYPES.length * 10) / 10;
    const avgQual = Math.round(SOURCETYPES.reduce((sum, s) => sum + s.qual, 0) / SOURCETYPES.length * 10) / 10;
    const avgConf = Math.round(SOURCETYPES.reduce((sum, s) => sum + s.confidence, 0) / SOURCETYPES.length * 1000) / 10;
    const roiScore = Math.round(SOURCETYPES.reduce((sum, s) => sum + s.composite, 0) / SOURCETYPES.length * 10) / 10;
    const lowValueCost = SOURCETYPES.filter(s => s.tier === 'Low-Value' || s.tier === 'Nice-to-Have').reduce((sum, s) => sum + s.costPerYear, 0);
    const totalSavings = SOURCETYPES.reduce((sum, s) => sum + s.savings, 0);
    const criticalCount = SOURCETYPES.filter(s => s.tier === 'Critical').length;
    const importantCount = SOURCETYPES.filter(s => s.tier === 'Important').length;
    const niceCount = SOURCETYPES.filter(s => s.tier === 'Nice-to-Have').length;
    const lowCount = SOURCETYPES.filter(s => s.tier === 'Low-Value').length;
    const securityGaps = SOURCETYPES.filter(s => s.detectionGap).length;
    const quickWinsList = SOURCETYPES.filter(s => s.isQuickWin).map(s => ({
      indexName: s.sourcetype, action: s.action, savings: s.savings, tier: s.tier,
      reasoning: s.evidence[0]
    }));
    const savingsStaircase = [
      { bucket: '0-1K', count: SOURCETYPES.filter(s => s.savings > 0 && s.savings <= 1000).length, amount: SOURCETYPES.filter(s => s.savings > 0 && s.savings <= 1000).reduce((a, b) => a + b.savings, 0) },
      { bucket: '1K-5K', count: SOURCETYPES.filter(s => s.savings > 1000 && s.savings <= 5000).length, amount: SOURCETYPES.filter(s => s.savings > 1000 && s.savings <= 5000).reduce((a, b) => a + b.savings, 0) },
      { bucket: '5K-10K', count: SOURCETYPES.filter(s => s.savings > 5000 && s.savings <= 10000).length, amount: SOURCETYPES.filter(s => s.savings > 5000 && s.savings <= 10000).reduce((a, b) => a + b.savings, 0) },
      { bucket: '10K+', count: SOURCETYPES.filter(s => s.savings > 10000).length, amount: SOURCETYPES.filter(s => s.savings > 10000).reduce((a, b) => a + b.savings, 0) },
    ];

    await client.query(`
      INSERT INTO executive_kpis (
        snapshot_id, snapshot_date,
        roi_score, gainscope_score, total_license_spend, license_spend_low_value,
        storage_savings_potential, total_daily_gb, total_sourcetypes,
        tier_critical, tier_important, tier_nice_to_have, tier_low_value,
        security_gaps, operational_gaps, avg_utilization, avg_detection, avg_quality, avg_confidence,
        quick_wins, savings_staircase, agent_reasoning, tenant_id
      ) VALUES ($1, $2::date,
        $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20::jsonb, $21::jsonb, $22, $23)
      ON CONFLICT (tenant_id, snapshot_id) DO UPDATE SET
        roi_score = EXCLUDED.roi_score, gainscope_score = EXCLUDED.gainscope_score,
        total_license_spend = EXCLUDED.total_license_spend,
        storage_savings_potential = EXCLUDED.storage_savings_potential,
        quick_wins = EXCLUDED.quick_wins, savings_staircase = EXCLUDED.savings_staircase
    `, [
      SNAPSHOT_ID, TODAY, roiScore, gainScope, totalCost, lowValueCost,
      totalSavings, totalGb, SOURCETYPES.length,
      criticalCount, importantCount, niceCount, lowCount,
      securityGaps, 0, avgUtil, avgDet, avgQual, avgConf,
      JSON.stringify(quickWinsList), JSON.stringify(savingsStaircase),
      `Executive summary: ${SOURCETYPES.length} sourcetypes analyzed. ${totalGb.toFixed(1)} GB/day total. ` +
      `GainScope ${gainScope}%. ${totalQuickWins} quick wins identified. $${totalSavings.toFixed(0)} potential savings.`,
      TENANT_ID
    ]);

    // ── 5. Insert pipeline_runs ──
    await client.query(`
      INSERT INTO pipeline_runs (run_id, snapshot_id, tenant_id, status, published, idempotency_hash,
        started_at, published_at, pipeline_version, model_version, prompt_version, splunk_query_version,
        total_llm_tokens, total_llm_latency_ms)
      VALUES ($1, $2, $3, 'SUCCEEDED', true, $4,
        NOW() - INTERVAL '5 minutes', NOW(), '2.0.0', 'gemma2:9b', '2.0', '1.0',
        28500, 84500)
      ON CONFLICT (run_id) DO NOTHING
    `, [RUN_ID, SNAPSHOT_ID, TENANT_ID, crypto.createHash('sha256').update(SNAPSHOT_ID + TODAY).digest('hex').slice(0, 32)]);

    // Add historical pipeline runs
    const pastRuns = [
      { runId: crypto.randomUUID(), minutesAgo: 65, status: 'SUCCEEDED', published: true },
      { runId: crypto.randomUUID(), minutesAgo: 125, status: 'SUCCEEDED', published: true },
      { runId: crypto.randomUUID(), minutesAgo: 245, status: 'FAILED', published: false, tokens: 0, latency: 0 },
      { runId: crypto.randomUUID(), minutesAgo: 365, status: 'SUCCEEDED', published: true },
    ];
    for (const r of pastRuns) {
      const pastSnapshot = crypto.randomUUID();
      const pastHash = crypto.createHash('sha256').update(pastSnapshot + TODAY).digest('hex').slice(0, 32);
      await client.query(`
        INSERT INTO pipeline_runs (run_id, snapshot_id, tenant_id, status, published, idempotency_hash,
          started_at, published_at, pipeline_version, model_version, prompt_version, splunk_query_version,
          total_llm_tokens, total_llm_latency_ms)
        VALUES ($1, $2, $3, $4, $5, $6,
          NOW() - ($7 || ' minutes')::interval, NOW() - (($7::numeric - 2) || ' minutes')::interval,
          '2.0.0', 'gemma2:9b', '2.0', '1.0', $8, $9)
        ON CONFLICT (run_id) DO NOTHING
      `, [r.runId, pastSnapshot, TENANT_ID, r.status, r.published, pastHash,
          r.minutesAgo, r.tokens || 25000, r.latency || 72000]);
    }

    // ── 6. Insert pipeline_stage_events ──
    const stages = ['SPLUNK_FETCH', 'SNAPSHOT_WRITE', 'KPI_AGGREGATION', 'AI_DECISIONS', 'GOVERNANCE_SYNC', 'PUBLISH'];
    const stageDurations = [2100, 1800, 1200, 5100, 800, 400];
    for (let i = 0; i < stages.length; i++) {
      const startedAt = i === 0 ? `NOW() - INTERVAL '5 minutes'` : `NOW() - INTERVAL '5 minutes' + INTERVAL '${stageDurations.slice(0, i).reduce((a, b) => a + b, 0)} milliseconds'`;
      await client.query(`
        INSERT INTO pipeline_stage_events (run_id, stage, attempt, status,
          started_at, completed_at, records_processed, metadata_json)
        VALUES ($1, $2, 1, 'SUCCESS',
          NOW() - INTERVAL '5 minutes' + INTERVAL '${stageDurations.slice(0, i).reduce((a, b) => a + b, 0)} milliseconds',
          NOW() - INTERVAL '5 minutes' + INTERVAL '${stageDurations.slice(0, i + 1).reduce((a, b) => a + b, 0)} milliseconds',
          $3, $4::jsonb)
      `, [RUN_ID, stages[i],
        i === 0 ? SOURCETYPES.length : i === 1 ? SOURCETYPES.length : i === 3 ? SOURCETYPES.length : 1,
        JSON.stringify({ records: i === 0 ? SOURCETYPES.length : i === 3 ? SOURCETYPES.length : 1, mode: 'batch' })
      ]);
    }

    // Historical stage events for all past runs
    for (const r of pastRuns) {
      if (r.status === 'FAILED') {
        await client.query(`
          INSERT INTO pipeline_stage_events (run_id, stage, attempt, status,
            started_at, completed_at, records_processed, metadata_json, error_message)
          VALUES ($1, 'AI_DECISIONS', 1, 'FAILED',
            NOW() - ($2 || ' minutes')::interval + INTERVAL '4 seconds',
            NOW() - ($2 || ' minutes')::interval + INTERVAL '14 seconds',
            0, '{"error":"LLM timeout"}'::jsonb, 'LLM inference exceeded timeout')
        `, [r.runId, r.minutesAgo]);
      } else {
        for (let i = 0; i < stages.length; i++) {
          await client.query(`
            INSERT INTO pipeline_stage_events (run_id, stage, attempt, status,
              started_at, completed_at, records_processed, metadata_json)
            VALUES ($1, $2, 1, 'SUCCESS',
              NOW() - ($3 || ' minutes')::interval + INTERVAL '${i * 2} seconds',
              NOW() - ($3 || ' minutes')::interval + INTERVAL '${i * 2 + 1} seconds',
              $4, $5::jsonb)
          `, [r.runId, stages[i], r.minutesAgo,
            i === 3 ? SOURCETYPES.length : 10,
            JSON.stringify({ mode: 'batch' })
          ]);
        }
      }
    }

    // ── 7. Insert security_coverage ──
    const mitreSources = [
      { sourcetype: 'WinEventLog:Security', coveragePct: 92, alerts: 120, gaps: 2 },
      { sourcetype: 'crowdstrike:events', coveragePct: 96, alerts: 95, gaps: 1 },
      { sourcetype: 'o365:management:activity', coveragePct: 85, alerts: 85, gaps: 3 },
      { sourcetype: 'aws:cloudtrail', coveragePct: 78, alerts: 60, gaps: 5 },
      { sourcetype: 'linux:secure', coveragePct: 82, alerts: 52, gaps: 4 },
      { sourcetype: 'cisco:asa', coveragePct: 72, alerts: 34, gaps: 6 },
      { sourcetype: 'okta:events', coveragePct: 88, alerts: 40, gaps: 2 },
      { sourcetype: 'pan:traffic', coveragePct: 65, alerts: 22, gaps: 8 },
      { sourcetype: 'mysql:slow', coveragePct: 15, alerts: 0, gaps: 12 },
    ];
    for (const ms of mitreSources) {
      await client.query(`
        INSERT INTO security_coverage (snapshot_date, sourcetype, coverage_pct, active_alerts, detection_gaps)
        VALUES ($1::date, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [TODAY, ms.sourcetype, ms.coveragePct, ms.alerts, ms.gaps]);
    }

    // ── 8. Insert quality_hotspots ──
    const hotspots = SOURCETYPES.filter(s => s.issues > 5).map(s => ({
      sourcetype: s.sourcetype,
      issueCount: s.issues,
      qualityScore: s.qual,
      impact: s.qual < 50 ? 'High' : s.qual < 70 ? 'Medium' : 'Low',
    }));
    for (const h of hotspots) {
      await client.query(`
        INSERT INTO quality_hotspots (snapshot_date, sourcetype, issue_count, quality_score, estimated_impact)
        VALUES ($1::date, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [TODAY, h.sourcetype, h.issueCount, h.qualityScore, h.impact + ' parse errors']);
    }

    // ── 9. Insert field_usage ──
    for (const s of SOURCETYPES) {
      const fieldsIndexed = Math.max(1, Math.round(100 - s.qual + 50));
      const fieldsUsed = Math.max(1, Math.round(s.util / 5));
      await client.query(`
        INSERT INTO field_usage (snapshot_date, sourcetype, fields_indexed, fields_used, optimization_pct)
        VALUES ($1::date, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [TODAY, s.sourcetype, fieldsIndexed, fieldsUsed, s.qual]);
    }

    // ── 10. LLM health ──
    await client.query(`
      INSERT INTO llm_health_cache (provider, available, response_time_ms, queue_depth, running_model,
        inference_capacity, models_available, last_checked)
      VALUES ('ollama', true, 2845, 0, 'gemma2:9b', 'healthy',
        ARRAY['gemma2:9b','qwen2.5:7b','llama3.1:8b','gemma4:latest'], NOW())
      ON CONFLICT (provider) DO UPDATE SET
        available = EXCLUDED.available, response_time_ms = EXCLUDED.response_time_ms,
        running_model = EXCLUDED.running_model, last_checked = NOW()
    `);

    // ── 11. tenant_snapshot_pointer (required for cache-status to find run) ──
    await client.query(`
      INSERT INTO tenant_snapshot_pointer (tenant_id, active_run_id, active_snapshot_id, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        active_run_id = EXCLUDED.active_run_id,
        active_snapshot_id = EXCLUDED.active_snapshot_id,
        updated_at = NOW()
    `, [TENANT_ID, RUN_ID, SNAPSHOT_ID]);

    // ── 12. model_health_ledger ──
    await client.query(`
      INSERT INTO model_health_ledger (snapshot_date, total_reviews_30d, total_rejections_30d,
        stale_approvals_count, expired_approvals_count, system_health_status, model_trust_score)
      VALUES ($1::date, 245, 12, 3, 1, 'HEALTHY', 0.985)
      ON CONFLICT (snapshot_date) DO UPDATE SET
        total_reviews_30d = EXCLUDED.total_reviews_30d,
        system_health_status = EXCLUDED.system_health_status
    `, [TODAY]);

    await client.query('COMMIT');

    console.log(JSON.stringify({
      ok: true,
      snapshotId: SNAPSHOT_ID,
      runId: RUN_ID,
      today: TODAY,
      sourcetypes: SOURCETYPES.length,
      summary: {
        totalDailyGb: Math.round(totalDailyGb * 10) / 10,
        totalAnnualCost: Math.round(totalCost),
        totalSavings: totalSavings,
        roiScore,
        gainScope,
        quickWins: totalQuickWins,
        tierCounts,
        avgUtil, avgDet, avgQual,
      }
    }, null, 2));

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[seed-rich-data] failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
