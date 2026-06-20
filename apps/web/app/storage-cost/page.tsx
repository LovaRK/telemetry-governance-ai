'use client';

import { useEffect, useState } from 'react';
import TopAppBar from '../../components/layout/TopAppBar';
import { apiFetch } from '../../lib/api-client';
import { useAuthGuard } from '../../lib/use-auth-guard';
import { fmt$ } from '../../components/dashboard/executive-overview/utils';

interface StorageCostRow {
  indexName: string;
  sourcetype: string;
  tier: string;
  action: string;
  dailyAvgGb: number;
  retentionDays: number;
  annualCost: number;
  utilizationScore: number;
  retentionSavings: number;
  fieldSavings: number;
  compressionSavings: number;
  totalSavings: number;
  confidence: string;
}

interface StorageCostSummary {
  totalAnnualCost: number;
  totalSavings: number;
  indexCount: number;
}

const TIER_COLORS: Record<string, string> = {
  critical: '#ef4444',
  important: '#f59e0b',
  niceToHave: '#3b82f6',
  lowValue: '#64748b',
};

function tierColor(tier: string): string {
  if (/critical/i.test(tier)) return TIER_COLORS.critical;
  if (/important/i.test(tier)) return TIER_COLORS.important;
  if (/nice/i.test(tier)) return TIER_COLORS.niceToHave;
  return TIER_COLORS.lowValue;
}

function confidenceColor(c: string): string {
  if (c === 'HIGH') return '#22c55e';
  if (c === 'MEDIUM') return '#f59e0b';
  return '#ef4444';
}

