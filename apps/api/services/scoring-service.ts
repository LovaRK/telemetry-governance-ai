import { PoolClient } from 'pg';
import { query, transaction } from '../../../core/database/connection';

export interface ScoringInput {
  index: string;
  sourcetype?: string;
  totalEvents: number;
  dailyAvgGb: number;
  retentionDays: number;
  utilizationPct: number;
  costPerYear: number;
}

export interface ScoringResult {
  classification: 'KEEP' | 'OPTIMIZE' | 'ARCHIVE' | 'ELIMINATE' | 'INVESTIGATE';
  confidence: number;
  riskScore: number;
  recommendation: string;
  evidence: string[];
}

/**
 * Deterministic classification engine.
 * NO LLM involved — pure rule-based logic for consistency and testability.
 */
export function scoreTelemetry(input: ScoringInput): ScoringResult {
  const { dailyAvgGb, retentionDays, utilizationPct, costPerYear, totalEvents } = input;

  // Signal strength: how "alive" is this data?
  const signalStrength = Math.min(utilizationPct / 100, 1.0);

  // Consistency: does volume match retention policy?
  const expectedEventsPerDay = dailyAvgGb * 1e6; // rough heuristic
  const consistency = Math.min(totalEvents / (expectedEventsPerDay * 30), 1.0);

  // Base confidence
  const confidence = round(signalStrength * 0.6 + consistency * 0.4, 4);

  const evidence: string[] = [];
  let classification: ScoringResult['classification'] = 'KEEP';
  let riskScore = 0;

  // Decision tree (deterministic)
  if (dailyAvgGb > 10 && utilizationPct < 5) {
    classification = 'ELIMINATE';
    riskScore = 95;
    evidence.push(`High volume (${dailyAvgGb.toFixed(1)} GB/day) with extremely low utilization (${utilizationPct}%)`);
  } else if (dailyAvgGb > 5 && utilizationPct < 20) {
    classification = 'ARCHIVE';
    riskScore = 75;
    evidence.push(`Moderate-high volume (${dailyAvgGb.toFixed(1)} GB/day) with low utilization (${utilizationPct}%)`);
  } else if (retentionDays > 90 && utilizationPct < 30) {
    classification = 'OPTIMIZE';
    riskScore = 50;
    evidence.push(`Long retention (${retentionDays} days) with below-average utilization (${utilizationPct}%)`);
  } else if (utilizationPct > 80 && costPerYear > 50000) {
    classification = 'INVESTIGATE';
    riskScore = 40;
    evidence.push(`High-cost index ($${costPerYear.toLocaleString()}/year) with heavy usage — verify ROI`);
  } else {
    classification = 'KEEP';
    riskScore = 10;
    evidence.push(`Healthy profile: ${utilizationPct}% utilization, ${dailyAvgGb.toFixed(1)} GB/day`);
  }

  return {
    classification,
    confidence,
    riskScore,
    recommendation: generateRecommendation(classification, input, evidence),
    evidence,
  };
}

function generateRecommendation(
  classification: ScoringResult['classification'],
  input: ScoringInput,
  evidence: string[]
): string {
  const { index, dailyAvgGb, retentionDays, utilizationPct } = input;

  switch (classification) {
    case 'ELIMINATE':
      return `Index '${index}' (${dailyAvgGb.toFixed(1)} GB/day, ${utilizationPct}% utilization) is extremely low-value. Stop ingestion immediately and delete existing data after legal hold review.`;
    case 'ARCHIVE':
      return `Index '${index}' should be moved to cold storage. Reduce retention from ${retentionDays} to 30 days and archive to S3/Glacier.`;
    case 'OPTIMIZE':
      return `Index '${index}' has long retention with limited active use. Implement summary indexing and reduce retention to 60 days.`;
    case 'INVESTIGATE':
      return `Index '${index}' is heavily used but expensive. Validate business necessity and check for duplicate data sources.`;
    default:
      return `Index '${index}' is healthy. Continue current policy and review quarterly.`;
  }
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Batch scoring for all un-scored snapshots.
 */
export async function runBatchScoring(): Promise<{ scored: number; errors: number }> {
  const result = await query(
    `SELECT id, index_name, sourcetype, total_events, daily_avg_gb, retention_days, raw_metadata
     FROM telemetry_snapshots
     WHERE classification IS NULL OR classification = ''`
  );

  let scored = 0;
  let errors = 0;

  await transaction(async (client) => {
    for (const row of result.rows) {
      try {
        const metadata = row.raw_metadata || {};
        const input: ScoringInput = {
          index: row.index_name,
          sourcetype: row.sourcetype,
          totalEvents: parseInt(row.total_events, 10),
          dailyAvgGb: parseFloat(row.daily_avg_gb),
          retentionDays: row.retention_days,
          utilizationPct: metadata.utilizationPct || 0,
          costPerYear: metadata.costPerYear || row.daily_avg_gb * 365 * 0.5, // $0.50/GB heuristic
        };

        const score = scoreTelemetry(input);

        await client.query(
          `
          UPDATE telemetry_snapshots
          SET classification = $1,
              confidence = $2,
              risk_score = $3,
              recommendation = $4,
              evidence = $5,
              updated_at = NOW()
          WHERE id = $6
          `,
          [score.classification, score.confidence, score.riskScore, score.recommendation, JSON.stringify(score.evidence), row.id]
        );

        scored++;
      } catch (e) {
        errors++;
        console.error(`Scoring error for snapshot ${row.id}:`, e);
      }
    }
  });

  return { scored, errors };
}
