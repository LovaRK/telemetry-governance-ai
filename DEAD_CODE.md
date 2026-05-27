# DEAD CODE CLASSIFICATION

Source: ts-prune raw output (112 candidate exports)

## SAFE_DELETE
- None confirmed

## REVIEW
- agents/composition/agent.ts: runCompositionAgent — manual review
- agents/connection/agent.ts: runConnectionAgent — manual review
- agents/context/agent.ts: runContextAgent — manual review
- agents/discovery/agent.ts: runDiscoveryAgent — manual review
- agents/prioritization/types.ts: PrioritizationInput — manual review
- agents/reasoning/agent.ts: runReasoningAgent — manual review
- agents/reasoning/llm-router.ts: LLMProvider — only used in-module; verify before deleting
- agents/reasoning/llm-router.ts: LLMRouter — manual review
- agents/reasoning/types.ts: Confidence — only used in-module; verify before deleting
- agents/ui-spec/agent.ts: runUISpecAgent — manual review
- agents/value/types.ts: ValueAgentInput — manual review
- agents/value/types.ts: ValueAgentOutput — manual review
- agents/value/types.ts: ScoringInputs — manual review
- tools/mcp/tools.ts: mcpTools — manual review
- packages/core/workflow/executor.ts: executeAction — only used in-module; verify before deleting
- packages/core/workflow/executor.ts: executeDecision — manual review
- packages/core/policy/types.ts: RuleSeverity — only used in-module; verify before deleting
- packages/core/policy/types.ts: RuleOperator — only used in-module; verify before deleting
- packages/core/policy/types.ts: ScoredInput — only used in-module; verify before deleting
- packages/core/policy/types.ts: AgentRecommendation — manual review
- packages/core/policy/types.ts: RuleCondition — only used in-module; verify before deleting
- packages/core/policy/types.ts: PolicyRule — only used in-module; verify before deleting
- packages/core/policy/types.ts: Guardrail — only used in-module; verify before deleting
- packages/core/policy/types.ts: PolicyConfig — manual review
- packages/core/policy/types.ts: PolicyViolation — only used in-module; verify before deleting
- packages/core/policy/types.ts: PolicyValidationResult — manual review
- apps/api/repositories/telemetry-repository.ts: getSnapshotById — manual review
- apps/api/repositories/telemetry-repository.ts: getSnapshotCount — manual review
- apps/api/repositories/telemetry-repository.ts: getValueWasteMatrix — manual review
- apps/api/repositories/telemetry-repository.ts: TelemetrySnapshot — only used in-module; verify before deleting
- apps/api/repositories/telemetry-repository.ts: TelemetryFilters — only used in-module; verify before deleting

