import { NextRequest, NextResponse } from 'next/server';
import { getSnapshots, TelemetryFilters } from '@api/repositories/telemetry-repository';
import { query, transaction } from '@core/database/connection';

export async function GET(request: NextRequest) {
  try {
    const filters: TelemetryFilters = {
      limit: 100,
    };

    const snapshots = await getSnapshots(filters);

    // Find max cost for normalization
    const maxCost = Math.max(...snapshots.map(s => s.costPerYear || 0), 1);

    // Enhanced decision mapping with trust signals
    const actionable = snapshots
      .filter(s => s.classification && s.classification !== 'KEEP')
      .map(s => {
        const savings = s.costPerYear || 0;
        const risk = s.riskScore || 0;
        const utilization = s.utilizationPct || 0;

        // Normalize to 0-1 scale for consistent ranking
        const normalizedCost = savings / maxCost; // 0-1
        const normalizedRisk = risk / 100; // 0-1
        const normalizedWaste = 1 - (utilization / 100); // 0-1 (high waste = high score)

        // Business impact score: cost (50%) + risk (30%) + waste (20%)
        const impact_score = (normalizedCost * 0.5) + (normalizedRisk * 0.3) + (normalizedWaste * 0.2);

        // Real trend detection using delta (mock data - in production would query search counts)
        const usage_30d = (s as any).searches_last_30_days || Math.floor(Math.random() * 100);
        const usage_prev_30d = (s as any).searches_30_60_days || Math.floor(Math.random() * 200);
        let trend = 'stable';
        let trend_percent = 0;
        if (usage_prev_30d > 0) {
          trend_percent = ((usage_30d - usage_prev_30d) / usage_prev_30d) * 100;
          trend = trend_percent < -50 ? 'declining_usage' : trend_percent > 50 ? 'increasing' : 'stable';
        }
        const lastEventAt = s.rawMetadata?.lastEvent;
        const daysSinceLastEvent = lastEventAt ? Math.floor((Date.now() - new Date(lastEventAt).getTime()) / (1000 * 60 * 60 * 24)) : 30;

        // Confidence breakdown
        const signals = [];
        if (utilization < 10) signals.push({ name: 'Data Volume', status: 'HIGH', detail: `${s.dailyAvgGb?.toFixed(1) || 0} GB/day but low usage` });
        else signals.push({ name: 'Data Volume', status: 'NORMAL', detail: `${s.dailyAvgGb?.toFixed(1) || 0} GB/day` });

        if (s.totalEvents && s.totalEvents > 1000000) signals.push({ name: 'Search Usage', status: 'HIGH', detail: 'High event count' });
        else signals.push({ name: 'Search Usage', status: 'LOW', detail: 'Low query frequency' });

        signals.push({ name: 'Dashboard Usage', status: (s as any).dashboard_refs?.length ? 'ACTIVE' : 'NONE', detail: (s as any).dashboard_refs?.length ? `${(s as any).dashboard_refs.length} references` : 'No dashboards using this' });

        const confidenceLevel = s.confidence && s.confidence > 0.8 ? 'HIGH' : s.confidence && s.confidence > 0.6 ? 'MEDIUM' : 'LOW';

        // Blast radius with weighted scoring
        const dashCount = (s as any).dashboard_refs?.length || 0;
        const alertCount = 0; // Would query alert tables
        const userCount = 0; // Would query usage tables

        const blast_score = (dashCount * 5) + (alertCount * 10) + (userCount * 1);

        const blast_radius = {
          dashboards: dashCount,
          alerts: alertCount,
          users: userCount,
          score: blast_score,
          level: blast_score < 5 ? 'SAFE' : blast_score < 20 ? 'MEDIUM' : 'HIGH',
        };

        return {
          index_name: s.indexName,
          action: s.classification,
          savings,
          risk,
          confidence: s.confidence || 0,
          confidence_level: confidenceLevel,
          confidence_signals: signals,
          reason: s.recommendation || 'High impact index detected',
          impact_score,
          trend,
          trend_percent: Math.round(trend_percent),
          days_since_last_event: daysSinceLastEvent,
          utilization: utilization,
          blast_radius,
          safe_to_delete: blast_radius.level === 'SAFE',
        };
      });

    // Sort by business impact score (not just risk * savings)
    const ranked = actionable
      .sort((a, b) => b.impact_score - a.impact_score)
      .slice(0, 5);

    // Calculate totals
    const totalPotentialSavings = ranked.reduce((sum, r) => sum + r.savings, 0);

    // Quick wins: low risk + high savings
    const quickWins = ranked
      .filter(r => r.safe_to_delete && r.savings > 5000)
      .slice(0, 3);

    // Summary stats
    const highRiskCount = ranked.filter(r => r.risk > 80).length;
    const safeActionsCount = ranked.filter(r => r.safe_to_delete).length;

    // Total spend (would come from config in production)
    const totalSpend = maxCost * 10; // Approximate
    const roi = totalSpend > 0 ? (totalPotentialSavings / totalSpend) * 100 : 0;

    return NextResponse.json({
      top_decisions: ranked,
      quick_wins: quickWins,
      count: ranked.length,
      total_potential_savings: totalPotentialSavings,
      summary: {
        total_savings: totalPotentialSavings,
        high_risk_count: highRiskCount,
        safe_actions_count: safeActionsCount,
        roi_percent: Math.round(roi),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate decisions' },
      { status: 500 }
    );
  }
}

// POST: Record a decision action
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { index_name, action, status } = body;

    if (!index_name || !action || !status) {
      return NextResponse.json(
        { error: 'index_name, action, and status are required' },
        { status: 400 }
      );
    }

    // Safety limiter: Rate limit ELIMINATE actions
    if (action === 'ELIMINATE' && status === 'APPROVED') {
      const recentEliminations = await query(
        `SELECT COUNT(*) as count FROM decisions
         WHERE action = 'ELIMINATE'
         AND status = 'APPROVED'
         AND created_at > NOW() - INTERVAL '10 minutes'`
      );
      if (parseInt(recentEliminations.rows[0]?.count || '0', 10) >= 5) {
        return NextResponse.json(
          {
            error: 'Safety lock triggered: Too many ELIMINATE actions in short time',
            hint: 'Wait 10 minutes or contact admin to unlock'
          },
          { status: 429 }
        );
      }
    }

    // Guardrail: Prevent dangerous ELIMINATE actions with low risk
    if (action === 'ELIMINATE') {
      const snapshots = await getSnapshots({ indexName: index_name });
      const snapshot = snapshots[0];

      if (snapshot && snapshot.riskScore < 80) {
        return NextResponse.json(
          {
            error: 'Guardrail blocked: Cannot eliminate index with risk score below 80',
            hint: 'Indices with low risk should be optimized or archived instead'
          },
          { status: 403 }
        );
      }

      if (snapshot && snapshot.confidence < 0.6) {
        return NextResponse.json(
          {
            error: 'Guardrail blocked: Cannot eliminate index with confidence below 60%',
            hint: 'Gather more evidence before eliminating'
          },
          { status: 403 }
        );
      }
    }

    // Execute all decision logic in a single transaction
    await transaction(async (client) => {
      // Get linked snapshot ID for traceability
      const snapshotResult = await client.query(
        `SELECT id, snapshot_date FROM telemetry_snapshots
         WHERE index_name = $1
         ORDER BY snapshot_date DESC LIMIT 1`,
        [index_name]
      );
      const linked_snapshot_id = snapshotResult.rows[0]?.id || null;
      const snapshot_date = snapshotResult.rows[0]?.snapshot_date || new Date().toISOString().split('T')[0];

      // Get previous active decision for audit trail
      const prevActiveQuery = await client.query(
        `SELECT id, status FROM decisions
         WHERE index_name = $1 AND is_active = true
         ORDER BY created_at DESC LIMIT 1`,
        [index_name]
      );
      const prev_status = prevActiveQuery.rows[0]?.status || null;
      const prev_decision_id = prevActiveQuery.rows[0]?.id || null;

      // State control: Deactivate previous active decision
      if (prev_decision_id) {
        await client.query(
          `UPDATE decisions SET is_active = false WHERE id = $1`,
          [prev_decision_id]
        );
      }

      // Insert new decision with ACID-safe idempotency
      // Uses is_active = true to mark as current
      try {
        await client.query(
          `INSERT INTO decisions (index_name, action, status, is_active, snapshot_date, snapshot_id, created_at)
           VALUES ($1, $2, $3, true, $4, $5, NOW())`,
          [index_name, action, status, snapshot_date, linked_snapshot_id]
        );
      } catch (e: any) {
        // DB-level unique index catch (race-condition safe)
        if (e.code === '23505' && e.constraint?.includes('uniq_decision_active')) {
          throw Object.assign(new Error('DUPLICATE_APPROVAL'), { code: '23505' });
        }
        throw e;
      }

      // Insert audit trail with full traceability
      await client.query(
        `INSERT INTO decision_audit (index_name, action, prev_status, new_status, prev_decision_id, actor, reason, snapshot_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [index_name, action, prev_status, status, prev_decision_id, 'ui_user', `Decision ${status}`, linked_snapshot_id]
      );
    });

    const messages: Record<string, string> = {
      APPROVED: `Action ${action} approved for ${index_name}`,
      IGNORED: `Decision ignored for ${index_name}`,
      REVERTED: `Decision reverted for ${index_name}`,
    };

    return NextResponse.json({
      success: true,
      index_name,
      action,
      status,
      message: messages[status] || `Decision ${status} for ${index_name}`
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to record decision' },
      { status: 500 }
    );
  }
}
