export interface PipelineProvenance {
  lifecycleVersion: 'v1';
  sourceOrigin: 'pipeline_ledger';
  tenantId: string;
  runId: string | null;
  requestId: string | null;
  updatedAt: string | null;
}

export function buildPipelineProvenance(params: {
  tenantId: string;
  runId?: string | null;
  requestId?: string | null;
  updatedAt?: string | null;
}): PipelineProvenance {
  return {
    lifecycleVersion: 'v1',
    sourceOrigin: 'pipeline_ledger',
    tenantId: params.tenantId,
    runId: params.runId || null,
    requestId: params.requestId || null,
    updatedAt: params.updatedAt || null,
  };
}
