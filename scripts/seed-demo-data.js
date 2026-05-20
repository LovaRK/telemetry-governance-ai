#!/usr/bin/env node
/**
 * Demo Data Seed Script
 * Populates the database with realistic demonstration data
 * for the governance & cost optimization dashboard E2E testing.
 */

const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os',
});

// Utility to generate reproducible UUIDs for consistency
function seedUuid(seed) {
  const hash = crypto.createHash('md5').update(seed).digest('hex');
  return [
    hash.substr(0, 8),
    hash.substr(8, 4),
    hash.substr(12, 4),
    hash.substr(16, 4),
    hash.substr(20, 12),
  ].join('-');
}

async function seedDemoData() {
  const client = await pool.connect();

  try {
    console.log('\n' + '='.repeat(60));
    console.log('SEEDING DEMO DATA - Cost Optimization Dashboard');
    console.log('='.repeat(60) + '\n');

    // Create test tenant if it doesn't exist
    const tenantId = seedUuid('demo-tenant-prod');
    const snapshotId = seedUuid('demo-snapshot-2026-05-19');
    const snapshotDate = new Date().toISOString().split('T')[0];

    console.log(`[Seed] Using tenant: ${tenantId}`);
    console.log(`[Seed] Using snapshot: ${snapshotId} (${snapshotDate})\n`);

    // Ensure tenant exists
    await client.query(
      `INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [tenantId, 'demo-tenant', 'Demo Tenant']
    );

    // 1. Seed Agent Decisions (Cost Optimization Analysis Results)
    console.log('[Seed] Populating agent_decisions (cost analysis results)...');

    const decisions = [
      {
        snapshot_id: snapshotId,
        snapshot_date: snapshotDate,
        index_name: 'splunk_network_traffic',
        sourcetype: 'network_logs',
        tier: 'PREMIUM',
        action: 'MIGRATE_TO_STANDARD',
        composite_score: 0.89,
        utilization_score: 0.45,
        detection_score: 0.78,
        quality_score: 0.92,
        risk_score: 0.21,
        annual_license_cost: 148000,
        estimated_savings: 67000,
        confidence: 0.9234,
        confidence_score: 92.34,
        recommendation: 'Migrate to STANDARD tier. Network telemetry shows 45% utilization.',
        reasoning: 'Data shows consistent underutilization with high quality. Cost reduction recommended.',
        evidence: {
          utilization_trend: 'stable_low',
          ingestion_spike_count: 2,
          last_spike_magnitude: 1.2,
          sampling_rate: 0.1,
          cardinality: 'moderate',
        },
        is_quick_win: true,
        is_s3_candidate: false,
        detection_gap: false,
        confidence_score_numeric: 92,
        llm_version: 'gemma2:9b',
        prompt_version: 'v3.2',
        model_version: '1.0',
        heuristic_version: '2.1',
        candidate_reason: ['underutilized', 'cost_savings', 'risk_acceptable'],
        candidate_reasons: [
          { reason: 'underutilized', confidence: 0.88 },
          { reason: 'cost_savings', confidence: 0.91 },
          { reason: 'risk_acceptable', confidence: 0.89 },
        ],
        tenant_id: tenantId,
      },
      {
        snapshot_id: snapshotId,
        snapshot_date: snapshotDate,
        index_name: 'splunk_api_events',
        sourcetype: 'json_api_logs',
        tier: 'PREMIUM',
        action: 'MONITOR_COST',
        composite_score: 0.62,
        utilization_score: 0.68,
        detection_score: 0.55,
        quality_score: 0.58,
        risk_score: 0.45,
        annual_license_cost: 92000,
        estimated_savings: 0,
        confidence: 0.7821,
        confidence_score: 78.21,
        recommendation: 'Monitor cost. Moderate utilization with quality concerns. Investigate schema efficiency.',
        reasoning: 'Marginal case. Quality issues suggest data duplication. No immediate action recommended.',
        evidence: {
          utilization_trend: 'increasing',
          ingestion_spike_count: 12,
          last_spike_magnitude: 2.8,
          sampling_rate: 0.0,
          cardinality: 'high',
        },
        is_quick_win: false,
        is_s3_candidate: false,
        detection_gap: true,
        confidence_score_numeric: 78,
        llm_version: 'gemma2:9b',
        prompt_version: 'v3.2',
        model_version: '1.0',
        heuristic_version: '2.1',
        candidate_reason: ['moderate_utilization', 'quality_concerns', 'monitor_trend'],
        candidate_reasons: [
          { reason: 'moderate_utilization', confidence: 0.72 },
          { reason: 'quality_concerns', confidence: 0.68 },
          { reason: 'monitor_trend', confidence: 0.85 },
        ],
        tenant_id: tenantId,
      },
      {
        snapshot_id: snapshotId,
        snapshot_date: snapshotDate,
        index_name: 'splunk_security_events',
        sourcetype: 'cim_security',
        tier: 'STANDARD',
        action: 'RETAIN',
        composite_score: 0.95,
        utilization_score: 0.88,
        detection_score: 0.98,
        quality_score: 0.96,
        risk_score: 0.08,
        annual_license_cost: 58000,
        estimated_savings: 0,
        confidence: 0.9847,
        confidence_score: 98.47,
        recommendation: 'RETAIN - Critical security index. High utilization, excellent quality.',
        reasoning: 'Security telemetry essential for compliance and threat detection. Tier is appropriate.',
        evidence: {
          utilization_trend: 'stable_high',
          ingestion_spike_count: 1,
          last_spike_magnitude: 1.1,
          sampling_rate: 0.0,
          cardinality: 'high',
        },
        is_quick_win: false,
        is_s3_candidate: false,
        detection_gap: false,
        confidence_score_numeric: 98,
        llm_version: 'gemma2:9b',
        prompt_version: 'v3.2',
        model_version: '1.0',
        heuristic_version: '2.1',
        candidate_reason: ['security_critical', 'high_quality', 'compliance_required'],
        candidate_reasons: [
          { reason: 'security_critical', confidence: 0.99 },
          { reason: 'high_quality', confidence: 0.97 },
          { reason: 'compliance_required', confidence: 0.98 },
        ],
        tenant_id: tenantId,
      },
    ];

    for (const decision of decisions) {
      await client.query(
        `INSERT INTO agent_decisions (
          snapshot_id, snapshot_date, index_name, sourcetype, tier, action,
          composite_score, utilization_score, detection_score, quality_score, risk_score,
          annual_license_cost, estimated_savings, confidence, confidence_score,
          recommendation, reasoning, evidence, is_quick_win, is_s3_candidate, detection_gap,
          decision_stability_score, processing_status,
          llm_version, prompt_version, model_version, heuristic_version,
          candidate_reason, candidate_reasons, tenant_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
        )
         ON CONFLICT (snapshot_id, index_name, sourcetype) DO NOTHING`,
        [
          decision.snapshot_id,
          decision.snapshot_date,
          decision.index_name,
          decision.sourcetype,
          decision.tier,
          decision.action,
          decision.composite_score,
          decision.utilization_score,
          decision.detection_score,
          decision.quality_score,
          decision.risk_score,
          decision.annual_license_cost,
          decision.estimated_savings,
          decision.confidence,
          decision.confidence_score,
          decision.recommendation,
          decision.reasoning,
          JSON.stringify(decision.evidence),
          decision.is_quick_win,
          decision.is_s3_candidate,
          decision.detection_gap,
          85, // stability score
          'completed',
          decision.llm_version,
          decision.prompt_version,
          decision.model_version,
          decision.heuristic_version,
          decision.candidate_reason,
          JSON.stringify(decision.candidate_reasons),
          decision.tenant_id,
        ]
      );
    }
    console.log(`[Seed] ✓ Created ${decisions.length} agent decisions\n`);

    // 2. Seed Executive KPIs
    console.log('[Seed] Populating executive_kpis...');
    const kpis = [
      {
        tenant_id: tenantId,
        metric_date: snapshotDate,
        total_annual_cost: 298000,
        total_estimated_savings: 67000,
        roi_percentage: 22.48,
        indexes_analyzed: 3,
        quick_wins_available: 1,
        risk_weighted_recommendation_count: 3,
        governance_readiness_score: 87,
        data_quality_baseline: 0.82,
      },
    ];

    for (const kpi of kpis) {
      await client.query(
        `INSERT INTO executive_kpis (
          tenant_id, metric_date, total_annual_cost, total_estimated_savings, roi_percentage,
          indexes_analyzed, quick_wins_available, risk_weighted_recommendation_count,
          governance_readiness_score, data_quality_baseline
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (tenant_id, metric_date) DO NOTHING`,
        [
          kpi.tenant_id,
          kpi.metric_date,
          kpi.total_annual_cost,
          kpi.total_estimated_savings,
          kpi.roi_percentage,
          kpi.indexes_analyzed,
          kpi.quick_wins_available,
          kpi.risk_weighted_recommendation_count,
          kpi.governance_readiness_score,
          kpi.data_quality_baseline,
        ]
      );
    }
    console.log(`[Seed] ✓ Created ${kpis.length} KPI records\n`);

    // 3. Seed Decision History for trend visibility
    console.log('[Seed] Populating decision_history (decision timeline)...');
    const baseDate = new Date();

    const historyEntries = [];
    for (let i = 0; i < 10; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() - (10 - i));

      historyEntries.push({
        tenant_id: tenantId,
        snapshot_date: date.toISOString().split('T')[0],
        index_name: ['splunk_network_traffic', 'splunk_api_events', 'splunk_security_events'][i % 3],
        action_taken: ['ANALYZE', 'MIGRATE_TO_STANDARD', 'MONITOR_COST'][i % 3],
        cost_impact: Math.round(Math.random() * 100000 - 50000),
        confidence_score: 75 + Math.random() * 20,
      });
    }

    for (const entry of historyEntries) {
      await client.query(
        `INSERT INTO decision_history (
          tenant_id, snapshot_date, index_name, action_taken, cost_impact, confidence_score
        ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [
          entry.tenant_id,
          entry.snapshot_date,
          entry.index_name,
          entry.action_taken,
          entry.cost_impact,
          entry.confidence_score,
        ]
      );
    }
    console.log(`[Seed] ✓ Created ${historyEntries.length} decision history entries\n`);

    console.log('='.repeat(60));
    console.log('✓ DEMO DATA SEEDED SUCCESSFULLY');
    console.log('='.repeat(60));
    console.log('\nData summary:');
    console.log(`  • Agent Decisions: ${decisions.length}`);
    console.log(`  • Executive KPIs: ${kpis.length}`);
    console.log(`  • Decision History: ${historyEntries.length}`);
    console.log('\nYour dashboard is now ready for live testing.');
    console.log('Total Estimated Savings: $67,000');
    console.log('Governance Readiness Score: 87%');
    console.log('\n');

  } catch (error) {
    console.error('✗ Seeding failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await seedDemoData();
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
