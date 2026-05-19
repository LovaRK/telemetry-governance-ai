'use client';

import React, { useState } from 'react';
import { SnapshotRow } from '../../lib/types';

interface Props {
  snapshots: SnapshotRow[];
}

interface SourcetypeBucket {
  sourcetype: string;
  indexCount: number;
  avgCompositeScore: number;
  avgUtilization: number;
  totalSavings: number;
  highRiskCount: number;
  actions: Record<string, number>;
}

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

function riskColor(score: number): string {
  if (score < 30) return '#ef4444';
  if (score < 50) return '#f59e0b';
  if (score < 70) return '#3b82f6';
  return '#22c55e';
}

function riskLabel(score: number): string {
  if (score < 30) return 'High Risk';
  if (score < 50) return 'Medium Risk';
  if (score < 70) return 'Low Risk';
  return 'Healthy';
}

export default function SourcetypeRiskHeatmap({ snapshots }: Props) {
  const [sortBy, setSortBy] = useState<'risk' | 'savings' | 'count'>('risk');
  const [hovered, setHovered] = useState<string | null>(null);

  // Bucket snapshots by sourcetype
  const bucketMap = new Map<string, SourcetypeBucket>();

  for (const s of snapshots) {
    const key = s.sourcetype || '(no sourcetype)';
    if (!bucketMap.has(key)) {
      bucketMap.set(key, { sourcetype: key, indexCount: 0, avgCompositeScore: 0, avgUtilization: 0, totalSavings: 0, highRiskCount: 0, actions: {} });
    }
    const b = bucketMap.get(key)!;
    b.indexCount++;
    b.avgCompositeScore += s.compositeScore || 0;
    b.avgUtilization += s.utilizationScore || 0;
    b.totalSavings += s.estimatedSavings || 0;
    if ((s.compositeScore || 0) < 40) b.highRiskCount++;
    if (s.classification) {
      b.actions[s.classification] = (b.actions[s.classification] || 0) + 1;
    }
  }

  let buckets = Array.from(bucketMap.values()).map(b => ({
    ...b,
    avgCompositeScore: b.indexCount > 0 ? b.avgCompositeScore / b.indexCount : 0,
    avgUtilization: b.indexCount > 0 ? b.avgUtilization / b.indexCount : 0,
  }));

  if (sortBy === 'risk') buckets.sort((a, b) => a.avgCompositeScore - b.avgCompositeScore);
  else if (sortBy === 'savings') buckets.sort((a, b) => b.totalSavings - a.totalSavings);
  else buckets.sort((a, b) => b.indexCount - a.indexCount);

  if (buckets.length === 0) {
    return <div style={{ color: '#475569', fontSize: '0.85rem' }}>No sourcetype data available</div>;
  }

  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc' }}>Sourcetype Risk Heatmap</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['risk', 'savings', 'count'] as const).map(s => (
            <button key={s} onClick={() => setSortBy(s)} style={{
              padding: '0.2rem 0.6rem', borderRadius: 4, fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', border: 'none',
              background: sortBy === s ? '#3b82f6' : '#1e293b', color: sortBy === s ? '#fff' : '#64748b',
            }}>{s === 'risk' ? 'By Risk' : s === 'savings' ? 'By Savings' : 'By Count'}</button>
          ))}
        </div>
      </div>

      {/* Heatmap grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem' }}>
        {buckets.map(b => {
          const color = riskColor(b.avgCompositeScore);
          const isHov = hovered === b.sourcetype;
          return (
            <div key={b.sourcetype}
              onMouseEnter={() => setHovered(b.sourcetype)}
              onMouseLeave={() => setHovered(null)}
              style={{
                background: `${color}12`,
                border: `1px solid ${isHov ? color : color + '40'}`,
                borderRadius: 6,
                padding: '0.75rem',
                cursor: 'default',
                transition: 'all 0.15s',
                transform: isHov ? 'scale(1.02)' : 'none',
              }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}
                title={b.sourcetype}>{b.sourcetype}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontSize: '0.65rem', color, fontWeight: 600 }}>{riskLabel(b.avgCompositeScore)}</span>
              </div>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, color, marginBottom: 2 }}>{b.avgCompositeScore.toFixed(0)}</div>
              <div style={{ fontSize: '0.6rem', color: '#475569', marginBottom: 4 }}>composite · {b.indexCount} index{b.indexCount !== 1 ? 'es' : ''}</div>
              {b.totalSavings > 0 && (
                <div style={{ fontSize: '0.65rem', color: '#22c55e', fontWeight: 600 }}>{fmt$(b.totalSavings)} potential</div>
              )}
              {/* Action mini breakdown */}
              {Object.keys(b.actions).length > 0 && (
                <div style={{ display: 'flex', gap: 2, marginTop: 5, flexWrap: 'wrap' }}>
                  {Object.entries(b.actions).map(([action, cnt]) => (
                    <span key={action} style={{ fontSize: '0.5rem', padding: '0 3px', borderRadius: 2, background: `${ACTION_COLORS[action] || '#64748b'}25`, color: ACTION_COLORS[action] || '#64748b', fontWeight: 700 }}>
                      {action[0]}{cnt > 1 ? `×${cnt}` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        {[['#ef4444', 'High Risk (<30)'], ['#f59e0b', 'Medium (30-50)'], ['#3b82f6', 'Low (50-70)'], ['#22c55e', 'Healthy (70+)']].map(([c, l]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />
            <span style={{ fontSize: '0.62rem', color: '#475569' }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
