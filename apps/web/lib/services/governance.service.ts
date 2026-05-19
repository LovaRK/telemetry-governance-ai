/**
 * GOVERNANCE SERVICE — Business Logic for Governance Operations
 * Implements SOLID principles:
 * - Single Responsibility: Only governance domain logic
 * - Dependency Injection: Receives API client as dependency
 * - Interface Segregation: Focused interface
 * - Open/Closed: Extensible through strategy pattern
 */

import { IAPIClient } from '../api/client';
import {
  Decision,
  CausalLink,
  CausalityEdge,
  DecisionNode,
  CausalityDAG,
  DependencyAnalysis,
  PaginatedResponse,
  AppError,
} from '../types';

/**
 * IGovernanceService — Interface for governance operations
 * Enables testing and multiple implementations
 */
export interface IGovernanceService {
  getDecision(id: string): Promise<Decision>;
  listDecisions(filters?: DecisionFilters): Promise<PaginatedResponse<Decision>>;
  recordCausalLink(link: CausalLink): Promise<{ id: string }>;
  analyzeDecisionChain(decisionId: string): Promise<DependencyAnalysis>;
  buildCausalityDAG(decisionId: string, depth?: number): Promise<CausalityDAG>;
  findRootCauses(decisionId: string): Promise<DecisionNode[]>;
  getDecisionImpact(decisionId: string): Promise<DecisionNode[]>;
}

export interface DecisionFilters {
  status?: string;
  indexName?: string;
  confidenceMin?: number;
  confidenceMax?: number;
  limit?: number;
  offset?: number;
}

/**
 * GovernanceService — Production implementation
 */
export class GovernanceService implements IGovernanceService {
  constructor(private apiClient: IAPIClient) {}

  /**
   * Get single decision by ID
   */
  async getDecision(id: string): Promise<Decision> {
    if (!id) {
      throw new AppError('INVALID_ID', 'Decision ID is required', 400);
    }

    try {
      const decision = await this.apiClient.get<Decision>(`/api/governance/decisions/${id}`);
      this.validateDecision(decision);
      return decision;
    } catch (error) {
      throw this.mapError(error, `Failed to get decision ${id}`);
    }
  }

  /**
   * List decisions with filtering and pagination
   */
  async listDecisions(filters?: DecisionFilters): Promise<PaginatedResponse<Decision>> {
    try {
      const params = new URLSearchParams();

      if (filters?.status) params.append('status', filters.status);
      if (filters?.indexName) params.append('indexName', filters.indexName);
      if (filters?.confidenceMin !== undefined) params.append('confidenceMin', String(filters.confidenceMin));
      if (filters?.confidenceMax !== undefined) params.append('confidenceMax', String(filters.confidenceMax));
      if (filters?.limit) params.append('limit', String(filters.limit));
      if (filters?.offset) params.append('offset', String(filters.offset));

      const queryString = params.toString();
      const endpoint = `/api/governance/decisions${queryString ? `?${queryString}` : ''}`;

      const response = await this.apiClient.get<PaginatedResponse<Decision>>(endpoint);
      return response;
    } catch (error) {
      throw this.mapError(error, 'Failed to list decisions');
    }
  }

  /**
   * Record causal relationship between decisions
   */
  async recordCausalLink(link: CausalLink): Promise<{ id: string }> {
    this.validateCausalLink(link);

    try {
      const result = await this.apiClient.post<{ id: string }>(
        '/api/governance/causality/links',
        link
      );
      return result;
    } catch (error) {
      throw this.mapError(error, 'Failed to record causal link');
    }
  }

  /**
   * Analyze complete decision chain with dependencies, impact, cycles
   */
  async analyzeDecisionChain(decisionId: string): Promise<DependencyAnalysis> {
    if (!decisionId) {
      throw new AppError('INVALID_ID', 'Decision ID is required', 400);
    }

    try {
      const analysis = await this.apiClient.get<DependencyAnalysis>(
        `/api/governance/causality/analysis/${decisionId}`
      );
      return analysis;
    } catch (error) {
      throw this.mapError(error, `Failed to analyze decision chain ${decisionId}`);
    }
  }

  /**
   * Build causality DAG (directed acyclic graph) for visualization
   */
  async buildCausalityDAG(decisionId: string, depth: number = 3): Promise<CausalityDAG> {
    if (!decisionId) {
      throw new AppError('INVALID_ID', 'Decision ID is required', 400);
    }

    if (depth < 0 || depth > 10) {
      throw new AppError('INVALID_DEPTH', 'Depth must be between 0 and 10', 400);
    }

    try {
      const dag = await this.apiClient.get<CausalityDAG>(
        `/api/governance/causality/dag/${decisionId}?depth=${depth}`
      );
      return dag;
    } catch (error) {
      throw this.mapError(error, `Failed to build DAG for decision ${decisionId}`);
    }
  }

  /**
   * Find root causes (origin decisions with no dependencies)
   */
  async findRootCauses(decisionId: string): Promise<DecisionNode[]> {
    if (!decisionId) {
      throw new AppError('INVALID_ID', 'Decision ID is required', 400);
    }

    try {
      const roots = await this.apiClient.get<DecisionNode[]>(
        `/api/governance/causality/roots/${decisionId}`
      );
      return Array.isArray(roots) ? roots : [];
    } catch (error) {
      throw this.mapError(error, `Failed to find root causes for decision ${decisionId}`);
    }
  }

  /**
   * Get decision impact (all affected downstream decisions)
   */
  async getDecisionImpact(decisionId: string): Promise<DecisionNode[]> {
    if (!decisionId) {
      throw new AppError('INVALID_ID', 'Decision ID is required', 400);
    }

    try {
      const impact = await this.apiClient.get<DecisionNode[]>(
        `/api/governance/causality/impact/${decisionId}`
      );
      return Array.isArray(impact) ? impact : [];
    } catch (error) {
      throw this.mapError(error, `Failed to get impact for decision ${decisionId}`);
    }
  }

  // ========================================================================
  // PRIVATE VALIDATION & ERROR HANDLING
  // ========================================================================

  /**
   * Validate decision object
   */
  private validateDecision(decision: Decision): void {
    if (!decision?.id) {
      throw new AppError('INVALID_DECISION', 'Invalid decision object', 400);
    }
    if (decision.confidence < 0 || decision.confidence > 1) {
      throw new AppError('INVALID_CONFIDENCE', 'Confidence must be between 0 and 1', 400);
    }
  }

  /**
   * Validate causal link
   */
  private validateCausalLink(link: CausalLink): void {
    if (!link.parentDecisionId || !link.childDecisionId) {
      throw new AppError('INVALID_LINK', 'Parent and child decision IDs are required', 400);
    }
    if (link.parentDecisionId === link.childDecisionId) {
      throw new AppError('SELF_REFERENCE', 'Cannot create causal link to itself', 400);
    }
    if (link.confidence < 0 || link.confidence > 1) {
      throw new AppError('INVALID_CONFIDENCE', 'Confidence must be between 0 and 1', 400);
    }
  }

  /**
   * Map errors to AppError for consistent handling
   */
  private mapError(error: any, defaultMessage: string): AppError {
    if (error instanceof AppError) {
      return error;
    }

    if (error instanceof Error) {
      return new AppError('SERVICE_ERROR', error.message, 500, { originalError: error.message });
    }

    return new AppError('UNKNOWN_ERROR', defaultMessage, 500);
  }
}

/**
 * FACTORY FUNCTION — Create governance service with dependency injection
 */
export function createGovernanceService(apiClient: IAPIClient): IGovernanceService {
  return new GovernanceService(apiClient);
}
