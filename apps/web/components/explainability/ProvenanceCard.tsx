'use client';

import React from 'react';
import { KPIExplainabilityRecord } from '@/lib/types';

interface Props {
  record: KPIExplainabilityRecord;
  onOpen: (record: KPIExplainabilityRecord) => void;
}

export default function ProvenanceCard({ record, onOpen }: Props) {
  const label = record.displayLabel || record.metricId;
  return (
    <button
      onClick={() => onOpen(record)}
      style={{
        textAlign: 'left',
        background: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: 8,
        color: '#e2e8f0',
        padding: '0.75rem',
        cursor: 'pointer',
      }}
    >
      <div style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{Number(record.value || 0).toFixed(2)}</div>
      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{record.formulaExpression || 'Unavailable'}</div>
      <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#94a3b8' }}>Confidence: {record.confidence || 'Unknown'}</div>
      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Source: {record.sourceOrigin || record.sourceTable || 'Unknown'}</div>
    </button>
  );
}
