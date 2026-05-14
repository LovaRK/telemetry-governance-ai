import { DiscoveryOutput } from '../discovery/types';

export interface ContextInput {
  discovery: DiscoveryOutput;
}

export interface ContextOutput {
  categories: {
    health: string[];
    errors: string[];
    latency: string[];
    security: string[];
    waste: string[];
    anomalies: string[];
  };
  schema_version: string;
}