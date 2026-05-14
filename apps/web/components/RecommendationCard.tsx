'use client';

import { TelemetryAsset } from '../lib/types';

interface RecommendationCardProps {
  asset: TelemetryAsset;
}

const actionColors: Record<string, string> = {
  KEEP: '#22c55e',
  OPTIMIZE: '#f59e0b',
  ARCHIVE: '#3b82f6',
  ELIMINATE: '#ef4444',
  INVESTIGATE: '#8b5cf6'
};

export default function RecommendationCard({ asset }: RecommendationCardProps) {
  const color = actionColors[asset.recommendation.action] || '#666';

  return (
    <div style={{ 
      padding: '1.5rem', 
      background: '#1a1a1a', 
      borderRadius: '8px', 
      border: `2px solid ${color}`,
      marginBottom: '1rem'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <span style={{ fontWeight: 600, fontSize: '1.125rem' }}>{asset.telemetry_asset}</span>
        <span style={{ 
          padding: '0.25rem 0.75rem', 
          background: color, 
          borderRadius: '4px', 
          fontSize: '0.875rem',
          fontWeight: 600
        }}>
          {asset.recommendation.action}
        </span>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ textAlign: 'center', padding: '0.5rem', background: '#0a0a0a', borderRadius: '4px' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#22c55e' }}>{asset.value_score}</div>
          <div style={{ fontSize: '0.75rem', color: '#888' }}>Value</div>
        </div>
        <div style={{ textAlign: 'center', padding: '0.5rem', background: '#0a0a0a', borderRadius: '4px' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#ef4444' }}>{asset.waste_score}</div>
          <div style={{ fontSize: '0.75rem', color: '#888' }}>Waste</div>
        </div>
        <div style={{ textAlign: 'center', padding: '0.5rem', background: '#0a0a0a', borderRadius: '4px' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#f59e0b' }}>{asset.risk_score}</div>
          <div style={{ fontSize: '0.75rem', color: '#888' }}>Risk</div>
        </div>
      </div>

      {asset.estimated_savings && (
        <div style={{ fontSize: '1.25rem', fontWeight: 600, color: '#22c55e', marginBottom: '0.5rem' }}>
          Potential Savings: ${(asset.estimated_savings / 1000).toFixed(0)}k/year
        </div>
      )}

      {asset.evidence.length > 0 && (
        <div style={{ fontSize: '0.875rem', color: '#ccc', marginBottom: '0.5rem' }}>
          <strong>Evidence:</strong> {asset.evidence.slice(0, 3).join(' • ')}
        </div>
      )}

      {asset.scoring_breakdown && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#0a0a0a', borderRadius: '4px', fontSize: '0.75rem' }}>
          <div style={{ color: '#888', marginBottom: '0.5rem' }}>Scoring Breakdown:</div>
          <div style={{ color: '#ccc' }}>
            Waste Score: {asset.scoring_breakdown.waste_score} → 
            ingest(+{asset.scoring_breakdown.derived_from.ingest_volume}), 
            low_usage(+{asset.scoring_breakdown.derived_from.low_search_usage}), 
            duplicates(+{asset.scoring_breakdown.derived_from.duplicate_patterns})
          </div>
        </div>
      )}
    </div>
  );
}