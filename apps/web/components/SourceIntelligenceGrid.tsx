'use client';

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

interface SourceIntelligenceGridProps {
  assets: Asset[];
}

const ACTION_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  KEEP: { bg: '#22c55e20', text: '#22c55e', border: '#22c55e' },
  OPTIMIZE: { bg: '#f59e0b20', text: '#f59e0b', border: '#f59e0b' },
  ARCHIVE: { bg: '#3b82f620', text: '#3b82f6', border: '#3b82f6' },
  ELIMINATE: { bg: '#ef444420', text: '#ef4444', border: '#ef4444' },
  INVESTIGATE: { bg: '#8b5cf620', text: '#8b5cf6', border: '#8b5cf6' }
};

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '0.25rem' }}>
        <span style={{ color: '#94a3b8' }}>{label}</span>
        <span style={{ color: color, fontWeight: 600 }}>{value}</span>
      </div>
      <div style={{ height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

export default function SourceIntelligenceGrid({ assets }: SourceIntelligenceGridProps) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <h3 style={{ marginBottom: '1rem', fontSize: '1.125rem', fontWeight: 600, color: '#f8fafc' }}>Sourcetype Intelligence Grid</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
        {assets.map((asset, idx) => {
          const style = ACTION_STYLES[asset.recommendation.action] || ACTION_STYLES.INVESTIGATE;
          const breakdown = asset.scoring_breakdown?.derived_from || {};
          
          return (
            <div key={idx} style={{ 
              background: '#0f172a', 
              borderRadius: '12px', 
              padding: '1.25rem', 
              border: `1px solid ${style.border}30`,
              transition: 'transform 0.2s, box-shadow 0.2s'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.9rem', marginBottom: '0.25rem' }}>{asset.telemetry_asset}</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>${(asset.estimated_annual_cost / 1000).toFixed(0)}k/year</div>
                </div>
                <span style={{ 
                  padding: '0.25rem 0.75rem', 
                  background: style.bg, 
                  color: style.text, 
                  borderRadius: '6px', 
                  fontSize: '0.75rem', 
                  fontWeight: 600 
                }}>
                  {asset.recommendation.action}
                </span>
              </div>

              <ScoreBar label="Value" value={asset.value_score} color="#22c55e" />
              <ScoreBar label="Waste" value={asset.waste_score} color={asset.waste_score > 40 ? '#ef4444' : '#f59e0b'} />
              <ScoreBar label="Risk" value={asset.risk_score} color={asset.risk_score > 50 ? '#ef4444' : '#3b82f6'} />

              <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #1e293b' }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.5rem' }}>WASTE FACTORS</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {Object.entries(breakdown).map(([key, val]) => (
                    val > 0 && (
                      <span key={key} style={{ 
                        padding: '0.125rem 0.5rem', 
                        background: '#1e293b', 
                        borderRadius: '4px', 
                        fontSize: '0.65rem', 
                        color: '#94a3b8' 
                      }}>
                        {key.replace(/_/g, ' ')}: {val}
                      </span>
                    )
                  ))}
                </div>
              </div>

              {asset.estimated_savings > 0 && (
                <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: '#22c55e10', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: '#22c55e' }}>Potential savings:</span>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#22c55e' }}>${(asset.estimated_savings / 1000).toFixed(0)}k</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}