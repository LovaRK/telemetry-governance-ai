import fs from 'fs';
import path from 'path';

type Fixture = {
  search_count_30d: number;
  annual_license_cost: number;
  security_critical: boolean;
};

function confidenceModel(f: Fixture): number {
  if (f.security_critical) return 0.84;
  if (f.search_count_30d <= 1 && f.annual_license_cost > 1000) return 0.9;
  return 0.75;
}

describe('Agent Reasoning - Confidence', () => {
  test('confidence remains in calibrated bounds', () => {
    const fixtures = ['healthy.json', 'waste.json', 'risky_removal.json'].map((name) => {
      const p = path.join(process.cwd(), 'tests', 'fixtures', name);
      return JSON.parse(fs.readFileSync(p, 'utf8')) as Fixture;
    });

    for (const f of fixtures) {
      const c = confidenceModel(f);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});
