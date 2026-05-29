'use client';

/**
 * TierDistribution — visualization of index tier breakdown.
 * Pure visualization component — receives all values as props.
 */

import React from 'react';
import { TIER_COLORS, ACTION_COLORS, fmt$ } from './utils';
import { ScoreBar } from './kpi-gauges';

interface Snapshot {
  tier: string;
  utilizationScore: number;
  detectionScore: number;
  qualityScore: number;
  costPerYear: number;
  classification: string;
  estimatedSavings?: number;
}

interface TierBar {
  label: string;
  key: string;
  value: number;
  color: string;
}

interface TierDistributionProps {
  tierBars: TierBar[];
  tierTotal: number;
  snapshots: Snapshot[];
  avgUtilization: number;
  avgDetection: number;
  avgQuality: number;
  avgConfidencePct: number;
  snapshotDate?: string;
  agentReasoning?: string;
  onTierClick?: (tierKey: string, tierLabel: string, count: number) => void;
}

export function TierDistribution({
  tierBars,
  tierTotal,
  snapshots,
  avgUtilization,
  avgDetection,
  avgQuality,
  avgConfidencePct,
  snapshotDate,
  agentReasoning,
  onTierClick,
}: TierDistributionProps) {
  const actionCounts: Record<string, number> = {};
  snapshots.forEach((s) => {
    actionCounts[s.classification] = (actionCounts[s.classification] || 0) + 1;
  });

  const card: React.CSSProperties = {
    padding: '1.5rem', background: '#0f172a', borderRadius: 12,
    border: '1px solid #1e293b', position: 'relative'
  };
  const cardTitle: React.CSSProperties = {
    fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600
  };
  const AIBadge = (
    <div style={{
      position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem',
      backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px',
      borderRadius: '12px', fontWeight: 500
    }}>🤖 AI</div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
      {/* Tier Distribution */}
      <div style={card}>
        {AIBadge}
        <div style={cardTitle}>
          Tier Distribution <span style={{ color: '#334155' }}>— {tierTotal} indexes</span>
        </div>
        <div style={{
          height: 12, borderRadius: 6, overflow: 'hidden',
          display: 'flex', marginBottom: '1rem'
        }}>
          {tierBars.filter(t => t.value > 0).map((t) => (
            <div key={t.key} style={{ flex: t.value, background: t.color }}
              title={`${t.label}: ${t.value}`} />
          ))}
        </div>
        {tierBars.map((t) => {
          const tierSnaps = snapshots.filter(s =>
            new RegExp(t.label.toLowerCase().replace('-', '.'), 'i').test(s.tier)
          );
          const tierSpend = tierSnaps.reduce((s, v) => s + v.costPerYear, 0);
          return (
            <div
              key={t.key}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: '0.5rem', fontSize: '0.8rem', cursor: onTierClick ? 'pointer' : 'default',
                padding: '0.25rem 0.5rem', borderRadius: 4
              }}
              onClick={() => onTierClick?.(t.key, t.label, t.value)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: t.color }} />
                <span style={{ color: '#94a3b8' }}>{t.label}</span>
              </div>
              <span style={{ fontWeight: 600, color: '#f8fafc' }}>{t.value}</span>
            </div>
          );
        })}
      </div>

      {/* Score Averages */}
      <div style={card}>
        {AIBadge}
        <div style={cardTitle}>Score Averages</div>
        <ScoreBar label="Utilization" value={avgUtilization} color="#3b82f6" />
        <ScoreBar label="Detection Coverage" value={avgDetection} color="#8b5cf6" />
        <ScoreBar label="Data Quality" value={avgQuality} color="#22c55e" />
        <ScoreBar label="Confidence" value={avgConfidencePct} color="#f59e0b" />
        <div style={{ marginTop: '0.75rem', fontSize: '0.7rem', color: '#475569', textAlign: 'right' }}>
          Snapshot: {snapshotDate ? new Date(snapshotDate).toLocaleDateString() : '—'}
        </div>
      </div>

      {/* Agent Actions */}
      <div style={card}>
        {AIBadge}
        <div style={cardTitle}>Agent Actions</div>
        {Object.entries(actionCounts).length === 0 ? (
          <div style={{ color: '#475569', fontSize: '0.875rem' }}>No actions yet</div>
        ) : (
          Object.entries(actionCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([action, count]) => {
              const pct = snapshots.length > 0 ? (count / snapshots.length) * 100 : 0;
              const color = ACTION_COLORS[action] || '#64748b';
              return (
                <div key={action} style={{ marginBottom: '0.625rem' }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: '0.75rem', marginBottom: '0.2rem'
                  }}>
                    <span style={{ color, fontWeight: 600 }}>{action}</span>
                    <span style={{ color: '#94a3b8' }}>{count} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div style={{ height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3 }} />
                  </div>
                </div>
              );
            })
        )}
      </div>
    </div>
  );
}
