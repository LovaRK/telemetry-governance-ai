import { ReasoningOutput } from '../reasoning/types';

export interface PrioritizationInput {
  reasoning: ReasoningOutput;
}

export interface PrioritizationOutput {
  prioritized: {
    high: any[];
    medium: any[];
    low: any[];
  };
  severity_scores: Record<string, number>;
  schema_version: string;
}