'use client';

import React, { useState } from 'react';

interface Trace {
  stage: string;
  stage_order: number;
  reasoning: string;
  evidence: string[];
  confidence: number;
  duration_ms: number;
  timestamp: string;
}

interface Props {
  pipelineTrace?: {
    decision_traces: Trace[];
    overall_confidence: number;
    trace_id: string;
  } | null;
}

const STAGE_LABELS: Record<string, string> = {
  connection: 'Connection',
  discovery: 'Discovery',
  context: 'Context',
  reasoning: 'Reasoning',
  value: 'Value',
  prioritization: 'Prioritization',
  composition: 'Composition',
};

const STAGE_COLORS: Record<string, string> = {
  connection: '#22c55e',
  discovery: '#3b82f6',
  context: '#8b5cf6',
  reasoning: '#f59e0b',
  value: '#ef4444',
  prioritization: '#06b6d4',
  composition: '#ec4899',
};

export default function DecisionTimeline({ pipelineTrace }: Props) {
  const [expandedStage, setExpandedStage] = useState<string | null>(null);

  if (!pipelineTrace || !pipelineTrace.decision_traces || pipelineTrace.decision_traces.length === 0) {
    return (
      <div style={{ marginBottom: '2rem', padding: '1.5rem', background: '#0f172a', borderRadius: '12px', border: '1px solid #1e293b', color: '#94a3b8' }}>
        No decision trace available — pipeline may have failed early.
      </div>
    );
  }

  const traces = [...pipelineTrace.decision_traces].sort((a, b) => a.stage_order - b.stage_order);

  return (
    <div style={{ marginBottom: '2rem', padding: '1.5rem', background: '#0f172a', borderRadius: '12px', border: '1px solid #1e293b' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#f8fafc' }}>Decision Timeline</h3>
        <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
          Overall Confidence: <strong style={{ color: '#22c55e' }}>{(pipelineTrace.overall_confidence * 100).toFixed(1)}%</strong>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {traces.map((trace) => {
          const isExpanded = expandedStage === trace.stage;
          const color = STAGE_COLORS[trace.stage] || '#94a3b8';
          
          return (
            <div
              key={trace.stage}
              onClick={() => setExpandedStage(isExpanded ? null : trace.stage)}
              style={{
                padding: '1rem',
                background: '#1e293b',
                borderRadius: '8px',
                border: `1px solid ${isExpanded ? color : '#334155'}`,
                cursor: 'pointer',
                transition: 'border-color 0.2s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: color,
                  }} />
                  <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.875rem' }}>
                    {STAGE_LABELS[trace.stage] || trace.stage}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {trace.duration_ms}ms
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ width: 80, height: 6, background: '#334155', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      width: `${trace.confidence * 100}%`,
                      height: '100%',
                      background: color,
                      borderRadius: 3,
                    }} />
                  </div>
                  <span style={{ fontSize: '0.75rem', color: color, fontWeight: 600, minWidth: 40, textAlign: 'right' }}>
                    {(trace.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              {isExpanded && (
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #334155' }}>
                  <div style={{ marginBottom: '0.75rem', color: '#f8fafc', fontSize: '0.875rem', lineHeight: 1.5 }}>
                    {trace.reasoning}
                  </div>
                  {trace.evidence.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>Evidence:</span>
                      {trace.evidence.map((ev, i) => (
                        <span key={i} style={{ fontSize: '0.75rem', color: '#94a3b8', paddingLeft: '0.75rem', borderLeft: '2px solid #334155' }}>
                          {ev}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
