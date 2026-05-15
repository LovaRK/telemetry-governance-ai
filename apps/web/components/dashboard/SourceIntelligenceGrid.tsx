'use client';

import React, { useState } from 'react';
import { DashboardAsset } from '../../lib/mappers';

interface Props {
  assets: DashboardAsset[];
}

const CLASSIFICATION_BADGES: Record<string, { bg: string; color: string }> = {
  KEEP: { bg: '#22c55e20', color: '#22c55e' },
  OPTIMIZE: { bg: '#f59e0b20', color: '#f59e0b' },
  ARCHIVE: { bg: '#3b82f620', color: '#3b82f6' },
  ELIMINATE: { bg: '#ef444420', color: '#ef4444' },
  INVESTIGATE: { bg: '#8b5cf620', color: '#8b5cf6' },
};

export default function SourceIntelligenceGrid({ assets }: Props) {
  const [sortKey, setSortKey] = useState<keyof DashboardAsset>('riskScore');
  const [sortDesc, setSortDesc] = useState(true);
  const [filterClass, setFilterClass] = useState<string>('');

  const sorted = [...assets]
    .filter((a) => !filterClass || a.classification === filterClass)
    .sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDesc ? bVal - aVal : aVal - bVal;
      }
      return sortDesc ? String(bVal).localeCompare(String(aVal)) : String(aVal).localeCompare(String(bVal));
    });

  const headers: Array<{ key: keyof DashboardAsset; label: string }> = [
    { key: 'indexName', label: 'Index' },
    { key: 'sourcetype', label: 'Sourcetype' },
    { key: 'dailyAvgGb', label: 'GB/Day' },
    { key: 'utilizationPct', label: 'Util %' },
    { key: 'costPerYear', label: 'Cost/Yr' },
    { key: 'riskScore', label: 'Risk' },
    { key: 'classification', label: 'Action' },
    { key: 'confidence', label: 'Conf' },
  ];

  return (
    <div style={{ padding: '1.5rem', background: '#0f172a', borderRadius: '12px', border: '1px solid #1e293b' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#f8fafc' }}>Source Intelligence Grid</h3>
        <select
          value={filterClass}
          onChange={(e) => setFilterClass(e.target.value)}
          style={{ padding: '0.5rem', background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', borderRadius: '6px' }}
        >
          <option value="">All Classifications</option>
          <option value="KEEP">KEEP</option>
          <option value="OPTIMIZE">OPTIMIZE</option>
          <option value="ARCHIVE">ARCHIVE</option>
          <option value="ELIMINATE">ELIMINATE</option>
          <option value="INVESTIGATE">INVESTIGATE</option>
        </select>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #1e293b' }}>
              {headers.map((h) => (
                <th
                  key={h.key as string}
                  onClick={() => {
                    if (sortKey === h.key) setSortDesc(!sortDesc);
                    else { setSortKey(h.key); setSortDesc(true); }
                  }}
                  style={{
                    padding: '0.75rem',
                    textAlign: 'left',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    userSelect: 'none',
                    fontWeight: 500,
                  }}
                >
                  {h.label} {sortKey === h.key ? (sortDesc ? '▼' : '▲') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((asset) => {
              const badge = CLASSIFICATION_BADGES[asset.classification] || { bg: '#334155', color: '#94a3b8' };
              return (
                <tr key={`${asset.indexName}-${asset.sourcetype || ''}`} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '0.75rem', color: '#f8fafc', fontWeight: 500 }}>{asset.indexName}</td>
                  <td style={{ padding: '0.75rem', color: '#94a3b8' }}>{asset.sourcetype || '—'}</td>
                  <td style={{ padding: '0.75rem', color: '#f8fafc' }}>{asset.dailyAvgGb.toFixed(2)}</td>
                  <td style={{ padding: '0.75rem', color: '#f8fafc' }}>{asset.utilizationPct}%</td>
                  <td style={{ padding: '0.75rem', color: '#f8fafc' }}>${asset.costPerYear.toLocaleString()}</td>
                  <td style={{ padding: '0.75rem', color: asset.riskScore > 70 ? '#ef4444' : asset.riskScore > 40 ? '#f59e0b' : '#22c55e', fontWeight: 600 }}>
                    {asset.riskScore}
                  </td>
                  <td style={{ padding: '0.75rem' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      background: badge.bg,
                      color: badge.color,
                    }}>
                      {asset.classification}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem', color: '#94a3b8' }}>{(asset.confidence * 100).toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
