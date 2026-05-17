'use client';

import React, { useState } from 'react';

interface SectionExplainerProps {
  title: string;
  summary: string;
  dataInputs: string[];
  decisionLogic: string;
  isCollapsed?: boolean;
}

export default function SectionExplainer({
  title,
  summary,
  dataInputs,
  decisionLogic,
  isCollapsed = true,
}: SectionExplainerProps) {
  const [collapsed, setCollapsed] = useState(isCollapsed);

  return (
    <div
      style={{
        marginBottom: '1rem',
        padding: '0.875rem 1rem',
        background: '#0f1a2e',
        border: '1px solid #1e3a5f',
        borderRadius: 8,
        color: '#cbd5e1',
        fontSize: '0.8rem',
      }}
    >
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ color: '#3b82f6', fontSize: '1rem' }}>ℹ️</span>
        <span style={{ flex: 1, fontWeight: 600, color: '#94a3b8' }}>How was this calculated? {collapsed ? '▾' : '▴'}</span>
      </div>

      {!collapsed && (
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #1e3a5f' }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ color: '#64748b', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
              {title}
            </div>
            <div style={{ color: '#cbd5e1', lineHeight: 1.4 }}>{summary}</div>
          </div>

          {dataInputs.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ color: '#64748b', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
                Data Inputs
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {dataInputs.map((input) => (
                  <span
                    key={input}
                    style={{
                      padding: '0.25rem 0.5rem',
                      background: '#1e293b',
                      borderRadius: 4,
                      fontFamily: 'monospace',
                      fontSize: '0.7rem',
                      color: '#94a3b8',
                    }}
                  >
                    {input}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <div style={{ color: '#64748b', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
              Decision Logic
            </div>
            <div style={{ color: '#cbd5e1', lineHeight: 1.4, fontSize: '0.75rem' }}>{decisionLogic}</div>
          </div>
        </div>
      )}
    </div>
  );
}
