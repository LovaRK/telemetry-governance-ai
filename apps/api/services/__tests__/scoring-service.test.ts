import { scoreTelemetry, ScoringInput, runBatchScoring } from '../scoring-service';
import { query, transaction } from '../../../../core/database/connection';

jest.mock('../../../../core/database/connection');

describe('scoreTelemetry', () => {
  it('classifies high-volume low-utilization as ELIMINATE', () => {
    const input: ScoringInput = {
      index: 'nginx_debug',
      totalEvents: 1_000_000_000,
      dailyAvgGb: 15,
      retentionDays: 30,
      utilizationPct: 2,
      costPerYear: 2737.5,
    };

    const result = scoreTelemetry(input);
    expect(result.classification).toBe('ELIMINATE');
    expect(result.riskScore).toBe(95);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies moderate volume with low utilization as ARCHIVE', () => {
    const input: ScoringInput = {
      index: 'staging_logs',
      totalEvents: 100_000_000,
      dailyAvgGb: 7,
      retentionDays: 180,
      utilizationPct: 15,
      costPerYear: 1277.5,
    };

    const result = scoreTelemetry(input);
    expect(result.classification).toBe('ARCHIVE');
    expect(result.riskScore).toBe(75);
  });

  it('classifies healthy indices as KEEP', () => {
    const input: ScoringInput = {
      index: 'prod_api',
      totalEvents: 500_000_000,
      dailyAvgGb: 3,
      retentionDays: 90,
      utilizationPct: 85,
      costPerYear: 547.5,
    };

    const result = scoreTelemetry(input);
    expect(result.classification).toBe('KEEP');
    expect(result.riskScore).toBe(10);
  });

  it('generates actionable recommendations', () => {
    const input: ScoringInput = {
      index: 'test_data',
      totalEvents: 10,
      dailyAvgGb: 20,
      retentionDays: 30,
      utilizationPct: 1,
      costPerYear: 3650,
    };

    const result = scoreTelemetry(input);
    expect(result.recommendation).toContain('Stop ingestion');
    expect(result.evidence.length).toBeGreaterThan(0);
  });
});

describe('runBatchScoring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('scores unclassified snapshots and updates database', async () => {
    const mockRows = [
      {
        id: 1,
        index_name: 'idx1',
        sourcetype: null,
        total_events: '1000000',
        daily_avg_gb: '5.5',
        retention_days: 90,
        raw_metadata: { utilizationPct: 10 },
      },
    ];

    (query as jest.Mock).mockResolvedValue({ rows: mockRows });
    (transaction as jest.Mock).mockImplementation(async (fn: any) => fn({ query: jest.fn().mockResolvedValue({}) }));

    const result = await runBatchScoring();
    expect(result.scored).toBe(1);
    expect(result.errors).toBe(0);
  });
});
