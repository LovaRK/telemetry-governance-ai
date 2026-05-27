import {
  buildDecisionHash,
  buildExecutionHash,
  buildSnapshotHash,
  buildSourceHash,
} from '../../apps/api/services/pipeline-hash-service';

describe('pipeline hash canonicalization contracts', () => {
  test('source hash is stable for key order differences', () => {
    const a = {
      daily_ingest: 920,
      indexes: ['security', 'infra'],
      unused_sources: 14,
    };
    const b = {
      unused_sources: 14,
      indexes: ['infra', 'security'],
      daily_ingest: 920,
    };
    expect(buildSourceHash(a)).toBe(buildSourceHash(b));
  });

  test('snapshot hash is stable for equivalent payload shape', () => {
    const payloadA = {
      annual_savings: 520000,
      waste_pct: 34,
      risk: 0.18,
      unused_sources: 14,
    };
    const payloadB = {
      unused_sources: 14,
      annual_savings: 520000,
      risk: 0.18,
      waste_pct: 34,
    };
    expect(buildSnapshotHash(payloadA)).toBe(buildSnapshotHash(payloadB));
  });

  test('execution hash deterministically combines all layers', () => {
    const sourceHash = buildSourceHash({ metric: 1 });
    const snapshotHash = buildSnapshotHash({ kpi: 2 });
    const decisionHash = buildDecisionHash([{ action: 'OPTIMIZE', confidence: 0.82 }]);
    const one = buildExecutionHash({ sourceHash, snapshotHash, decisionHash, schemaVersion: '1' });
    const two = buildExecutionHash({ sourceHash, snapshotHash, decisionHash, schemaVersion: '1' });
    expect(one).toBe(two);
  });
});

