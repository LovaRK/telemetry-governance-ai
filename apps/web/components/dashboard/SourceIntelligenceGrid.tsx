'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { SnapshotRow } from '../../lib/types';

interface Props { snapshots: SnapshotRow[]; hasAgentDecisions?: boolean; }

const PAGE_SIZE = 15;

const TIER_COLORS: Record<string, string> = {
  'Critical': '#ef4444', 'Important': '#f59e0b', 'Nice-to-Have': '#3b82f6', 'Low Value': '#64748b',
};
const ACTION_COLORS: Record<string, string> = {
  KEEP: '#22c55e', OPTIMIZE: '#f59e0b', ARCHIVE: '#3b82f6', ELIMINATE: '#ef4444', INVESTIGATE: '#8b5cf6',
};

function fmt$(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  if (v >= 1) return `$${v.toFixed(0)}`;
  if (v > 0) return `$${v.toFixed(2)}`;
  return '$0';
}

function ScorePip({ value }: { value: number }) {
  const color = value >= 70 ? '#22c55e' : value >= 40 ? '#f59e0b' : '#ef4444';
  return <span style={{ fontWeight: 700, color }}>{value.toFixed(0)}</span>;
}

/** Mini 4-bar sparkline showing Util/Detect/Quality/Composite scores */
function ScoreSparkline({ util, detect, quality, composite }: { util: number; detect: number; quality: number; composite: number }) {
  const bars = [
    { label: 'U', value: util,      color: util >= 70 ? '#22c55e' : util >= 40 ? '#f59e0b' : '#ef4444' },
    { label: 'D', value: detect,    color: detect >= 70 ? '#22c55e' : detect >= 40 ? '#f59e0b' : '#ef4444' },
    { label: 'Q', value: quality,   color: quality >= 70 ? '#22c55e' : quality >= 40 ? '#f59e0b' : '#ef4444' },
    { label: 'C', value: composite, color: composite >= 70 ? '#22c55e' : composite >= 40 ? '#f59e0b' : '#ef4444' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 28, padding: '2px 0' }} title={`Util: ${util.toFixed(0)}  Detect: ${detect.toFixed(0)}  Quality: ${quality.toFixed(0)}  Composite: ${composite.toFixed(0)}`}>
      {bars.map((b, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
          <div style={{ width: 8, height: Math.max(3, (b.value / 100) * 20), background: b.color, borderRadius: 2, opacity: 0.85 }} />
          <span style={{ fontSize: '0.42rem', color: '#475569', fontWeight: 700 }}>{b.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function SourceIntelligenceGrid({ snapshots, hasAgentDecisions = false }: Props) {
  const [sortKey, setSortKey] = useState<string>('compositeScore');
  const [sortDesc, setSortDesc] = useState(true);
  const [filterTier, setFilterTier] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  type SortableKey = keyof SnapshotRow;

  const sorted = [...snapshots]
    .filter((s) => !filterTier || s.tier === filterTier)
    .filter((s) => !filterAction || s.classification === filterAction)
    .sort((a, b) => {
      const aVal = a[sortKey as SortableKey];
      const bVal = b[sortKey as SortableKey];
      if (typeof aVal === 'number' && typeof bVal === 'number') return sortDesc ? bVal - aVal : aVal - bVal;
      return sortDesc ? String(bVal ?? '').localeCompare(String(aVal ?? '')) : String(aVal ?? '').localeCompare(String(bVal ?? ''));
    });

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggle = (key: string) => {
    if (sortKey === key) setSortDesc(!sortDesc);
    else { setSortKey(key); setSortDesc(true); }
    setPage(0);
  };

  const sortIcon = (key: string) => sortKey === key ? (sortDesc ? ' ▼' : ' ▲') : '';
  const tiers = Array.from(new Set(snapshots.map((s) => s.tier).filter(Boolean)));
  const actions = ['KEEP', 'OPTIMIZE', 'ARCHIVE', 'ELIMINATE', 'INVESTIGATE'];

  const COLS = 14; // total column count for expanded row colSpan

  return (
    <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
      {!hasAgentDecisions && (
        <div style={{ marginBottom: '1rem', padding: '0.625rem 1rem', background: '#1c1008', border: '1px solid #f59e0b40', borderRadius: 8, color: '#f59e0b', fontSize: '0.78rem' }}>
          ⏳ Tier, Action, Risk, and Recommendation columns are populated by the LLM pipeline — run a Splunk refresh to generate decisions.
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#f8fafc', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Telemetry Intelligence — {sorted.length} indexes
        </h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <select value={filterTier} onChange={(e) => { setFilterTier(e.target.value); setPage(0); }} style={selectStyle}>
            <option value="">All Tiers</option>
            {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setPage(0); }} style={selectStyle}>
            <option value="">All Actions</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #1e293b' }}>
              {[
                { key: 'indexName', label: 'Index' },
                { key: 'tier', label: 'Tier' },
                { key: 'classification', label: 'Action' },
                { key: 'dailyAvgGb', label: 'GB/Day' },
                { key: 'costPerYear', label: 'Cost/Yr' },
                { key: 'compositeScore', label: 'Composite' },
                { key: 'utilizationScore', label: 'Util' },
                { key: 'detectionScore', label: 'Detect' },
                { key: 'qualityScore', label: 'Quality' },
                { key: 'estimatedSavings', label: 'Savings' },
                { key: 'confidence', label: 'Conf' },
                { key: 'detectionGap', label: 'Det. Gap' },
              ].map((h) => (
                <th key={h.key} onClick={() => toggle(h.key)} style={thStyle}>
                  {h.label}{sortIcon(h.key)}
                </th>
              ))}
              <th style={{ ...thStyle, cursor: 'default' }}>Recommendation</th>
              <th style={{ ...thStyle, cursor: 'default' }}>Flags</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((s) => {
              const rowKey = `${s.indexName}-${s.sourcetype || ''}`;
              const isExpanded = expanded === rowKey;
              const tierColor = TIER_COLORS[s.tier] || '#64748b';
              const actionColor = ACTION_COLORS[s.classification] || '#64748b';

              return (
                <React.Fragment key={rowKey}>
                  <tr
                    style={{ borderBottom: '1px solid #1e293b', cursor: 'pointer', background: isExpanded ? '#0f1f35' : 'transparent' }}
                    onClick={() => setExpanded(isExpanded ? null : rowKey)}
                  >
                    <td style={{ padding: '0.625rem 0.75rem' }}>
                      <Link href={`/index/${encodeURIComponent(s.indexName)}`} style={{ color: '#f8fafc', fontWeight: 600, textDecoration: 'none', fontSize: '0.85rem' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#3b82f6')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#f8fafc')}>
                        {s.indexName}
                      </Link>
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem' }}>
                      <span style={{ padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.7rem', background: `${tierColor}20`, color: tierColor, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {s.tier}
                      </span>
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem' }}>
                      <span style={{ padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.7rem', background: `${actionColor}20`, color: actionColor, fontWeight: 600 }}>
                        {s.classification}
                      </span>
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', color: '#94a3b8' }}>{s.dailyAvgGb.toFixed(3)}</td>
                    <td style={{ padding: '0.625rem 0.75rem', color: '#94a3b8' }}>{fmt$(s.costPerYear)}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ScoreSparkline util={s.utilizationScore} detect={s.detectionScore} quality={s.qualityScore} composite={s.compositeScore} />
                        <ScorePip value={s.compositeScore} />
                      </div>
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem' }}><ScorePip value={s.utilizationScore} /></td>
                    <td style={{ padding: '0.625rem 0.75rem' }}><ScorePip value={s.detectionScore} /></td>
                    <td style={{ padding: '0.625rem 0.75rem' }}><ScorePip value={s.qualityScore} /></td>
                    <td style={{ padding: '0.625rem 0.75rem', color: s.estimatedSavings > 0 ? '#22c55e' : '#475569', fontWeight: 600 }}>
                      {s.estimatedSavings > 0 ? fmt$(s.estimatedSavings) : '—'}
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', color: '#94a3b8' }}>{(s.confidence <= 1 ? s.confidence * 100 : s.confidence).toFixed(0)}%</td>
                    <td style={{ padding: '0.625rem 0.75rem' }}>
                      {s.detectionGap
                        ? <span style={{ padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.7rem', background: '#ef444420', color: '#ef4444', fontWeight: 600 }}>Yes</span>
                        : <span style={{ color: '#334155', fontSize: '0.7rem' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem', color: '#64748b', maxWidth: 200 }}>
                      <span title={s.recommendation || ''} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
                        {s.recommendation ? s.recommendation.slice(0, 60) + (s.recommendation.length > 60 ? '…' : '') : '—'}
                      </span>
                    </td>
                    <td style={{ padding: '0.625rem 0.75rem' }}>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        {s.isQuickWin && <span title="Quick Win" style={flagStyle('#22c55e')}>⚡</span>}
                        {s.isS3Candidate && <span title="S3 Archive Candidate" style={flagStyle('#3b82f6')}>☁</span>}
                        {s.detectionGap && <span title="Detection Gap" style={flagStyle('#ef4444')}>⚠</span>}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr style={{ background: '#0a1628' }}>
                      <td colSpan={COLS} style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #1e293b' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          <div>
                            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>🧠 Agent Reasoning</div>
                            <div style={{ color: '#cbd5e1', fontSize: '0.8rem', lineHeight: 1.6 }}>{s.reasoning || s.recommendation || 'No reasoning provided'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>Metrics</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.75rem' }}>
                              <div style={{ color: '#94a3b8' }}>Retention: <span style={{ color: '#f8fafc' }}>{s.retentionDays}d</span></div>
                              <div style={{ color: '#94a3b8' }}>Events: <span style={{ color: '#f8fafc' }}>{s.totalEvents.toLocaleString()}</span></div>
                              <div style={{ color: '#94a3b8' }}>Utilization: <span style={{ color: '#f8fafc' }}>{s.utilizationPct.toFixed(1)}%</span></div>
                              <div style={{ color: '#94a3b8' }}>Risk Score: <span style={{ color: '#f8fafc' }}>{s.riskScore.toFixed(0)}</span></div>
                              {s.sourcetype && <div style={{ color: '#94a3b8', gridColumn: 'span 2' }}>Sourcetype: <span style={{ color: '#f8fafc' }}>{s.sourcetype}</span></div>}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* F2: Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', fontSize: '0.75rem', color: '#64748b' }}>
          <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={pageBtn(page === 0)}>← Prev</button>
            <span style={{ padding: '0.375rem 0.5rem', color: '#94a3b8' }}>Page {page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={pageBtn(page >= totalPages - 1)}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '0.375rem 0.625rem', background: '#1e293b', border: '1px solid #334155',
  color: '#f8fafc', borderRadius: 6, fontSize: '0.75rem',
};
const thStyle: React.CSSProperties = {
  padding: '0.625rem 0.75rem', textAlign: 'left', color: '#64748b',
  cursor: 'pointer', userSelect: 'none', fontWeight: 500, fontSize: '0.75rem', whiteSpace: 'nowrap',
};
const flagStyle = (color: string): React.CSSProperties => ({
  fontSize: '0.75rem', padding: '0.1rem 0.25rem', borderRadius: 3, background: `${color}20`,
});
const pageBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '0.375rem 0.75rem', background: disabled ? '#0f172a' : '#1e293b',
  border: '1px solid #1e293b', color: disabled ? '#334155' : '#94a3b8',
  borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '0.75rem',
});
