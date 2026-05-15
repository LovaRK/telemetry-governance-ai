'use client';

import { useMemo } from 'react';

interface Asset {
  telemetry_asset: string;
  value_score: number;
  waste_score: number;
  risk_score: number;
  recommendation: { action: string; priority: string };
  estimated_annual_cost: number;
  estimated_savings: number;
  scoring_breakdown?: { derived_from: Record<string, number> };
}

interface ExecutiveOverviewProps {
  assets: Asset[];
  summary: {
    totalAssets: number;
    totalPotentialSavings: number;
  };
  scenario?: string;
}

export default function ExecutiveOverview({ assets, summary, scenario }: ExecutiveOverviewProps) {
  const stats = useMemo(() => {
    const totalCost = assets.reduce((sum, a) => sum + (a.estimated_annual_cost || 0), 0);
    const totalSavings = assets.reduce((sum, a) => sum + (a.estimated_savings || 0), 0);
    const avgValue = assets.length > 0 ? assets.reduce((sum, a) => sum + a.value_score, 0) / assets.length : 0;
    const avgWaste = assets.length > 0 ? assets.reduce((sum, a) => sum + a.waste_score, 0) / assets.length : 0;
    
    const actionCounts = assets.reduce((acc, a) => {
      acc[a.recommendation.action] = (acc[a.recommendation.action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return { totalCost, totalSavings, avgValue, avgWaste, actionCounts };
  }, [assets]);

  const agentInsight = useMemo(() => {
    if (stats.avgWaste > 50) {
      return `High telemetry waste detected. ${stats.actionCounts.ELIMINATE || 0} sources should be eliminated.`;
    } else if (stats.avgValue > 60) {
      return `Telemetry portfolio showing strong operational value.`;
    } else if (stats.actionCounts.INVESTIGATE) {
      return `${stats.actionCounts.INVESTIGATE} sources need investigation for anomalies.`;
    }
    return 'Analyzing telemetry patterns for optimization opportunities.';
  }, [stats]);

  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: '#0f172a', borderRadius: '12px', padding: '1.5rem', border: '1px solid #1e293b' }}>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Annual Telemetry Spend</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#f8fafc' }}>${(stats.totalCost / 1000).toFixed(0)}k</div>
          <div style={{ fontSize: '0.875rem', color: '#64748b' }}>across {assets.length} sources</div>
        </div>

        <div style={{ background: '#0f172a', borderRadius: '12px', padding: '1.5rem', border: '1px solid #1e293b' }}>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Projected Annual Savings</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: '#22c55e' }}>${(stats.totalSavings / 1000).toFixed(0)}k</div>
          <div style={{ fontSize: '0.875rem', color: '#64748b' }}>through optimization</div>
        </div>

        <div style={{ background: '#0f172a', borderRadius: '12px', padding: '1.5rem', border: '1px solid #1e293b' }}>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg Operational Value</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: stats.avgValue > 50 ? '#22c55e' : '#f59e0b' }}>{stats.avgValue.toFixed(0)}%</div>
          <div style={{ fontSize: '0.875rem', color: '#64748b' }}>value score across portfolio</div>
        </div>

        <div style={{ background: '#0f172a', borderRadius: '12px', padding: '1.5rem', border: '1px solid #1e293b' }}>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg Waste Score</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: stats.avgWaste > 40 ? '#ef4444' : '#f59e0b' }}>{stats.avgWaste.toFixed(0)}%</div>
          <div style={{ fontSize: '0.875rem', color: '#64748b' }}>inefficiency detected</div>
        </div>
      </div>

      <div style={{ background: '#1e293b', borderRadius: '12px', padding: '1.25rem', border: '1px solid #334155' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <span style={{ background: '#3b82f6', color: '#fff', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>AGENT INSIGHT</span>
          <span style={{ color: '#94a3b8', fontSize: '0.875rem' }}>{scenario?.replace(/_/g, ' ') || 'Full Analysis'}</span>
        </div>
        <p style={{ color: '#e2e8f0', fontSize: '1rem', margin: 0, lineHeight: 1.5 }}>{agentInsight}</p>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {Object.entries(stats.actionCounts).map(([action, count]) => (
            <span key={action} style={{ 
              padding: '0.25rem 0.75rem', 
              background: action === 'KEEP' ? '#22c55e20' : action === 'ELIMINATE' ? '#ef444420' : action === 'OPTIMIZE' ? '#f59e0b20' : '#3b82f620',
              color: action === 'KEEP' ? '#22c55e' : action === 'ELIMINATE' ? '#ef4444' : action === 'OPTIMIZE' ? '#f59e0b' : '#3b82f6',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 600
            }}>
              {action}: {count}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}