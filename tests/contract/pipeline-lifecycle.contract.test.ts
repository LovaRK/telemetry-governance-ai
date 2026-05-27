import {
  derivePipelineStatus,
  type LLMStatus,
  type SnapshotStatus,
} from '../../apps/web/lib/pipeline-lifecycle';

describe('Contract: canonical pipeline lifecycle derivation', () => {
  test('snapshot READY + llm RUNNING => PARTIAL', () => {
    const status = derivePipelineStatus('READY' as SnapshotStatus, 'RUNNING' as LLMStatus);
    expect(status).toBe('PARTIAL');
  });

  test('snapshot READY + llm READY => READY', () => {
    const status = derivePipelineStatus('READY' as SnapshotStatus, 'READY' as LLMStatus);
    expect(status).toBe('READY');
  });

  test('snapshot FAILED => FAILED', () => {
    const status = derivePipelineStatus('FAILED' as SnapshotStatus, 'NOT_STARTED' as LLMStatus);
    expect(status).toBe('FAILED');
  });
});