## PROTECTED
- core/adapters/adapter-registry.ts: getAdapter — shared runtime/core infrastructure
- core/adapters/adapter-registry.ts: registerAdapter — shared runtime/core infrastructure
- core/adapters/adapter-registry.ts: AdapterResult — shared runtime/core infrastructure
- core/adapters/adapter-registry.ts: ExternalAdapter — shared runtime/core infrastructure
- core/config/cost.ts: calculateAnnualCost — shared runtime/core infrastructure
- core/config/cost.ts: calculateSavings — shared runtime/core infrastructure
- core/config/cost.ts: CostConfig — shared runtime/core infrastructure
- core/config/cost.ts: DEFAULT_COST_CONFIG — shared runtime/core infrastructure
- core/config/weights.ts: validateWeights — shared runtime/core infrastructure
- core/config/weights.ts: ValueWeights — shared runtime/core infrastructure
- core/config/weights.ts: DEFAULT_VALUE_WEIGHTS — shared runtime/core infrastructure
- core/config/weights.ts: ScoringConfig — shared runtime/core infrastructure
- core/config/weights.ts: DEFAULT_SCORING_CONFIG — shared runtime/core infrastructure
- core/database/connection.ts: getClient — shared runtime/core infrastructure
- core/database/connection.ts: transaction — shared runtime/core infrastructure
- core/database/connection.ts: healthCheck — shared runtime/core infrastructure
- core/database/connection.ts: pool — shared runtime/core infrastructure
- core/database/pipeline-events.ts: emitPipelineEventBatch — shared runtime/core infrastructure
- core/database/pipeline-events.ts: getRecentEventsByTaxonomy — shared runtime/core infrastructure
- core/database/pipeline-events.ts: PipelineStage — shared runtime/core infrastructure
- core/database/pipeline-events.ts: PipelineExecution — shared runtime/core infrastructure
- core/events/emit-pure-event.ts: setEmitFn — shared runtime/core infrastructure
- core/events/emit-pure-event.ts: emitPureEvent — shared runtime/core infrastructure
- core/events/emit-pure-event.ts: PureEvent — shared runtime/core infrastructure
- core/governance/policy-engine-events.ts: executePolicyEvaluation — shared runtime/core infrastructure
- core/governance/policy-engine-events.ts: approveOperatorDecision — shared runtime/core infrastructure
- core/governance/policy-engine-events.ts: describeGovernanceDomain — shared runtime/core infrastructure
- core/governance/policy-engine-events.ts: GovernanceDomain — shared runtime/core infrastructure
- core/governance/policy-engine-events.ts: RiskLevel — shared runtime/core infrastructure
- core/governance/policy-engine-events.ts: ActionType — shared runtime/core infrastructure
- core/governance/policy-engine-events.ts: PolicyEvaluationInput — shared runtime/core infrastructure
- core/governance/policy-engine-events.ts: PolicyEvaluationResult — shared runtime/core infrastructure
- core/guards/adapter-purity.guard.ts: withAdapterPurity — shared runtime/core infrastructure
- core/guards/adapter-purity.guard.ts: wrapAdapterResult — shared runtime/core infrastructure
- core/guards/adapter-purity.guard.ts: getPurityMeta — shared runtime/core infrastructure
- core/guards/adapter-purity.guard.ts: AdapterSource — shared runtime/core infrastructure
- core/guards/executor-purity.guard.ts: wrapExecutionResult — shared runtime/core infrastructure
- core/guards/executor-purity.guard.ts: PureExecutionResult — shared runtime/core infrastructure
- core/guards/next-trace-context.ts: withNextTraceContext — shared runtime/core infrastructure
- core/guards/next-trace-context.ts: getTraceId — shared runtime/core infrastructure
- core/guards/pure-executor.wrapper.ts: pureExecutor — shared runtime/core infrastructure
- core/guards/pure-executor.wrapper.ts: PureExecutionResultType — shared runtime/core infrastructure
- core/guards/trace-context.ts: initTraceFromRequest — shared runtime/core infrastructure
- core/pipeline/index.ts: runPipelineFromCache — shared runtime/core infrastructure
- core/pipeline/index.ts: PipelineResult — shared runtime/core infrastructure
- core/schemas/index.ts: RecommendationSchema — shared runtime/core infrastructure
- core/schemas/index.ts: ScoringBreakdownSchema — shared runtime/core infrastructure
- core/schemas/index.ts: TelemetryAssetSchema — shared runtime/core infrastructure
- core/schemas/index.ts: TelemetryAsset — shared runtime/core infrastructure
- core/schemas/index.ts: Recommendation — shared runtime/core infrastructure
- core/schemas/index.ts: ConfidenceSchema — shared runtime/core infrastructure
- core/schemas/index.ts: InsightSchema — shared runtime/core infrastructure
- core/schemas/index.ts: Insight — shared runtime/core infrastructure
- core/schemas/index.ts: Confidence — shared runtime/core infrastructure
- core/schemas/index.ts: ConnectionStateSchema — shared runtime/core infrastructure
- core/schemas/index.ts: ConnectionOutputSchema — shared runtime/core infrastructure
- core/schemas/index.ts: ConnectionOutput — shared runtime/core infrastructure
- core/schemas/index.ts: TimelineEventSchema — shared runtime/core infrastructure
- core/schemas/index.ts: PipelineResultSchema — shared runtime/core infrastructure
- core/schemas/index.ts: TimelineEvent — shared runtime/core infrastructure
- core/schemas/index.ts: PipelineResult — shared runtime/core infrastructure
- core/schemas/index.ts: validateTelemetryAsset — shared runtime/core infrastructure
- core/schemas/index.ts: validateInsight — shared runtime/core infrastructure
- core/schemas/index.ts: validateConnectionOutput — shared runtime/core infrastructure
- core/schemas/index.ts: validatePipelineResult — shared runtime/core infrastructure
- core/schemas/index.ts: safeValidate — shared runtime/core infrastructure
- core/traceability/index.ts: DecisionTraceCollector — shared runtime/core infrastructure
- core/traceability/index.ts: globalTraceCollector — shared runtime/core infrastructure
- core/traceability/index.ts: ConfidenceEngine — shared runtime/core infrastructure
- core/traceability/index.ts: EvidenceCollector — shared runtime/core infrastructure
- core/traceability/index.ts: DecisionTrace — shared runtime/core infrastructure
- core/traceability/index.ts: ConfidenceInput — shared runtime/core infrastructure
- core/traceability/index.ts: PipelineTrace — shared runtime/core infrastructure
- core/traceability/index.ts: STAGE_ORDER — shared runtime/core infrastructure
- core/traceability/index.ts: STAGE_LABELS — shared runtime/core infrastructure
- core/workers/worker-trace-wrapper.ts: withWorkerTrace — shared runtime/core infrastructure
- core/workflow/executor.ts: mapDecisionToActions — shared runtime/core infrastructure
- packages/auth/auth-edge.ts: extractBearerToken — shared runtime/core infrastructure
- packages/auth/auth-edge.ts: JWTPayload — shared runtime/core infrastructure
- packages/auth/request-context.ts: requireContext — shared runtime/core infrastructure

## FROZEN_BASELINE

## Notes
- `ts-prune` can flag conservative false positives, especially framework and dynamic-import code.
- This inventory does not authorize deletions. Confirm with runtime tests before any cleanup commit.