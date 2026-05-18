import { PoolClient } from 'pg';
import * as math from 'mathjs';

export interface SamplingCandidate {
  indexName: string;
  effectiveConfidence: number;
  reuseDepth: number;
  financialImpactUsd: number;
  policyWeight: number;
  samplingProbability: number;
  riskScore: number;
}

export interface RiskWeightedSamplingBatch {
  batchId: string;
  samplingSize: number;
  candidates: SamplingCandidate[];
  selectedIndexes: string[];
  totalRiskCovered: number;
  explanation: string;
}

/**
 * Risk-weighted ground truth sampling service
 * Targets high-confidence decisions with deep reuse that are most likely to contain
 * stable hallucinations (the most dangerous error class: confidently wrong, repeatedly)
 *
 * Mathematical formula for sampling probability:
 * P_s = min(1.0, C_effective × ln(D_reuse + 1) × (Financial_Impact / 1000) × w_policy)
 *
 * Where:
 * - C_effective: Current effective confidence (0.0 → 1.0)
 * - D_reuse: Reuse depth (how many consecutive snapshots used this decision)
 * - Financial_Impact: USD value/risk of this decision
 * - w_policy: Policy weight (1.0 general, 3.5 compliance-sensitive)
 */
export class RiskWeightedSamplingService {
  /**
   * Calculate sampling probability for a candidate
   */
  calculateSamplingProbability(
    effectiveConfidence: number,
    reuseDepth: number,
    financialImpactUsd: number,
    policyWeight: number
  ): number {
    // P_s = min(1.0, C_effective × ln(D_reuse + 1) × (Financial_Impact / 1000) × w_policy)
    const baseProbability =
      effectiveConfidence *
      Math.log(reuseDepth + 1) *
      (financialImpactUsd / 1000) *
      policyWeight;

    return Math.min(1.0, baseProbability);
  }

  /**
   * Calculate composite risk score (used for ranking candidates)
   */
  calculateRiskScore(
    effectiveConfidence: number,
    reuseDepth: number,
    financialImpactUsd: number,
    policyWeight: number
  ): number {
    // Risk score combines all factors to determine priority
    // Higher = more likely to contain undetected hallucinations
    return (
      Math.pow(effectiveConfidence, 2) * // Confidence squared: higher confidence = higher risk if wrong
      (reuseDepth + 1) * // Reuse depth: longer without verification = higher risk
      Math.log(Math.max(1, financialImpactUsd)) * // Log of financial impact
      policyWeight // Policy sensitivity multiplier
    );
  }

  /**
   * Determine policy weight for an index
   * Compliance-sensitive indexes get higher sampling priority
   */
  getPolicyWeight(indexName: string): number {
    // Compliance keywords that increase sampling priority
    const complianceKeywords = ['pci', 'sox', 'hipaa', 'gdpr', 'compliance', 'regulatory', 'audit', 'legal'];
    const policyKeywords = ['policy', 'control', 'governance', 'mandate', 'requirement'];

    const lowerName = indexName.toLowerCase();

    if (complianceKeywords.some((kw) => lowerName.includes(kw))) {
      return 3.5; // High compliance sensitivity
    }

    if (policyKeywords.some((kw) => lowerName.includes(kw))) {
      return 2.0; // Policy-sensitive
    }

    // Check for financial/revenue keywords
    if (lowerName.includes('revenue') || lowerName.includes('billing') || lowerName.includes('transaction')) {
      return 2.2; // High financial impact
    }

    return 1.0; // General purpose
  }

  /**
   * Select candidates for sampling from the corpus
   * Returns candidates sorted by risk score, ready for probabilistic selection
   */
  async selectSamplingCandidates(
    client: PoolClient,
    maxCandidates: number = 50,
    minEffectiveConfidence: number = 0.7
  ): Promise<SamplingCandidate[]> {
    // Find indexes with:
    // - High effective confidence (likely to be trusted without verification)
    // - Deep reuse (used multiple times without re-evaluation)
    // - Approved status (stable, not under investigation)
    const result = await client.query(
      `WITH index_statistics AS (
        SELECT
          d.index_name,
          AVG(COALESCE(d.drift_confidence_adjusted, d.confidence_score)) as avg_effective_confidence,
          COUNT(*) as reuse_depth,
          COALESCE(SUM(COALESCE(f.calculated_monthly_loss_usd, 100)), 100) as financial_impact
        FROM agent_decisions d
        LEFT JOIN telemetry_facts f ON d.index_name = f.index_name
        WHERE d.approval_status = 'APPROVED'
        AND d.drift_detected = FALSE
        AND COALESCE(d.drift_confidence_adjusted, d.confidence_score) >= $1
        GROUP BY d.index_name
      )
      SELECT
        index_name,
        avg_effective_confidence,
        reuse_depth,
        financial_impact
      FROM index_statistics
      WHERE avg_effective_confidence >= $1
      ORDER BY (avg_effective_confidence * reuse_depth * financial_impact) DESC
      LIMIT $2`,
      [minEffectiveConfidence, maxCandidates]
    );

    return result.rows.map((row) => {
      const policyWeight = this.getPolicyWeight(row.index_name);
      const samplingProb = this.calculateSamplingProbability(
        row.avg_effective_confidence,
        row.reuse_depth,
        row.financial_impact,
        policyWeight
      );
      const riskScore = this.calculateRiskScore(
        row.avg_effective_confidence,
        row.reuse_depth,
        row.financial_impact,
        policyWeight
      );

      return {
        indexName: row.index_name,
        effectiveConfidence: parseFloat(row.avg_effective_confidence),
        reuseDepth: row.reuse_depth,
        financialImpactUsd: parseFloat(row.financial_impact),
        policyWeight,
        samplingProbability: parseFloat(samplingProb.toFixed(4)),
        riskScore: parseFloat(riskScore.toFixed(2)),
      };
    });
  }

