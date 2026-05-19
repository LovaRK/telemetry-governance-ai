/**
 * Decision Lineage Tracker — Record and track causality relationships
 *
 * Integrates with governance workflow to:
 * - Record parent-child relationships between decisions
 * - Propagate causality through decision chains
 * - Trace decision origins (root cause)
 * - Calculate impact radius (affected decisions)
 */

import { getCorrelationId } from './correlation-context';
import { governanceCausalityService, DecisionNode } from './governance-causality-service';

export interface DecisionLink {
  parentDecisionId: string;
  childDecisionId: string;
  causalityType: 'blocks' | 'depends_on' | 'overrides' | 'triggers' | 'contradicts' | 'related';
  confidence: number;
  reason?: string;
}

export interface CausalChain {
  rootDecisionId: string;
  currentDecisionId: string;
  chainLength: number;
  decisions: DecisionNode[];
  causalityTypes: string[];
}

class DecisionLineageTracker {
  /**
   * Record a causal link between two decisions
   * Called when a decision explicitly causes/affects another decision
   */
  async recordCausalLink(link: DecisionLink): Promise<{ id: string }> {
    const correlationId = getCorrelationId();

    // TODO: Insert into governance_causality table
    // INSERT INTO governance_causality (
    //   correlationId, parentDecisionId, childDecisionId,
    //   causalityType, confidence, reason
    // ) VALUES ($1, $2, $3, $4, $5, $6)
    // ON CONFLICT (parentDecisionId, childDecisionId) DO UPDATE
    // SET confidence = EXCLUDED.confidence

    console.log('[Lineage] Recorded causal link:', {
      correlationId,
      ...link,
    });

    return { id: `link_${Date.now()}` };
  }

  /**
   * Propagate causality through decision chain
   * When a decision is made, find all related decisions and establish causality
   */
  async propagateCausality(decisionId: string, relatedDecisionIds: string[] = []): Promise<void> {
    const correlationId = getCorrelationId();

    // For each related decision, determine causality type
    for (const relatedId of relatedDecisionIds) {
      const causalityType = await this.determineCausalityType(decisionId, relatedId);

      if (causalityType) {
        await this.recordCausalLink({
          parentDecisionId: decisionId,
          childDecisionId: relatedId,
          causalityType,
          confidence: 0.8, // Default confidence (can be adjusted)
          reason: `Related through correlation ${correlationId}`,
        });
      }
    }

    console.log('[Lineage] Propagated causality from decision:', {
      decisionId,
      relatedCount: relatedDecisionIds.length,
      correlationId,
    });
  }

  /**
   * Get origin decision (trace to root cause)
   * Finds the first decision in the causal chain
   */
  async getOriginDecision(decisionId: string): Promise<DecisionNode | null> {
    const dependencies = await governanceCausalityService.getDecisionDependencies(decisionId);

    if (dependencies.length === 0) {
      // This is the origin
      return await this.getDecisionById(decisionId);
    }

    // Recursively find the origin of the oldest dependency
    const oldestDependency = dependencies.reduce((oldest, current) => {
      return new Date(current.createdAt) < new Date(oldest.createdAt) ? current : oldest;
    });

    return this.getOriginDecision(oldestDependency.id);
  }

  /**
   * Get impact radius (all affected decisions)
   * Returns decisions that depend on or are blocked by this decision
   */
  async getImpactRadius(decisionId: string): Promise<{
    blocking: DecisionNode[];
    dependent: DecisionNode[];
    related: DecisionNode[];
  }> {
    const impactedDecisions = await governanceCausalityService.getDecisionImpact(decisionId);

    // Categorize by relationship type
    const edgesByType = await this.getEdgesByDecision(decisionId);

    const blocking = edgesByType
      .filter((e) => e.causalityType === 'blocks')
      .map((e) => impactedDecisions.find((d) => d.id === e.childDecisionId))
      .filter((d) => d !== undefined) as DecisionNode[];

    const dependent = edgesByType
      .filter((e) => e.causalityType === 'depends_on')
      .map((e) => impactedDecisions.find((d) => d.id === e.childDecisionId))
      .filter((d) => d !== undefined) as DecisionNode[];

    const related = edgesByType
      .filter((e) => ['related', 'contradicts'].includes(e.causalityType))
      .map((e) => impactedDecisions.find((d) => d.id === e.childDecisionId))
      .filter((d) => d !== undefined) as DecisionNode[];

    return { blocking, dependent, related };
  }

  /**
   * Build complete causal chain for a decision
   */
  async buildCausalChain(decisionId: string): Promise<CausalChain> {
    const origin = await this.getOriginDecision(decisionId);
    if (!origin) {
      return {
        rootDecisionId: decisionId,
        currentDecisionId: decisionId,
        chainLength: 1,
        decisions: [],
        causalityTypes: [],
      };
    }

    const dependencies = await governanceCausalityService.getDecisionDependencies(decisionId);
    const edges = await this.getEdgesByDecision(decisionId);

    return {
      rootDecisionId: origin.id,
      currentDecisionId: decisionId,
      chainLength: dependencies.length + 1,
      decisions: [...dependencies, origin],
      causalityTypes: [...new Set(edges.map((e) => e.causalityType))],
    };
  }

  /**
   * Analyze decision cluster by correlation ID
   */
  async analyzeCorrelationCluster(correlationId: string): Promise<{
    decisionCount: number;
    causalityEdgeCount: number;
    originDecision?: DecisionNode;
    affectedDecisions: DecisionNode[];
  }> {
    const cluster = await governanceCausalityService.getCorrelationCluster(correlationId);

    let originDecision: DecisionNode | undefined;
    const affectedDecisions: DecisionNode[] = [];

    // Find the origin (decision with no dependencies in this cluster)
    for (const decision of cluster.decisions) {
      const dependencies = cluster.causalityEdges.filter((e) => e.childDecisionId === decision.id);
      if (dependencies.length === 0) {
        originDecision = decision;
      } else {
        affectedDecisions.push(decision);
      }
    }

    return {
      decisionCount: cluster.decisionCount,
      causalityEdgeCount: cluster.causalityEdges.length,
      originDecision,
      affectedDecisions,
    };
  }

  /**
   * Determine causality type between two decisions
   * Logic:
   * - If decisions have same index: depends_on (one decision affects another)
   * - If decisions have different indexes: triggers (one affects different resource)
   * - If decisions have opposing status: contradicts
   * - Default: related
   */
  private async determineCausalityType(
    parentId: string,
    childId: string
  ): Promise<'blocks' | 'depends_on' | 'overrides' | 'triggers' | 'contradicts' | 'related' | null> {
    const parent = await this.getDecisionById(parentId);
    const child = await this.getDecisionById(childId);

    if (!parent || !child) return null;

    // Same index: depends_on relationship
    if (parent.indexName === child.indexName) {
      return 'depends_on';
    }

    // Different indexes: triggers relationship
    return 'triggers';
  }

  // ========================================================================
  // PRIVATE HELPER METHODS
  // ========================================================================

  private async getDecisionById(decisionId: string): Promise<DecisionNode | null> {
    // TODO: Replace with actual database query
    // SELECT id, indexName, status, createdAt, updatedAt
    // FROM agent_decisions WHERE id = $1
    return null;
  }

  private async getEdgesByDecision(decisionId: string): Promise<any[]> {
    // TODO: Replace with actual database query
    // SELECT * FROM governance_causality
    // WHERE parentDecisionId = $1 OR childDecisionId = $1
    return [];
  }
}

export const decisionLineageTracker = new DecisionLineageTracker();
