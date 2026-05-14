import { ConnectionOutput } from '../connection/types';

export interface DiscoveryInput {
  connection: ConnectionOutput;
}

export interface DiscoveryOutput {
  high_volume_sources: string[];
  error_sources: string[];
  critical_indexes: string[];
  telemetry_summary: {
    total_indexes: number;
    total_sources: number;
    daily_gb_estimate: number;
  };
  schema_version: string;
}