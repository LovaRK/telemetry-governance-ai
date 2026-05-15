'use client';

import { useMemo } from 'react';

interface Asset {
  telemetry_asset: string;
  value_score: number;
  waste_score: number;
  risk_score: number;
  recommendation: { action: string; priority: string };
  estimated_annual_cost?: number;
  estimated_savings?: number;
  scoring_breakdown?: { derived_from: Record<string, number> };
}

interface OperationalIntelligenceFeedProps {
  assets: Asset[];
}

export default function OperationalIntelligenceFeed({ assets }: OperationalIntelligenceFeedProps) {
  const findings = useMemo(() => {
    const results: Array<{ type: string; severity: string; message: string }> = [];
    
    const eliminate = assets.filter(a => a.recommendation.action === 'ELIMINATE');
    const optimize = assets.filter(a => a.recommendation.action === 'OPTIMIZE');
    const archive = assets.filter(a => a.recommendation.action === 'ARCHIVE');
    const investigate = assets.filter(a => a.recommendation.action === 'INVESTIGATE');
    const staleSources = assets.filter(a => (a.scoring_breakdown?.derived_from?.low_search_usage || 0) > 0);
    const largeRetention = assets.filter(a => (a.estimated_annual_cost || 0) > 100000);

    if (eliminate.length > 0) {
      results.push({ type: 'Eliminate', severity: 'high', message: `${eliminate.length} sources with zero operational usage detected` });
    }
    if (optimize.length > 0) {
      results.push({ type: 'Optimize', severity: 'medium', message: `${optimize.length} sources showing inefficient resource utilization` });
    }
    if (archive.length > 0) {
      results.push({ type: 'Archive', severity: 'low', message: `${archive.length} sources eligible for cold storage/archive` });
    }
    if (investigate.length > 0) {
      results.push({ type: 'Anomaly', severity: 'medium', message: `${investigate.length} sources showing suspicious patterns` });
    }
    if (staleSources.length > 0) {
      results.push({ type: 'Stale', severity: 'medium', message: `${staleSources.length} sources with low search frequency` });
    }
    if (largeRetention.length > 0) {
      results.push({ type: 'Retention', severity: 'low', message: `${largeRetention.length} high-cost sources may have excessive retention` });
    }

    return results;
  }, [assets]);

  const SEVERITY_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
    high: { bg: '#ef444420', text: '#ef4444', icon: '⬆' },
    medium: { bg: '#f59e0b20', text: '#f59e0b', icon: '→' },
    low: { bg: '#3b82f620', text: '#3b82f6', icon: '↓' }
  };

  return (
    <div style={{ marginBottom: '2rem' }}>
      <h3 style={{ marginBottom: '1rem', fontSize: '1.125rem', fontWeight: 600, color: '#f8fafc' }}>
        Operational Intelligence Feed
      </h3>
      <div style={{ 
        background: '#0f172a', 
        borderRadius: '12px', 
        padding: '1rem', 
        border: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem'
      }}>
        {findings.map((finding, idx) => {
          const style = SEVERITY_COLORS[finding.severity] || SEVERITY_COLORS.low;
          return (
            <div key={idx} style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.75rem',
              padding: '0.75rem',
              background: '#1e293b',
              borderRadius: '8px'
            }}>
              <span style={{ 
                width: 24, 
                height: 24, 
                borderRadius: '6px', 
                background: style.bg,
                color: style.text,
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {style.icon}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: style.text, fontSize: '0.75rem', fontWeight: 600 }}>{finding.type}</span>
                  <span style={{ color: '#64748b', fontSize: '0.65rem', textTransform: 'uppercase' }}>{finding.severity}</span>
                </div>
                <span style={{ color: '#cbd5e1', fontSize: '0.8rem' }}>{finding.message}</span>
              </div>
            </div>
          );
        })}
        {findings.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
            No operational issues detected
          </div>
        )}
      </div>
    </div>
  );
}