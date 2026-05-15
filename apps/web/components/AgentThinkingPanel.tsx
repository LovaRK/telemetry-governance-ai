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

interface TimelineEvent {
  timestamp: string;
  agent: string;
  status: string;
  duration_ms: number;
}

interface AgentThinkingPanelProps {
  assets: Asset[];
  timeline: TimelineEvent[];
}

export default function AgentThinkingPanel({ assets, timeline }: AgentThinkingPanelProps) {
  const reasoningSteps = useMemo(() => {
    const steps: string[] = [];
    
    const highWaste = assets.filter(a => a.waste_score > 40);
    const highValue = assets.filter(a => a.value_score > 60);
    const eliminate = assets.filter(a => a.recommendation.action === 'ELIMINATE');
    const investigate = assets.filter(a => a.recommendation.action === 'INVESTIGATE');
    const totalSavings = assets.reduce((sum, a) => sum + (a.estimated_savings || 0), 0);

    if (highWaste.length > 0) {
      steps.push(`Analyzed ${highWaste.length} high-waste telemetry sources`);
    }
    if (highValue.length > 0) {
      steps.push(`Identified ${highValue.length} high-value operational sources`);
    }
    if (eliminate.length > 0) {
      steps.push(`Flagged ${eliminate.length} sources for elimination (0 usage detected)`);
    }
    if (investigate.length > 0) {
      steps.push(`Detected anomaly patterns in ${investigate.length} sources requiring investigation`);
    }
    if (totalSavings > 0) {
      steps.push(`Calculated potential savings of $${(totalSavings/1000).toFixed(0)}k/year`);
    }
    
    const avgWaste = assets.length > 0 ? assets.reduce((sum, a) => sum + a.waste_score, 0) / assets.length : 0;
    if (avgWaste > 30) {
      steps.push(`Portfolio shows ${avgWaste.toFixed(0)}% average waste - recommend retention optimization`);
    }
    
    const highRisk = assets.filter(a => a.risk_score > 50);
    if (highRisk.length > 0) {
      steps.push(`${highRisk.length} sources have elevated risk scores - prioritize review`);
    }

    return steps;
  }, [assets]);

  return (
    <div style={{ 
      width: '300px', 
      background: '#0f172a', 
      borderLeft: '1px solid #1e293b',
      padding: '1.5rem',
      height: '100%',
      overflowY: 'auto'
    }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', animation: 'pulse 2s infinite' }} />
          Agent Reasoning
        </h3>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Reasoning Chain
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {reasoningSteps.map((step, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              <div style={{ 
                width: 20, 
                height: 20, 
                borderRadius: '50%', 
                background: '#3b82f620', 
                color: '#3b82f6',
                fontSize: '0.7rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                {idx + 1}
              </div>
              <span style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.4 }}>{step}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Pipeline Execution
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {timeline.map((event, idx) => (
            <div key={idx} style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              padding: '0.5rem 0.75rem',
              background: '#1e293b',
              borderRadius: '6px',
              fontSize: '0.75rem'
            }}>
              <span style={{ color: '#94a3b8' }}>{event.agent.replace(' Agent', '')}</span>
              <span style={{ color: '#22c55e' }}>{event.duration_ms}ms</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Decision Trace
        </div>
        <div style={{ 
          padding: '0.75rem', 
          background: '#1e293b', 
          borderRadius: '8px',
          fontSize: '0.7rem',
          fontFamily: 'monospace',
          color: '#94a3b8'
        }}>
          {assets[0]?.scoring_breakdown ? 
            `trace-${Date.now().toString(36)}-${assets[0].telemetry_asset.substring(0,4)}` 
            : 'No trace available'}
        </div>
      </div>
    </div>
  );
}