'use client';

import { useState } from 'react';

interface DecisionTrace {
  stage: string;
  stage_order: number;
  reasoning: string;
  evidence: string[];
  confidence: number;
  timestamp: string;
  duration_ms: number;
}

interface PipelineTrace {
  decision_traces: DecisionTrace[];
  overall_confidence: number;
  trace_id: string;
}

interface DecisionTimelineProps {
  pipelineTrace?: PipelineTrace;
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return '#22c55e';
  if (confidence >= 0.5) return '#f59e0b';
  return '#ef4444';
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return 'High';
  if (confidence >= 0.5) return 'Medium';
  return 'Low';
}

export default function DecisionTimeline({ pipelineTrace }: DecisionTimelineProps) {
  const [expandedStage, setExpandedStage] = useState<string | null>(null);

  if (!pipelineTrace?.decision_traces?.length) {
    return (
      <div style={{ padding: '1rem', background: '#1e293b', borderRadius: '8px', textAlign: 'center', color: '#64748b' }}>
        No decision traces available
      </div>
    );
  }

  const traces = pipelineTrace.decision_traces;

  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#f8fafc' }}>Decision Timeline</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Overall Confidence:</span>
          <span style={{ 
            padding: '0.25rem 0.75rem', 
            background: `${getConfidenceColor(pipelineTrace.overall_confidence)}20`,
            color: getConfidenceColor(pipelineTrace.overall_confidence),
            borderRadius: '4px',
            fontSize: '0.75rem',
            fontWeight: 600
          }}>
            {getConfidenceLabel(pipelineTrace.overall_confidence)} ({(pipelineTrace.overall_confidence * 100).toFixed(0)}%)
          </span>
        </div>
      </div>

      <div style={{ 
        display: 'flex', 
        gap: '0.5rem', 
        overflowX: 'auto', 
        paddingBottom: '0.5rem',
        marginBottom: '1rem'
      }}>
        {traces.map((trace, idx) => (
          <div key={trace.stage} style={{ display: 'flex', alignItems: 'center' }}>
            <button
              onClick={() => setExpandedStage(expandedStage === trace.stage ? null : trace.stage)}
              style={{
                padding: '0.75rem 1rem',
                background: expandedStage === trace.stage ? '#3b82f6' : '#1e293b',
                border: `1px solid ${getConfidenceColor(trace.confidence)}40`,
                borderRadius: '8px',
                color: '#f8fafc',
                cursor: 'pointer',
                minWidth: '120px',
                textAlign: 'center',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                Stage {trace.stage_order}
              </div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                {trace.stage.charAt(0).toUpperCase() + trace.stage.slice(1)}
              </div>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                gap: '0.25rem'
              }}>
                <div style={{ 
                  width: 8, 
                  height: 8, 
                  borderRadius: '50%', 
                  background: getConfidenceColor(trace.confidence) 
                }} />
                <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                  {(trace.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </button>
            {idx < traces.length - 1 && (
              <div style={{ 
                width: 20, 
                height: 2, 
                background: '#334155',
                margin: '0 0.25rem'
              }} />
            )}
          </div>
        ))}
      </div>

      {expandedStage && (
        <div style={{ 
          background: '#0f172a', 
          borderRadius: '12px', 
          padding: '1.25rem', 
          border: '1px solid #1e293b',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
          
          {traces.filter(t => t.stage === expandedStage).map(trace => (
            <div key={trace.stage}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#f8fafc' }}>
                  {trace.stage.charAt(0).toUpperCase() + trace.stage.slice(1)} Agent Reasoning
                </h4>
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{trace.duration_ms}ms</span>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem' }}>REASONING</div>
                <p style={{ margin: 0, color: '#e2e8f0', fontSize: '0.875rem', lineHeight: 1.5 }}>{trace.reasoning}</p>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem' }}>CONFIDENCE</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ flex: 1, height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ 
                      width: `${trace.confidence * 100}%`, 
                      height: '100%', 
                      background: getConfidenceColor(trace.confidence),
                      borderRadius: 4
                    }} />
                  </div>
                  <span style={{ 
                    fontSize: '0.875rem', 
                    fontWeight: 600, 
                    color: getConfidenceColor(trace.confidence) 
                  }}>
                    {(trace.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem' }}>EVIDENCE ({trace.evidence.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {trace.evidence.slice(0, 5).map((ev, i) => (
                    <div key={i} style={{ 
                      padding: '0.5rem 0.75rem', 
                      background: '#1e293b', 
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      color: '#cbd5e1',
                      fontFamily: 'monospace'
                    }}>
                      {ev}
                    </div>
                  ))}
                  {trace.evidence.length > 5 && (
                    <div style={{ fontSize: '0.7rem', color: '#64748b', textAlign: 'center' }}>
                      +{trace.evidence.length - 5} more evidence items
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '0.75rem', fontSize: '0.7rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span>Trace ID:</span>
        <code style={{ background: '#1e293b', padding: '0.125rem 0.5rem', borderRadius: '4px' }}>{pipelineTrace.trace_id}</code>
      </div>
    </div>
  );
}