import { fetchSourcesParallel } from '../../apps/api/services/parallel-fetch-service';

describe('Contract: parallel fetch abstraction', () => {
  test('2 succeed + 1 fail returns settled results without throwing', async () => {
    const sources = ['main', 'history', 'security'];

    const out = await fetchSourcesParallel(sources, async (sourceType) => {
      if (sourceType === 'security') {
        throw new Error('SPLUNK_SOURCE_TIMEOUT');
      }
      return { sourceType, rows: sourceType === 'main' ? 12 : 8 };
    });

    expect(out).toHaveLength(3);

    const main = out.find((r) => r.sourceType === 'main');
    const history = out.find((r) => r.sourceType === 'history');
    const security = out.find((r) => r.sourceType === 'security');

    expect(main?.status).toBe('fulfilled');
    expect(history?.status).toBe('fulfilled');
    expect(security?.status).toBe('rejected');
    expect(security?.error).toContain('SPLUNK_SOURCE_TIMEOUT');

    // Refresh survives: function returns all rows instead of throwing.
    expect(() => out.map((r) => r.sourceType)).not.toThrow();
  });
});
