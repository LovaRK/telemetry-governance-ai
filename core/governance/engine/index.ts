/**
 * Runtime Governance Engine (RGE) Module
 * Core deterministic decision-making substrate.
 */

export { RuntimeGovernanceEngine, governanceEngine } from './runtime-governance-engine';
export {
  Decision,
  RiskLevel,
  GovernanceDecision,
  GovernanceEvaluation,
  ExecutionAuthorization,
  GovernanceEvaluationRequest,
  PolicyEvaluationResult
} from './decision-model';