  /**
   * Select final audit batch using probabilistic sampling
   * Each candidate has a P_s probability of being selected
   */
  selectAuditBatch(
    candidates: SamplingCandidate[],
    targetBatchSize: number = 10
  ): RiskWeightedSamplingBatch {
    // Probabilistic selection: for each candidate, rand() < P_s means select
    const selected: SamplingCandidate[] = [];
    const selectedIndexes: string[] = [];
    let totalRiskCovered = 0;

    for (const candidate of candidates) {
      const rand = Math.random();
      if (rand < candidate.samplingProbability) {
        selected.push(candidate);
        selectedIndexes.push(candidate.indexName);
        totalRiskCovered += candidate.riskScore;

        // Stop if we've reached target batch size
        if (selected.length >= targetBatchSize) {
          break;
        }
      }
    }

    // If probabilistic selection didn't yield enough, take top candidates by risk score
    if (selected.length < Math.ceil(targetBatchSize * 0.5)) {
      const sortedByRisk = candidates.sort((a, b) => b.riskScore - a.riskScore);
      for (let i = selected.length; i < Math.ceil(targetBatchSize * 0.5); i++) {
        if (i < sortedByRisk.length) {
          const candidate = sortedByRisk[i];
          if (!selectedIndexes.includes(candidate.indexName)) {
            selected.push(candidate);
            selectedIndexes.push(candidate.indexName);
            totalRiskCovered += candidate.riskScore;
          }
        }
      }
    }

    const explanation = this.explainBatch(selected);

    return {
      batchId: `batch-${Date.now()}`,
      samplingSize: selectedIndexes.length,
      candidates: selected,
      selectedIndexes,
      totalRiskCovered: parseFloat(totalRiskCovered.toFixed(1)),
      explanation,
    };
  }

  /**
   * Enqueue sampling batch as reanalysis jobs
   */
  async enqueueSamplingBatch(
    client: PoolClient,
    batch: RiskWeightedSamplingBatch,
    samplingId: string
  ): Promise<number> {
    // Import the reanalysis service to enqueue jobs
    const { enqueueReanalysisJob } = await import('./reanalysis-budget-service');

    let jobsEnqueued = 0;

    for (const indexName of batch.selectedIndexes) {
      try {
        const result = await enqueueReanalysisJob(
          client,
          indexName,
          'RISK_WEIGHTED_SAMPLING',
          'BACKGROUND', // Sampling jobs run at low priority
          {
            humanReviewRequired: true, // Force human review on sampling findings
          }
        );

        if (result.enqueued) {
          jobsEnqueued++;
        }
      } catch (e) {
        console.warn(`Failed to enqueue sampling job for ${indexName}:`, e);
      }
    }

    return jobsEnqueued;
  }

  /**
   * Explain why specific indexes were selected for sampling
   */
  private explainBatch(candidates: SamplingCandidate[]): string {
    if (candidates.length === 0) {
      return 'No high-risk candidates selected for sampling.';
    }

    const topByConfidence = candidates.sort((a, b) => b.effectiveConfidence - a.effectiveConfidence).slice(0, 3);
    const topByReuse = candidates.sort((a, b) => b.reuseDepth - a.reuseDepth).slice(0, 3);

    const lines: string[] = [
      `Selected ${candidates.length} indexes for ground truth sampling.`,
      '',
      'Highest confidence (most likely to be trusted without verification):',
      ...topByConfidence.map((c) => `  • ${c.indexName}: ${(c.effectiveConfidence * 100).toFixed(0)}% confidence, reused ${c.reuseDepth}x`),
      '',
      'Deepest reuse (longest without re-evaluation):',
      ...topByReuse.map((c) => `  • ${c.indexName}: ${c.reuseDepth} consecutive uses, ${(c.effectiveConfidence * 100).toFixed(0)}% confidence`),
    ];

    return lines.join('\n');
  }

  /**
   * Explain the sampling formula for audit/compliance purposes
   */
  explainFormula(): string {
    return `Risk-Weighted Sampling Formula:

P_s = min(1.0, C_effective × ln(D_reuse + 1) × (Financial_Impact / 1000) × w_policy)

Where:
  C_effective: Effective confidence (0-1). High-confidence decisions are targeted
              because if wrong, they go undetected longer.

  D_reuse: Reuse depth (count of consecutive snapshots using this decision).
           Decisions inherited via fingerprinting without re-evaluation increase risk.

  Financial_Impact: USD value of the decision. Higher financial impact increases
                   sampling priority.

  w_policy: Policy weight (1.0 general, 2.0-3.5 compliance-sensitive).
           Compliance/regulatory indexes get boosted sampling priority.

Example:
  High-confidence (0.95) + deep reuse (50x) + high-impact ($100k) + compliance (3.5x)
  = min(1.0, 0.95 × ln(51) × 100 × 3.5) = min(1.0, 1241) = 1.0 (always sample)

  Low-confidence (0.6) + shallow reuse (2x) + low-impact ($100) + general (1.0x)
  = min(1.0, 0.6 × ln(3) × 0.1 × 1.0) = min(1.0, 0.066) ≈ 0.066 (6.6% chance)

This targets "stable hallucinations" - the most dangerous error class:
  High confidence + deep reuse + undetected = decision trusted and repeated
  without human verification, propagating error across the corpus.`;
  }
}

/**
 * Singleton instance
 */
let globalService: RiskWeightedSamplingService | null = null;

export function getRiskWeightedSamplingService(): RiskWeightedSamplingService {
  if (!globalService) {
    globalService = new RiskWeightedSamplingService();
  }
  return globalService;
}
