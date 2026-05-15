'use client';

import React from 'react';

interface KpiData {
  totalIndices: number;
  totalSourcetypes: number;
  totalPotentialSavings: number;
  avgConfidence: number;
  highRiskCount: number;
}

interface Props {
  kpis: KpiData;
  summary?: {
    totalAssets: number;
    totalPotentialSavings: number;
  };
  scenario?: string;
}

export default function ExecutiveOverview({ kpis, summary, scenario }: Props) {
  const cards = [
    { label: 'Total Indices', value: kpis.totalIndices, color: '#3b82f6' },
    { label: 'Sourcetypes', value: kpis.totalSourcetypes, color: '#8b5cf6' },
    { label: 'High Risk', value: kpis.highRiskCount, color: '#ef4444', alert: kpis.highRiskCount > 0 },
    { label: 'Avg Confidence', value: `${(kpis.avgConfidence * 100).toFixed(0)}%`, color: '#22c55e' },
    { label: 'Potential Savings', value: `$${(kpis.totalPotentialSavings / 1000).toFixed(0)}k`, color: '#f59e0b' },
  ];

  return (
    <div style={{ marginBottom: '2rem' }}>
      {scenario && (
        <div style={{ marginBottom: '1rem', padding: '0.5rem 1rem', background: '#1e293b', borderRadius: '6px', color: '#94a3b8', fontSize: '0.875rem' }}>
          Scenario: <strong style={{ color: '#f8fafc' }}>{scenario.replace(/_/g, ' ')}</strong>
        </div>
      )}
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {cards.map((card) => (
          <div
            key={card.label}
            style={{
              padding: '1.25rem',
              background: '#0f172a',
              borderRadius: '12px',
              border: `1px solid ${card.alert ? '#ef4444' : '#1e293b'}`,
              borderLeft: `4px solid ${card.color}`,
            }}
          >
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
              {card.label}
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc' }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
