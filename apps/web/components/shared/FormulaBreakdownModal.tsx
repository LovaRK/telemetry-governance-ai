'use client';

import React from 'react';

interface ComponentValue {
  label: string;
  value: number | string;
  weight?: string; // e.g., "35%", "0.40"
}

interface FormulaBreakdownModalProps {
  isOpen: boolean;
  metricName: string;
  formula: string;
  components: ComponentValue[];
  result: number | string;
  unit?: string; // e.g., "%", "$", ""
  onClose: () => void;
}

export default function FormulaBreakdownModal({
  isOpen,
  metricName,
  formula,
  components,
  result,
  unit = '',
  onClose,
}: FormulaBreakdownModalProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0f172a',
          borderRadius: 12,
          border: '1px solid #1e293b',
          padding: '2rem',
          maxWidth: '600px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.25rem', fontWeight: 700 }}>
            {metricName}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              fontSize: '1.5rem',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        {/* Formula Section */}
        <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#1e293b', borderRadius: 8 }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase' }}>
            Formula
          </div>
          <div style={{ fontSize: '0.95rem', color: '#e2e8f0', fontFamily: 'monospace', lineHeight: 1.6, wordBreak: 'break-word' }}>
            {formula}
          </div>
        </div>

        {/* Components Section */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
            Components
          </div>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {components.map((comp, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.75rem',
                  background: '#1e293b',
                  borderRadius: 6,
                  borderLeft: '3px solid #3b82f6',
                }}
              >
                <div>
                  <div style={{ color: '#f8fafc', fontSize: '0.9rem', fontWeight: 500 }}>
                    {comp.label}
                  </div>
                  {comp.weight && (
                    <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                      Weight: {comp.weight}
                    </div>
                  )}
                </div>
                <div style={{ color: '#22c55e', fontSize: '1rem', fontWeight: 600, fontFamily: 'monospace' }}>
                  {comp.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Result Section */}
        <div style={{ marginBottom: '1.5rem', padding: '1.25rem', background: 'rgba(34, 197, 94, 0.1)', borderRadius: 8, border: '1px solid #22c55e' }}>
          <div style={{ fontSize: '0.75rem', color: '#22c55e', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase' }}>
            Result
          </div>
          <div style={{ fontSize: '2rem', color: '#22c55e', fontWeight: 700, fontFamily: 'monospace' }}>
            {result}
            {unit && <span style={{ fontSize: '1.5rem', marginLeft: '0.5rem' }}>{unit}</span>}
          </div>
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '0.75rem',
            borderRadius: 6,
            border: '1px solid #1e293b',
            background: '#1e293b',
            color: '#f8fafc',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