export default function StorageCostPage() {
  useAuthGuard();
  const [rows, setRows] = useState<StorageCostRow[]>([]);
  const [summary, setSummary] = useState<StorageCostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<keyof StorageCostRow>('annualCost');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/storage-cost');
        if (!res.ok) {
          setError(`Failed to load storage cost data: ${res.status}`);
          return;
        }
        const json = await res.json();
        const payload = json?.data || json;
        if (payload?.empty) {
          setRows([]);
          setSummary(null);
          return;
        }
        setRows(payload?.rows || []);
        setSummary(payload?.summary || null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSort = (field: keyof StorageCostRow) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortField];
    const bv = b[sortField];
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const topSavings = rows.length > 0
    ? Math.max(...rows.map(r => r.totalSavings))
    : 0;

  return (
    <main style={{ minHeight: '100vh', background: '#050a14' }}>
      <TopAppBar />

      <div style={{ padding: '1.25rem', maxWidth: 1440, margin: '0 auto' }}>
        {/* Back + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
          <a href="/" style={{ color: '#64748b', textDecoration: 'none', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4 }}>
            ← Dashboard
          </a>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc', margin: 0, letterSpacing: '-0.02em' }}>
              High Storage Cost Assessment
            </h1>
            <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>
              Per-index storage cost ranking with retention &amp; compression savings breakdown (Guide §8)
            </div>
          </div>
        </div>

        {error && (
          <div style={{ padding: '0.75rem 1rem', background: '#ef444415', border: '1px solid #ef444440', borderRadius: 8, color: '#ef4444', fontSize: '0.8rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '4rem', color: '#64748b', fontSize: '0.85rem' }}>Loading storage cost data…</div>
        )}

        {!loading && rows.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '4rem', color: '#475569', fontSize: '0.85rem' }}>
            No storage cost data available. Run a pipeline refresh first.
          </div>
        )}

        {!loading && summary && rows.length > 0 && (
          <>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <SummaryCard label="Total Annual Cost" value={fmt$(summary.totalAnnualCost)} color="#f8fafc" />
              <SummaryCard label="Total Savings Potential" value={fmt$(summary.totalSavings)} color="#22c55e" />
              <SummaryCard label="Savings Rate" value={summary.totalAnnualCost > 0 ? `${((summary.totalSavings / summary.totalAnnualCost) * 100).toFixed(1)}%` : '0%'} color="#3b82f6" />
              <SummaryCard label="Indexes Analyzed" value={String(summary.indexCount)} color="#a78bfa" />
            </div>

            {/* Table */}
            <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1e293b' }}>
                      {([
                        ['indexName', 'Index'],
                        ['sourcetype', 'Sourcetype'],
                        ['tier', 'Tier'],
                        ['dailyAvgGb', 'Daily GB'],
                        ['retentionDays', 'Retention'],
                        ['annualCost', 'Annual Cost'],
                        ['retentionSavings', 'Retention Savings'],
                        ['compressionSavings', 'Compression Savings'],
                        ['totalSavings', 'Total Savings'],
                        ['confidence', 'Confidence'],
                      ] as [keyof StorageCostRow, string][]).map(([field, label]) => (
                        <th
                          key={field}
                          onClick={() => handleSort(field)}
                          style={{
                            padding: '0.65rem 0.75rem',
                            textAlign: field === 'indexName' || field === 'sourcetype' || field === 'tier' || field === 'confidence' ? 'left' : 'right',
                            color: sortField === field ? '#e2e8f0' : '#64748b',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            fontSize: '0.65rem',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            userSelect: 'none',
                          }}
                        >
                          {label} {sortField === field ? (sortDir === 'desc' ? '▼' : '▲') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((row, i) => (
                      <tr key={`${row.indexName}-${row.sourcetype}-${i}`} style={{ borderBottom: '1px solid #0f172a', background: i % 2 === 0 ? '#0b1120' : '#0f172a' }}>
                        <td style={{ ...cellStyle, fontWeight: 600, color: '#e2e8f0' }}>{row.indexName}</td>
                        <td style={{ ...cellStyle, color: '#94a3b8' }}>{row.sourcetype || '—'}</td>
                        <td style={cellStyle}>
                          <span style={{ color: tierColor(row.tier), fontWeight: 600, fontSize: '0.68rem', textTransform: 'uppercase' }}>
                            {row.tier}
                          </span>
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'right', color: '#cbd5e1', fontFamily: 'ui-monospace, monospace' }}>
                          {row.dailyAvgGb.toFixed(2)}
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'right', color: '#cbd5e1' }}>
                          {row.retentionDays}d
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'right', color: '#f8fafc', fontWeight: 600 }}>
                          {fmt$(row.annualCost)}
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'right', color: row.retentionSavings > 0 ? '#22c55e' : '#475569' }}>
                          {row.retentionSavings > 0 ? fmt$(row.retentionSavings) : '—'}
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'right', color: row.compressionSavings > 0 ? '#22c55e' : '#475569' }}>
                          {row.compressionSavings > 0 ? fmt$(row.compressionSavings) : '—'}
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'right', position: 'relative' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                            {topSavings > 0 && row.totalSavings > 0 && (
                              <div style={{ width: 48, height: 4, borderRadius: 2, background: '#1e293b', overflow: 'hidden' }}>
                                <div style={{ width: `${(row.totalSavings / topSavings) * 100}%`, height: '100%', background: '#22c55e', borderRadius: 2 }} />
                              </div>
                            )}
                            <span style={{ color: row.totalSavings > 0 ? '#22c55e' : '#475569', fontWeight: 600 }}>
                              {row.totalSavings > 0 ? fmt$(row.totalSavings) : '—'}
                            </span>
                          </div>
                        </td>
                        <td style={cellStyle}>
                          <span style={{ color: confidenceColor(row.confidence), fontWeight: 600, fontSize: '0.68rem' }}>
                            {row.confidence}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Evidence badge */}
            <div style={{ marginTop: '1rem', padding: '0.6rem 0.85rem', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                RECONSTRUCTED
              </span>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                Built from calculation guide §8. No reference screencapture available for pixel-level validation.
              </span>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ padding: '1rem 1.25rem', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10 }}>
      <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, color, letterSpacing: '-0.02em' }}>
        {value}
      </div>
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  padding: '0.55rem 0.75rem',
  whiteSpace: 'nowrap',
  color: '#94a3b8',
};
