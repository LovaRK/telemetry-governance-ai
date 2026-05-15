import { ContextOutput } from '../context/types';

export interface ReasoningInput {
  context: ContextOutput;
}

export interface Confidence {
  score: number;
  factors: string[];
}

export interface Insight {
  insight: string;
  confidence: Confidence;
  evidence: string[];
  source_queries: string[];
  supporting_metrics: string[];
  trigger_conditions: string[];
  correlation?: string;
}

export interface ReasoningOutput {
  insights: Insight[];
  schema_version: string;
}