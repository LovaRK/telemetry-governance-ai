/**
 * EXTERNAL SYSTEM ADAPTER LAYER
 * Abstraction for external infrastructure operations
 * Enables clean testing, failure injection, and reconciliation
 */

export interface DeleteIndexInput {
  index: string;
  tenantId: string;
  idempotencyKey: string;
}

export interface DeleteIndexOutput {
  status: 'success' | 'failed' | 'unknown';
  externalId?: string;
  error?: string;
  executedAt?: Date;
}

export interface GetIndexStateInput {
  index: string;
  tenantId: string;
}

export interface GetIndexStateOutput {
  exists: boolean;
  lastModified?: Date;
  deleted?: boolean;
  error?: string;
}

export interface ArchiveToS3Input {
  bucket: string;
  prefix: string;
  dataSize: number;
}

export interface ArchiveToS3Output {
  status: 'success' | 'failed' | 'unknown';
  s3Path?: string;
  error?: string;
}

/**
 * External System Adapter (Interface)
 * Enables DI for prod vs test implementations
 */
export interface ExternalSystemAdapter {
  /**
   * Delete index in Splunk
   * Returns state-driven result, not HTTP-specific
   */
  deleteIndex(input: DeleteIndexInput): Promise<DeleteIndexOutput>;

  /**
   * Probe current state of index
   * Used by reconciliation to determine what actually happened
   */
  getIndexState(input: GetIndexStateInput): Promise<GetIndexStateOutput>;

  /**
   * Archive index data to S3
   * Must be idempotent (same prefix = no duplicate)
   */
  archiveToS3(input: ArchiveToS3Input): Promise<ArchiveToS3Output>;

  /**
   * Health check for adapter readiness
   */
  health(): Promise<{ healthy: boolean; error?: string }>;
}
