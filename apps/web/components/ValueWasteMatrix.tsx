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
}

interface ValueWasteMatrixProps {
  assets: Asset[];
}

const ACTION_COLORS: Record<string, string> = {
  KEEP: '#22c55e',
  OPTIMIZE: '#f59e0b',
  ARCHIVE: '#3b82f6',
  ELIMINATE: '#ef4444',
  INVESTIGATE: '#8b5cf6'
};

export default function ValueWasteMatrix({ assets }: ValueWasteMatrixProps) {
  const { normalizedAssets, maxCost } = useMemo(() => {
    const maxAnnualCost = Math.max(...assets.map(a => a.estimated_annual_cost || 0), 1);
    return {
      normalizedAssets: assets.map(a => ({
        ...a,
        costNormalized: ((a.estimated_annual_cost || 0) / maxAnnualCost) * 100
      })),
      maxCost: maxAnnualCost
    };
  }, [assets]);

  const getPosition = (value: number, waste: number) => {
    const x = (value / 100) * 100;
    const y = 100 - (waste / 100) * 100;
    return { x, y };
  };

  return (
    <div style={{ marginBottom: '2rem', background: '#0f172a', borderRadius: '12px', padding: '1.5rem', border: '1px solid #1e293b' }}>
      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600, color: '#f8fafc' }}>Telemetry Value Matrix</h3>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem' }}>
          {Object.entries(ACTION_COLORS).map(([action, color]) => (
            <span key={action} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
              <span style={{ color: '#94a3b8' }}>{action}</span>
            </span>
          ))}
        </div>
      </div>

      <div style={{ position: 'relative', height: '320px', background: '#1e293b', borderRadius: '8px', overflow: 'hidden' }}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          <defs>
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#334155" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#grid)" />
          
          <line x1="0" y1="50" x2="100" y2="50" stroke="#475569" strokeWidth="1" strokeDasharray="4" />
          <line x1="50" y1="0" x2="50" y2="100" stroke="#475569" strokeWidth="1" strokeDasharray="4" />
          
          <text x="50" y="98" textAnchor="middle" fill="#64748b" fontSize="3">Operational Value</text>
          <text x="5" y="50" textAnchor="middle" fill="#64748b" fontSize="3" transform="rotate(-90, 5, 50)">Waste Score</text>
          
          <text x="50" y="5" textAnchor="middle" fill="#22c55e" fontSize="3" fontWeight="bold">HIGH VALUE</text>
          <text x="5" y="95" textAnchor="middle" fill="#ef4444" fontSize="3" fontWeight="bold">HIGH WASTE</text>
        </svg>

        {normalizedAssets.map((asset, idx) => {
          const pos = getPosition(asset.value_score, asset.waste_score);
          const radius = Math.max(3, Math.min(12, asset.costNormalized / 10));
          const color = ACTION_COLORS[asset.recommendation.action] || '#94a3b8';
          
          return (
            <div
              key={idx}
              style={{
                position: 'absolute',
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                transform: 'translate(-50%, -50%)',
                width: radius * 2,
                height: radius * 2,
                borderRadius: '50%',
                background: color,
                border: '2px solid rgba(255,255,255,0.3)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: `${Math.max(6, radius / 3)}px`,
                fontWeight: 600,
                boxShadow: `0 0 ${radius}px ${color}40`,
                transition: 'transform 0.2s'
              }}
              title={`${asset.telemetry_asset}\nValue: ${asset.value_score}\nWaste: ${asset.waste_score}\nCost: $${(asset.estimated_annual_cost/1000).toFixed(0)}k`}
            >
              {asset.telemetry_asset.substring(0, 3)}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b' }}>
        <span>Bubble size = Annual Cost</span>
        <span>Higher = More expensive</span>
      </div>
    </div>
  );
}