'use client';

import React from 'react';

interface ProvenanceBadgeProps {
  source: string;
  pipelineRunId?: string;
  generatedAt?: string;
  classification?: 'REAL' | 'DERIVED' | 'BASELINE' | 'EMPTY';
}

const classificationColors: Record<string, string> = {
  REAL: '#22c55e',
  DERIVED: '#3b82f6',
  BASELINE: '#f59e0b',
  EMPTY: '#6b7280',
};

const classificationLabels: Record<string, string> = {
  REAL: 'Data-backed',
  DERIVED: 'Computed',
  BASELINE: 'Reference',
  EMPTY: 'No data',
};

export default function ProvenanceBadge({
  source,
  pipelineRunId,
  generatedAt,
  classification = 'REAL',
}: ProvenanceBadgeProps) {
  const formattedTime = generatedAt ? new Date(generatedAt).toLocaleString() : 'Unknown';
  const tooltipText = `Source: ${source}\nGenerated: ${formattedTime}\nPipeline: ${pipelineRunId || 'unknown'}`;

  return (
    <div
      title={tooltipText}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.25rem 0.75rem',
        borderRadius: 6,
        background: 'rgba(100, 116, 139, 0.1)',
        border: '1px solid rgba(100, 116, 139, 0.3)',
        fontSize: '0.75rem',
        color: '#94a3b8',
        cursor: 'help',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: classificationColors[classification],
        }}
      />
      <span>{classificationLabels[classification]}</span>
      <span style={{ color: '#64748b', fontSize: '0.65rem' }}>•</span>
      <span style={{ fontSize: '0.7rem' }}>{source}</span>
    </div>
  );
}
