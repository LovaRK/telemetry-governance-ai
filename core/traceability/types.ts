export interface DecisionTrace {
  trace_id: string;
  stage: string;
  stage_order: number;
  input: any;
  output: any;
  reasoning: string;
  evidence: string[];
  confidence: number;
  duration_ms: number;
  timestamp: string;
}

export interface ConfidenceInput {
  evidenceCount: number;
  dataQualityScore: number;
  anomalyScore: number;
  sourceReliability: number;
}

export interface PipelineTrace {
  decision_traces: DecisionTrace[];
  overall_confidence: number;
  trace_id: string;
}

export const STAGE_ORDER: Record<string, number> = {
  connection: 1,
  discovery: 2,
  context: 3,
  reasoning: 4,
  value: 5,
  prioritization: 6,
  composition: 7
};

export const STAGE_LABELS: Record<string, string> = {
  connection: 'Connection Agent',
  discovery: 'Discovery Agent',
  context: 'Context Agent',
  reasoning: 'Reasoning Agent',
  value: 'Value Agent',
  prioritization: 'Prioritization Agent',
  composition: 'Composition Agent'
};