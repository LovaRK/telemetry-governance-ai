/**
 * NORMALIZATION BENCHMARK PACKS (P4.12)
 *
 * CI-certified fixture sets covering all source categories. Each pack
 * exercises a different normalizer or cross-cutting concern. The CI gate
 * (npm run normalization:gate) depends on all packs passing.
 *
 * Packs:
 *   windows   — WinEventLog:* channels (known + unknown)
 *   cloud     — AWS, Azure, GCP, O365 patterns
 *   syslog    — Cisco, Fortinet, Palo Alto, Linux syslog
 *   broken    — Malformed, truncated, null, special chars (generic fallback)
 *   cross     — Routing priority, batch mixing, idempotency
 */

import * as fs from 'fs';
import * as path from 'path';
import { normalizeBatch, validateCanonical } from '../../packages/core/normalization/index';

interface FixtureEntry {
  input: {
    index?: string;
    sourcetype?: string | null;
    dailyAvgGb?: number;
    totalEvents?: number;
    retentionDays?: number;
    costPerGbPerDay?: number;
  };
  expected: {
    sourceType?: string;
    category?: string;
    confidence?: string;
    [key: string]: unknown;
  };
}

interface FixturePack {
  name: string;
  description: string;
  entries: FixtureEntry[];
}

function makeEntry(overrides: {
  index?: string;
  sourcetype?: string | null;
}) {
  return {
    index: overrides.index ?? 'main',
    sourcetype: overrides.sourcetype ?? null,
    dailyAvgGb: 10,
    totalEvents: 1_000_000,
    retentionDays: 90,
    costPerGbPerDay: 0.5,
  };
}

function loadPack(packName: string): FixturePack {
  const p = path.resolve(__dirname, '../fixtures/normalization', `${packName}-pack.json`);
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

const PACKS: { name: string; label: string }[] = [
  { name: 'windows', label: 'Windows Event Log' },
  { name: 'cloud', label: 'Cloud Platform' },
  { name: 'syslog', label: 'Syslog/Network' },
  { name: 'broken', label: 'Broken/Malformed' },
  { name: 'cross-cutting', label: 'Cross-Cutting' },
];

for (const { name, label } of PACKS) {
  const pack = loadPack(name);

  describe(`Normalization Benchmark: ${label}`, () => {
    it(`loads ${pack.entries.length} fixture entries`, () => {
      expect(pack.entries.length).toBeGreaterThan(0);
    });

    it('every entry produces non-null canonical output', () => {
      const entries = pack.entries.map(f =>
        makeEntry({ index: f.input.index, sourcetype: f.input.sourcetype ?? null })
      );
      const { canonical } = normalizeBatch(entries);
      expect(canonical).toHaveLength(entries.length);
      for (const c of canonical) {
        expect(c).not.toBeNull();
        expect(c.sourceType).toBeTruthy();
      }
    });

    it('every canonical entry passes validateCanonical', () => {
      const entries = pack.entries.map(f =>
        makeEntry({ index: f.input.index, sourcetype: f.input.sourcetype ?? null })
      );
      const { canonical } = normalizeBatch(entries);
      for (const c of canonical) {
        const errors = validateCanonical(c);
        expect(errors).toHaveLength(0);
      }
    });

    it('normalization is idempotent (second pass matches first)', () => {
      const entries = pack.entries.map(f =>
        makeEntry({ index: f.input.index, sourcetype: f.input.sourcetype ?? null })
      );
      const { canonical: first } = normalizeBatch(entries);
      const { canonical: second } = normalizeBatch(entries);
      expect(first).toHaveLength(second.length);
      for (let i = 0; i < first.length; i++) {
        expect(first[i].sourceType).toBe(second[i].sourceType);
        expect(first[i].category).toBe(second[i].category);
        expect(first[i].confidence).toBe(second[i].confidence);
      }
    });

    it('preserves volume and event metadata', () => {
      const entries = pack.entries.map((f, i) => ({
        ...makeEntry({ index: f.input.index, sourcetype: f.input.sourcetype ?? null }),
        dailyAvgGb: 5 + i,
        totalEvents: 100_000 * (i + 1),
      }));
      const { canonical } = normalizeBatch(entries);
      for (let i = 0; i < canonical.length; i++) {
        expect(canonical[i].volumeGb).toBe(entries[i].dailyAvgGb);
        expect(canonical[i].events).toBe(entries[i].totalEvents);
      }
    });

    it('never errors on any input (generic fallback)', () => {
      const entries = pack.entries.map(f =>
        makeEntry({ index: f.input.index, sourcetype: f.input.sourcetype ?? null })
      );
      const { errors } = normalizeBatch(entries);
      expect(errors).toHaveLength(0);
    });

    it('mixes correctly with other categories in a batch', () => {
      const pack2 = PACKS.find(p => p.name !== name);
      const otherPack = pack2 ? loadPack(pack2.name) : null;
      const allEntries = [
        ...pack.entries.map(f =>
          makeEntry({ index: f.input.index, sourcetype: f.input.sourcetype ?? null })
        ),
        ...(otherPack ? otherPack.entries.slice(0, 3).map(f =>
          makeEntry({ index: f.input.index, sourcetype: f.input.sourcetype ?? null })
        ) : []),
      ];
      const { canonical } = normalizeBatch(allEntries);
      expect(canonical).toHaveLength(allEntries.length);
      expect(canonical.every(c => c.sourceType.length > 0)).toBe(true);
    });

    if (name !== 'broken') {
      it('matches expected sourceType when confidence is HIGH', () => {
        const highConfEntries = pack.entries.filter(f => f.expected.confidence === 'HIGH');
        if (highConfEntries.length === 0) return;

        const entries = highConfEntries.map(f =>
          makeEntry({ index: f.input.index, sourcetype: f.input.sourcetype ?? null })
        );
        const { canonical } = normalizeBatch(entries);
        for (let i = 0; i < highConfEntries.length; i++) {
          const exp = highConfEntries[i].expected;
          if (exp.sourceType) {
            expect(canonical[i].sourceType).toBe(exp.sourceType);
          }
          if (exp.confidence) {
            expect(canonical[i].confidence).toBe(exp.confidence);
          }
        }
      });
    }
  });
}

describe('Normalization Benchmark: Cross-Pack CI Certification', () => {
  it('all packs combined produce correct entry count', () => {
    const allEntries: FixtureEntry[] = [];
    for (const { name } of PACKS) {
      const pack = loadPack(name);
      allEntries.push(...pack.entries);
    }
    const entries = allEntries.map(f =>
      makeEntry({ index: f.input.index, sourcetype: f.input.sourcetype ?? null })
    );
    const { canonical } = normalizeBatch(entries);
    expect(canonical).toHaveLength(entries.length);
  });

  it('every canonical sourceType is non-empty string', () => {
    for (const { name } of PACKS) {
      const pack = loadPack(name);
      const entries = pack.entries.map(f =>
        makeEntry({ index: f.input.index, sourcetype: f.input.sourcetype ?? null })
      );
      const { canonical } = normalizeBatch(entries);
      for (const c of canonical) {
        expect(typeof c.sourceType).toBe('string');
        expect(c.sourceType.length).toBeGreaterThan(0);
      }
    }
  });
});
