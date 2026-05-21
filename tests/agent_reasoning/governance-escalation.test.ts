import fs from 'fs';
import path from 'path';

type Fixture = {
  security_critical: boolean;
  search_count_30d: number;
  annual_license_cost: number;
};

function mustEscalate(f: Fixture): boolean {
  return f.security_critical && f.search_count_30d <= 1 && f.annual_license_cost >= 1000;
}

describe('Agent Reasoning - Governance Escalation', () => {
  test('unsafe removal scenario requires approval', () => {
    const p = path.join(process.cwd(), 'tests', 'fixtures', 'risky_removal.json');
    const f = JSON.parse(fs.readFileSync(p, 'utf8')) as Fixture;

    expect(mustEscalate(f)).toBe(true);
  });
});
